from __future__ import annotations

import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import BackgroundTasks, Depends, FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from web3 import Web3

from blockchain import AgreementChain, ChainConfig, ChainError, SubmissionUnknown
from blockchain.signing import ApprovalError, approval_payload, snapshot_hash, verify_approval_signature
from .agent import CALL_CONTEXT, AgentError, KilnAgent, MockAgent
from .config import Settings
from .models import (
    AgreementView, ApprovalPayloadView, AuditView, BuyerIntentInput,
    BuyerIntentView, ChainView, DecisionInput, DecisionView, DemoSessionInput, DemoSessionView,
    ErrorView, HealthView, ListingInput, ListingView, NegotiationInput, NegotiationStartView,
    NegotiationView,
)
from .policy import evaluate_offer
from .store import Store, evidence_hash, new_id, parse_time, utc_now, utc_stamp


class ApiError(Exception):
    def __init__(self, code: str, status: int = 400, message: str | None = None):
        super().__init__(code)
        self.code = code
        self.status = status
        self.message = message or ERROR_MESSAGES.get(code, code)


ERROR_MESSAGES = {
    "SESSION_REQUIRED": "데모 세션을 다시 연결하세요.",
    "ROLE_FORBIDDEN": "이 역할에서는 요청할 수 없습니다.",
    "REQUEST_NOT_FOUND": "요청을 찾을 수 없습니다.",
    "NEGOTIATION_NOT_FOUND": "협상을 찾을 수 없습니다.",
    "AGREEMENT_NOT_FOUND": "합의안을 찾을 수 없습니다.",
    "IDEMPOTENCY_REQUIRED": "Idempotency-Key 헤더가 필요합니다.",
    "IDEMPOTENCY_CONFLICT": "같은 Idempotency-Key에 다른 요청 본문이 사용되었습니다.",
    "STATE_CONFLICT": "현재 상태에서는 이 작업을 수행할 수 없습니다.",
    "APPROVAL_STALE": "합의 내용이 변경되었습니다. 최신 내용을 다시 확인하세요.",
    "SIGNATURE_INVALID": "현재 사용자 지갑의 유효한 서명이 아닙니다.",
    "CHAIN_CONFIG_UNAVAILABLE": "블록체인 서명 설정이 없습니다.",
    "KILN_UNAVAILABLE": "Kiln 모델 서비스에 연결할 수 없습니다.",
    "KILN_AUTH_FAILED": "Kiln API 키가 올바르지 않습니다.",
    "KILN_CREDITS_EXHAUSTED": "Kiln 크레딧이 부족합니다.",
    "KILN_RATE_LIMITED": "Kiln 호출 한도에 걸렸습니다. 잠시 후 다시 시도하세요.",
    "KILN_TIMEOUT": "Kiln 응답이 너무 늦어 중단했습니다.",
    "KILN_MODEL_UNAVAILABLE": "Kiln에서 설정한 모델을 사용할 수 없습니다.",
    "INVALID_MODEL_OUTPUT": "모델 응답을 검증할 수 없어 제안을 중단했습니다.",
    "VALIDATION_ERROR": "요청 조건을 확인해 주세요.",
    "OFFER_EXPIRED": "합의안 승인 기한이 지났습니다.",
    "DEMO_SESSIONS_DISABLED": "이 환경에서는 데모 세션을 사용할 수 없습니다.",
    "EVIDENCE_NOT_OWNED": "이 판매자 계정에 등록된 데모 증빙 ID가 아닙니다.",
}


