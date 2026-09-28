import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { approvalBlockReason, walletTypedData } from "./approval";
import type { Agreement, ApprovalPayload, DemoSession } from "./types";

const buyer = `0x${"1".repeat(40)}` as Address;
const seller = `0x${"2".repeat(40)}` as Address;
const contract = `0x${"3".repeat(40)}` as Address;
const hash = `0x${"a".repeat(64)}` as Hex;
const evidenceHash = `0x${"b".repeat(64)}` as Hex;
const expiry = "2030-01-03T12:00:00Z";
const now = Date.parse("2030-01-01T12:00:00Z");

function fixture() {
  const snapshot = {
    snapshot_version: 1, agreement_id: "agreement-1", offer_id: "offer-1",
    listing_id: "listing-1", seller_id: "seller-1", gpu_model: "RTX 3070",
    item_price_krw: 450000, shipping_fee_krw: 10000, total_krw: 460000,
    delivery_by: "2030-01-02T12:00:00Z", warranty_terms: "보증서 기준",
    evidence_hashes: [evidenceHash], buyer_wallet: buyer, seller_wallet: seller,
    expires_at: expiry, nonce: "7",
  };
  const agreement: Agreement = {
    request_id: "req-1", id: "agreement-1", flow_id: "flow-1", offer_id: "offer-1",
    status: "AWAITING_APPROVALS", snapshot, snapshot_hash: hash,
    assessment: null, rationale: null, buyer_approved: false, seller_approved: false,
    chain: { mode: null, tx_hash: null, receipt_status: null },
  };
  const payload: ApprovalPayload = {
    request_id: "req-2", snapshot: structuredClone(snapshot), snapshot_hash: hash,
    expected_wallet: buyer,
    typed_data: {
      domain: { name: "AgentAccord", version: "1", chainId: 84532, verifyingContract: contract },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" }, { name: "version", type: "string" },
          { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
        ],
        AgreementApproval: [
          { name: "agreementHash", type: "bytes32" }, { name: "buyer", type: "address" },
          { name: "seller", type: "address" }, { name: "totalKrw", type: "uint256" },
          { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "AgreementApproval",
      message: { agreementHash: hash, buyer, seller, totalKrw: "460000", nonce: "7", deadline: String(Date.parse(expiry) / 1000) },
    },
  };
  const session: DemoSession = {
    request_id: "req-3", access_token: "memory-only", actor_id: "buyer-demo",
    role: "buyer", wallet_address: buyer,
  };
  return { agreement, payload, session, wallet: { address: buyer, chainId: 84532 } };
}

describe("approvalBlockReason", () => {
  it("allows only a matching unexpired snapshot, typed data, account, and chain", () => {
    const { agreement, payload, session, wallet } = fixture();
    expect(approvalBlockReason(agreement, payload, session, wallet, now)).toBeNull();
  });

  it("blocks changed amounts or a stale snapshot hash", () => {
    const { agreement, payload, session, wallet } = fixture();
    payload.typed_data.message.totalKrw = "470000";
    expect(approvalBlockReason(agreement, payload, session, wallet, now)).toContain("EIP-712");
    payload.typed_data.message.totalKrw = "460000";
    payload.snapshot_hash = `0x${"c".repeat(64)}` as Hex;
    expect(approvalBlockReason(agreement, payload, session, wallet, now)).toContain("스냅샷");
  });

  it("blocks the wrong account or chain", () => {
    const { agreement, payload, session, wallet } = fixture();
    expect(approvalBlockReason(agreement, payload, session, { ...wallet, address: seller }, now)).toContain("올바른 계정");
    expect(approvalBlockReason(agreement, payload, session, { ...wallet, chainId: 1 }, now)).toContain("Base Sepolia");
  });

  it("blocks expired, rejected, and already approved agreements", () => {
    const { agreement, payload, session, wallet } = fixture();
    expect(approvalBlockReason(agreement, payload, session, wallet, Date.parse(expiry) + 1)).toContain("만료");
    agreement.status = "REJECTED";
    expect(approvalBlockReason(agreement, payload, session, wallet, now)).toContain("승인 대기");
    agreement.status = "AWAITING_APPROVALS";
    agreement.buyer_approved = true;
    expect(approvalBlockReason(agreement, payload, session, wallet, now)).toContain("이미 승인");
  });

  it("preserves signed values while adapting JSON uints for viem", () => {
    const { payload } = fixture();
    const typed = walletTypedData(payload);
    expect(typed.message).toMatchObject({ totalKrw: 460000n, nonce: 7n, deadline: BigInt(Date.parse(expiry) / 1000) });
    expect(payload.typed_data.message.totalKrw).toBe("460000");
  });
});
