from datetime import timedelta
import pytest
from app import db as m
from app.policy import PolicyEngine, digest, canonical
from app.schemas import BuyerPolicy
from app.service import product_view
from conftest import policy


@pytest.mark.parametrize("kind,code", [
    ("budget", "BUDGET_EXCEEDED"), ("floor", "SELLER_FLOOR_VIOLATED"), ("seller", "SELLER_NOT_ALLOWED"),
    ("ram", "SPEC_MISMATCH"), ("ssd", "SPEC_MISMATCH"), ("delivery", "DELIVERY_TOO_LATE"),
    ("stock", "OUT_OF_STOCK"), ("expiry", "POLICY_EXPIRED"), ("product_expiry", "PRODUCT_EXPIRED"),
    ("round", "ROUND_LIMIT"), ("invalid", "INVALID_DATA")])
def test_policy_boundaries(rig, kind, code):
    app, _ = rig
    with m.Session(app.state.engine) as db: product = product_view(db, "laptop-a")
    data, price, floor, number, current = policy(), 910000, 910000, 1, m.now()
    data["max_total_krw"] = price + 15000
    data["delivery_by"] = product.delivery_date.isoformat()
    if kind == "budget": data["max_total_krw"] -= 1
    elif kind == "floor": price -= 1
    elif kind == "seller": data["allowed_seller_ids"] = ["other"]
    elif kind == "ram": data["min_ram_gb"] = 17
    elif kind == "ssd": data["min_ssd_gb"] = 513
    elif kind == "delivery": data["delivery_by"] = (product.delivery_date - timedelta(days=1)).isoformat()
    elif kind == "stock": product.stock = 0
    elif kind == "expiry": data["expires_at"] = current.isoformat()
    elif kind == "product_expiry": product.expires_at = current
    elif kind == "round": number = 7
    elif kind == "invalid": price = 1.5
    result = PolicyEngine().evaluate(BuyerPolicy.model_validate(data), product, floor, price, current, number, 3)
    assert not result.allowed and code in result.reason_codes and result.policy_version == 3


def test_exact_budget_delivery_and_expiry_before_boundary_pass(rig):
    app, _ = rig
    with m.Session(app.state.engine) as db: p = product_view(db, "laptop-a")
    data = policy(925000)
    data["delivery_by"] = p.delivery_date.isoformat()
    result = PolicyEngine().evaluate(BuyerPolicy.model_validate(data), p, 910000, 910000, m.now(), 6, 1)
    assert result.allowed


def test_hash_canonical_vector_and_tampering():
    assert canonical({"b": 2, "a": 1}) == '{"a":1,"b":2}'
    assert digest({"b": 2, "a": 1}) == "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777"
    assert digest({"a": 2, "b": 2}) != digest({"b": 2, "a": 1})
    with pytest.raises(ValueError): digest({"krw": 1.0})
