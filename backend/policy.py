from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from .store import parse_time


def evaluate_offer(
    intent: dict[str, Any],
    listing: dict[str, Any],
    *,
    item_price_krw: int,
    delivery_by: str,
    now: datetime | None = None,
) -> dict[str, Any]:
    current = now or datetime.now(timezone.utc)
    reasons: list[str] = []
    deadline = parse_time(intent["delivery_deadline"])
    earliest = parse_time(listing["private_policy"]["earliest_delivery_at"])
    delivery = parse_time(delivery_by)
    total = item_price_krw + listing["shipping_fee_krw"]

    checks = [
        ("budget", total <= intent["max_total_krw"], "BUDGET_EXCEEDED"),
        ("seller_floor", item_price_krw >= listing["private_policy"]["min_item_price_krw"], "SELLER_FLOOR_VIOLATED"),
        ("delivery_deadline", delivery <= deadline, "DEADLINE_MISSED"),
        ("seller_delivery", delivery >= earliest, "DEADLINE_MISSED"),
        ("stock", listing["stock_status"] == "available", "OUT_OF_STOCK"),
        ("evidence_present", "evidence_present" not in intent["must_have"] or bool(listing["evidence_ids"]), "MUST_HAVE_UNMET"),
        (
            "warranty_active",
            "warranty_active" not in intent["must_have"]
            or bool(listing["warranty_end"] and date.fromisoformat(listing["warranty_end"]) >= current.date()),
            "MUST_HAVE_UNMET",
        ),
    ]
    for _rule, passed, reason in checks:
        if not passed and reason not in reasons:
            reasons.append(reason)
    return {
        "allowed": not reasons,
        "total_krw": total,
        "checks": [{"rule": rule, "passed": bool(passed), "reason_code": None if passed else code}
                   for rule, passed, code in checks],
        "reason_codes": reasons,
    }
