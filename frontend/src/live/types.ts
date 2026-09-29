import type { Address, Hex } from "viem";

export type Role = "buyer" | "seller";
export type FlowStatus =
  | "DRAFT"
  | "NEGOTIATING"
  | "PROPOSED"
  | "AWAITING_APPROVALS"
  | "RECORDING"
  | "RECORDED"
  /** local mock chain: both signatures stored, nothing broadcast */
  | "MOCK_RECORDED"
  | "NO_MATCH"
  | "BLOCKED"
  | "REJECTED"
  | "EXPIRED"
  | "CHAIN_FAILED";

export interface DemoSession {
  request_id: string;
  access_token: string;
  actor_id: string;
  role: Role;
  wallet_address: Address;
}

export interface BuyerIntentInput {
  gpu_model: string;
  max_total_krw: number;
  delivery_deadline: string;
  must_have: Array<"warranty_active" | "evidence_present">;
}

export interface BuyerIntent extends BuyerIntentInput {
  request_id: string;
  id: string;
  buyer_id: string;
}

export interface ListingInput {
  gpu_model: string;
  asking_price_krw: number;
  min_item_price_krw: number;
  shipping_fee_krw: number;
  earliest_delivery_at: string;
  condition_text: string;
  warranty_end: string | null;
  stock_status: "available" | "sold";
  evidence_ids: string[];
}

export interface Listing extends Omit<ListingInput, "min_item_price_krw" | "earliest_delivery_at" | "condition_text" | "warranty_end" | "stock_status"> {
  request_id: string;
  id: string;
  seller_id: string;
  private_policy: Pick<ListingInput, "min_item_price_krw" | "earliest_delivery_at">;
}

export interface Finding {
  evidence_id: string | null;
  verdict: "consistent" | "conflicted" | "unverified";
  note: string;
}

export interface ListingAssessment {
  flow_id: string;
  listing_id: string;
  summary: string;
  findings: Finding[];
  source: "kiln" | "mock";
}

export interface Offer {
  id: string;
  negotiation_id: string;
  listing_id: string;
  round: number;
  proposer: string;
  item_price_krw: number;
  shipping_fee_krw: number;
  total_krw: number;
  delivery_by: string;
  warranty_terms: string;
  expires_at: string;
  evidence_ids: string[];
  rationale: string;
  valid: boolean;
}

export interface Negotiation {
  request_id: string;
  id: string;
  flow_id: string;
  status: FlowStatus;
  assessments: ListingAssessment[];
  offers: Offer[];
  blocked_events: Array<{ reason_code: string }>;
  selected_offer_id: string | null;
  agreement_id: string | null;
}

export interface NegotiationStart {
  request_id: string;
  id: string;
  flow_id: string;
  status: FlowStatus;
  agreement_id: string | null;
}

export interface AgreementSummary {
  id: string;
  status: FlowStatus;
  listing_id: string;
  total_krw: number;
  buyer_approved: boolean;
  seller_approved: boolean;
}

export interface AgreementSnapshot {
  snapshot_version: number;
  agreement_id: string;
  offer_id: string;
  listing_id: string;
  seller_id: string;
  gpu_model: string;
  item_price_krw: number;
  shipping_fee_krw: number;
  total_krw: number;
  delivery_by: string;
  warranty_terms: string;
  evidence_hashes: Hex[];
  buyer_wallet: Address;
  seller_wallet: Address;
  expires_at: string;
  nonce: number;
}

export interface ChainResult {
  mode: "testnet" | "mock" | null;
  chain_id?: number;
  tx_hash: Hex | null;
  receipt_status: "pending" | "success" | "failed" | null;
  block_number?: number;
  event_name?: string;
  recorded_hash?: Hex;
  reason_code?: string;
}

export interface Agreement {
  request_id: string;
  id: string;
  flow_id: string;
  offer_id: string;
  status: FlowStatus;
  snapshot: AgreementSnapshot;
  snapshot_hash: Hex;
  assessment: ListingAssessment | null;
  rationale: string | null;
  buyer_approved: boolean;
  seller_approved: boolean;
  chain: ChainResult;
}

export interface ApprovalTypedData {
  domain: { name: string; version: string; chainId: number; verifyingContract: Address };
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: {
    agreementHash: Hex;
    buyer: Address;
    seller: Address;
    totalKrw: number | string;
    nonce: number | string;
    deadline: number | string;
  };
}

export interface ApprovalPayload {
  request_id: string;
  snapshot: AgreementSnapshot;
  snapshot_hash: Hex;
  typed_data: ApprovalTypedData;
  expected_wallet: Address;
}

export interface DecisionResponse {
  request_id: string;
  agreement_id: string;
  status: FlowStatus;
  buyer_approved: boolean;
  seller_approved: boolean;
  chain: ChainResult;
}

export interface AuditEvent {
  at: string;
  actor: string;
  event_type: string;
  object_id: string | null;
  decision: string | null;
  reason_code: string | null;
}

export interface ModelUsage {
  actor: string;
  step: string;
  model_id: string;
  request_id: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  source: "api" | "estimated";
}

export interface Audit {
  request_id: string;
  flow_id: string;
  status: FlowStatus;
  events: AuditEvent[];
  model_usage: ModelUsage[];
  totals: Record<string, unknown>;
  chain: ChainResult;
}
