from __future__ import annotations

import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from blockchain.signing import approval_payload
from backend.approval_service import ApprovalService
from backend.models import AgreementDecisionRequest
from backend.repository import DemoSession

from .conftest import ExistingRecordChain, PreviousHashChain, WaitingFailChain, make_system, sign


def _decision(system, payload, signature, *, actor="buyer", agreement_id=None):
    headers = system.buyer_headers if actor == "buyer" else system.seller_headers
    return system.client.post(
        f"/api/agreements/{agreement_id or system.agreement_id}/decisions",
        headers=headers,
        json={"decision": "approve", "snapshot_hash": payload["snapshot_hash"], "signature": signature},
    )


def test_approval_payload_uses_deployed_base_sepolia_domain(system):
    result = system.payload()
    assert result["typed_data"]["domain"]["chainId"] == 84532
    assert result["typed_data"]["domain"]["verifyingContract"].lower() == "0x4e62343bb75a2d21e2e38850d49a680f62b9e6e4"
    assert result["typed_data"]["primaryType"] == "AgreementApproval"
    assert result["snapshot_hash"].startswith("0x")
    assert result["expected_wallet"].lower() == system.buyer.address.lower()


def test_buyer_approval_is_persisted_without_submission(system):
    payload = system.payload()
    response = _decision(system, payload, sign(system.buyer, payload["typed_data"]))
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["buyer_approved"] is True
    assert result["seller_approved"] is False
    assert result["status"] == "AWAITING_APPROVALS"
    assert result["chain"]["tx_hash"] is None
    assert len([event for event in system.repository.audit_events(system.agreement_id)
                if event["event_type"] == "BUYER_APPROVED"]) == 1


def test_seller_approval_completes_both_approvals_but_waits_for_relayer(system):
    buyer_payload = system.payload()
    seller_payload = system.payload(actor="seller")
    assert buyer_payload["snapshot_hash"] == seller_payload["snapshot_hash"]
    assert buyer_payload["typed_data"] == seller_payload["typed_data"]
    buyer = _decision(system, buyer_payload, sign(system.buyer, buyer_payload["typed_data"]))
    assert buyer.status_code == 200
    seller = _decision(system, seller_payload, sign(system.seller, seller_payload["typed_data"]), actor="seller")
    assert seller.status_code == 200, seller.text
    result = seller.json()
    assert result["buyer_approved"] is True
    assert result["seller_approved"] is True
    assert result["status"] == "RECORDING"
    assert result["chain"]["submission_state"] == "relayer_missing"
    assert result["chain"]["reason_code"] == "RELAYER_NOT_CONFIGURED_FOR_LIVE_SUBMISSION"
    assert result["chain"]["tx_hash"] is None
    assert result["chain"]["receipt_status"] is None


def test_invalid_signer_is_rejected_without_approval(system):
    payload = system.payload()
    response = _decision(system, payload, sign(system.seller, payload["typed_data"]))
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "SIGNATURE_INVALID"
    assert system.repository.get_agreement(system.agreement_id).buyer_approved is False


def test_seller_cannot_submit_a_buyer_signature(system):
    payload = system.payload(actor="seller")
    response = _decision(system, payload, sign(system.buyer, payload["typed_data"]), actor="seller")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "SIGNATURE_INVALID"
    assert system.repository.get_agreement(system.agreement_id).seller_approved is False


def test_buyer_cannot_choose_seller_role_in_request(system):
    payload = system.payload()
    signature = sign(system.buyer, payload["typed_data"])
    response = system.client.post(
        f"/api/agreements/{system.agreement_id}/decisions",
        headers=system.buyer_headers,
        json={"decision": "approve", "snapshot_hash": payload["snapshot_hash"],
              "signature": signature, "role": "seller"},
    )
    assert response.status_code == 422
    assert system.repository.get_agreement(system.agreement_id).seller_approved is False


