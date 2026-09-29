from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from backend.agent import CALL_CONTEXT, AgentError, KilnAgent, extract_json
from backend.config import Settings

KEY = "sk-bk-test-key-never-logged-0000"


def stamp(days: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).replace(microsecond=0).isoformat().replace("+00:00", "Z")


LISTING = {
    "id": "listing-1", "gpu_model": "RTX 4090", "asking_price_krw": 2_400_000, "shipping_fee_krw": 5_000,
    "condition_text": "정상 작동", "warranty_end": "2027-01-01", "stock_status": "available",
    "evidence_ids": ["evidence-01"],
    "private_policy": {"min_item_price_krw": 2_200_000, "earliest_delivery_at": stamp(2)},
}
INTENT = {"gpu_model": "RTX 4090", "max_total_krw": 2_350_000, "delivery_deadline": stamp(7),
          "must_have": ["evidence_present"]}


def completion(content: str, *, cost: float = 0.00012) -> httpx.Response:
    return httpx.Response(200, headers={"x-neocloud-generation-id": "gen-123"}, json={
        "id": "chatcmpl-1", "object": "chat.completion", "created": 0, "model": "qwen3-32b",
        "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": content}}],
        "usage": {"prompt_tokens": 321, "completion_tokens": 45, "total_tokens": 366, "cost": cost},
    })


def make_agent(tmp_path, replies):
    queue = list(replies)
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == f"Bearer {KEY}"
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"object": "list", "data": [{"id": "qwen3-32b", "object": "model"}]})
        seen.append(json.loads(request.content))
        reply = queue.pop(0)
        return reply if isinstance(reply, httpx.Response) else completion(reply)

    settings = Settings(mode="live", chain_mode="live", kiln_api_key=KEY,
                        kiln_log_path=str(tmp_path / "kiln.jsonl"))
    agent = KilnAgent(settings, http_client=httpx.Client(transport=httpx.MockTransport(handler)), sleep=lambda _s: None)
    return agent, seen


def log_lines(tmp_path) -> list[dict]:
    text = (tmp_path / "kiln.jsonl").read_text(encoding="utf-8")
    assert KEY not in text
    return [json.loads(line) for line in text.splitlines()]


def test_extract_json_ignores_think_blocks_and_fences():
    assert extract_json('<think>\nhmm {"x": 0}\n</think>\n```json\n{"a": 1}\n```') == {"a": 1}
    assert extract_json('Sure! {"a": {"b": 2}} done') == {"a": {"b": 2}}
    with pytest.raises(AgentError):
        extract_json("<think>still thinking {\"a\": 1}")


def test_buyer_offer_records_generation_id_tokens_and_cost(tmp_path):
    agent, seen = make_agent(tmp_path, [
        '<think></think>{"item_price_krw": 2200000, "delivery_by": "%s", "warranty_terms": "판매자 주장 보증", '
        '"reason": "증빙이 있어 조금 낮춰 제안"}' % stamp(3),
    ])
    CALL_CONTEXT.set({"flow_id": "flow-1", "listing_id": "listing-1"})
    offer, usage = agent.buyer_offer(INTENT, LISTING, {"summary": "", "findings": []})
    assert offer["item_price_krw"] == 2_200_000 and offer["reason"]
    assert usage["request_id"] == "gen-123" and usage["input_tokens"] == 321 and usage["cost_usd"] == 0.00012
    assert usage["source"] == "api"
    assert seen[0]["model"] == "qwen3-32b" and "/no_think" in seen[0]["messages"][0]["content"]
    [line] = log_lines(tmp_path)
    assert line["flow_id"] == "flow-1" and line["outcome"] == "OK" and line["output"]["item_price_krw"] == 2_200_000


def test_invalid_answer_gets_one_repair_round_and_both_calls_are_logged(tmp_path):
    agent, seen = make_agent(tmp_path, [
        '{"action": "accept", "item_price_krw": 2100000}',
        '{"action": "counter", "item_price_krw": 2250000, "delivery_by": "%s", "reason": "최저가 근처로 역제안"}'
        % LISTING["private_policy"]["earliest_delivery_at"],
    ])
    reply, usage = agent.seller_reply(LISTING, {
        "item_price_krw": 2_100_000, "delivery_by": stamp(3), "warranty_terms": "",
    })
    assert reply["action"] == "counter" and reply["item_price_krw"] == 2_250_000
    assert usage["repaired_from"]["outcome"] == "INVALID_OUTPUT"
    assert "rejected" in seen[1]["messages"][-1]["content"]
    assert [line["outcome"] for line in log_lines(tmp_path)] == ["INVALID_OUTPUT", "OK"]


def test_rate_limit_is_retried_and_credit_errors_are_named(tmp_path):
    agent, _ = make_agent(tmp_path, [
        httpx.Response(429, headers={"retry-after": "1"}, json={"error": {"message": "slow down"}}),
        '{"action": "reject", "reason": "예산 초과"}',
    ])
    reply, usage = agent.buyer_reply(INTENT, LISTING, {}, {"item_price_krw": 2_200_000, "delivery_by": stamp(3)},
                                     {"item_price_krw": 2_390_000, "delivery_by": stamp(3)})
    assert reply["action"] == "reject" and usage["attempts"] == 2

    agent, _ = make_agent(tmp_path, [httpx.Response(402, json={"error": {"message": "insufficient credits"}})])
    with pytest.raises(AgentError) as caught:
        agent.assess(LISTING)
    assert caught.value.code == "KILN_CREDITS_EXHAUSTED" and caught.value.usage["outcome"] == "KILN_CREDITS_EXHAUSTED"
