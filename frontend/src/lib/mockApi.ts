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

export function createAgreementSnapshot(
  offer: Offer,
): AgreementSnapshot | null {
  const listing = DEMO_LISTINGS.find((item) => item.id === offer.listingId);
  if (!listing || offer.itemPriceKrw + offer.shippingFeeKrw !== offer.totalKrw)
    return null;

  return {
    agreementId: "AGR-DEMO-0281",
    snapshotHash:
      "0x8d1c37af19f6b4c2e78a319d40a62cf51e2b77a0c94d3e6f13882c9b6e0d4a12",
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
