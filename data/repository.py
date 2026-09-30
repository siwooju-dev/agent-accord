"""Database functions for the backend. Public reads never include private limits.

Authorization and negotiation decisions belong to the backend. Only call the
``get_private_*`` functions after checking the caller's ownership there.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from datetime import date, datetime, timezone
from typing import Any, Mapping, Sequence

from .init_db import connect

_MUST_HAVE = {"warranty_active", "evidence_present"}
_VERDICTS = {"consistent", "conflicted", "unverified"}
_HASH = re.compile(r"0x[0-9a-f]{64}\Z")
_WALLET = re.compile(r"0x[0-9a-f]{40}\Z")
_SNAPSHOT_FIELDS = {
    "snapshot_version", "agreement_id", "offer_id", "listing_id", "seller_id",
    "gpu_model", "item_price_krw", "shipping_fee_krw", "total_krw",
    "delivery_by", "warranty_terms", "evidence_hashes", "buyer_wallet",
    "seller_wallet", "expires_at", "nonce",
}


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _utc(value: str | datetime | None = None) -> str:
    if value is None:
        value = datetime.now(timezone.utc)
    elif isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if value.tzinfo is None:
        raise ValueError("time must include a UTC offset")
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _required(row: sqlite3.Row | None, kind: str) -> sqlite3.Row:
    if row is None:
        raise KeyError(f"{kind} not found")
    return row


def _parse(row: sqlite3.Row, *json_fields: str) -> dict[str, Any]:
    result = dict(row)
    for field in json_fields:
        result[field.removesuffix("_json")] = json.loads(result.pop(field))
    return result


def save_buyer_intent(conn: sqlite3.Connection, intent: Mapping[str, Any]) -> None:
    must_have = list(intent.get("must_have", []))
    if set(must_have) - _MUST_HAVE:
        raise ValueError("unsupported must_have value")
    with conn:
        conn.execute(
            """INSERT INTO buyer_intents
               (id, buyer_id, gpu_model, max_total_krw, delivery_deadline,
                must_have_json, scenario, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (intent["id"], intent["buyer_id"], intent["gpu_model"],
             intent["max_total_krw"], _utc(intent["delivery_deadline"]),
             _json(must_have), intent.get("scenario"), _utc(intent.get("created_at"))),
        )


def get_private_buyer_intent(conn: sqlite3.Connection, intent_id: str) -> dict[str, Any]:
    row = _required(conn.execute("SELECT * FROM buyer_intents WHERE id = ?", (intent_id,)).fetchone(), "buyer intent")
    return _parse(row, "must_have_json")


