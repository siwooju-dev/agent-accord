"""Export per-flow proof (Kiln calls + on-chain transactions) for the README.

    .venv/bin/python scripts/export_proof.py --db data/live.sqlite3 \
        --label flow_abc="기본 흐름" --label flow_def="예산 변경" --verify

Writes docs/PROOF.md, docs/proof/flows.json and docs/proof/kiln_calls.jsonl. Only flows with a
Kiln call are exported (pass --flow to choose). The Kiln log holds no prompt text and no key; each
line carries the Kiln generation id (`x-neocloud-generation-id`), token counts and `usage.cost`.
With --verify, every transaction hash is re-checked against the RPC (receipt status and block).
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.config import load_local_env  # noqa: E402

DOCS = ROOT / "docs"
# Stated assumption for a rough estimate; Kiln does not report energy. Change it if you have a better figure.
ENERGY_WH_PER_1K_TOKENS = 0.3
STEP_LABEL = {"assessment": "증빙 검토", "buyer_offer": "구매 제안", "seller_reply": "판매 응답", "buyer_reply": "구매 답변"}


def rows(conn: sqlite3.Connection, kind: str) -> list[dict]:
    result = conn.execute("SELECT id, payload, created_at FROM entities WHERE kind=? ORDER BY rowid", (kind,))
    return [{"id": row[0], "created_at": row[2], **json.loads(row[1])} for row in result]


def won(value: int | None) -> str:
    return "-" if value is None else f"{value:,}원"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", default="data/live.sqlite3")
    parser.add_argument("--log", default="data/kiln_calls.jsonl")
    parser.add_argument("--flow", action="append", default=[], help="flow id to export (repeatable)")
    parser.add_argument("--label", action="append", default=[], help="flow_id=표시 이름")
    parser.add_argument("--verify", action="store_true", help="re-check tx receipts on the RPC")
    args = parser.parse_args()
    load_local_env()
    import os

    explorer = os.getenv("CHAIN_EXPLORER_URL", "https://sepolia.basescan.org").rstrip("/")
    labels = dict(item.split("=", 1) for item in args.label)
    db_path = (ROOT / args.db) if not Path(args.db).is_absolute() else Path(args.db)
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)

    log_path = (ROOT / args.log) if not Path(args.log).is_absolute() else Path(args.log)
    calls: list[dict] = []
    if log_path.exists():
        calls = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines() if line.strip()]

    intents = {item["id"]: item for item in rows(conn, "intent")}
    agreements = {item["id"]: item for item in rows(conn, "agreement")}
    listings = {item["id"]: item for item in rows(conn, "listing")}
    negotiations = rows(conn, "negotiation")
    wanted = set(args.flow) or {call["flow_id"] for call in calls if call.get("flow_id")}

    web3 = None
    if args.verify:
        from web3 import Web3

        web3 = Web3(Web3.HTTPProvider(os.getenv("CHAIN_RPC_URL", "https://sepolia.base.org"), request_kwargs={"timeout": 20}))

    deployment = json.loads((ROOT / "blockchain/deployments/base-sepolia.json").read_text(encoding="utf-8"))
    flows, exported_calls = [], []
    for negotiation in negotiations:
        flow_id = negotiation["flow_id"]
        if flow_id not in wanted:
            continue
        intent = intents.get(negotiation.get("buyer_intent_id"), {})
        agreement = agreements.get(negotiation.get("agreement_id") or "", {})
        chain = agreement.get("chain") or {}
        flow_calls = [call for call in calls if call.get("flow_id") == flow_id]
        events = [{"at": row[0], "actor": row[1], "event_type": row[2], "object_id": row[3], "reason_code": row[4]}
                  for row in conn.execute("SELECT at, actor, event_type, object_id, reason_code FROM audit_events "
                                          "WHERE flow_id=? ORDER BY at, rowid", (flow_id,))]
        skipped = [event for event in events if event["event_type"] == "CANDIDATE_BLOCKED"]
        exported_calls += flow_calls
        verified = None
        if web3 and chain.get("tx_hash"):
            receipt = web3.eth.get_transaction_receipt(chain["tx_hash"])
            verified = {"status": receipt["status"], "block_number": receipt["blockNumber"],
                        "to": receipt["to"], "logs": len(receipt["logs"])}
        flows.append({
            "flow_id": flow_id,
            "label": labels.get(flow_id, flow_id),
            "started_at": negotiation["created_at"],
            "intent": {key: intent.get(key) for key in ("gpu_model", "max_total_krw", "delivery_deadline", "must_have")},
            "negotiation_status": negotiation.get("status"),
            "blocked": [item.get("reason_code") for item in negotiation.get("blocked_events", [])],
            "offers": [{"listing_id": offer["listing_id"], "title": listings.get(offer["listing_id"], {}).get("title"),
                        "round": offer["round"], "total_krw": offer["total_krw"]} for offer in negotiation.get("offers", [])],
            "agreement": {
                "id": agreement.get("id"), "status": agreement.get("status"),
                "listing_id": (agreement.get("snapshot") or {}).get("listing_id"),
                "total_krw": (agreement.get("snapshot") or {}).get("total_krw"),
                "snapshot_hash": agreement.get("snapshot_hash"),
                "buyer_wallet": (agreement.get("snapshot") or {}).get("buyer_wallet"),
                "seller_wallet": (agreement.get("snapshot") or {}).get("seller_wallet"),
                "tx_hash": chain.get("tx_hash"), "block_number": chain.get("block_number"),
                "receipt_status": chain.get("receipt_status"), "rpc_check": verified,
            } if agreement else None,
            "events": events,
            "skipped_candidates": [{"listing_id": event["object_id"], "reason_code": event["reason_code"]} for event in skipped],
            "kiln": {
                "calls": len(flow_calls),
                "ok": sum(1 for call in flow_calls if call.get("outcome") == "OK"),
                "input_tokens": sum(call.get("input_tokens") or 0 for call in flow_calls),
                "output_tokens": sum(call.get("output_tokens") or 0 for call in flow_calls),
                "cost_usd": round(sum(call.get("cost_usd") or 0 for call in flow_calls), 8),
            },
        })

    (DOCS / "proof").mkdir(parents=True, exist_ok=True)
    (DOCS / "proof" / "flows.json").write_text(json.dumps(flows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (DOCS / "proof" / "kiln_calls.jsonl").write_text(
        "".join(json.dumps(call, ensure_ascii=False, separators=(",", ":")) + "\n" for call in exported_calls),
        encoding="utf-8")

    out = ["# Proof of API usage", "",
           "Generated by `scripts/export_proof.py` from the backend database and the Kiln call log. "
           "Raw data: [`proof/flows.json`](proof/flows.json), [`proof/kiln_calls.jsonl`](proof/kiln_calls.jsonl).", "",
           "## Contract", "",
           f"- Network: Base Sepolia (chain {deployment['chain_id']})",
           f"- AgreementRegistry: [`{deployment['contract_address']}`]({explorer}/address/{deployment['contract_address']})",
           f"- Deployment tx: [`{deployment['deployment']['tx_hash']}`]({explorer}/tx/{deployment['deployment']['tx_hash']})",
           f"- Relayer (only address allowed to record): `{deployment['relayer_address']}`", ""]
    total_cost = sum(flow["kiln"]["cost_usd"] for flow in flows)
    out += ["## Summary", "", "| Flow | Buyer condition | Kiln calls | Kiln cost | Agreement | On-chain tx |", "|---|---|---|---|---|---|"]
    for flow in flows:
        intent, agreement = flow["intent"], flow["agreement"] or {}
        tx = agreement.get("tx_hash")
        out.append(
            f"| {flow['label']} | {intent.get('gpu_model')} · 예산 {won(intent.get('max_total_krw'))} · 기한 {(intent.get('delivery_deadline') or '')[:10]} "
            f"| {flow['kiln']['ok']}/{flow['kiln']['calls']} | ${flow['kiln']['cost_usd']:.6f} "
            f"| {agreement.get('status', flow['negotiation_status'])} {won(agreement.get('total_krw')) if agreement else ''} "
            f"| {f'[`{tx[:10]}…{tx[-6:]}`]({explorer}/tx/{tx})' if tx else '-'} |")
    total_tokens = sum(flow["kiln"]["input_tokens"] + flow["kiln"]["output_tokens"] for flow in flows)
    total_skipped = sum(len(flow["skipped_candidates"]) for flow in flows)
    out += ["", f"- Total Kiln cost for these flows: ${total_cost:.6f} · {total_tokens:,} tokens",
            f"- Model calls avoided: {total_skipped} candidate(s) failed the server's budget/deadline pre-check, so no "
            "Kiln call was made for them (about 3 calls each: assessment, buyer offer, seller reply).",
            f"- Energy (assumption, not a measurement): at {ENERGY_WH_PER_1K_TOKENS} Wh per 1,000 tokens, "
            f"≈ {total_tokens / 1000 * ENERGY_WH_PER_1K_TOKENS:.2f} Wh for these flows.", ""]
    for flow in flows:
        agreement = flow["agreement"] or {}
        out += [f"## {flow['label']}", "",
                f"- Flow ID: `{flow['flow_id']}` · started {flow['started_at']}",
                f"- Buyer intent: `{json.dumps(flow['intent'], ensure_ascii=False)}`",
                f"- Negotiation: {flow['negotiation_status']}"
                + (f" · blocked: {', '.join(code for code in flow['blocked'] if code)}" if flow["blocked"] else ""),
                "- Skipped before any model call: " + (", ".join(
                    f"{item['listing_id']} ({item['reason_code']})" for item in flow["skipped_candidates"]) or "none"),
                f"- Offers: " + (", ".join(f"{o['title'] or o['listing_id']} {won(o['total_krw'])} (round {o['round']})" for o in flow["offers"]) or "none")]
        if agreement:
            out += [f"- Agreement `{agreement['id']}` · {agreement['status']} · total {won(agreement['total_krw'])}",
                    f"- Snapshot hash (signed by buyer and seller, EIP-712): `{agreement['snapshot_hash']}`",
                    f"- Buyer wallet `{agreement['buyer_wallet']}` · seller wallet `{agreement['seller_wallet']}`"]
            if agreement.get("tx_hash"):
                out.append(f"- **Tx**: [`{agreement['tx_hash']}`]({explorer}/tx/{agreement['tx_hash']}) · block {agreement['block_number']}"
                           + (f" · RPC re-check: status {agreement['rpc_check']['status']}, {agreement['rpc_check']['logs']} log(s)" if agreement.get("rpc_check") else ""))
        out += ["", "| # | Time (UTC) | Agent | Step | Kiln generation id | Tokens in/out | Cost (USD) | Latency | Result |",
                "|---|---|---|---|---|---|---|---|---|"]
        for index, call in enumerate([c for c in exported_calls if c.get("flow_id") == flow["flow_id"]], 1):
            out.append(
                f"| {index} | {call.get('at', '')[11:19]} | {call.get('actor')} | {STEP_LABEL.get(call.get('step'), call.get('step'))} "
                f"| `{call.get('generation_id') or '-'}` | {call.get('input_tokens') or '-'}/{call.get('output_tokens') or '-'} "
                f"| {call.get('cost_usd') if call.get('cost_usd') is not None else '-'} | {call.get('latency_ms')}ms | {call.get('outcome')} |")
        out.append("")
    (DOCS / "PROOF.md").write_text("\n".join(out), encoding="utf-8")
    # Keep the README summary in sync: replace the block between the proof markers.
    readme = ROOT / "README.md"
    start, end = "<!-- proof:start -->", "<!-- proof:end -->"
    text = readme.read_text(encoding="utf-8") if readme.exists() else ""
    if start in text and end in text:
        summary_start = out.index("## Summary") + 2
        summary_end = next(i for i in range(summary_start, len(out)) if out[i].startswith("## "))
        block = "\n".join([start, "", *out[summary_start:summary_end], "Full per-call log: [docs/PROOF.md](docs/PROOF.md)", "", end])
        text = text[: text.index(start)] + block + text[text.index(end) + len(end):]
        readme.write_text(text, encoding="utf-8")
        print("updated README proof block")
    print(f"flows: {len(flows)} · kiln calls: {len(exported_calls)} · cost ${total_cost:.6f}")
    print("wrote docs/PROOF.md, docs/proof/flows.json, docs/proof/kiln_calls.jsonl")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
