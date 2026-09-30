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

  it("revokes the current server session on logout", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      request_id: "req-logout", revoked: true,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.logout("session-token")).resolves.toMatchObject({ revoked: true });

    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/auth/logout");
    expect(options.method).toBe("POST");
    expect(options.headers).toMatchObject({ Authorization: "Bearer session-token" });
  });

  it("surfaces a backend status conflict without replacing it with mock success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      request_id: "req-error", error: { code: "OFFER_EXPIRED", message: "제안이 만료되었습니다." },
    }), { status: 409, headers: { "Content-Type": "application/json" } })));

    await expect(api.getApprovalPayload("demo-token", "agreement-1")).rejects.toMatchObject({
      status: 409, code: "OFFER_EXPIRED", message: "제안이 만료되었습니다.",
    });
  });

  it("starts wallet authentication with a public challenge and trades it for a session", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        request_id: "req-auth", challenge_id: "challenge-1", message: "SIWE message", expires_at: "2026-10-01T00:00:00Z",
      }), { status: 201, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        request_id: "req-session", access_token: "memory-token", actor_id: "wallet-buyer-test", role: "buyer",
        wallet_address: "0x1111111111111111111111111111111111111111",
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const challenge = await api.createAuthChallenge("0x1111111111111111111111111111111111111111", "buyer");
    const session = await api.createWalletSession(challenge.challenge_id, "0xsigned-message");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/auth/challenges");
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      wallet_address: "0x1111111111111111111111111111111111111111", role: "buyer",
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/auth/sessions");
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      challenge_id: "challenge-1", signature: "0xsigned-message",
    });
    expect(session.role).toBe("buyer");
  });

  it("loads the public listing catalog through the real API path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      request_id: "req-listings", items: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await api.listListings();

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/listings");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("GET");
  });
});