def _hash_token(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _sha256_json(value: dict[str, Any]) -> str:
    raw = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _datetime_string(value: datetime | str) -> str:
    return utc_stamp(value if isinstance(value, datetime) else parse_time(value))


def _public_listing(listing: dict[str, Any], request_id: str, *, include_private: bool) -> dict[str, Any]:
    result = {
        "request_id": request_id,
        "id": listing["id"],
        "seller_id": listing["seller_id"],
        "gpu_model": listing["gpu_model"],
        "asking_price_krw": listing["asking_price_krw"],
        "shipping_fee_krw": listing["shipping_fee_krw"],
        "evidence_ids": list(listing["evidence_ids"]),
    }
    if include_private:
        result["private_policy"] = dict(listing["private_policy"])
    return result


OFFER_PUBLIC_FIELDS = (
    "id", "negotiation_id", "listing_id", "round", "proposer", "item_price_krw",
    "shipping_fee_krw", "total_krw", "delivery_by", "warranty_terms", "expires_at",
    "evidence_ids", "rationale", "valid",
)


def _public_offer(offer: dict[str, Any]) -> dict[str, Any]:
    return {key: offer[key] for key in OFFER_PUBLIC_FIELDS}


AUDIT_EVENT_PUBLIC_FIELDS = (
    "at", "actor", "event_type", "object_id", "decision", "reason_code",
)


def _public_audit_event(event: dict[str, Any]) -> dict[str, Any]:
    return {key: event[key] for key in AUDIT_EVENT_PUBLIC_FIELDS}


def _chain_view(value: dict[str, Any] | None) -> dict[str, Any]:
    return value or {
        "mode": None, "chain_id": None, "tx_hash": None, "receipt_status": None,
        "block_number": None, "event_name": None, "recorded_hash": None, "reason_code": None,
    }


def create_app(settings: Settings | None = None, *, database_path: str | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    if database_path is not None:
        settings = Settings(**{**settings.__dict__, "database_path": database_path})
    settings.validate()
    store = Store(settings.database_path)
    store.seed_demo_listings(settings.actors)

    app = FastAPI(title="Agent Accord API", version="0.1.0")
    app.state.settings = settings
    app.state.store = store
    app.state.agent = MockAgent() if settings.mode == "mock" else KilnAgent(settings)
    app.state.chain = None

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            settings.app_origin, "http://localhost:5173", "http://127.0.0.1:5173",
        ],
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
    )

    @app.middleware("http")
    async def request_id(request: Request, call_next):
        request.state.request_id = new_id("req")
        response = await call_next(request)
        response.headers["X-Request-Id"] = request.state.request_id
        return response

    @app.exception_handler(ApiError)
    async def api_error_handler(request: Request, exc: ApiError):
        return JSONResponse(
            status_code=exc.status,
            content=ErrorView(
                request_id=getattr(request.state, "request_id", None),
                error={"code": exc.code, "message": exc.message or ERROR_MESSAGES.get(exc.code, exc.code)},
            ).model_dump(mode="json"),
        )

    @app.exception_handler(RequestValidationError)
    async def request_validation_handler(request: Request, _exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content={
                "request_id": getattr(request.state, "request_id", None),
                "error": {"code": "VALIDATION_ERROR", "message": "요청 형식이나 값이 올바르지 않습니다."},
            },
        )

    @app.exception_handler(Exception)
    async def internal_error_handler(request: Request, _exc: Exception):
        return JSONResponse(
            status_code=500,
            content={
                "request_id": getattr(request.state, "request_id", None),
                "error": {"code": "INTERNAL_ERROR", "message": "서버에서 요청을 처리하지 못했습니다."},
            },
        )

    def current_actor(
        request: Request, authorization: str | None = Header(default=None)
    ) -> dict[str, Any]:
        if not authorization or not authorization.startswith("Bearer "):
            raise ApiError("SESSION_REQUIRED", 401)
        token = authorization[7:].strip()
        if not token:
            raise ApiError("SESSION_REQUIRED", 401)
        session = store.get_session(_hash_token(token))
        if not session or parse_time(session["expires_at"]) <= utc_now():
            raise ApiError("SESSION_REQUIRED", 401)
        actor = settings.actors.get(session["actor_id"])
        if not actor:
            raise ApiError("SESSION_REQUIRED", 401)
        return {
            "actor_id": session["actor_id"],
            "role": actor["role"],
            "wallet_address": actor["wallet_address"].lower(),
        }

    def require_role(actor: dict[str, Any], role: str) -> None:
        if actor["role"] != role:
            raise ApiError("ROLE_FORBIDDEN", 403)

    def load_agreement(agreement_id: str, actor: dict[str, Any]) -> dict[str, Any]:
        agreement = store.get("agreement", agreement_id)
        if not agreement:
            raise ApiError("AGREEMENT_NOT_FOUND", 404)
        if actor["actor_id"] not in {agreement["buyer_id"], agreement["seller_id"]}:
            raise ApiError("ROLE_FORBIDDEN", 403)
        return agreement

    def agreement_view(agreement: dict[str, Any], request_id: str) -> dict[str, Any]:
        return {
            "request_id": request_id,
            "id": agreement["id"],
            "flow_id": agreement["flow_id"],
            "offer_id": agreement["offer_id"],
            "status": agreement["status"],
            "snapshot": agreement["snapshot"],
            "snapshot_hash": agreement["snapshot_hash"],
            "assessment": agreement["assessment"],
            "rationale": agreement["rationale"],
            "buyer_approved": bool(agreement.get("buyer_signature")),
            "seller_approved": bool(agreement.get("seller_signature")),
            "chain": _chain_view(agreement.get("chain")),
        }

    def decision_view(agreement: dict[str, Any], request_id: str) -> dict[str, Any]:
        return {
            "request_id": request_id,
            "agreement_id": agreement["id"],
            "status": agreement["status"],
            "buyer_approved": bool(agreement.get("buyer_signature")),
            "seller_approved": bool(agreement.get("seller_signature")),
            "chain": _chain_view(agreement.get("chain")),
        }

    def current_chain_client() -> AgreementChain:
        if settings.chain_mode != "live":
            raise ApiError("CHAIN_CONFIG_UNAVAILABLE", 503)
        if not settings.contract_address or not settings.relayer_private_key:
            raise ApiError("CHAIN_CONFIG_UNAVAILABLE", 503)
        if app.state.chain is None:
            try:
                app.state.chain = AgreementChain(ChainConfig(
                    rpc_url=settings.chain_rpc_url,
                    chain_id=settings.chain_id,
                    contract_address=settings.contract_address,
                    relayer_private_key=settings.relayer_private_key,
                ))
            except Exception as exc:
                raise ApiError("CHAIN_CONFIG_UNAVAILABLE", 503) from exc
        return app.state.chain

    def chain_domain() -> tuple[int, str]:
        if not settings.contract_address:
            raise ApiError("CHAIN_CONFIG_UNAVAILABLE", 503)
        if settings.chain_mode == "live":
            client = current_chain_client()
            return client.config.chain_id, client.config.contract_address
        return settings.chain_id, Web3.to_checksum_address(settings.contract_address)

    def reconcile_live(agreement: dict[str, Any]) -> dict[str, Any]:
        chain_data = agreement.get("chain") or {}
        tx_hash = chain_data.get("tx_hash")
        if settings.chain_mode != "live" or not tx_hash or agreement["status"] != "RECORDING":
            return agreement
        try:
            client = current_chain_client()
            result = client.get_record(tx_hash, agreement["snapshot_hash"])
            updated = dict(agreement)
            if result["status"] == "success":
                updated["status"] = "RECORDED"
                updated["chain"] = {
                    "mode": "testnet", "chain_id": result["chain_id"], "tx_hash": result["tx_hash"],
                    "receipt_status": "success", "block_number": result["block_number"],
                    "event_name": "AgreementRecorded", "recorded_hash": result["agreement_hash"],
                    "reason_code": None,
                }
                store.add_event(agreement["flow_id"], "chain", "AGREEMENT_RECORDED",
                                object_id=agreement["id"], decision="confirmed")
            elif result["status"] == "failed":
                updated["status"] = "CHAIN_FAILED"
                updated["chain"] = {
                    **chain_data, "mode": "testnet", "chain_id": settings.chain_id,
                    "receipt_status": "failed", "reason_code": "CHAIN_FAILED",
                }
                store.add_event(agreement["flow_id"], "chain", "CHAIN_FAILED",
                                object_id=agreement["id"], decision="failed", reason_code="CHAIN_FAILED")
            else:
                return agreement
            with store.transaction() as conn:
                store.put("agreement", agreement["id"], agreement["buyer_id"], updated, conn)
            return updated
        except ApiError:
            return agreement
        except Exception:
            # Keep the persisted transaction pending; an RPC error is not proof of failure.
            return agreement

    def submit_live_agreement(agreement_id: str) -> None:
        agreement = store.get("agreement", agreement_id)
        if not agreement or agreement["status"] != "RECORDING":
            return
        client = current_chain_client()

        def persist_hash(tx_hash: str) -> None:
            current = store.get("agreement", agreement_id)
            if not current:
                raise RuntimeError("agreement disappeared")
            current["chain"] = {
                "mode": "testnet", "chain_id": settings.chain_id, "tx_hash": tx_hash,
                "receipt_status": "pending", "block_number": None, "event_name": None,
                "recorded_hash": None, "reason_code": None,
            }
            with store.transaction() as conn:
                store.put("agreement", agreement_id, current["buyer_id"], current, conn)

        try:
            submission = client.record_agreement(
                agreement, agreement["buyer_signature"], agreement["seller_signature"],
                persist_tx_hash=persist_hash,
                previous_tx_hash=(agreement.get("chain") or {}).get("tx_hash"),
            )
            if submission["status"] == "submitted":
                result = client.get_record(submission["tx_hash"], agreement["snapshot_hash"])
            elif submission["status"] == "previous_submission":
                result = submission["record"]
            else:
                raise ChainError("record has no verifiable transaction receipt")
            current = store.get("agreement", agreement_id)
            if not current:
                return
            if result["status"] == "success":
                current["status"] = "RECORDED"
                current["chain"] = {
                    "mode": "testnet", "chain_id": result["chain_id"], "tx_hash": result["tx_hash"],
                    "receipt_status": "success", "block_number": result["block_number"],
                    "event_name": "AgreementRecorded", "recorded_hash": result["agreement_hash"],
                    "reason_code": None,
                }
                store.add_event(current["flow_id"], "chain", "AGREEMENT_RECORDED",
                                object_id=agreement_id, decision="confirmed")
            elif result["status"] in {"pending", "not_found"}:
                current["status"] = "RECORDING"
                current["chain"] = {
                    "mode": "testnet", "chain_id": settings.chain_id,
                    "tx_hash": result.get("tx_hash") or (current.get("chain") or {}).get("tx_hash"),
                    "receipt_status": "pending", "block_number": result.get("block_number"),
                    "event_name": None, "recorded_hash": None, "reason_code": None,
                }
                store.add_event(current["flow_id"], "chain", "CHAIN_PENDING",
                                object_id=agreement_id, decision="pending")
            else:
                raise ChainError("chain transaction failed")
            with store.transaction() as conn:
                store.put("agreement", agreement_id, current["buyer_id"], current, conn)
        except SubmissionUnknown:
            # The adapter committed the original hash before broadcast; do not replace it.
            current = store.get("agreement", agreement_id)
            if current:
                store.add_event(current["flow_id"], "chain", "CHAIN_SUBMISSION_UNKNOWN",
                                object_id=agreement_id, decision="pending")
        except Exception as exc:
            current = store.get("agreement", agreement_id)
            if current:
                tx_hash = (current.get("chain") or {}).get("tx_hash")
                if tx_hash:
                    # A persisted hash always takes the read-only reconciliation path.
                    return
                current["status"] = "CHAIN_FAILED"
                current["chain"] = {
                    "mode": "testnet", "chain_id": settings.chain_id, "tx_hash": None,
                    "receipt_status": "failed", "block_number": None, "event_name": None,
                    "recorded_hash": None, "reason_code": "CHAIN_FAILED",
                }
                store.add_event(current["flow_id"], "chain", "CHAIN_FAILED",
                                object_id=agreement_id, decision="failed", reason_code="CHAIN_FAILED")
                with store.transaction() as conn:
                    store.put("agreement", agreement_id, current["buyer_id"], current, conn)

    def run_negotiation(negotiation_id: str) -> None:
        negotiation = store.get("negotiation", negotiation_id)
        if not negotiation or negotiation["status"] != "NEGOTIATING":
            return
        intent = store.get("intent", negotiation["buyer_intent_id"])
        if not intent:
            return
        # One candidate per seller: a seller's newest listing for this model replaces older ones.
        latest_by_seller: dict[str, dict[str, Any]] = {}
        for item in store.list("listing"):
            if item["gpu_model"].casefold() == intent["gpu_model"].casefold():
                latest_by_seller[item["seller_id"]] = item
        listings = list(latest_by_seller.values())[:3]
        assessments: list[dict[str, Any]] = []
        offers: list[dict[str, Any]] = []
        blocked_events: list[dict[str, str]] = []
        usages: list[dict[str, Any]] = []
        now = utc_now()

        if not listings:
            negotiation["status"] = "NO_MATCH"
            negotiation.update({"assessments": [], "offers": [], "blocked_events": [],
                                "selected_offer_id": None, "agreement_id": None})
            with store.transaction() as conn:
                store.put("negotiation", negotiation_id, negotiation["buyer_id"], negotiation, conn)
                store.add_event(negotiation["flow_id"], "server", "NO_MATCH", object_id=negotiation_id,
                                decision="blocked", reason_code="NO_MATCH", conn=conn)
            return

        def keep_usage(usage: dict[str, Any] | None) -> None:
            if not usage:
                return
            usage = dict(usage)
            repaired = usage.pop("repaired_from", None)
            if repaired:
                usages.append(repaired)
            usages.append(usage)

        for listing in listings:
            CALL_CONTEXT.set({"flow_id": negotiation["flow_id"], "listing_id": listing["id"]})
            # Skip model work for candidates that are already impossible at the seller floor.
            precheck = evaluate_offer(
                intent, listing,
                item_price_krw=listing["private_policy"]["min_item_price_krw"],
                delivery_by=listing["private_policy"]["earliest_delivery_at"],
                now=now,
            )
            if not precheck["allowed"]:
                blocked_events.extend({"reason_code": reason} for reason in precheck["reason_codes"])
                store.add_event(
                    negotiation["flow_id"], "server", "CANDIDATE_BLOCKED",
                    object_id=listing["id"], decision="blocked",
                    reason_code=precheck["reason_codes"][0],
                    details={"reason_codes": precheck["reason_codes"]},
                )
                continue

            try:
                assessment, assessment_usage = app.state.agent.assess(listing)
                keep_usage(assessment_usage)
                assessments.append({
                    "flow_id": negotiation["flow_id"], "listing_id": listing["id"],
                    "summary": assessment["summary"], "findings": assessment["findings"],
                    "source": "mock" if settings.mode == "mock" else "kiln",
                })
                buyer_offer, buyer_usage = app.state.agent.buyer_offer(intent, listing, assessment)
                keep_usage(buyer_usage)
                if buyer_offer.get("skip"):
                    blocked_events.append({"reason_code": "BUYER_AGENT_SKIPPED"})
                    store.add_event(
                        negotiation["flow_id"], "buyer-agent", "LISTING_SKIPPED",
                        object_id=listing["id"], decision="rejected", reason_code="BUYER_AGENT_SKIPPED",
                    )
                    continue
                if (type(buyer_offer.get("item_price_krw")) is not int
                    or buyer_offer["item_price_krw"] <= 0
                    or buyer_offer["item_price_krw"] > listing["asking_price_krw"]):
                    raise AgentError("INVALID_MODEL_OUTPUT")
                if buyer_offer["item_price_krw"] + listing["shipping_fee_krw"] > intent["max_total_krw"]:
                    blocked_events.append({"reason_code": "BUDGET_EXCEEDED"})
                    store.add_event(
                        negotiation["flow_id"], "server", "BUYER_OFFER_BLOCKED",
                        object_id=listing["id"], decision="blocked", reason_code="BUDGET_EXCEEDED",
                    )
                    continue
                seller_reply, seller_usage = app.state.agent.seller_reply(listing, buyer_offer)
                keep_usage(seller_usage)
                if seller_reply["action"] == "reject":
                    blocked_events.append({"reason_code": "SELLER_REJECTED"})
                    store.add_event(
                        negotiation["flow_id"], "seller-agent", "OFFER_REJECTED",
                        object_id=listing["id"], decision="rejected", reason_code="SELLER_REJECTED",
                    )
                    continue
                final_price = seller_reply["item_price_krw"]
                final_delivery = buyer_offer["delivery_by"]
                reasons = [f"구매 에이전트: {buyer_offer['reason']}"] if buyer_offer.get("reason") else []
                if seller_reply.get("reason"):
                    reasons.append(f"판매 에이전트: {seller_reply['reason']}")
                offer_round = 1
                if seller_reply["action"] == "counter":
                    buyer_reply, buyer_reply_usage = app.state.agent.buyer_reply(
                        intent, listing, assessment, buyer_offer, seller_reply,
                    )
                    keep_usage(buyer_reply_usage)
                    if buyer_reply["action"] != "accept":
                        blocked_events.append({"reason_code": "BUYER_REJECTED_COUNTER"})
                        store.add_event(
                            negotiation["flow_id"], "buyer-agent", "COUNTER_REJECTED",
                            object_id=listing["id"], decision="rejected",
                            reason_code="BUYER_REJECTED_COUNTER",
                        )
                        continue
                    offer_round = 2
                    final_delivery = seller_reply.get("delivery_by") or buyer_offer["delivery_by"]
                    if buyer_reply.get("reason"):
                        reasons.append(f"구매 에이전트 답: {buyer_reply['reason']}")
                decision = evaluate_offer(
                    intent, listing, item_price_krw=final_price,
                    delivery_by=_datetime_string(final_delivery), now=now,
                )
                if not decision["allowed"]:
                    blocked_events.extend({"reason_code": reason} for reason in decision["reason_codes"])
                    store.add_event(
                        negotiation["flow_id"], "server", "OFFER_BLOCKED",
                        object_id=listing["id"], decision="blocked",
                        reason_code=decision["reason_codes"][0],
                        details={"reason_codes": decision["reason_codes"]},
                    )
                    continue
                offers.append({
                    "id": new_id("offer"),
                    "negotiation_id": negotiation_id,
                    "listing_id": listing["id"],
                    "round": offer_round,
                    "proposer": "seller" if offer_round == 2 else "buyer",
                    "item_price_krw": final_price,
                    "shipping_fee_krw": listing["shipping_fee_krw"],
                    "total_krw": decision["total_krw"],
                    "delivery_by": _datetime_string(final_delivery),
                    "warranty_terms": buyer_offer["warranty_terms"],
                    "expires_at": utc_stamp(now + timedelta(hours=12)),
                    "evidence_ids": list(listing["evidence_ids"]),
                    "rationale": " ".join([(
                        "판매자 제안을 구매자 조건과 대조해 서버 검사를 통과했습니다."
                        if offer_round == 2 else
                        "판매자가 구매자 제안을 수락했고 구매 조건에 대한 서버 검사를 통과했습니다."
                    ), *reasons])[:900],
                    "valid": True,
                    "assessment": assessments[-1],
                    "seller_id": listing["seller_id"],
                    "seller_wallet": listing["seller_wallet"],
                    "evidence_hashes": sorted(set(listing.get("evidence_hashes", []))),
                })
                store.add_event(
                    negotiation["flow_id"], "server", "OFFER_ALLOWED",
                    object_id=listing["id"], decision="allowed",
                    details={"total_krw": decision["total_krw"], "checks": decision["checks"]},
                )
            except AgentError as exc:
                keep_usage(exc.usage)
                reason = exc.code
                blocked_events.append({"reason_code": reason})
                store.add_event(
                    negotiation["flow_id"], "agent", "MODEL_CALL_FAILED",
                    object_id=listing["id"], decision="blocked", reason_code=reason,
                )
            except (KeyError, TypeError, ValueError):
                blocked_events.append({"reason_code": "INVALID_MODEL_OUTPUT"})
                store.add_event(
                    negotiation["flow_id"], "agent", "MODEL_OUTPUT_REJECTED",
                    object_id=listing["id"], decision="blocked", reason_code="INVALID_MODEL_OUTPUT",
                )

        for usage in usages:
            store.add_usage(negotiation["flow_id"], usage)

        chosen = min(offers, key=lambda item: (item["total_krw"], item["id"])) if offers else None
        if chosen:
            agreement_id = new_id("agreement")
            buyer_actor = settings.actors[intent["buyer_id"]]
            seller_actor = settings.actors[chosen["seller_id"]]
            expiry = min(now + timedelta(hours=12), parse_time(intent["delivery_deadline"]))
            with store.transaction() as conn:
                nonce = store.allocate_nonce(buyer_actor["wallet_address"], agreement_id, conn)
                snapshot = {
                    "snapshot_version": 1,
                    "agreement_id": agreement_id,
                    "offer_id": chosen["id"],
                    "listing_id": chosen["listing_id"],
                    "seller_id": chosen["seller_id"],
                    "gpu_model": intent["gpu_model"],
                    "item_price_krw": chosen["item_price_krw"],
                    "shipping_fee_krw": chosen["shipping_fee_krw"],
                    "total_krw": chosen["total_krw"],
                    "delivery_by": chosen["delivery_by"],
                    "warranty_terms": chosen["warranty_terms"],
                    "evidence_hashes": chosen["evidence_hashes"],
                    "buyer_wallet": buyer_actor["wallet_address"].lower(),
                    "seller_wallet": seller_actor["wallet_address"].lower(),
                    "expires_at": utc_stamp(expiry),
                    "nonce": nonce,
                }
                try:
                    agreement_hash = snapshot_hash(snapshot)
                except ApprovalError:
                    negotiation["status"] = "BLOCKED"
                    negotiation.update({"assessments": assessments, "offers": [], "blocked_events": [
                        {"reason_code": "INVALID_DATA"},
                    ], "selected_offer_id": None, "agreement_id": None})
                    store.put("negotiation", negotiation_id, negotiation["buyer_id"], negotiation, conn)
                    store.add_event(negotiation["flow_id"], "server", "SNAPSHOT_INVALID",
                                    object_id=negotiation_id, decision="blocked",
                                    reason_code="INVALID_DATA", conn=conn)
                    return
                agreement = {
                    "id": agreement_id,
                    "flow_id": negotiation["flow_id"],
                    "buyer_id": intent["buyer_id"],
                    "seller_id": chosen["seller_id"],
                    "offer_id": chosen["id"],
                    "status": "AWAITING_APPROVALS",
                    "snapshot": snapshot,
                    "snapshot_hash": agreement_hash,
                    "assessment": chosen["assessment"],
                    "rationale": chosen["rationale"],
                    "buyer_signature": None,
                    "seller_signature": None,
                    "chain": _chain_view(None),
                }
                store.put("agreement", agreement_id, intent["buyer_id"], agreement, conn)
                negotiation.update({
                    "status": "AWAITING_APPROVALS",
                    "assessments": assessments,
                    "offers": offers,
                    "blocked_events": blocked_events,
                    "selected_offer_id": chosen["id"],
                    "agreement_id": agreement_id,
                })
                store.put("negotiation", negotiation_id, negotiation["buyer_id"], negotiation, conn)
                store.add_event(negotiation["flow_id"], "server", "AGREEMENT_CREATED",
                                object_id=agreement_id, decision="awaiting_approvals", conn=conn)
        else:
            status = "BLOCKED" if blocked_events else "NO_MATCH"
            negotiation.update({
                "status": status, "assessments": assessments, "offers": [],
                "blocked_events": blocked_events, "selected_offer_id": None, "agreement_id": None,
            })
            with store.transaction() as conn:
                store.put("negotiation", negotiation_id, negotiation["buyer_id"], negotiation, conn)
                store.add_event(negotiation["flow_id"], "server", status,
                                object_id=negotiation_id, decision="blocked" if status == "BLOCKED" else "no_match",
                                reason_code=(blocked_events[0]["reason_code"] if blocked_events else None), conn=conn)

    @app.get("/health", response_model=HealthView)
    def health():
        # Public facts only: never the key, only whether one is configured.
        relayer = None
        if settings.relayer_private_key:
            try:
                from eth_account import Account

                relayer = Account.from_key(settings.relayer_private_key).address
            except Exception:
                relayer = "invalid"
        return {
            "status": "ok", "contract_version": "0.1", "mode": settings.mode, "chain_mode": settings.chain_mode,
            "kiln": {"agent": "kiln" if settings.mode == "live" else "mock", "model_id": settings.kiln_model_id,
                     "base_url": settings.kiln_base_url, "api_key_configured": bool(settings.kiln_api_key)},
            "chain": {"chain_id": settings.chain_id, "contract_address": settings.contract_address or None,
                      "relayer_address": relayer, "explorer_url": settings.chain_explorer_url},
        }

    @app.post("/api/demo/sessions", response_model=DemoSessionView)
    def create_session(body: DemoSessionInput, request: Request):
        if not settings.allow_demo_sessions:
            raise ApiError("DEMO_SESSIONS_DISABLED", 403)
        profile = settings.actors.get(body.actor_id)
        if profile is None:
            raise ApiError("SESSION_REQUIRED", 401)
        token = secrets.token_urlsafe(32)
        expiry = utc_stamp(utc_now() + timedelta(seconds=settings.session_seconds))
        store.create_session(_hash_token(token), body.actor_id, expiry)
        return {
            "request_id": request.state.request_id, "access_token": token,
            "actor_id": body.actor_id, "role": profile["role"],
            "wallet_address": profile["wallet_address"].lower(),
        }

    @app.post("/api/buyer-intents", status_code=201, response_model=BuyerIntentView)
    def create_buyer_intent(body: BuyerIntentInput, request: Request, actor=Depends(current_actor)):
        require_role(actor, "buyer")
        if body.delivery_deadline.astimezone(timezone.utc) <= utc_now():
            raise ApiError("VALIDATION_ERROR", 422, "배송 기한은 현재보다 뒤여야 합니다.")
        intent_id = new_id("intent")
        payload = {
            "buyer_id": actor["actor_id"],
            "gpu_model": body.gpu_model,
            "max_total_krw": body.max_total_krw,
            "delivery_deadline": utc_stamp(body.delivery_deadline),
            "must_have": list(body.must_have),
        }
        with store.transaction() as conn:
            store.put("intent", intent_id, actor["actor_id"], payload, conn)
        return {"request_id": request.state.request_id, "id": intent_id,
                "buyer_id": actor["actor_id"], **payload}

    @app.post("/api/listings", status_code=201, response_model=ListingView)
    def create_listing(body: ListingInput, request: Request, actor=Depends(current_actor)):
        require_role(actor, "seller")
        owned_evidence_ids = {
            evidence_id
            for existing in store.list("listing")
            if existing["seller_id"] == actor["actor_id"]
            for evidence_id in existing["evidence_ids"]
        }
        if not set(body.evidence_ids).issubset(owned_evidence_ids):
            raise ApiError("EVIDENCE_NOT_OWNED", 422)
        # Reuse the registered evidence records (and their hashes) for the IDs the seller attached.
        known_evidence = {
            item["id"]: item
            for existing in store.list("listing")
            if existing["seller_id"] == actor["actor_id"]
            for item in existing.get("evidence", [])
        }
        evidence = [known_evidence[evidence_id] for evidence_id in body.evidence_ids if evidence_id in known_evidence]
        listing_id = new_id("listing")
        payload = {
            "seller_id": actor["actor_id"],
            "seller_wallet": actor["wallet_address"],
            "gpu_model": body.gpu_model,
            "asking_price_krw": body.asking_price_krw,
            "shipping_fee_krw": body.shipping_fee_krw,
            "condition_text": body.condition_text,
            "warranty_end": body.warranty_end.isoformat() if body.warranty_end else None,
            "stock_status": body.stock_status,
            "evidence_ids": list(body.evidence_ids),
            "evidence": evidence,
            "evidence_hashes": sorted({evidence_hash(item) for item in evidence}),
            "private_policy": {
                "min_item_price_krw": body.min_item_price_krw,
                "earliest_delivery_at": utc_stamp(body.earliest_delivery_at),
            },
            "source": "seller_claimed",
        }
        with store.transaction() as conn:
            store.put("listing", listing_id, actor["actor_id"], payload, conn)
        return _public_listing({"id": listing_id, **payload}, request.state.request_id, include_private=True)

    @app.post("/api/negotiations", status_code=202, response_model=NegotiationStartView)
    def start_negotiation(
        body: NegotiationInput, request: Request, background_tasks: BackgroundTasks,
        actor=Depends(current_actor), idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ):
        require_role(actor, "buyer")
        idempotency_key = idempotency_key.strip() if idempotency_key else ""
        if not idempotency_key or len(idempotency_key) > 128:
            raise ApiError("IDEMPOTENCY_REQUIRED", 400)
        intent = store.get("intent", body.buyer_intent_id)
        if not intent:
            raise ApiError("REQUEST_NOT_FOUND", 404)
        if intent["owner_id"] != actor["actor_id"]:
            raise ApiError("ROLE_FORBIDDEN", 403)
        body_hash = _sha256_json(body.model_dump(mode="json"))
        negotiation_id: str
        with store.transaction() as conn:
            try:
                prior = store.idempotency(actor["actor_id"], "negotiation", idempotency_key, body_hash, conn)
            except ValueError as exc:
                raise ApiError("IDEMPOTENCY_CONFLICT", 409) from exc
            if prior:
                existing = store.get("negotiation", prior, conn)
                if not existing:
                    raise ApiError("STATE_CONFLICT", 409)
                return {
                    "request_id": request.state.request_id, "id": existing["id"],
                    "flow_id": existing["flow_id"], "status": existing["status"],
                    "agreement_id": existing.get("agreement_id"),
                }
            negotiation_id, flow_id = new_id("neg"), new_id("flow")
            negotiation = {
                "flow_id": flow_id, "buyer_id": actor["actor_id"],
                "buyer_intent_id": body.buyer_intent_id, "status": "NEGOTIATING",
                "assessments": [], "offers": [], "blocked_events": [],
                "selected_offer_id": None, "agreement_id": None,
            }
            store.put("negotiation", negotiation_id, actor["actor_id"], negotiation, conn)
            store.save_idempotency(actor["actor_id"], "negotiation", idempotency_key,
                                   body_hash, negotiation_id, conn)
            store.add_event(flow_id, actor["actor_id"], "NEGOTIATION_STARTED",
                            object_id=negotiation_id, decision="started", conn=conn)
        background_tasks.add_task(run_negotiation, negotiation_id)
        return {
            "request_id": request.state.request_id, "id": negotiation_id,
            "flow_id": flow_id, "status": "NEGOTIATING", "agreement_id": None,
        }

    @app.get("/api/negotiations/{negotiation_id}", response_model=NegotiationView)
    def get_negotiation(negotiation_id: str, request: Request, actor=Depends(current_actor)):
        negotiation = store.get("negotiation", negotiation_id)
        if not negotiation:
            raise ApiError("NEGOTIATION_NOT_FOUND", 404)
        if negotiation["buyer_id"] != actor["actor_id"] or actor["role"] != "buyer":
            raise ApiError("ROLE_FORBIDDEN", 403)
        return {
            "request_id": request.state.request_id, "id": negotiation_id,
            "flow_id": negotiation["flow_id"], "status": negotiation["status"],
            "assessments": negotiation["assessments"],
            "offers": [_public_offer(item) for item in negotiation["offers"]],
            "blocked_events": negotiation["blocked_events"],
            "selected_offer_id": negotiation["selected_offer_id"],
            "agreement_id": negotiation["agreement_id"],
        }

    @app.get("/api/agreements", response_model=dict[str, Any])
    def list_agreements(
        request: Request, status: str | None = Query(default=None),
        actor=Depends(current_actor),
    ):
        allowed_statuses = {
            "AWAITING_APPROVALS", "RECORDING", "RECORDED", "MOCK_RECORDED",
            "REJECTED", "EXPIRED", "CHAIN_FAILED",
        }
        if status is not None and status not in allowed_statuses:
            raise ApiError("VALIDATION_ERROR", 400, "status 값이 유효하지 않습니다.")
        agreements = []
        for agreement in store.list("agreement"):
            permitted = (
                actor["actor_id"] == agreement["buyer_id"]
                or (actor["role"] == "seller" and actor["actor_id"] == agreement["seller_id"])
            )
            if not permitted or (status and agreement["status"] != status):
                continue
            agreements.append({
                "id": agreement["id"], "status": agreement["status"],
                "listing_id": agreement["snapshot"]["listing_id"],
                "total_krw": agreement["snapshot"]["total_krw"],
                "buyer_approved": bool(agreement.get("buyer_signature")),
                "seller_approved": bool(agreement.get("seller_signature")),
            })
        return {"request_id": request.state.request_id, "items": agreements}

    @app.get("/api/agreements/{agreement_id}", response_model=AgreementView)
    def get_agreement(agreement_id: str, request: Request, actor=Depends(current_actor)):
        agreement = load_agreement(agreement_id, actor)
        agreement = reconcile_live(agreement)
        return agreement_view(agreement, request.state.request_id)

    @app.get("/api/agreements/{agreement_id}/approval-payload", response_model=ApprovalPayloadView)
    def get_approval_payload(agreement_id: str, request: Request, actor=Depends(current_actor)):
        agreement = load_agreement(agreement_id, actor)
        if agreement["status"] != "AWAITING_APPROVALS":
            raise ApiError("STATE_CONFLICT", 409)
        if parse_time(agreement["snapshot"]["expires_at"]) <= utc_now():
            agreement["status"] = "EXPIRED"
            with store.transaction() as conn:
                store.put("agreement", agreement_id, agreement["buyer_id"], agreement, conn)
            raise ApiError("OFFER_EXPIRED", 409)
        if actor["actor_id"] == agreement["buyer_id"]:
            expected_wallet = agreement["snapshot"]["buyer_wallet"]
        else:
            expected_wallet = agreement["snapshot"]["seller_wallet"]
        chain_id, contract_address = chain_domain()
        try:
            payload = approval_payload(
                agreement["snapshot"], chain_id=chain_id, contract_address=contract_address,
                expected_hash=agreement["snapshot_hash"],
            )
        except ApprovalError as exc:
            raise ApiError("CHAIN_CONFIG_UNAVAILABLE", 503) from exc
        return {
            "request_id": request.state.request_id, **payload,
            "expected_wallet": expected_wallet,
        }

    @app.post("/api/agreements/{agreement_id}/decisions", response_model=DecisionView)
    def submit_decision(
        agreement_id: str, body: DecisionInput, request: Request, actor=Depends(current_actor)
    ):
        agreement = load_agreement(agreement_id, actor)
        if body.snapshot_hash != agreement["snapshot_hash"]:
            raise ApiError("APPROVAL_STALE", 409)
        is_buyer = actor["actor_id"] == agreement["buyer_id"]
        signature_key = "buyer_signature" if is_buyer else "seller_signature"
        wallet_key = "buyer_wallet" if is_buyer else "seller_wallet"
        if body.decision == "approve":
            chain_id, contract_address = chain_domain()
            try:
                typed = approval_payload(
                    agreement["snapshot"], chain_id=chain_id, contract_address=contract_address,
                    expected_hash=agreement["snapshot_hash"],
                )
                verify_approval_signature(
                    typed, body.signature or "", agreement["snapshot"][wallet_key],
                    chain_id=chain_id, contract_address=contract_address,
                )
            except ApprovalError as exc:
                raise ApiError("SIGNATURE_INVALID", 409, ERROR_MESSAGES["SIGNATURE_INVALID"]) from exc

        expired = False
        both_approved = False
        with store.transaction() as conn:
            current = store.get("agreement", agreement_id, conn)
            if not current:
                raise ApiError("AGREEMENT_NOT_FOUND", 404)
            if body.snapshot_hash != current["snapshot_hash"]:
                raise ApiError("APPROVAL_STALE", 409)
            if current.get(signature_key) and body.decision == "approve":
                if current[signature_key] != body.signature:
                    raise ApiError("STATE_CONFLICT", 409)
                agreement = current
            elif current["status"] != "AWAITING_APPROVALS":
                raise ApiError("STATE_CONFLICT", 409)
            elif parse_time(current["snapshot"]["expires_at"]) <= utc_now():
                current["status"] = "EXPIRED"
                store.put("agreement", agreement_id, current["buyer_id"], current, conn)
                store.add_event(current["flow_id"], "server", "AGREEMENT_EXPIRED",
                                object_id=agreement_id, decision="expired",
                                reason_code="OFFER_EXPIRED", conn=conn)
                agreement = current
                expired = True
            elif body.decision == "reject":
                current["status"] = "REJECTED"
                store.put("agreement", agreement_id, current["buyer_id"], current, conn)
                store.add_event(current["flow_id"], actor["actor_id"], "AGREEMENT_REJECTED",
                                object_id=agreement_id, decision="rejected", conn=conn)
                agreement = current
            else:
                current[signature_key] = body.signature
                store.add_event(current["flow_id"], actor["actor_id"], "AGREEMENT_APPROVED",
                                object_id=agreement_id, decision="approved", conn=conn)
                both_approved = bool(current.get("buyer_signature") and current.get("seller_signature"))
                if both_approved:
                    if settings.chain_mode == "mock":
                        current["status"] = "MOCK_RECORDED"
                        current["chain"] = {
                            "mode": "mock", "chain_id": None, "tx_hash": None,
                            "receipt_status": None, "block_number": None, "event_name": None,
                            "recorded_hash": None, "reason_code": None,
                        }
                        store.add_event(current["flow_id"], "mock-chain", "MOCK_RECORD_ONLY",
                                        object_id=agreement_id, decision="mock_recorded", conn=conn)
                    else:
                        current["status"] = "RECORDING"
                        current["chain"] = {
                            "mode": "testnet", "chain_id": settings.chain_id, "tx_hash": None,
                            "receipt_status": "pending", "block_number": None, "event_name": None,
                            "recorded_hash": None, "reason_code": None,
                        }
                store.put("agreement", agreement_id, current["buyer_id"], current, conn)
                agreement = current

        if expired:
            raise ApiError("OFFER_EXPIRED", 409)
        if both_approved and settings.chain_mode == "live":
            submit_live_agreement(agreement_id)
            agreement = store.get("agreement", agreement_id) or agreement
        return decision_view(agreement, request.state.request_id)

    @app.get("/api/flows/{flow_id}/audit", response_model=AuditView)
    def get_audit(flow_id: str, request: Request, actor=Depends(current_actor)):
        negotiation = next((row for row in store.list("negotiation") if row["flow_id"] == flow_id), None)
        if not negotiation:
            raise ApiError("REQUEST_NOT_FOUND", 404)
        if actor["actor_id"] != negotiation["buyer_id"]:
            agreement = store.get("agreement", negotiation.get("agreement_id", "")) if negotiation.get("agreement_id") else None
            if not agreement or actor["actor_id"] != agreement["seller_id"] or actor["role"] != "seller":
                raise ApiError("ROLE_FORBIDDEN", 403)
        agreement = store.get("agreement", negotiation.get("agreement_id", "")) if negotiation.get("agreement_id") else None
        usage = store.usages(flow_id)
        input_values = [item.get("input_tokens") for item in usage]
        output_values = [item.get("output_tokens") for item in usage]
        return {
            "request_id": request.state.request_id,
            "flow_id": flow_id,
            "status": negotiation["status"] if not agreement else agreement["status"],
            "events": [_public_audit_event(event) for event in store.events(flow_id)],
            "model_usage": usage,
            "totals": {
                "calls": len(usage),
                # Failed calls (e.g. 402/429) have no token counts; totals cover the calls that report usage.
                "input_tokens": sum(value for value in input_values if isinstance(value, int))
                    if any(isinstance(value, int) for value in input_values) else None,
                "output_tokens": sum(value for value in output_values if isinstance(value, int))
                    if any(isinstance(value, int) for value in output_values) else None,
                "calls_with_usage": sum(1 for value in input_values if isinstance(value, int)),
                "usage_source": "api" if usage and all(item.get("source") == "api" for item in usage)
                    else "unavailable" if any(item.get("source") == "unavailable" for item in usage)
                    else "estimated" if usage else "mock" if settings.mode == "mock" else "unavailable",
                "cost_usd": round(sum(item["cost_usd"] for item in usage if isinstance(item.get("cost_usd"), (int, float))), 8)
                    if any(isinstance(item.get("cost_usd"), (int, float)) for item in usage) else None,
                "model_call_reason": "mock_agent" if settings.mode == "mock" and not usage
                    else "no_successful_usage_record" if not usage else None,
            },
            "chain": _chain_view(agreement.get("chain") if agreement else None),
        }

    return app


app = create_app()
