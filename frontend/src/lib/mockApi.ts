import { sha256, stringToHex } from "viem";
import { DEMO_EVIDENCE, DEMO_LISTINGS } from "../data/demo";
import type {
  AgreementSnapshot,
  BuyerIntent,
  Offer,
  OfferEvaluation,
} from "../types";

const EVIDENCE_HASH_BY_ID = new Map(
  DEMO_EVIDENCE.map((item) => [item.id, item.hash]),
);
const MOCK_WALLETS: Record<string, string> = {
  "seller-01": "0xA11cE00000000000000000000000000000000101",
  "seller-02": "0xA11cE00000000000000000000000000000000202",
  "seller-03": "0xA11cE00000000000000000000000000000000303",
};

export function validateOffers(
  offers: Offer[],
  intent: BuyerIntent,
): OfferEvaluation[] {
  return offers.map((offer) => {
    if (offer.itemPriceKrw + offer.shippingFeeKrw !== offer.totalKrw) {
      return {
        offer,
        status: "blocked",
        reasonCode: "TOTAL_MISMATCH",
        reason: "총액 계산이 일치하지 않습니다.",
      };
    }
    if (offer.totalKrw > intent.maxTotalKrw) {
      return {
        offer,
        status: "blocked",
        reasonCode: "BUDGET_EXCEEDED",
        reason: "구매 조건의 총예산을 초과해 서버 검증에서 차단됐습니다.",
      };
    }
    if (offer.deliveryBy > intent.deliveryDeadline) {
      return {
        offer,
        status: "blocked",
        reasonCode: "DELIVERY_DEADLINE",
        reason: "요청한 배송 기한을 넘겨 서버 검증에서 차단됐습니다.",
      };
    }
    return { offer, status: "valid" };
  });
}

export interface OfferCheck {
  rule: "TOTAL_SUM" | "BUDGET" | "DEADLINE" | "EVIDENCE";
  label: string;
  expected: string;
  actual: string;
  passed: boolean;
  /** true when the expected value is the buyer's private limit */
  privateExpected?: boolean;
}

const won = (n: number) => "₩" + new Intl.NumberFormat("ko-KR").format(n);

/** Mock server inspection table. Same rules and order as validateOffers. */
export function inspectOffer(offer: Offer, intent: BuyerIntent): OfferCheck[] {
  return [
    {
      rule: "TOTAL_SUM",
      label: "상품가 + 배송비 = 총액",
      expected: won(offer.itemPriceKrw + offer.shippingFeeKrw),
      actual: won(offer.totalKrw),
      passed: offer.itemPriceKrw + offer.shippingFeeKrw === offer.totalKrw,
    },
    {
      rule: "BUDGET",
      label: "총액 ≤ 최고 총예산",
      expected: "≤ " + won(intent.maxTotalKrw),
      actual: won(offer.totalKrw),
      passed: offer.totalKrw <= intent.maxTotalKrw,
      privateExpected: true,
    },
    {
      rule: "DEADLINE",
      label: "배송 예정 ≤ 배송 기한",
      expected: "≤ " + intent.deliveryDeadline,
      actual: offer.deliveryBy,
      passed: offer.deliveryBy <= intent.deliveryDeadline,
    },
    {
      rule: "EVIDENCE",
      label: "증빙 참조 첨부",
      expected: "≥ 1건",
      actual: `${offer.evidenceIds.length}건`,
      passed: offer.evidenceIds.length > 0,
    },
  ];
}

/** Canonical JSON (sorted keys) → SHA-256. Mock stand-in for the server snapshot hash. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return (
      "{" +
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}

export function createAgreementSnapshot(
  offer: Offer,
): AgreementSnapshot | null {
  const listing = DEMO_LISTINGS.find((item) => item.id === offer.listingId);
  if (!listing || offer.itemPriceKrw + offer.shippingFeeKrw !== offer.totalKrw)
    return null;

  const body: Omit<AgreementSnapshot, "snapshotHash"> = {
    agreementId: "AGR-DEMO-0281",
    listingId: listing.id,
    model: listing.model,
    condition: listing.condition,
    itemPriceKrw: offer.itemPriceKrw,
    shippingFeeKrw: offer.shippingFeeKrw,
    totalKrw: offer.totalKrw,
    deliveryBy: offer.deliveryBy,
    warrantyTerms: offer.warrantyTerms,
    evidenceHashes: offer.evidenceIds.map(
      (id) => EVIDENCE_HASH_BY_ID.get(id) ?? id,
    ),
    buyerWallet: "0xB0b0000000000000000000000000000000000B01",
    sellerWallet: MOCK_WALLETS[listing.sellerId],
    expiresAt: offer.expiresAt,
    nonce: 28,
    demo: true,
  };
  return { ...body, snapshotHash: sha256(stringToHex(canonical(body))) };
}

export function approvalPayloadMatches(
  snapshot: AgreementSnapshot | null,
  offer: Offer | undefined,
): boolean {
  if (!snapshot || !offer) return false;
  return (
    snapshot.agreementId.length > 0 &&
    snapshot.snapshotHash.startsWith("0x") &&
    snapshot.listingId === offer.listingId &&
    snapshot.itemPriceKrw === offer.itemPriceKrw &&
    snapshot.shippingFeeKrw === offer.shippingFeeKrw &&
    snapshot.totalKrw === offer.totalKrw &&
    snapshot.deliveryBy === offer.deliveryBy &&
    snapshot.warrantyTerms === offer.warrantyTerms &&
    snapshot.expiresAt === offer.expiresAt &&
    snapshot.evidenceHashes.length === offer.evidenceIds.length &&
    snapshot.evidenceHashes.every(
      (hash, index) =>
        hash === EVIDENCE_HASH_BY_ID.get(offer.evidenceIds[index]),
    )
  );
}

export function mockWalletAddress(
  role: "buyer" | "seller",
  sellerId = "seller-01",
): string {
  if (role === "buyer") return "0xB0b0000000000000000000000000000000000B01";
  return MOCK_WALLETS[sellerId] ?? MOCK_WALLETS["seller-01"];
}
