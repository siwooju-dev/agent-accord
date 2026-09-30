"""Load repeatable synthetic data with ``python -m data.seed``.

The JSON file is a reference template. A newly seeded database shifts only
future-facing delivery and warranty dates by the days since its reference date.
The chosen shift is saved, so running the seed again never moves existing data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .init_db import DEFAULT_DB_PATH, initialize

DEFAULT_DATASET_PATH = Path(__file__).with_name("gpu-demo-v1.json")


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _shift_timestamp(value: str, days: int) -> str:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return (parsed + timedelta(days=days)).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _shift_date(value: str | None, days: int) -> str | None:
    return (date.fromisoformat(value) + timedelta(days=days)).isoformat() if value else None


def seed_database(
    db_path: str | Path = DEFAULT_DB_PATH,
    *,
    as_of: date | None = None,
    dataset_path: str | Path = DEFAULT_DATASET_PATH,
) -> dict[str, Any]:
    source = json.loads(Path(dataset_path).read_text(encoding="utf-8"))
    reference = datetime.fromisoformat(source["reference_time_utc"].replace("Z", "+00:00"))
    today = as_of or datetime.now(timezone.utc).date()
    proposed_shift = max(0, (today - reference.date()).days)
    conn = initialize(db_path)
    try:
        with conn:
            conn.execute(
                """INSERT INTO seed_runs
                   (dataset_id, source_reference_time, shifted_days, seeded_at)
                   VALUES (?, ?, ?, ?) ON CONFLICT(dataset_id) DO NOTHING""",
                (source["dataset_id"], source["reference_time_utc"], proposed_shift,
                 datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")),
            )
            seed_run = conn.execute(
                "SELECT source_reference_time, shifted_days FROM seed_runs WHERE dataset_id = ?",
                (source["dataset_id"],),
            ).fetchone()
            if seed_run["source_reference_time"] != source["reference_time_utc"]:
                raise ValueError("dataset reference date changed for an existing seed")
            shift = seed_run["shifted_days"]

            for intent in source["buyer_intents"]:
                if set(intent["must_have"]) - {"warranty_active", "evidence_present"}:
                    raise ValueError("unsupported must_have in seed")
                conn.execute(
                    """INSERT INTO buyer_intents
                       (id, buyer_id, gpu_model, max_total_krw, delivery_deadline,
                        must_have_json, scenario, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(id) DO NOTHING""",
                    (intent["id"], intent["buyer_id"], intent["gpu_model"],
                     intent["max_total_krw"], _shift_timestamp(intent["delivery_deadline"], shift),
                     _json(intent["must_have"]), intent.get("scenario"), source["reference_time_utc"]),
                )

            for listing in source["listings"]:
                warranty_end = _shift_date(listing["warranty_end"], shift)
                conn.execute(
                    """INSERT INTO listings
                       (id, seller_id, gpu_model, asking_price_krw, shipping_fee_krw,
                        condition_text, warranty_end, stock_status, stock_quantity,
                        data_label, description_version, description_updated_at, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(id) DO NOTHING""",
                    (listing["id"], listing["seller_id"], listing["gpu_model"],
                     listing["asking_price_krw"], listing["shipping_fee_krw"],
                     listing["condition_text"], warranty_end, listing["stock_status"],
                     listing["stock_quantity"], listing["data_label"],
                     listing["description_version"], listing["description_updated_at"],
                     listing["description_updated_at"]),
                )
                conn.execute(
                    """INSERT INTO listing_description_history
                       (listing_id, version, condition_text, warranty_end, changed_at)
                       VALUES (?, ?, ?, ?, ?)
                       ON CONFLICT(listing_id, version) DO NOTHING""",
                    (listing["id"], listing["description_version"],
                     listing["condition_text"], warranty_end, listing["description_updated_at"]),
                )

            for policy in source["seller_policies_private"]:
                conn.execute(
                    """INSERT INTO seller_policies
                       (id, seller_id, listing_id, min_item_price_krw, earliest_delivery_at)
                       VALUES (?, ?, ?, ?, ?)
                       ON CONFLICT(id) DO NOTHING""",
                    (policy["id"], policy["seller_id"], policy["listing_id"],
                     policy["min_item_price_krw"],
                     _shift_timestamp(policy["earliest_delivery_at"], shift)),
                )

            for evidence in source["evidences"]:
                digest = "0x" + hashlib.sha256(evidence["content_text"].encode("utf-8")).hexdigest()
                if digest != evidence["sha256"]:
                    raise ValueError(f"evidence hash mismatch: {evidence['id']}")
                conn.execute(
                    """INSERT INTO evidences
                       (id, listing_id, kind, source, ref, sha256, content_text,
                        metadata_json, uploaded_by, uploaded_at, verification_status,
                        verification_method, verified_by, note)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(id) DO NOTHING""",
                    (evidence["id"], evidence["listing_id"], evidence["kind"],
                     evidence["source"], evidence["ref"], digest, evidence["content_text"],
                     _json(evidence.get("metadata", {})), evidence.get("uploaded_by"),
                     evidence["uploaded_at"], evidence["verification_status"],
                     evidence.get("verification_method"), evidence.get("verified_by"),
                     evidence.get("note")),
                )
            for listing in source["listings"]:
                for position, evidence_id in enumerate(listing["evidence_ids"]):
                    conn.execute(
                        """INSERT INTO listing_evidence(listing_id, evidence_id, position)
                           VALUES (?, ?, ?)
                           ON CONFLICT(listing_id, evidence_id) DO NOTHING""",
                        (listing["id"], evidence_id, position),
                    )

            for scenario in source["scenario_expectations"]:
                conn.execute(
                    """INSERT INTO seed_scenarios
                       (intent_id, expected_candidate_ids_json, expected_budget_ids_json, notes)
                       VALUES (?, ?, ?, ?)
                       ON CONFLICT(intent_id) DO NOTHING""",
                    (scenario["intent_id"], _json(scenario["expected_candidate_listing_ids"]),
                     _json(scenario["expected_listed_price_budget_pass_listing_ids"]),
                     scenario["notes"]),
                )

        counts = {table: conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                  for table in ("buyer_intents", "listings", "seller_policies", "evidences")}
        return {"dataset_id": source["dataset_id"], "shifted_days": shift, "counts": counts}
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed synthetic GPU demo data")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--as-of", type=date.fromisoformat, help="UTC date for a new seed, YYYY-MM-DD")
    args = parser.parse_args()
    print(_json(seed_database(args.db, as_of=args.as_of)))


if __name__ == "__main__":
    main()
