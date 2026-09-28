import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("live API client", () => {
  it("sends the bearer token and stable idempotency key to the relative negotiation path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      request_id: "req-1", id: "neg-1", flow_id: "flow-1", status: "NEGOTIATING", agreement_id: null,
    }), { status: 202, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await api.startNegotiation("demo-token", "intent-1", "retry-key-1");

    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/negotiations");
    expect(options.method).toBe("POST");
    expect(options.headers).toMatchObject({ Authorization: "Bearer demo-token", "Idempotency-Key": "retry-key-1" });
    expect(JSON.parse(options.body as string)).toEqual({ buyer_intent_id: "intent-1" });
  });

  it("surfaces a backend status conflict without replacing it with mock success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      request_id: "req-error", error: { code: "OFFER_EXPIRED", message: "제안이 만료되었습니다." },
    }), { status: 409, headers: { "Content-Type": "application/json" } })));

    await expect(api.getApprovalPayload("demo-token", "agreement-1")).rejects.toMatchObject({
      status: 409, code: "OFFER_EXPIRED", message: "제안이 만료되었습니다.",
    });
  });
});
