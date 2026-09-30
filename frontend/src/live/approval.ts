import { isAddress, type Hex } from "viem";
import type { Agreement, ApprovalPayload, AgreementSnapshot, DemoSession } from "./types";

const CHAIN_ID = 84532;
const HASH = /^0x[0-9a-f]{64}$/;
const SNAPSHOT_FIELDS = [
  "snapshot_version", "agreement_id", "offer_id", "listing_id", "seller_id",
  "gpu_model", "item_price_krw", "shipping_fee_krw", "total_krw",
  "delivery_by", "warranty_terms", "evidence_hashes", "buyer_wallet",
  "seller_wallet", "expires_at", "nonce",
] as const;
const DOMAIN_FIELDS = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
];
const APPROVAL_FIELDS = [
  { name: "agreementHash", type: "bytes32" },
  { name: "buyer", type: "address" },
  { name: "seller", type: "address" },
  { name: "totalKrw", type: "uint256" },
  { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint256" },
];

const addressEqual = (a: string, b: string) =>
  isAddress(a) && isAddress(b) && a.toLowerCase() === b.toLowerCase();

function integer(value: number | string): bigint | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  return /^\d+$/.test(value) ? BigInt(value) : null;
}

function sameFields(actual: Array<{ name: string; type: string }> | undefined, expected: typeof DOMAIN_FIELDS): boolean {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((field, index) => field.name === expected[index].name && field.type === expected[index].type);
}

export function sameSnapshot(a: AgreementSnapshot, b: AgreementSnapshot): boolean {
  const keys = Object.keys(a).sort().join("|");
  const expectedKeys = [...SNAPSHOT_FIELDS].sort().join("|");
  const validEvidenceHashes = (hashes: unknown): hashes is string[] =>
    Array.isArray(hashes) && hashes.every((hash, index) =>
      typeof hash === "string" && HASH.test(hash) &&
      (index === 0 || hashes[index - 1] < hash));

  if (keys !== expectedKeys || Object.keys(b).sort().join("|") !== expectedKeys ||
      !validEvidenceHashes(a.evidence_hashes) || !validEvidenceHashes(b.evidence_hashes) ||
      !isAddress(a.buyer_wallet) || a.buyer_wallet !== a.buyer_wallet.toLowerCase() ||
      !isAddress(a.seller_wallet) || a.seller_wallet !== a.seller_wallet.toLowerCase() ||
      !isAddress(b.buyer_wallet) || b.buyer_wallet !== b.buyer_wallet.toLowerCase() ||
      !isAddress(b.seller_wallet) || b.seller_wallet !== b.seller_wallet.toLowerCase()) return false;

  return SNAPSHOT_FIELDS.every((field) => {
    if (field === "evidence_hashes") {
      return a.evidence_hashes.length === b.evidence_hashes.length &&
        a.evidence_hashes.every((hash, index) => hash === b.evidence_hashes[index]);
    }
    if (field === "nonce") {
      return Number.isSafeInteger(a.nonce) && a.nonce > 0 &&
        Number.isSafeInteger(b.nonce) && b.nonce === a.nonce;
    }
    return a[field] === b[field];
  });
}

function isUtcSecond(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) &&
    new Date(parsed).toISOString().replace(".000Z", "Z") === value;
}