def save_listing(conn: sqlite3.Connection, listing: Mapping[str, Any]) -> None:
    at = _utc(listing.get("description_updated_at"))
    warranty = listing.get("warranty_end")
    if warranty is not None:
        date.fromisoformat(warranty)
    version = listing.get("description_version", 1)
    with conn:
        conn.execute(
            """INSERT INTO listings
               (id, seller_id, gpu_model, asking_price_krw, shipping_fee_krw,
                condition_text, warranty_end, stock_status, stock_quantity,
                data_label, description_version, description_updated_at, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (listing["id"], listing["seller_id"], listing["gpu_model"],
             listing["asking_price_krw"], listing["shipping_fee_krw"],
             listing["condition_text"], warranty, listing["stock_status"],
             listing.get("stock_quantity", 1), listing.get("data_label"),
             version, at, _utc(listing.get("created_at", at))),
        )
        conn.execute(
            """INSERT INTO listing_description_history
               (listing_id, version, condition_text, warranty_end, changed_at)
               VALUES (?, ?, ?, ?, ?)""",
            (listing["id"], version, listing["condition_text"], warranty, at),
        )


def save_seller_policy(conn: sqlite3.Connection, policy: Mapping[str, Any]) -> None:
    listing = _required(conn.execute(
        "SELECT seller_id, asking_price_krw FROM listings WHERE id = ?",
        (policy["listing_id"],),
    ).fetchone(), "listing")
    if policy["seller_id"] != listing["seller_id"]:
        raise ValueError("policy seller does not own listing")
    if not 0 < policy["min_item_price_krw"] <= listing["asking_price_krw"]:
        raise ValueError("seller floor exceeds asking price")
    with conn:
        conn.execute(
            """INSERT INTO seller_policies
               (id, seller_id, listing_id, min_item_price_krw, earliest_delivery_at)
               VALUES (?, ?, ?, ?, ?)""",
            (policy["id"], policy["seller_id"], policy["listing_id"],
             policy["min_item_price_krw"], _utc(policy["earliest_delivery_at"])),
        )


def get_private_seller_policy(conn: sqlite3.Connection, listing_id: str) -> dict[str, Any]:
    row = _required(conn.execute(
        "SELECT * FROM seller_policies WHERE listing_id = ?", (listing_id,),
    ).fetchone(), "seller policy")
    return dict(row)


def save_evidence(conn: sqlite3.Connection, evidence: Mapping[str, Any]) -> None:
    content = evidence["content_text"]
    digest = "0x" + hashlib.sha256(content.encode("utf-8")).hexdigest()
    if evidence.get("sha256") not in (None, digest):
        raise ValueError("evidence SHA-256 does not match content_text")
    with conn:
        conn.execute(
            """INSERT INTO evidences
               (id, listing_id, kind, source, ref, sha256, content_text,
                metadata_json, uploaded_by, uploaded_at, verification_status,
                verification_method, verified_by, note)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (evidence["id"], evidence["listing_id"], evidence["kind"],
             evidence["source"], evidence["ref"], digest, content,
             _json(evidence.get("metadata", {})), evidence.get("uploaded_by"),
             _utc(evidence["uploaded_at"]), evidence["verification_status"],
             evidence.get("verification_method"), evidence.get("verified_by"),
             evidence.get("note")),
        )
        position = conn.execute(
            "SELECT COUNT(*) FROM listing_evidence WHERE listing_id = ?",
            (evidence["listing_id"],),
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO listing_evidence(listing_id, evidence_id, position) VALUES (?, ?, ?)",
            (evidence["listing_id"], evidence["id"], position),
        )


def get_evidences_for_listing(conn: sqlite3.Connection, listing_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        """SELECT e.* FROM evidences e JOIN listing_evidence le ON le.evidence_id = e.id
           WHERE le.listing_id = ? ORDER BY le.position""",
        (listing_id,),
    )
    return [_parse(row, "metadata_json") for row in rows]


def get_listing(conn: sqlite3.Connection, listing_id: str) -> dict[str, Any]:
    row = _required(conn.execute("SELECT * FROM listings WHERE id = ?", (listing_id,)).fetchone(), "listing")
    result = dict(row)
    result["evidence_ids"] = [e["id"] for e in get_evidences_for_listing(conn, listing_id)]
    return result


def get_listing_description_history(conn: sqlite3.Connection, listing_id: str) -> list[dict[str, Any]]:
    return [dict(row) for row in conn.execute(
        """SELECT version, condition_text, warranty_end, changed_at
           FROM listing_description_history WHERE listing_id = ? ORDER BY version""",
        (listing_id,),
    )]


def search_listings(
    conn: sqlite3.Connection,
    gpu_model: str,
    delivery_deadline: str | datetime,
    must_have: Sequence[str] = (),
) -> list[dict[str, Any]]:
    """Filter model, stock and delivery in SQL; return only public listing fields."""
    if set(must_have) - _MUST_HAVE:
        raise ValueError("unsupported must_have value")
    clauses = [
        "l.gpu_model = ?", "l.stock_status = 'available'", "l.stock_quantity > 0",
        "p.earliest_delivery_at <= ?",
    ]
    params: list[Any] = [gpu_model, _utc(delivery_deadline)]
    if "evidence_present" in must_have:
        clauses.append("EXISTS (SELECT 1 FROM listing_evidence le WHERE le.listing_id = l.id)")
    if "warranty_active" in must_have:
        clauses.append("l.warranty_end IS NOT NULL AND l.warranty_end >= ?")
        params.append(_utc(delivery_deadline)[:10])
    rows = conn.execute(
        "SELECT l.id FROM listings l JOIN seller_policies p ON p.listing_id = l.id "
        + "WHERE " + " AND ".join(clauses) + " ORDER BY l.id",
        params,
    )
    return [get_listing(conn, row["id"]) for row in rows]


