import hashlib
import json
from typing import Protocol
from datetime import datetime
from .schemas import BuyerPolicy, ProductView, Decision, Check, Reason


def canonical(data):
    def validate(value):
        if isinstance(value, float):
            raise ValueError("Floating point is forbidden in canonical snapshots")
        if isinstance(value, dict):
            for v in value.values(): validate(v)
        elif isinstance(value, list):
            for v in value: validate(v)
    validate(data)
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def digest(data):
    return hashlib.sha256(canonical(data).encode("utf-8")).hexdigest()


class PolicyPort(Protocol):
    def evaluate(self, policy: BuyerPolicy, product: ProductView, floor: int, price: int,
                 now: datetime, round_number: int, version: int) -> Decision: ...


class PolicyEngine:
    def evaluate(self, policy, product, floor, price, now, round_number, version):
        if (type(price) is not int or type(floor) is not int or not 0 < floor <= 100_000_000
            or not 0 < price <= 100_000_000 or type(product.stock) is not int
            or any(type(x) is not int or x < 0 for x in [product.shipping_fee_krw, product.fee_krw])
            or now.tzinfo is None):
            return Decision(allowed=False, checks=[Check(rule="data_integrity", passed=False, reason_code=Reason.INVALID_DATA)],
                            reason_codes=[Reason.INVALID_DATA], policy_version=version)
        rules = [
            ("budget_includes_shipping_and_fee", price + product.shipping_fee_krw + product.fee_krw <= policy.max_total_krw, Reason.BUDGET_EXCEEDED),
            ("seller_floor", price >= floor, Reason.SELLER_FLOOR_VIOLATED),
            ("seller_allowlist", product.seller_id in policy.allowed_seller_ids, Reason.SELLER_NOT_ALLOWED),
            ("ram_ssd", product.ram_gb >= policy.min_ram_gb and product.ssd_gb >= policy.min_ssd_gb, Reason.SPEC_MISMATCH),
            ("delivery", product.delivery_date <= policy.delivery_by, Reason.DELIVERY_TOO_LATE),
            ("stock", product.stock > 0, Reason.OUT_OF_STOCK),
            ("policy_expiry", now < policy.expires_at, Reason.POLICY_EXPIRED),
            ("product_expiry", now < product.expires_at, Reason.PRODUCT_EXPIRED),
            ("round_limit", 0 <= round_number <= policy.max_rounds, Reason.ROUND_LIMIT),
        ]
        checks = [Check(rule=rule, passed=bool(passed), reason_code=None if passed else code) for rule, passed, code in rules]
        return Decision(allowed=all(c.passed for c in checks), checks=checks,
                        reason_codes=[c.reason_code for c in checks if not c.passed], policy_version=version)