function isCanonicalSnapshot(snapshot: AgreementSnapshot): boolean {
  const textFields = [
    snapshot.agreement_id, snapshot.offer_id, snapshot.listing_id, snapshot.seller_id,
    snapshot.gpu_model, snapshot.delivery_by, snapshot.warranty_terms, snapshot.expires_at,
  ];
  return sameSnapshot(snapshot, snapshot) &&
    snapshot.snapshot_version === 1 &&
    textFields.every((value) => typeof value === "string") &&
    Number.isSafeInteger(snapshot.item_price_krw) && snapshot.item_price_krw > 0 &&
    Number.isSafeInteger(snapshot.shipping_fee_krw) && snapshot.shipping_fee_krw >= 0 &&
    Number.isSafeInteger(snapshot.total_krw) &&
    snapshot.total_krw === snapshot.item_price_krw + snapshot.shipping_fee_krw &&
    isUtcSecond(snapshot.delivery_by) && isUtcSecond(snapshot.expires_at);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("스냅샷 숫자는 JSON 안전 정수여야 합니다.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error("스냅샷에 JSON으로 표현할 수 없는 값이 있습니다.");
}

export async function hashSnapshot(snapshot: AgreementSnapshot): Promise<Hex> {
  if (!isCanonicalSnapshot(snapshot)) throw new Error("스냅샷 형식이 API/블록체인 계약과 다릅니다.");
  const bytes = new TextEncoder().encode(canonicalJson(snapshot));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `0x${hash}` as Hex;
}

export async function snapshotHashMatches(snapshot: AgreementSnapshot, expectedHash: string): Promise<boolean> {
  if (!HASH.test(expectedHash)) return false;
  try {
    return await hashSnapshot(snapshot) === expectedHash;
  } catch {
    return false;
  }
}

export function approvalBlockReason(
  agreement: Agreement | null,
  payload: ApprovalPayload | null,
  session: DemoSession | null,
  wallet: { address: string; chainId: number } | null,
  now = Date.now(),
): string | null {
  if (!session || !agreement) return "세션과 합의안을 먼저 불러오세요.";
  if (agreement.status !== "AWAITING_APPROVALS") return "현재 합의안은 승인 대기 상태가 아닙니다.";
  if (session.role === "buyer" ? agreement.buyer_approved : agreement.seller_approved) {
    return "이 계정은 이미 승인했습니다.";
  }
  if (!payload) return "승인 자료를 새로 불러오세요.";
  const snapshot = agreement.snapshot;
  if (snapshot.snapshot_version !== 1 || payload.snapshot.snapshot_version !== 1 ||
      snapshot.agreement_id !== agreement.id || snapshot.offer_id !== agreement.offer_id ||
      !HASH.test(agreement.snapshot_hash) || !HASH.test(payload.snapshot_hash) ||
      agreement.snapshot_hash !== payload.snapshot_hash || !sameSnapshot(snapshot, payload.snapshot)) {
    return "화면의 합의 스냅샷과 서명 자료가 다릅니다. 다시 조회하세요.";
  }
  const expiry = Date.parse(snapshot.expires_at);
  if (!Number.isFinite(expiry) || expiry <= now) return "합의안이 만료되었습니다.";
  if (!Number.isSafeInteger(snapshot.total_krw) || !Number.isSafeInteger(snapshot.item_price_krw) ||
      !Number.isSafeInteger(snapshot.shipping_fee_krw) ||
      snapshot.total_krw !== snapshot.item_price_krw + snapshot.shipping_fee_krw) {
    return "합의 총액과 상품가·배송비가 일치하지 않습니다.";
  }
  const typed = payload.typed_data;
  const domain = typed?.domain;
  const message = typed?.message;
  if (!domain || !message || typed.primaryType !== "AgreementApproval" ||
      Object.keys(typed.types ?? {}).sort().join("|") !== "AgreementApproval|EIP712Domain" ||
      !sameFields(typed.types.EIP712Domain, DOMAIN_FIELDS) ||
      !sameFields(typed.types.AgreementApproval, APPROVAL_FIELDS) ||
      Object.keys(domain).sort().join("|") !== "chainId|name|verifyingContract|version" ||
      Object.keys(message).sort().join("|") !== "agreementHash|buyer|deadline|nonce|seller|totalKrw" ||
      domain.name !== "AgentAccord" || domain.version !== "1" || domain.chainId !== CHAIN_ID ||
      !isAddress(domain.verifyingContract) || /^0x0{40}$/i.test(domain.verifyingContract) ||
      message.agreementHash !== payload.snapshot_hash ||
      !addressEqual(message.buyer, snapshot.buyer_wallet) ||
      !addressEqual(message.seller, snapshot.seller_wallet) ||
      integer(message.totalKrw) !== BigInt(snapshot.total_krw) ||
      integer(message.nonce) === null || integer(message.nonce) !== integer(snapshot.nonce) ||
      integer(message.deadline) !== BigInt(Math.floor(expiry / 1000))) {
    return "EIP-712 서명 내용이 합의 스냅샷과 일치하지 않습니다.";
  }
  const expected = session.role === "buyer" ? snapshot.buyer_wallet : snapshot.seller_wallet;
  if (!addressEqual(payload.expected_wallet, expected) || !addressEqual(session.wallet_address, expected)) {
    return "세션 지갑 주소가 합의 당사자 주소와 다릅니다.";
  }
  if (!wallet) return "브라우저 지갑을 연결하세요.";
  if (!addressEqual(wallet.address, payload.expected_wallet)) {
    return "연결된 지갑이 서명 대상 주소와 다릅니다. 올바른 계정으로 전환하세요.";
  }
  if (wallet.chainId !== domain.chainId) return "Base Sepolia 네트워크로 전환하세요.";
  return null;
}

export function walletTypedData(payload: ApprovalPayload) {
  const typed = payload.typed_data;
  const totalKrw = integer(typed.message.totalKrw);
  const nonce = integer(typed.message.nonce);
  const deadline = integer(typed.message.deadline);
  if (totalKrw === null || nonce === null || deadline === null) throw new Error("서명 숫자 형식이 올바르지 않습니다.");
  return {
    domain: typed.domain,
    types: typed.types,
    primaryType: "AgreementApproval" as const,
    message: { ...typed.message, totalKrw, nonce, deadline },
  };
}
