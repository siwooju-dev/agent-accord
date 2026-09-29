from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

from blockchain.adapter import AgreementChain, ChainConfig, ChainError, SubmissionUnknown

from .config import Settings
from .repository import AgreementRecord, SQLiteAgreementRepository


ChainFactory = Callable[[Settings], AgreementChain]


def _default_chain_factory(settings: Settings) -> AgreementChain:
    if not settings.relayer_private_key:
        raise ChainError("RELAYER_NOT_CONFIGURED_FOR_LIVE_SUBMISSION")
    config = ChainConfig(
        rpc_url=settings.chain_rpc_url,
        chain_id=settings.chain_id,
        contract_address=settings.contract_address,
        relayer_private_key=settings.relayer_private_key,
    )
    return AgreementChain(config)


class ChainSubmissionService:
    def __init__(
        self, *, repository: SQLiteAgreementRepository, settings: Settings,
        chain_factory: ChainFactory | None = None,
    ) -> None:
        self.repository = repository
        self.settings = settings
        self.chain_factory = chain_factory or _default_chain_factory

    def submit_or_resume(self, agreement_id: str) -> None:
        agreement = self.repository.get_agreement(agreement_id)
        if agreement is None or agreement.status != "RECORDING":
            return
        if agreement.tx_hash is None:
            try:
                expiry = datetime.strptime(
                    agreement.snapshot["expires_at"], "%Y-%m-%dT%H:%M:%SZ"
                ).replace(tzinfo=timezone.utc)
            except (KeyError, TypeError, ValueError):
                expiry = datetime.min.replace(tzinfo=timezone.utc)
            if expiry <= datetime.now(timezone.utc):
                self.repository.update_chain_state(
                    agreement_id, submission_state="expired", status="EXPIRED",
                    reason_code="OFFER_EXPIRED", event_type="AGREEMENT_EXPIRED",
                    idempotency_key=f"recording-expired:{agreement_id}",
                )
                return
        if not self.settings.has_relayer:
            if agreement.tx_hash is not None:
                return
            self.repository.mark_relayer_missing(agreement_id)
            return
        try:
            self.settings.validate_signing_chain()
        except ValueError:
            self.repository.update_chain_state(
                agreement_id, submission_state="failed", status="CHAIN_FAILED",
                reason_code="CHAIN_CONFIG_UNAVAILABLE", event_type="CHAIN_FAILED",
                idempotency_key=f"chain-config-failed:{agreement_id}",
            )
            return
        if not self.repository.claim_submission(agreement_id):
            return
        agreement = self.repository.get_agreement(agreement_id)
        if agreement is None:
            return
        try:
            chain = self.chain_factory(self.settings)
            result = chain.record_agreement(
                agreement.as_chain_agreement(), agreement.buyer_signature or "",
                agreement.seller_signature or "",
                persist_tx_hash=lambda tx_hash: self.repository.save_and_commit_tx_hash(agreement_id, tx_hash),
                previous_tx_hash=agreement.tx_hash,
            )
            if result.get("status") == "previous_submission":
                self._apply_record(agreement, result.get("record", {}), source_tx_hash=agreement.tx_hash)
                return
            if result.get("status") == "already_recorded":
                # The adapter has no receipt/event tx hash in this result, so it cannot
                # satisfy the API's proof requirement for RECORDED.
                self.repository.update_chain_state(
                    agreement_id, submission_state="failed", status="CHAIN_FAILED",
                    reason_code="CHAIN_FAILED", event_type="CHAIN_FAILED",
                    idempotency_key=f"already-recorded-unverifiable:{agreement_id}",
                )
                return
            if result.get("status") != "submitted" or not result.get("tx_hash"):
                raise ChainError("unexpected adapter submission result")
            tx_hash = result["tx_hash"]
            persisted = self.repository.get_agreement(agreement_id)
            if persisted is None or persisted.tx_hash is None or persisted.tx_hash.lower() != tx_hash.lower():
                raise ChainError("transaction hash was not durably persisted")
            record = chain.get_record(tx_hash, agreement.snapshot_hash)
            self._apply_record(agreement, record, source_tx_hash=tx_hash)
        except SubmissionUnknown as exc:
            # AgreementChain calls persist_tx_hash before broadcast; preserve the hash.
            self.repository.update_chain_state(
                agreement_id, submission_state="unknown", receipt_status="pending",
                reason_code="CHAIN_PENDING", event_type="CHAIN_PENDING",
                idempotency_key=f"unknown-submit:{agreement_id}:{exc.tx_hash.lower()}",
            )
        except ChainError as exc:
            current = self.repository.get_agreement(agreement_id)
            if current is not None and current.tx_hash:
                if self._is_record_mismatch(exc):
                    self.repository.update_chain_state(
                        agreement_id, submission_state="failed", status="CHAIN_FAILED",
                        receipt_status="failed", reason_code="CHAIN_FAILED", event_type="CHAIN_FAILED",
                        idempotency_key=f"chain-record-mismatch:{agreement_id}:{current.tx_hash.lower()}",
                    )
                else:
                    self.repository.update_chain_state(
                        agreement_id, submission_state="unknown", receipt_status="pending",
                        reason_code="CHAIN_PENDING", event_type="CHAIN_PENDING",
                        idempotency_key=f"reconcile-required:{agreement_id}:{current.tx_hash.lower()}",
                    )
            else:
                self.repository.update_chain_state(
                    agreement_id, submission_state="failed", status="CHAIN_FAILED",
                    reason_code="CHAIN_FAILED", event_type="CHAIN_FAILED",
                    idempotency_key=f"chain-failed:{agreement_id}:{agreement.submission_state}",
                )
        except Exception:
            # Do not expose exception text or configuration values in API/log output.
            current = self.repository.get_agreement(agreement_id)
            if current is not None and current.tx_hash:
                self.repository.update_chain_state(
                    agreement_id, submission_state="unknown", receipt_status="pending",
                    reason_code="CHAIN_PENDING", event_type="CHAIN_PENDING",
                    idempotency_key=f"reconcile-required:{agreement_id}:{current.tx_hash.lower()}",
                )
            else:
                self.repository.update_chain_state(
                    agreement_id, submission_state="failed", status="CHAIN_FAILED",
                    reason_code="CHAIN_FAILED", event_type="CHAIN_FAILED",
                    idempotency_key=f"chain-failed:{agreement_id}:{agreement.submission_state}",
                )

    @staticmethod
    def _is_record_mismatch(exc: ChainError) -> bool:
        # ChainError currently carries stable adapter messages rather than typed codes.
        # Only explicit receipt/event/storage mismatches are terminal; RPC uncertainty stays pending.
        return str(exc) in {
            "transaction target mismatch",
            "agreement event mismatch",
            "contract record mismatch",
            "cannot verify receipt, event and contract",
            "record differs from agreement",
            "existing record differs from agreement",
        }

    def _apply_record(self, agreement: AgreementRecord, record: dict[str, Any], *, source_tx_hash: str | None) -> None:
        status = record.get("status")
        if status in {"pending", "not_found"}:
            state = "pending" if status == "pending" else "unknown"
            self.repository.update_chain_state(
                agreement.id, submission_state=state, receipt_status="pending" if status == "pending" else None,
                reason_code="CHAIN_PENDING", event_type="CHAIN_PENDING",
                idempotency_key=f"chain-{state}:{agreement.id}:{(source_tx_hash or 'none').lower()}",
            )
            return
        if status == "failed":
            self.repository.update_chain_state(
                agreement.id, submission_state="failed", status="CHAIN_FAILED", receipt_status="failed",
                reason_code="CHAIN_FAILED", event_type="CHAIN_FAILED",
                idempotency_key=f"chain-failed-receipt:{agreement.id}:{(source_tx_hash or 'none').lower()}",
            )
            return
        snapshot = agreement.snapshot
        matches = (
            status == "success"
            and str(record.get("agreement_hash", "")).lower() == agreement.snapshot_hash.lower()
            and str(record.get("buyer", "")).lower() == snapshot["buyer_wallet"].lower()
            and str(record.get("seller", "")).lower() == snapshot["seller_wallet"].lower()
            and record.get("total_krw") == snapshot["total_krw"]
            and record.get("nonce") == snapshot["nonce"]
            and bool(source_tx_hash)
            and str(record.get("tx_hash", source_tx_hash)).lower() == source_tx_hash.lower()
        )
        if not matches:
            self.repository.update_chain_state(
                agreement.id, submission_state="failed", status="CHAIN_FAILED", receipt_status="failed",
                reason_code="CHAIN_FAILED", event_type="CHAIN_FAILED",
                idempotency_key=f"chain-record-mismatch:{agreement.id}:{(source_tx_hash or 'none').lower()}",
            )
            return
        self.repository.update_chain_state(
            agreement.id, submission_state="recorded", status="RECORDED", receipt_status="success",
            block_number=record.get("block_number"), event_name="AgreementRecorded",
            recorded_hash=agreement.snapshot_hash, reason_code=None, event_type="CHAIN_RECORDED",
            idempotency_key=f"chain-recorded:{agreement.id}:{source_tx_hash.lower()}",
        )
