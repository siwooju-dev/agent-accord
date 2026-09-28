import type {
  Agreement,
  AgreementSummary,
  ApprovalPayload,
  Audit,
  BuyerIntent,
  BuyerIntentInput,
  DecisionResponse,
  DemoSession,
  Listing,
  ListingInput,
  Negotiation,
  NegotiationStart,
} from "./types";

interface ApiProblem {
  error?: { code?: string; message?: string };
}

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  path: string,
  options: {
    method?: "GET" | "POST";
    token?: string;
    body?: unknown;
    idempotencyKey?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "NETWORK_ERROR", "API 서버에 연결할 수 없습니다. 백엔드 실행 상태를 확인하세요.");
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      response.status,
      "INVALID_RESPONSE",
      response.status >= 500
        ? "API 서버가 응답하지 않습니다. 백엔드 실행 상태를 확인하세요."
        : "API가 JSON 응답을 반환하지 않았습니다.",
    );
  }

  if (!response.ok) {
    const problem = data as ApiProblem;
    throw new ApiError(
      response.status,
      problem?.error?.code ?? "API_ERROR",
      problem?.error?.message ?? `요청이 실패했습니다. (HTTP ${response.status})`,
    );
  }
  return data as T;
}

const idPath = (id: string) => encodeURIComponent(id);

export const api = {
  createSession: (actorId: string) =>
    request<DemoSession>("/demo/sessions", { method: "POST", body: { actor_id: actorId } }),
  createBuyerIntent: (token: string, input: BuyerIntentInput) =>
    request<BuyerIntent>("/buyer-intents", { method: "POST", token, body: input }),
  createListing: (token: string, input: ListingInput) =>
    request<Listing>("/listings", { method: "POST", token, body: input }),
  startNegotiation: (token: string, buyerIntentId: string, idempotencyKey: string) =>
    request<NegotiationStart>("/negotiations", {
      method: "POST",
      token,
      idempotencyKey,
      body: { buyer_intent_id: buyerIntentId },
    }),
  getNegotiation: (token: string, id: string, signal?: AbortSignal) =>
    request<Negotiation>(`/negotiations/${idPath(id)}`, { token, signal }),
  listAgreements: (token: string) =>
    request<{ request_id: string; items: AgreementSummary[] }>("/agreements", { token }),
  getAgreement: (token: string, id: string, signal?: AbortSignal) =>
    request<Agreement>(`/agreements/${idPath(id)}`, { token, signal }),
  getApprovalPayload: (token: string, id: string) =>
    request<ApprovalPayload>(`/agreements/${idPath(id)}/approval-payload`, { token }),
  submitDecision: (
    token: string,
    id: string,
    decision: { decision: "approve" | "reject"; snapshot_hash: string; signature?: string },
  ) =>
    request<DecisionResponse>(`/agreements/${idPath(id)}/decisions`, {
      method: "POST",
      token,
      body: decision,
    }),
  getAudit: (token: string, flowId: string) =>
    request<Audit>(`/flows/${idPath(flowId)}/audit`, { token }),
};
