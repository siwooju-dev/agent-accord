import json
from pathlib import Path
import yaml
from conftest import start


def test_server_openapi_equals_committed_contract(rig):
    _, client = rig
    root = Path(__file__).resolve().parents[3]
    actual = client.get("/openapi.json").json()
    assert actual == yaml.safe_load((root / "openapi.yaml").read_text(encoding="utf-8"))
    assert actual == json.loads((root / "contracts/openapi.json").read_text(encoding="utf-8"))
    for path, operations in actual["paths"].items():
        for method, operation in operations.items():
            if method in {"post", "put", "delete"} and path != "/api/v1/session":
                headers = {p["name"].lower() for p in operation["parameters"] if p["in"] == "header"}
                assert {"x-csrf-token", "idempotency-key"} <= headers


def test_success_views_validate_contract(rig):
    from app.schemas import DealView, EvidenceView, UsageSummary
    _, client = rig
    base, deal = start(client)
    DealView.model_validate(deal)
    EvidenceView.model_validate(client.get(base + "/evidence").json())
    UsageSummary.model_validate(client.get(base + "/usage").json())
