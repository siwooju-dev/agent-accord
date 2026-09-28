from concurrent.futures import ThreadPoolExecutor
import threading
from sqlalchemy import select, func
from app import db as m
from app.main import create_app
from app.chain import MockChain
from app.agent import MockAgent
from app.worker import process_all
from app.schemas import Proposal
from fastapi.testclient import TestClient
from conftest import policy, post, create, start, approval


def count(app, table):
    with m.Session(app.state.engine) as db: return db.scalar(select(func.count()).select_from(table))


def test_A_negotiation_approval_record_and_reload(rig):
    app, client = rig
    base, deal = start(client)
    assert deal["status"] == "AWAITING_APPROVAL"
    snap = deal["agreement"]["snapshot"]
    # Negotiated price is an output, never a hardcoded 920000 expectation.
    assert 910000 <= snap["item_price_krw"] and snap["total_krw"] <= 1000000
    assert snap["total_krw"] == snap["item_price_krw"] + snap["shipping_fee_krw"] + snap["fee_krw"]
    response = post(client, base + "/agreement/approve", approval(deal))
    assert response.status_code == 202
    result = client.get(base).json()
    assert result["status"] == "MOCK_RECORDED"
    assert result["chain"]["tx_hash"] is None and result["chain"]["explorer_url"] is None
    assert result["chain"]["event"]["audit_hash"] == deal["agreement"]["snapshot_hash"]
    usage = client.get(base + "/usage").json()
    assert usage["call_count"] == 2 and usage["provider_total_tokens"] is None
    assert {c["actor"] for c in usage["calls"]} == {"buyer", "seller"}
    assert count(app, m.Approval) == count(app, m.ChainRecord) == 1
    restarted = create_app(app.state.settings, engine=app.state.engine)
    with TestClient(restarted) as again:
        again.cookies.update(client.cookies)
        assert again.get(base).json()["status"] == "MOCK_RECORDED"


def test_B_lower_budget_precheck_no_calls_approval_or_chain(rig):
    app, client = rig
    base, deal = start(client, policy(900000))
    assert deal["status"] == "BLOCKED" and "BUDGET_EXCEEDED" in deal["reason_codes"]
    assert client.get(base + "/usage").json()["call_count"] == 0
    assert count(app, m.Approval) == count(app, m.ChainRecord) == 0
    assert post(client, base + "/agreement/approve", {"expected_policy_version": 1, "snapshot_hash": "a" * 64}).status_code == 409


def test_C_excluded_seller_no_calls(rig):
    app, client = rig
    base, deal = start(client, policy(sellers=["seller-b"]))
    assert deal["reason_codes"] == ["SELLER_NOT_ALLOWED"]
    assert count(app, m.ModelUsage) == count(app, m.Approval) == count(app, m.ChainRecord) == 0


def test_E_concurrent_approval_and_duplicate_start_are_once(rig):
    app, client = rig
    base, deal = start(client)
    assert post(client, base + "/negotiation/start", {"expected_policy_version": 1}).status_code == 200
    assert count(app, m.ModelUsage) == 2
    def approve(index):
        with TestClient(app) as other:
            other.cookies.update(client.cookies)
            other.headers.update(client.headers)
            return post(other, base + "/agreement/approve", approval(deal), "approve-" + str(index)).status_code
    with ThreadPoolExecutor(max_workers=4) as pool: statuses = list(pool.map(approve, range(4)))
    assert statuses == [202] * 4
    assert count(app, m.Approval) == count(app, m.ChainRecord) == 1
    assert count(app, m.ModelUsage) == 2
    with m.Session(app.state.engine) as db: assert db.get(m.Product, "laptop-a").stock == 4


def test_E_policy_change_invalidates_old_round_and_hash(rig):
    app, client = rig
    base, old = start(client)
    response = client.put(base + "/policy", json={"expected_policy_version": 1, "policy": policy(900000)}, headers={"Idempotency-Key": "change"})
    assert response.status_code == 200 and response.json()["policy_version"] == 2
    assert post(client, base + "/agreement/approve", approval(old)).json()["error"]["code"] == "VERSION_CONFLICT"
    assert all(not r["valid"] for r in client.get(base + "/rounds").json())
    assert not client.get(base + "/evidence").json()["agreements"][0]["valid"]
    post(client, base + "/policy/confirm", {"expected_policy_version": 2})
    assert post(client, base + "/negotiation/start", {"expected_policy_version": 2}).json()["status"] == "BLOCKED"
    assert count(app, m.Approval) == count(app, m.ChainRecord) == 0


def test_E_unknown_queries_original_record_without_resubmit(rig):
    app, client = rig
    class UnknownChain(MockChain):
        prepares = broadcasts = queries = 0
        def prepare(self, *args):
            self.prepares += 1
            return super().prepare(*args)
        def broadcast(self, prepared):
            self.broadcasts += 1
            raise TimeoutError()
        def reconcile(self, *args):
            self.queries += 1
            return args[2] | {"status": "UNKNOWN"}
    chain = UnknownChain()
    app.state.chain = chain
    base, deal = start(client)
    post(client, base + "/agreement/approve", approval(deal))
    assert client.get(base).json()["chain"]["status"] == "UNKNOWN"
    post(client, base + "/chain/reconcile", {"expected_policy_version": 1})
    process_all(app)
    assert (chain.prepares, chain.broadcasts, chain.queries) == (1, 1, 2)
    assert count(app, m.Approval) == count(app, m.ChainRecord) == 1


def test_policy_change_during_model_call_discards_result(rig):
    app, client = rig
    entered, release = threading.Event(), threading.Event()
    class SlowAgent(MockAgent):
        def propose(self, *args):
            entered.set()
            assert release.wait(10)
            return super().propose(*args)
    app.state.agent = SlowAgent()
    deal = create(client)
    base = "/api/v1/deals/" + deal["id"]
    post(client, base + "/policy/confirm", {"expected_policy_version": 1})
    def begin():
        with TestClient(app) as other:
            other.cookies.update(client.cookies)
            other.headers.update(client.headers)
            return post(other, base + "/negotiation/start", {"expected_policy_version": 1})
    with ThreadPoolExecutor(max_workers=1) as pool:
        task = pool.submit(begin)
        assert entered.wait(10)
        changed = client.put(base + "/policy", json={"expected_policy_version": 1, "policy": policy(900000)}, headers={"Idempotency-Key": "during"})
        assert changed.status_code == 200
        release.set()
        assert task.result().json()["status"] == "DRAFT"
    assert count(app, m.Agreement) == 0 and count(app, m.ModelUsage) == 1


def test_reject_and_recorded_policy_change(rig):
    app, client = rig
    base, deal = start(client)
    assert post(client, base + "/agreement/reject", {"expected_policy_version": 1}).json()["status"] == "REJECTED"
    assert post(client, base + "/agreement/approve", approval(deal)).status_code == 409
    base, deal = start(client)
    post(client, base + "/agreement/approve", approval(deal))
    assert client.put(base + "/policy", json={"expected_policy_version": 1, "policy": policy()}, headers={"Idempotency-Key": "recorded"}).status_code == 409