def update_listing_description(
    conn: sqlite3.Connection,
    listing_id: str,
    condition_text: str,
    warranty_end: str | None,
    at: str | datetime | None = None,
) -> int:
    if warranty_end is not None:
        date.fromisoformat(warranty_end)
    changed_at = _utc(at)
    with conn:
        row = _required(conn.execute(
            "SELECT description_version FROM listings WHERE id = ?", (listing_id,),
        ).fetchone(), "listing")
        version = row["description_version"] + 1
        conn.execute(
            """UPDATE listings SET condition_text = ?, warranty_end = ?,
               description_version = ?, description_updated_at = ? WHERE id = ?""",
            (condition_text, warranty_end, version, changed_at, listing_id),
        )
        conn.execute(
            """INSERT INTO listing_description_history
               (listing_id, version, condition_text, warranty_end, changed_at)
               VALUES (?, ?, ?, ?, ?)""",
            (listing_id, version, condition_text, warranty_end, changed_at),
        )
    return version


def create_flow(
    conn: sqlite3.Connection, flow_id: str, buyer_intent_id: str,
    negotiation_id: str, status: str = "DRAFT", at: str | datetime | None = None,
) -> None:
    timestamp = _utc(at)
    with conn:
        conn.execute(
            """INSERT INTO flows(id, buyer_intent_id, negotiation_id, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (flow_id, buyer_intent_id, negotiation_id, status, timestamp, timestamp),
        )


def set_flow_status(conn: sqlite3.Connection, flow_id: str, status: str, at: str | datetime | None = None) -> None:
    with conn:
        cursor = conn.execute(
            "UPDATE flows SET status = ?, updated_at = ? WHERE id = ?",
            (status, _utc(at), flow_id),
        )
        if cursor.rowcount != 1:
            raise KeyError("flow not found")


def save_assessment(conn: sqlite3.Connection, assessment: Mapping[str, Any]) -> None:
    findings = list(assessment["findings"])
    if any(f.get("verdict") not in _VERDICTS or "note" not in f for f in findings):
        raise ValueError("invalid assessment finding")
    with conn:
        conn.execute(
            """INSERT INTO listing_assessments
               (flow_id, listing_id, summary, findings_json, source, created_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(flow_id, listing_id) DO UPDATE SET
               summary=excluded.summary, findings_json=excluded.findings_json,
               source=excluded.source""",
            (assessment["flow_id"], assessment["listing_id"], assessment["summary"],
             _json(findings), assessment["source"], _utc(assessment.get("created_at"))),
        )


def save_offer(conn: sqlite3.Connection, offer: Mapping[str, Any]) -> None:
    flow = _required(conn.execute(
        "SELECT negotiation_id FROM flows WHERE id = ?", (offer["flow_id"],),
    ).fetchone(), "flow")
    if flow["negotiation_id"] != offer["negotiation_id"]:
        raise ValueError("offer negotiation_id does not match flow")
    if offer["total_krw"] != offer["item_price_krw"] + offer["shipping_fee_krw"]:
        raise ValueError("offer total does not equal item price plus shipping")
    with conn:
        conn.execute(
            """INSERT INTO offers
               (id, flow_id, negotiation_id, listing_id, round, proposer,
                item_price_krw, shipping_fee_krw, total_krw, delivery_by,
                warranty_terms, expires_at, evidence_ids_json, rationale, valid, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (offer["id"], offer["flow_id"], offer["negotiation_id"],
             offer["listing_id"], offer["round"], offer["proposer"],
             offer["item_price_krw"], offer["shipping_fee_krw"], offer["total_krw"],
             _utc(offer["delivery_by"]), offer["warranty_terms"],
             _utc(offer["expires_at"]), _json(offer["evidence_ids"]),
             offer["rationale"], int(offer.get("valid", False)),
             _utc(offer.get("created_at"))),
        )


def next_nonce(conn: sqlite3.Connection, buyer_wallet: str) -> int:
    """Suggest a nonce. The agreement UNIQUE constraint is the final race guard."""
    wallet = buyer_wallet.lower()
    if not _WALLET.fullmatch(wallet):
        raise ValueError("invalid buyer wallet")
    return conn.execute(
        "SELECT COALESCE(MAX(nonce), 0) + 1 FROM agreements WHERE buyer_wallet = ?",
        (wallet,),
    ).fetchone()[0]


def save_agreement(conn: sqlite3.Connection, agreement: Mapping[str, Any]) -> None:
    """Store a backend-created snapshot/hash without computing or verifying signatures."""
    snapshot = dict(agreement["snapshot"])
    if set(snapshot) != _SNAPSHOT_FIELDS or snapshot["snapshot_version"] != 1:
        raise ValueError("snapshot v1 fields are incomplete or unexpected")
    if snapshot["agreement_id"] != agreement["id"] or snapshot["offer_id"] != agreement["offer_id"]:
        raise ValueError("snapshot identity does not match agreement")
    if type(snapshot["nonce"]) is not int or snapshot["nonce"] <= 0:
        raise ValueError("nonce must be a positive integer")
    if not _HASH.fullmatch(agreement["snapshot_hash"]):
        raise ValueError("snapshot_hash must be lowercase 0x plus 64 hex digits")
    if not all(_HASH.fullmatch(value) for value in snapshot["evidence_hashes"]):
        raise ValueError("invalid evidence hash")
    if snapshot["evidence_hashes"] != sorted(set(snapshot["evidence_hashes"])):
        raise ValueError("evidence hashes must be unique and sorted")
    buyer_wallet, seller_wallet = snapshot["buyer_wallet"], snapshot["seller_wallet"]
    if not _WALLET.fullmatch(buyer_wallet) or not _WALLET.fullmatch(seller_wallet):
        raise ValueError("wallets must be lowercase 0x addresses")
    offer = _required(conn.execute(
        "SELECT flow_id, listing_id FROM offers WHERE id = ?", (agreement["offer_id"],),
    ).fetchone(), "offer")
    if offer["flow_id"] != agreement["flow_id"] or offer["listing_id"] != snapshot["listing_id"]:
        raise ValueError("agreement does not match offer")
    timestamp = _utc(agreement.get("created_at"))
    with conn:
        conn.execute(
            """INSERT INTO agreements
               (id, flow_id, offer_id, snapshot_json, snapshot_hash,
                buyer_wallet, seller_wallet, nonce, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (agreement["id"], agreement["flow_id"], agreement["offer_id"],
             _json(snapshot), agreement["snapshot_hash"], buyer_wallet,
             seller_wallet, snapshot["nonce"], agreement.get("status", "AWAITING_APPROVALS"),
             timestamp, timestamp),
        )


def save_approval(
    conn: sqlite3.Connection, agreement_id: str, actor: str, signature: str,
    at: str | datetime | None = None,
) -> None:
    """Persist a signature only after the backend has verified it."""
    if actor not in ("buyer", "seller") or not signature:
        raise ValueError("actor and signature are required")
    signature_column = "buyer_signature" if actor == "buyer" else "seller_signature"
    approved_column = "buyer_approved" if actor == "buyer" else "seller_approved"
    with conn:
        cursor = conn.execute(
            f"UPDATE agreements SET {signature_column} = ?, {approved_column} = 1, updated_at = ? "
            f"WHERE id = ? AND status = 'AWAITING_APPROVALS' AND {signature_column} IS NULL",
            (signature, _utc(at), agreement_id),
        )
        if cursor.rowcount != 1:
            raise ValueError("agreement is not awaiting approvals")


def save_chain_result(
    conn: sqlite3.Connection, agreement_id: str, status: str,
    tx_hash: str | None, receipt: Mapping[str, Any] | None,
    at: str | datetime | None = None,
) -> None:
    if status not in ("RECORDED", "CHAIN_FAILED"):
        raise ValueError("chain result must be RECORDED or CHAIN_FAILED")
    agreement = _required(conn.execute(
        "SELECT buyer_approved, seller_approved, status FROM agreements WHERE id = ?",
        (agreement_id,),
    ).fetchone(), "agreement")
    if agreement["status"] == "RECORDED":
        raise ValueError("recorded agreement cannot be changed")
    if status == "RECORDED" and (
        not tx_hash or not receipt or not agreement["buyer_approved"] or not agreement["seller_approved"]
    ):
        raise ValueError("recorded agreement needs two approvals, tx hash and receipt")
    if status == "RECORDED" and (
        receipt.get("receipt_status") != "success"
        or receipt.get("event_name") != "AgreementRecorded"
    ):
        raise ValueError("recorded agreement needs a successful AgreementRecorded receipt")
    with conn:
        conn.execute(
            """UPDATE agreements SET status = ?, tx_hash = ?, receipt_json = ?, updated_at = ?
               WHERE id = ?""",
            (status, tx_hash, _json(receipt) if receipt is not None else None,
             _utc(at), agreement_id),
        )


def add_audit_event(conn: sqlite3.Connection, event: Mapping[str, Any]) -> None:
    with conn:
        conn.execute(
            """INSERT INTO audit_events
               (id, flow_id, at, actor, event_type, object_id, decision, reason_code, details_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (event["id"], event["flow_id"], _utc(event.get("at")), event["actor"],
             event["event_type"], event.get("object_id"), event.get("decision"),
             event.get("reason_code"),
             _json(event["details"]) if event.get("details") is not None else None),
        )


def add_model_usage(conn: sqlite3.Connection, usage: Mapping[str, Any]) -> None:
    with conn:
        conn.execute(
            """INSERT INTO model_usage
               (flow_id, actor, step, model_id, request_id, input_tokens,
                output_tokens, latency_ms, source, at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (usage["flow_id"], usage["actor"], usage["step"], usage["model_id"],
             usage.get("request_id"), usage["input_tokens"], usage["output_tokens"],
             usage["latency_ms"], usage["source"], _utc(usage.get("at"))),
        )


def get_flow_history(conn: sqlite3.Connection, flow_id: str) -> dict[str, Any]:
    """Return records in stable order without either party's private price limit."""
    flow = dict(_required(conn.execute(
        "SELECT * FROM flows WHERE id = ?", (flow_id,),
    ).fetchone(), "flow"))
    assessments = [_parse(row, "findings_json") for row in conn.execute(
        "SELECT * FROM listing_assessments WHERE flow_id = ? ORDER BY created_at, listing_id",
        (flow_id,),
    )]
    offers = [_parse(row, "evidence_ids_json") for row in conn.execute(
        "SELECT * FROM offers WHERE flow_id = ? ORDER BY created_at, id", (flow_id,),
    )]
    agreements = []
    for row in conn.execute(
        "SELECT * FROM agreements WHERE flow_id = ? ORDER BY created_at, id", (flow_id,),
    ):
        record = _parse(row, "snapshot_json")
        receipt_json = record.pop("receipt_json")
        record["receipt"] = json.loads(receipt_json) if receipt_json else None
        agreements.append(record)
    events = []
    for row in conn.execute(
        "SELECT * FROM audit_events WHERE flow_id = ? ORDER BY at, sequence", (flow_id,),
    ):
        event = dict(row)
        event["details"] = json.loads(event.pop("details_json")) if event["details_json"] else None
        events.append(event)
    usage = [dict(row) for row in conn.execute(
        "SELECT * FROM model_usage WHERE flow_id = ? ORDER BY at, sequence", (flow_id,),
    )]
    timeline: list[dict[str, Any]] = []
    timeline.extend({"at": item["created_at"], "kind": "assessment", "object_id": item["listing_id"]}
                    for item in assessments)
    timeline.extend({"at": item["created_at"], "kind": "offer", "object_id": item["id"]}
                    for item in offers)
    timeline.extend({"at": item["created_at"], "kind": "agreement", "object_id": item["id"]}
                    for item in agreements)
    timeline.extend({"at": item["at"], "kind": "audit_event", "object_id": item["id"],
                     "event_type": item["event_type"], "reason_code": item["reason_code"]}
                    for item in events)
    timeline.extend({"at": item["at"], "kind": "model_usage", "object_id": item["request_id"],
                     "step": item["step"]} for item in usage)
    timeline.extend({"at": item["updated_at"], "kind": "chain_result", "object_id": item["id"],
                     "status": item["status"]} for item in agreements
                    if item["status"] in ("RECORDED", "CHAIN_FAILED"))
    timeline.sort(key=lambda item: (item["at"], item["kind"], item["object_id"] or ""))
    return {"flow": flow, "assessments": assessments, "offers": offers,
            "agreements": agreements, "events": events, "model_usage": usage,
            "timeline": timeline}
