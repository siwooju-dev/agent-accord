export type UserRole = "buyer" | "seller";
export type PageKey =
  "overview" | "conditions" | "negotiation" | "agreement" | "audit";
export type EvidenceStatus =
  "checked" | "seller_claimed" | "conflicted" | "unknown";

export interface BuyerIntent {
  id: string;
  gpuModel: string;
  maxTotalKrw: number;
  deliveryDeadline: string;
  mustHave: string[];
}

export interface Evidence {
  id: string;
  label: string;
  source: string;
  status: EvidenceStatus;
  hash: string;
}

export interface Listing {
  id: string;
  sellerId: string;
  sellerName: string;
  model: string;
  askingPriceKrw: number;
  shippingFeeKrw: number;
  condition: string;
  warrantyEnd: string;
  stockStatus: string;
  deliveryBy: string;
  evidenceIds: string[];
  accent: "blue" | "violet" | "mint";
}

export interface Offer {
  id: string;
  listingId: string;
  negotiationId: string;
  round: number;
  proposer: "buyer_agent" | "seller_agent";
  itemPriceKrw: number;
  shippingFeeKrw: number;
  totalKrw: number;
  deliveryBy: string;
  warrantyTerms: string;
  expiresAt: string;
  evidenceIds: string[];
  explanation: string;
}

export interface OfferEvaluation {
  offer: Offer;
  status: "valid" | "blocked";
  reasonCode?: "BUDGET_EXCEEDED" | "DELIVERY_DEADLINE" | "TOTAL_MISMATCH";
  reason?: string;
}

export interface AgreementSnapshot {
  agreementId: string;
  snapshotHash: string;
  listingId: string;
  model: string;
  condition: string;
  itemPriceKrw: number;
  shippingFeeKrw: number;
  totalKrw: number;
  deliveryBy: string;
  warrantyTerms: string;
  evidenceHashes: string[];
  buyerWallet: string;
  sellerWallet: string;
  expiresAt: string;
  nonce: number;
  demo: true;
}

export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  eventType: string;
  decision: "info" | "allowed" | "blocked" | "pending" | "rejected";
  detail: string;
  source: "demo/mock";
}