def test_different_snapshot_hash_is_rejected_before_approval(system):
    payload = system.payload()
    changed_hash = "0x" + "f" * 64
    response = system.client.post(
        f"/api/agreements/{system.agreement_id}/decisions",
        headers=system.buyer_headers,
        json={"decision": "approve", "snapshot_hash": changed_hash,
              "signature": sign(system.buyer, payload["typed_data"])},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "SNAPSHOT_HASH_MISMATCH"
    assert system.repository.get_agreement(system.agreement_id).buyer_approved is False


def test_changed_snapshot_invalidates_old_approval_signature(system):
    old_payload = system.payload()
    connection = sqlite3.connect(system.settings.database_path)
    try:
        row = connection.execute("SELECT snapshot_json FROM agreements WHERE agreement_id = ?",
                                 (system.agreement_id,)).fetchone()
        changed = json.loads(row[0])
        changed["warranty_terms"] = "Changed after the original approval payload"
        changed_hash = approval_payload(
            changed, chain_id=system.settings.chain_id,
            contract_address=system.settings.contract_address,
        )["snapshot_hash"]
        connection.execute(
            "UPDATE agreements SET snapshot_json = ?, snapshot_hash = ? WHERE agreement_id = ?",
            (json.dumps(changed, separators=(",", ":")), changed_hash, system.agreement_id),
        )
        connection.commit()
    finally:
        connection.close()
    response = _decision(system, old_payload, sign(system.buyer, old_payload["typed_data"]))
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "SNAPSHOT_HASH_MISMATCH"


def test_expired_agreement_cannot_issue_payload_or_record_approval(tmp_path):
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")
    system = make_system(tmp_path, expiry=past)
    payload_response = system.client.get(
        f"/api/agreements/{system.agreement_id}/approval-payload", headers=system.buyer_headers,
    )
    assert payload_response.status_code == 409
    assert payload_response.json()["error"]["code"] == "OFFER_EXPIRED"
    record = system.repository.get_agreement(system.agreement_id)
    assert record.status == "EXPIRED"
    assert record.tx_hash is None


def test_reject_sets_rejected_and_never_submits(system):
    payload = system.payload()
    response = system.client.post(
        f"/api/agreements/{system.agreement_id}/decisions", headers=system.buyer_headers,
        json={"decision": "reject", "snapshot_hash": payload["snapshot_hash"]},
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["status"] == "REJECTED"
    assert result["buyer_approved"] is False
    assert result["seller_approved"] is False
    assert result["chain"]["tx_hash"] is None
    assert any(event["event_type"] == "APPROVAL_REJECTED"
               for event in system.repository.audit_events(system.agreement_id))


def test_duplicate_approval_is_one_row_and_one_audit_event(system):
    payload = system.payload()
    signature = sign(system.buyer, payload["typed_data"])
    first = _decision(system, payload, signature)
    second = _decision(system, payload, signature)
    assert first.status_code == second.status_code == 200
    with sqlite3.connect(system.settings.database_path) as connection:
        approval_count = connection.execute(
            "SELECT COUNT(*) FROM approvals WHERE agreement_id = ? AND actor_role = 'buyer'",
            (system.agreement_id,),
        ).fetchone()[0]
    events = [event for event in system.repository.audit_events(system.agreement_id)
              if event["event_type"] == "BUYER_APPROVED"]
    assert approval_count == 1
    assert len(events) == 1


def test_missing_relayer_keeps_recording_without_tx_or_recorded(system):
    buyer_payload = system.payload()
    seller_payload = system.payload(actor="seller")
    _decision(system, buyer_payload, sign(system.buyer, buyer_payload["typed_data"]))
    response = _decision(
        system, seller_payload, sign(system.seller, seller_payload["typed_data"]), actor="seller",
    )
    assert response.status_code == 200
    assert response.json()["status"] == "RECORDING"
    assert response.json()["chain"]["tx_hash"] is None
    assert response.json()["chain"]["receipt_status"] is None
    assert system.repository.get_agreement(system.agreement_id).status != "RECORDED"


def test_concurrent_last_approval_has_one_recording_transition_and_one_submit_attempt(tmp_path):
    chain = WaitingFailChain()
    system = make_system(tmp_path, relayer_private_key="test-only-placeholder", chain_factory=lambda _: chain)
    buyer_payload = system.payload()
    seller_payload = system.payload(actor="seller")
    buyer_sig = sign(system.buyer, buyer_payload["typed_data"])
    seller_sig = sign(system.seller, seller_payload["typed_data"])
    assert _decision(system, buyer_payload, buyer_sig).status_code == 200
    request = AgreementDecisionRequest(
        decision="approve", snapshot_hash=seller_payload["snapshot_hash"], signature=seller_sig,
    )
    seller_session = system.repository.get_session(
        __import__("hashlib").sha256(system.seller_token.encode("utf-8")).hexdigest()
    )
    assert seller_session is not None

    def submit_last_approval():
        return system.client.app.state.approval_service.decide(
            agreement_id=system.agreement_id, session=seller_session,
            request=request, request_id="parallel-request",
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(submit_last_approval)
        assert chain.entered.wait(timeout=5)
        second = executor.submit(submit_last_approval)
        second_result = second.result(timeout=5)
        chain.release.set()
        first_result = first.result(timeout=5)
    assert len(chain.calls) == 1
    assert first_result["agreement_id"] == second_result["agreement_id"] == system.agreement_id
    event_types = [event["event_type"] for event in system.repository.audit_events(system.agreement_id)]
    assert event_types.count("CHAIN_RECORDING_READY") == 1
    assert event_types.count("CHAIN_SUBMISSION_STARTED") == 1


def test_previous_tx_hash_is_passed_to_adapter_without_replacing_it(tmp_path):
    chain = PreviousHashChain()
    system = make_system(tmp_path, relayer_private_key="test-only-placeholder", chain_factory=lambda _: chain)
    buyer_payload = system.payload()
    seller_payload = system.payload(actor="seller")
    buyer_signature = sign(system.buyer, buyer_payload["typed_data"])
    seller_signature = sign(system.seller, seller_payload["typed_data"])
    with system.repository.locked_agreement(system.agreement_id) as tx:
        tx.save_approval("buyer", buyer_payload["snapshot_hash"], buyer_signature)
        tx.save_approval("seller", seller_payload["snapshot_hash"], seller_signature)
        tx.set_status("RECORDING")
        tx.set_submission_state("ready")
    existing_hash = "0x" + "a" * 64
    system.repository.save_and_commit_tx_hash(system.agreement_id, existing_hash)
    system.repository.update_chain_state(
        system.agreement_id, submission_state="pending", event_type="CHAIN_PENDING",
        idempotency_key=f"setup-pending:{system.agreement_id}",
    )
    system.client.app.state.approval_service.chain_submission.submit_or_resume(system.agreement_id)
    assert chain.previous_hashes == [existing_hash]
    record = system.repository.get_agreement(system.agreement_id)
    assert record.tx_hash == existing_hash
    assert record.status == "RECORDING"


def test_agreement_polling_reconciles_saved_tx_to_recorded(tmp_path):
    system = make_system(tmp_path, relayer_private_key="test-only-placeholder")
    payload = system.payload()
    record = system.repository.get_agreement(system.agreement_id)
    tx_hash = "0x" + "c" * 64
    chain_record = {
        "status": "success", "tx_hash": tx_hash,
        "agreement_hash": record.snapshot_hash,
        "buyer": record.snapshot["buyer_wallet"], "seller": record.snapshot["seller_wallet"],
        "total_krw": record.snapshot["total_krw"], "nonce": record.snapshot["nonce"],
        "block_number": 123,
    }
    chain = ExistingRecordChain(chain_record)
    system.client.app.state.approval_service.chain_submission.chain_factory = lambda _: chain
    with system.repository.locked_agreement(system.agreement_id) as tx:
        tx.save_approval("buyer", payload["snapshot_hash"], sign(system.buyer, payload["typed_data"]))
        tx.save_approval("seller", payload["snapshot_hash"], sign(system.seller, payload["typed_data"]))
        tx.set_status("RECORDING")
        tx.set_submission_state("pending")
    system.repository.save_and_commit_tx_hash(system.agreement_id, tx_hash)

    response = system.client.get(
        f"/api/agreements/{system.agreement_id}", headers=system.buyer_headers,
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["status"] == "RECORDED"
    assert result["chain"]["tx_hash"] == tx_hash
    assert result["chain"]["receipt_status"] == "success"
    assert result["chain"]["event_name"] == "AgreementRecorded"
    assert result["chain"]["recorded_hash"] == record.snapshot_hash
    assert chain.previous_hashes == [tx_hash]


def test_agreement_polling_fails_closed_on_chain_value_mismatch(tmp_path):
    system = make_system(tmp_path, relayer_private_key="test-only-placeholder")
    payload = system.payload()
    record = system.repository.get_agreement(system.agreement_id)
    tx_hash = "0x" + "d" * 64
    chain_record = {
        "status": "success", "tx_hash": tx_hash,
        "agreement_hash": record.snapshot_hash,
        "buyer": record.snapshot["buyer_wallet"], "seller": record.snapshot["seller_wallet"],
        "total_krw": record.snapshot["total_krw"] + 1, "nonce": record.snapshot["nonce"],
        "block_number": 124,
    }
    chain = ExistingRecordChain(chain_record)
    system.client.app.state.approval_service.chain_submission.chain_factory = lambda _: chain
    with system.repository.locked_agreement(system.agreement_id) as tx:
        tx.save_approval("buyer", payload["snapshot_hash"], sign(system.buyer, payload["typed_data"]))
        tx.save_approval("seller", payload["snapshot_hash"], sign(system.seller, payload["typed_data"]))
        tx.set_status("RECORDING")
        tx.set_submission_state("pending")
    system.repository.save_and_commit_tx_hash(system.agreement_id, tx_hash)

    response = system.client.get(
        f"/api/agreements/{system.agreement_id}", headers=system.buyer_headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "CHAIN_FAILED"
    assert response.json()["chain"]["receipt_status"] == "failed"


def test_signed_tx_hash_callback_is_committed_before_adapter_returns(tmp_path):
    system = make_system(tmp_path, relayer_private_key="test-only-placeholder")
    payload = system.payload()
    record = system.repository.get_agreement(system.agreement_id)
    with system.repository.locked_agreement(system.agreement_id) as tx:
        tx.save_approval("buyer", payload["snapshot_hash"], sign(system.buyer, payload["typed_data"]))
        tx.save_approval("seller", payload["snapshot_hash"], sign(system.seller, payload["typed_data"]))
        tx.set_status("RECORDING")
        tx.set_submission_state("ready")

    tx_hash = "0x" + "e" * 64

    class PersistProbeChain:
        committed_before_return = False

        def record_agreement(self, agreement, buyer_signature, seller_signature, *, persist_tx_hash, previous_tx_hash=None):
            assert previous_tx_hash is None
            persist_tx_hash(tx_hash)
            saved = system.repository.get_agreement(system.agreement_id)
            self.committed_before_return = saved is not None and saved.tx_hash == tx_hash
            assert self.committed_before_return
            return {"status": "submitted", "tx_hash": tx_hash}

        def get_record(self, submitted_hash, agreement_hash):
            return {"status": "pending", "tx_hash": submitted_hash}

    chain = PersistProbeChain()
    system.client.app.state.approval_service.chain_submission.chain_factory = lambda _: chain
    system.client.app.state.approval_service.chain_submission.submit_or_resume(system.agreement_id)
    saved = system.repository.get_agreement(system.agreement_id)
    assert chain.committed_before_return is True
    assert saved.tx_hash == tx_hash
    assert saved.status == "RECORDING"
    assert saved.receipt_status == "pending"
    assert any(event["event_type"] == "CHAIN_TX_HASH_PERSISTED"
               for event in system.repository.audit_events(system.agreement_id))


def test_payload_requires_the_pinned_chain_configuration(tmp_path):
    from backend.main import create_app
    from backend.config import Settings
    from backend.repository import SQLiteAgreementRepository
    from fastapi.testclient import TestClient
    from eth_account import Account
    from .conftest import make_snapshot

    buyer, seller = Account.create(), Account.create()
    settings = Settings(
        database_path=tmp_path / "wrong-chain.sqlite3", chain_id=31337,
        buyer_demo_wallet=buyer.address.lower(), seller_demo_wallet=seller.address.lower(),
    )
    repository = SQLiteAgreementRepository(settings.database_path)
    snapshot = make_snapshot(buyer.address, seller.address)
    repository.create_agreement(agreement_id=snapshot["agreement_id"], flow_id="flow",
                                offer_id=snapshot["offer_id"], snapshot=snapshot)
    app = create_app(settings=settings, repository=repository)
    client = TestClient(app)
    session = client.post("/api/demo/sessions", json={"actor_id": "buyer-demo"}).json()
    response = client.get(
        f"/api/agreements/{snapshot['agreement_id']}/approval-payload",
        headers={"Authorization": f"Bearer {session['access_token']}"},
    )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "CHAIN_CONFIG_UNAVAILABLE"
