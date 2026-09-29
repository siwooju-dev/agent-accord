from __future__ import annotations

import hashlib
import json
import sqlite3
import tempfile
import unittest
from datetime import date
from pathlib import Path

from data.init_db import connect
from data.repository import (
    add_audit_event,
    add_model_usage,
    create_flow,
    get_evidences_for_listing,
    get_flow_history,
    get_listing,
    get_listing_description_history,
    get_private_buyer_intent,
    get_private_seller_policy,
    next_nonce,
    save_agreement,
    save_approval,
    save_assessment,
    save_buyer_intent,
    save_chain_result,
    save_evidence,
    save_listing,
    save_offer,
    save_seller_policy,
    search_listings,
    update_listing_description,
)
from data.seed import DEFAULT_DATASET_PATH, seed_database


class DataRepositoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tempdir.name) / "demo.sqlite3"
        self.seed_result = seed_database(self.db_path, as_of=date(2027, 2, 1))
        self.conn = connect(self.db_path)

    def tearDown(self) -> None:
        self.conn.close()
        self.tempdir.cleanup()

    def test_seed_is_repeatable_and_shifts_future_schedule_once(self) -> None:
        first_deadline = get_private_buyer_intent(self.conn, "intent-base")["delivery_deadline"]
        self.assertGreater(first_deadline[:10], "2027-02-01")
        second_result = seed_database(self.db_path, as_of=date(2027, 3, 1))
        self.assertEqual(self.seed_result, second_result)
        self.assertEqual(first_deadline, get_private_buyer_intent(self.conn, "intent-base")["delivery_deadline"])
        self.assertEqual(3, self.conn.execute("SELECT COUNT(*) FROM listings").fetchone()[0])
        self.assertEqual(4, self.conn.execute("SELECT COUNT(*) FROM evidences").fetchone()[0])

    def test_search_matches_scenarios_without_private_limits(self) -> None:
        source = json.loads(DEFAULT_DATASET_PATH.read_text(encoding="utf-8"))
        for scenario in source["scenario_expectations"]:
            intent = get_private_buyer_intent(self.conn, scenario["intent_id"])
            found = search_listings(self.conn, intent["gpu_model"], intent["delivery_deadline"], intent["must_have"])
            self.assertEqual(scenario["expected_candidate_listing_ids"], [x["id"] for x in found])
            budget_pass = [x["id"] for x in found
                           if x["asking_price_krw"] + x["shipping_fee_krw"] <= intent["max_total_krw"]]
            self.assertEqual(scenario["expected_listed_price_budget_pass_listing_ids"], budget_pass)
            for listing in found:
                self.assertNotIn("min_item_price_krw", listing)
                self.assertNotIn("max_total_krw", listing)
                self.assertNotIn("earliest_delivery_at", listing)
        self.assertEqual(
            ["listing-01", "listing-03"],
            [x["id"] for x in search_listings(
                self.conn, "RTX 4080", intent["delivery_deadline"], ["warranty_active"]
            )],
        )

    def test_evidence_text_is_readable_and_hashed(self) -> None:
        records = get_evidences_for_listing(self.conn, "listing-02")
        self.assertEqual(["evidence-02a", "evidence-02b"], [x["id"] for x in records])
        self.assertNotEqual(records[0]["metadata"]["warranty_claim"], records[1]["metadata"]["warranty_claim"])
        for evidence in records:
            self.assertTrue(evidence["content_text"])
            self.assertEqual(
                evidence["sha256"], "0x" + hashlib.sha256(evidence["content_text"].encode("utf-8")).hexdigest()
            )
            self.assertEqual("conflicted", evidence["verification_status"])

    def test_runtime_registration_uses_same_contract(self) -> None:
        save_buyer_intent(self.conn, {
            "id": "intent-new", "buyer_id": "buyer-new", "gpu_model": "RTX 5090",
            "max_total_krw": 2000000, "delivery_deadline": "2027-02-06T12:00:00Z",
            "must_have": ["evidence_present"],
        })
        save_listing(self.conn, {
            "id": "listing-new", "seller_id": "seller-new", "gpu_model": "RTX 5090",
            "asking_price_krw": 1900000, "shipping_fee_krw": 0,
            "condition_text": "가상 판매자 주장", "warranty_end": None,
            "stock_status": "available", "data_label": "demo/synthetic",
        })
        save_seller_policy(self.conn, {
            "id": "policy-new", "seller_id": "seller-new", "listing_id": "listing-new",
            "min_item_price_krw": 1800000, "earliest_delivery_at": "2027-02-05T00:00:00Z",
        })
        self.assertEqual([], search_listings(
            self.conn, "RTX 5090", "2027-02-06T12:00:00Z", ["evidence_present"]
        ))
        save_evidence(self.conn, {
            "id": "evidence-new", "listing_id": "listing-new", "kind": "seller_note",
            "source": "demo/synthetic", "ref": "synthetic://new", "content_text": "가상 판매자 설명",
            "metadata": {"source_type": "text"}, "uploaded_at": "2027-02-01T00:00:00Z",
            "verification_status": "seller_claimed",
        })
        found = search_listings(
            self.conn, "RTX 5090", "2027-02-06T12:00:00Z", ["evidence_present"]
        )
        self.assertEqual(["listing-new"], [item["id"] for item in found])
        self.assertNotIn("min_item_price_krw", found[0])
        self.assertEqual("seller_claimed", get_evidences_for_listing(
            self.conn, "listing-new"
        )[0]["verification_status"])

    def test_flow_records_nonce_and_immutable_snapshot(self) -> None:
        intent = get_private_buyer_intent(self.conn, "intent-base")
        policy = get_private_seller_policy(self.conn, "listing-01")
        evidence = get_evidences_for_listing(self.conn, "listing-01")[0]
        create_flow(self.conn, "flow-1", intent["id"], "neg-1", at="2027-02-01T00:00:00Z")
        save_assessment(self.conn, {
            "flow_id": "flow-1", "listing_id": "listing-01", "summary": "판매자 주장만 확인됨",
            "findings": [{"evidence_id": evidence["id"], "verdict": "consistent", "note": "설명과 텍스트가 일치"}],
            "source": "mock", "created_at": "2027-02-01T00:00:01Z",
        })
        offer = {
            "id": "offer-1", "flow_id": "flow-1", "negotiation_id": "neg-1",
            "listing_id": "listing-01", "round": 0, "proposer": "seller",
            "item_price_krw": 1180000, "shipping_fee_krw": 10000, "total_krw": 1190000,
            "delivery_by": policy["earliest_delivery_at"], "warranty_terms": "판매자 주장",
            "expires_at": "2027-02-07T00:00:00Z", "evidence_ids": [evidence["id"]],
            "rationale": "예산과 배송 기한에 맞음", "valid": True,
            "created_at": "2027-02-01T00:00:02Z",
        }
        save_offer(self.conn, offer)
        buyer_wallet = "0x" + "1" * 40
        seller_wallet = "0x" + "2" * 40
        self.assertEqual(1, next_nonce(self.conn, buyer_wallet))
        snapshot = {
            "snapshot_version": 1, "agreement_id": "agreement-1", "offer_id": "offer-1",
            "listing_id": "listing-01", "seller_id": "seller-demo-01", "gpu_model": "RTX 4080",
            "item_price_krw": 1180000, "shipping_fee_krw": 10000, "total_krw": 1190000,
            "delivery_by": offer["delivery_by"], "warranty_terms": offer["warranty_terms"],
            "evidence_hashes": [evidence["sha256"]], "buyer_wallet": buyer_wallet,
            "seller_wallet": seller_wallet, "expires_at": offer["expires_at"], "nonce": 1,
        }
        save_agreement(self.conn, {
            "id": "agreement-1", "flow_id": "flow-1", "offer_id": "offer-1",
            "snapshot": snapshot, "snapshot_hash": "0x" + "a" * 64,
            "created_at": "2027-02-01T00:00:03Z",
        })
        self.assertEqual(2, next_nonce(self.conn, buyer_wallet))
        save_offer(self.conn, {**offer, "id": "offer-2", "created_at": "2027-02-01T00:00:03Z"})
        with self.assertRaises(sqlite3.IntegrityError):
            save_agreement(self.conn, {
                "id": "agreement-2", "flow_id": "flow-1", "offer_id": "offer-2",
                "snapshot": {**snapshot, "agreement_id": "agreement-2", "offer_id": "offer-2"},
                "snapshot_hash": "0x" + "c" * 64,
            })
        with self.assertRaises(sqlite3.IntegrityError):
            save_agreement(self.conn, {
                "id": "agreement-2", "flow_id": "flow-1", "offer_id": "offer-2",
                "snapshot": {**snapshot, "agreement_id": "agreement-2", "offer_id": "offer-2", "nonce": 2},
                "snapshot_hash": "0x" + "a" * 64,
            })
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute("UPDATE agreements SET snapshot_json = '{}' WHERE id = 'agreement-1'")
        update_listing_description(
            self.conn, "listing-01", "수정된 판매자 설명", None, "2027-02-01T00:00:04Z"
        )
        self.assertEqual(2, get_listing(self.conn, "listing-01")["description_version"])
        self.assertEqual(2, len(get_listing_description_history(self.conn, "listing-01")))
        save_approval(self.conn, "agreement-1", "buyer", "0xbuyer", "2027-02-01T00:00:05Z")
        save_approval(self.conn, "agreement-1", "seller", "0xseller", "2027-02-01T00:00:06Z")
        with self.assertRaises(ValueError):
            save_approval(self.conn, "agreement-1", "buyer", "0xother")
        save_chain_result(
            self.conn, "agreement-1", "RECORDED", "0x" + "b" * 64,
            {"receipt_status": "success", "event_name": "AgreementRecorded"},
            "2027-02-01T00:00:08Z",
        )
        with self.assertRaises(ValueError):
            save_chain_result(self.conn, "agreement-1", "CHAIN_FAILED", None, None)
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute("UPDATE agreements SET status = 'CHAIN_FAILED' WHERE id = 'agreement-1'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute("DELETE FROM agreements WHERE id = 'agreement-1'")
        add_audit_event(self.conn, {
            "id": "event-1", "flow_id": "flow-1", "at": "2027-02-01T00:00:02Z",
            "actor": "server", "event_type": "OFFER_CHECK", "object_id": "offer-1",
            "decision": "blocked", "reason_code": "BUDGET_EXCEEDED",
        })
        add_audit_event(self.conn, {
            "id": "event-2", "flow_id": "flow-1", "at": "2027-02-01T00:00:08Z",
            "actor": "chain", "event_type": "CHAIN_RECEIPT", "object_id": "agreement-1",
            "decision": "recorded", "details": {"tx_hash": "0x" + "b" * 64},
        })
        add_audit_event(self.conn, {
            "id": "event-3", "flow_id": "flow-1", "at": "2027-02-01T00:00:05Z",
            "actor": "buyer", "event_type": "APPROVAL", "object_id": "agreement-1",
            "decision": "approved",
        })
        add_audit_event(self.conn, {
            "id": "event-4", "flow_id": "flow-1", "at": "2027-02-01T00:00:06Z",
            "actor": "seller", "event_type": "APPROVAL", "object_id": "agreement-1",
            "decision": "approved",
        })
        add_model_usage(self.conn, {
            "flow_id": "flow-1", "actor": "buyer", "step": "proposal",
            "model_id": "qwen3-32b", "request_id": "request-1", "input_tokens": 12,
            "output_tokens": 8, "latency_ms": 100, "source": "api",
            "at": "2027-02-01T00:00:01Z",
        })
        history = get_flow_history(self.conn, "flow-1")
        self.assertEqual("BUDGET_EXCEEDED", history["events"][0]["reason_code"])
        self.assertEqual("0x" + "b" * 64, history["agreements"][0]["tx_hash"])
        self.assertEqual(snapshot, history["agreements"][0]["snapshot"])
        self.assertEqual("예산과 배송 기한에 맞음", history["offers"][0]["rationale"])
        self.assertEqual("api", history["model_usage"][0]["source"])
        self.assertEqual("consistent", history["assessments"][0]["findings"][0]["verdict"])
        self.assertEqual(["event-1", "event-3", "event-4", "event-2"],
                         [item["id"] for item in history["events"]])
        self.assertEqual(sorted(item["at"] for item in history["timeline"]),
                         [item["at"] for item in history["timeline"]])
        self.assertNotIn("min_item_price_krw", str(history))
        self.assertNotIn("max_total_krw", str(history))


if __name__ == "__main__":
    unittest.main()
