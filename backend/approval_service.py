from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from blockchain.signing import ApprovalError, approval_payload, verify_approval_signature

from .chain_submission import ChainFactory, ChainSubmissionService
from .config import Settings
from .errors import APIError
from .models import AgreementDecisionRequest
from .repository import AgreementRecord, DemoSession, SQLiteAgreementRepository


class ApprovalService:
    def __init__(
        self, *, repository: SQLiteAgreementRepository, settings: Settings,
        chain_factory: ChainFactory | None = None,
    ) -> None:
        self.repository = repository
        self.settings = settings
        self.chain_submission = ChainSubmissionService(
            repository=repository, settings=settings, chain_factory=chain_factory,
        )

    def _prepare(self, record: AgreementRecord) -> dict[str, Any]:
        try:
            self.settings.validate_signing_chain()
            return approval_payload(
                record.snapshot, chain_id=self.settings.chain_id,
                contract_address=self.settings.contract_address,
                expected_hash=record.snapshot_hash,
            )
        except (ValueError, ApprovalError) as exc:
            raise APIError("CHAIN_CONFIG_UNAVAILABLE" if str(exc) == "CHAIN_CONFIG_UNAVAILABLE" else "SNAPSHOT_HASH_MISMATCH",
                           "Approval signing configuration or stored snapshot is invalid", 503 if str(exc) == "CHAIN_CONFIG_UNAVAILABLE" else 409) from exc

    @staticmethod
    def _expected_wallet(record: AgreementRecord, session: DemoSession) -> str:
        snapshot = record.snapshot
        if session.role == "buyer":
            expected = snapshot["buyer_wallet"]
        elif session.role == "seller":
            expected = snapshot["seller_wallet"]
            if session.actor_id != snapshot["seller_id"]:
                raise APIError("ROLE_FORBIDDEN", "Only the selected seller can access this agreement", 403)
        else:
            raise APIError("ROLE_FORBIDDEN", "This operation is not available to this session role", 403)
        if expected.lower() != session.wallet_address.lower():
            raise APIError("ROLE_FORBIDDEN", "This session is not an agreement participant", 403)
        return expected

    @staticmethod
    def _ensure_not_expired(record: AgreementRecord) -> bool:
        try:
            expiry = datetime.strptime(record.snapshot["expires_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        except (KeyError, TypeError, ValueError) as exc:
            raise APIError("SNAPSHOT_HASH_MISMATCH", "Stored agreement expiry is invalid", 409) from exc
        return expiry <= datetime.now(timezone.utc)

    def approval_payload(self, *, agreement_id: str, session: DemoSession, request_id: str) -> dict[str, Any]:
        expired = False
        with self.repository.locked_agreement(agreement_id) as tx:
            record = tx.agreement()
            if record is None:
                raise APIError("AGREEMENT_NOT_FOUND", "Agreement not found", 404)
            expected_wallet = self._expected_wallet(record, session)
            if record.status != "AWAITING_APPROVALS":
                raise APIError("AGREEMENT_STATE_CONFLICT", "Agreement is not awaiting approvals", 409)
            if self._ensure_not_expired(record):
                tx.set_status("EXPIRED", reason_code="OFFER_EXPIRED")
                tx.add_audit(
                    actor="system", event_type="AGREEMENT_EXPIRED", decision="expired",
                    reason_code="OFFER_EXPIRED", idempotency_key=f"expired:{agreement_id}",
                )
                expired = True
            else:
                payload = self._prepare(record)
                tx.add_audit(
                    actor=session.role, event_type="APPROVAL_PAYLOAD_ISSUED", decision="issued",
                    reason_code=None, idempotency_key=f"payload:{agreement_id}:{session.role}:{request_id}",
                )
        if expired:
            raise APIError("OFFER_EXPIRED", "Agreement has expired", 409)
        return {
            "request_id": request_id, "agreement_id": agreement_id,
            "snapshot": payload["snapshot"], "snapshot_hash": payload["snapshot_hash"],
            "typed_data": payload["typed_data"], "expected_wallet": expected_wallet,
        }

    def decide(
        self, *, agreement_id: str, session: DemoSession,
        request: AgreementDecisionRequest, request_id: str,
    ) -> dict[str, Any]:
        role = session.role
        invalid_signature = False
        expired = False
        with self.repository.locked_agreement(agreement_id) as tx:
            record = tx.agreement()
            if record is None:
                raise APIError("AGREEMENT_NOT_FOUND", "Agreement not found", 404)
            expected_wallet = self._expected_wallet(record, session)
            prepared = self._prepare(record)
            if request.snapshot_hash != record.snapshot_hash:
                raise APIError("SNAPSHOT_HASH_MISMATCH", "Submitted snapshot hash does not match the stored agreement", 409)
            if record.status == "AWAITING_APPROVALS" and self._ensure_not_expired(record):
                tx.set_status("EXPIRED", reason_code="OFFER_EXPIRED")
                tx.add_audit(
                    actor="system", event_type="AGREEMENT_EXPIRED", decision="expired",
                    reason_code="OFFER_EXPIRED", idempotency_key=f"expired:{agreement_id}",
                )
                expired = True
            elif request.decision == "reject" and record.status == "REJECTED":
                pass
            elif record.status == "RECORDING" and request.decision == "approve":
                existing = tx.approval(role)
                if existing is None or existing["snapshot_hash"] != request.snapshot_hash or existing["signature"] != request.signature:
                    raise APIError("AGREEMENT_STATE_CONFLICT", "Agreement is already recording", 409)
                pass
            elif record.status != "AWAITING_APPROVALS":
                raise APIError("AGREEMENT_STATE_CONFLICT", "Agreement is not awaiting a decision", 409)
            elif request.decision == "reject":
                tx.set_status("REJECTED", reason_code="APPROVAL_REJECTED")
                tx.add_audit(
                    actor=role, event_type="APPROVAL_REJECTED", decision="rejected",
                    reason_code="APPROVAL_REJECTED", idempotency_key=f"reject:{agreement_id}:{role}:{record.snapshot_hash}",
                )
            else:
                existing = tx.approval(role)
                if existing is not None:
                    if existing["snapshot_hash"] == request.snapshot_hash and existing["signature"] == request.signature:
                        pass
                    else:
                        raise APIError("DECISION_CONFLICT", "A different approval is already stored", 409)
                else:
                    try:
                        verify_approval_signature(
                            prepared, request.signature or "", expected_wallet,
                            chain_id=self.settings.chain_id,
                            contract_address=self.settings.contract_address,
                        )
                    except ApprovalError as exc:
                        invalid_signature = True
                    else:
                        tx.save_approval(role, request.snapshot_hash, request.signature or "")
                        tx.add_audit(
                            actor=role,
                            event_type="BUYER_APPROVED" if role == "buyer" else "SELLER_APPROVED",
                            decision="approved", reason_code=None,
                            idempotency_key=f"approval:{agreement_id}:{role}:{record.snapshot_hash}",
                        )
                        updated = tx.agreement()
                        if updated is not None and updated.buyer_approved and updated.seller_approved:
                            tx.set_status("RECORDING")
                            tx.set_submission_state("ready")
                            tx.add_audit(
                                actor="system", event_type="CHAIN_RECORDING_READY", decision="ready",
                                reason_code=None, idempotency_key=f"recording-ready:{agreement_id}:{record.snapshot_hash}",
                            )
        if expired:
            raise APIError("OFFER_EXPIRED", "Agreement has expired", 409)
        if invalid_signature:
            self.repository.record_audit_event(
                agreement_id, actor=role, event_type="SIGNATURE_INVALID", decision="rejected",
                reason_code="SIGNATURE_INVALID", idempotency_key=f"signature-invalid:{agreement_id}:{role}:{request_id}",
            )
            raise APIError("SIGNATURE_INVALID", "Signature does not match the expected wallet", 400)
        current = self.repository.get_agreement(agreement_id)
        if current is None:
            raise APIError("AGREEMENT_NOT_FOUND", "Agreement not found", 404)
        if request.decision == "approve" and current.status == "RECORDING":
            # Safe to retry: claim_submission is atomic and the adapter receives any
            # persisted hash as previous_tx_hash instead of creating a fresh tx.
            self.chain_submission.submit_or_resume(agreement_id)
            current = self.repository.get_agreement(agreement_id) or current
        return self._decision_view(current, request_id)

    def get_agreement(self, *, agreement_id: str, session: DemoSession, request_id: str) -> dict[str, Any]:
        record = self.repository.get_agreement(agreement_id)
        if record is None:
            raise APIError("AGREEMENT_NOT_FOUND", "Agreement not found", 404)
        self._expected_wallet(record, session)
        self._prepare(record)
        if record.status == "RECORDING" and self.settings.has_relayer:
            # Polling reconciles a saved tx hash, or resumes a relayer-blocked submission.
            self.chain_submission.submit_or_resume(agreement_id)
            record = self.repository.get_agreement(agreement_id) or record
        return {
            "request_id": request_id, "id": record.id, "flow_id": record.flow_id,
            "offer_id": record.offer_id, "status": record.status,
            "snapshot": record.snapshot, "snapshot_hash": record.snapshot_hash,
            "assessment": None, "rationale": None,
            "buyer_approved": record.buyer_approved, "seller_approved": record.seller_approved,
            "chain": self._chain_view(record),
        }

    def _mark_expired(self, agreement_id: str) -> None:
        with self.repository.locked_agreement(agreement_id) as tx:
            record = tx.agreement()
            if record is not None and record.status == "AWAITING_APPROVALS":
                tx.set_status("EXPIRED", reason_code="OFFER_EXPIRED")
                tx.add_audit(
                    actor="system", event_type="AGREEMENT_EXPIRED", decision="expired",
                    reason_code="OFFER_EXPIRED", idempotency_key=f"expired:{agreement_id}",
                )

    @staticmethod
    def _chain_view(record: AgreementRecord) -> dict[str, Any]:
        if record.status in {"AWAITING_APPROVALS", "REJECTED", "EXPIRED"} and record.tx_hash is None:
            return {"mode": None, "chain_id": None, "tx_hash": None, "receipt_status": None}
        result: dict[str, Any] = {
            "mode": "testnet", "chain_id": 84532, "tx_hash": record.tx_hash,
            "receipt_status": record.receipt_status,
        }
        if record.block_number is not None:
            result["block_number"] = record.block_number
        if record.event_name is not None:
            result["event_name"] = record.event_name
        if record.recorded_hash is not None:
            result["recorded_hash"] = record.recorded_hash
        if record.reason_code is not None:
            result["reason_code"] = record.reason_code
        if record.submission_state != "idle":
            result["submission_state"] = record.submission_state
        return result

    @classmethod
    def _decision_view(cls, record: AgreementRecord, request_id: str) -> dict[str, Any]:
        return {
            "request_id": request_id, "agreement_id": record.id, "status": record.status,
            "buyer_approved": record.buyer_approved, "seller_approved": record.seller_approved,
            "chain": cls._chain_view(record),
        }
