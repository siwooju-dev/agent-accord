import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { BackendChip, BrandMark, Card, EvidenceList, HeroBento, LookBar, PageHead, StatusPill } from "../App";
import { HashDie } from "../components/HashDie";
import { Icon } from "../components/Icon";
import { Img } from "../components/Img";
import { ListingSheet, listingItems } from "../components/ListingSheet";
import { PriceRuler, type RulerRow } from "../components/PriceRuler";
import { ALL_CREDITS, LISTING_PHOTOS, coverOf } from "../data/media";
import { ApiError, api } from "../live/api";
import { approvalBlockReason, sameSnapshot, snapshotHashMatches } from "../live/approval";
import type {
  Agreement, AgreementSummary, ApprovalPayload, Audit, BuyerIntent, DemoSession, ListingInput,
  Negotiation, PublicListing, Role,
} from "../live/types";
import {
  connectWallet, currentWallet, signApproval, signLoginMessage, switchToBaseSepolia, watchWallet,
  type WalletState,
} from "../live/wallet";
import { LOOKS, readStoredLook, storeLook, type LookId } from "../looks";
import type { Evidence, PageKey } from "../types";
import "../App.css";
import "./connected.css";

/* ───────────── mapping between API data and the designed UI ───────────── */

/** Photos and evidence media exist for the three seeded listings (see data/media.ts). */
const MEDIA_ID: Record<string, string> = {
  "listing-demo-1": "listing-01",
  "listing-demo-2": "listing-02",
  "listing-demo-3": "listing-03",
};
const SELLER_NAME: Record<string, string> = {
  "seller-demo-1": "셀러 01",
  "seller-demo-2": "셀러 02",
  "seller-demo-3": "셀러 03",
};
const KINDS: Evidence["kind"][] = ["video", "receipt", "serial", "warranty"];
const EXPLORER = "https://sepolia.basescan.org";

const money = (n: number) => "₩" + new Intl.NumberFormat("ko-KR").format(n);
const day = (iso: string) => new Date(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
const stamp = (iso: string) => new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const short = (value: string, head = 6, tail = 4) => (value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value);
const sellerName = (sellerId: string) => SELLER_NAME[sellerId] ?? `판매자 ${sellerId.slice(-4)}`;
const localDay = (days: number) => {
  const date = new Date(Date.now() + days * 86_400_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const endOfDay = (value: string) => new Date(`${value}T23:59:00`).toISOString();

export const REASON_KO: Record<string, string> = {
  BUDGET_EXCEEDED: "예산 초과",
  DEADLINE_MISSED: "배송 기한 초과",
  SELLER_FLOOR_VIOLATED: "판매자 최저가 미달",
  OUT_OF_STOCK: "재고 없음",
  MUST_HAVE_UNMET: "필수 조건 미충족",
  SELLER_REJECTED: "판매 에이전트 거절",
  BUYER_REJECTED_COUNTER: "역제안 거절",
  BUYER_AGENT_SKIPPED: "증빙 문제로 제외",
  INVALID_MODEL_OUTPUT: "AI 응답 검증 실패",
  KILN_UNAVAILABLE: "Kiln 연결 실패",
  KILN_RATE_LIMITED: "Kiln 호출 한도",
  KILN_CREDITS_EXHAUSTED: "Kiln 크레딧 부족",
  KILN_TIMEOUT: "Kiln 응답 지연",
  KILN_AUTH_FAILED: "Kiln 인증 실패",
  NO_MATCH: "맞는 매물 없음",
  CANDIDATE_UNAVAILABLE: "조건에 맞지 않아 제외",
};
const EVENT_KO: Record<string, string> = {
  NEGOTIATION_STARTED: "협상 시작",
  CANDIDATE_BLOCKED: "사전 검사에서 제외 (AI 호출 생략)",
  LISTING_SKIPPED: "구매 에이전트가 매물 제외",
  BUYER_OFFER_BLOCKED: "예산을 넘는 제안 차단",
  OFFER_ALLOWED: "서버 규칙 통과",
  OFFER_BLOCKED: "서버 규칙 차단",
  OFFER_REJECTED: "판매 에이전트 거절",
  COUNTER_REJECTED: "구매 에이전트가 역제안 거절",
  MODEL_CALL_FAILED: "AI 호출 실패",
  MODEL_OUTPUT_REJECTED: "AI 응답 거부",
  AGREEMENT_CREATED: "합의안 생성",
  AGREEMENT_APPROVED: "지갑 서명 승인",
  AGREEMENT_REJECTED: "합의 거절",
  CHAIN_PENDING: "체인 기록 대기",
  CHAIN_SUBMISSION_UNKNOWN: "체인 전송 확인 중",
  AGREEMENT_RECORDED: "Base Sepolia 기록 완료",
  CHAIN_FAILED: "체인 기록 실패",
  NO_MATCH: "맞는 매물 없음",
  BLOCKED: "모든 제안 차단",
};
const STEP_KO: Record<string, string> = { assessment: "증빙 검토", buyer_offer: "구매 제안", seller_reply: "판매 응답", buyer_reply: "구매 답변" };
const ACTOR_KO: Record<string, string> = { assessor: "검토 에이전트", buyer: "구매 에이전트", seller: "판매 에이전트" };
const VERDICT_STATUS: Record<string, Evidence["status"]> = { consistent: "checked", conflicted: "conflicted", unverified: "unknown" };

function uiEvidence(listing: PublicListing, verdicts: Map<string, string>): Evidence[] {
  return listing.evidence.map((item) => ({
    id: item.id,
    kind: KINDS.includes(item.kind as Evidence["kind"]) ? (item.kind as Evidence["kind"]) : "receipt",
    label: item.label,
    source: item.summary,
    status: VERDICT_STATUS[verdicts.get(item.id) ?? ""] ?? "seller_claimed",
    hash: "",
  }));
}

const failure = (error: unknown) =>
  error instanceof ApiError
    ? `${error.message} (${error.code})`
    : error instanceof Error
      ? error.message
      : "요청을 완료하지 못했습니다.";

const PRESETS = [
  { key: "A", label: "기본 · ₩240만 · 10일", budget: 2_400_000, days: 10 },
  { key: "B", label: "예산 ₩200만", budget: 2_000_000, days: 10 },
  { key: "C", label: "기한 3일", budget: 2_400_000, days: 3 },
] as const;

const nav: { id: PageKey; label: string }[] = [
  { id: "overview", label: "개요" },
  { id: "conditions", label: "조건 · 매물" },
  { id: "negotiation", label: "협상" },
  { id: "agreement", label: "합의 · 서명" },
  { id: "audit", label: "기록" },
];

type OpenSheet = (listingId: string, itemId?: string) => void;

/* ───────────── app ───────────── */

export default function ConnectedApp() {
  const [look, setLook] = useState<LookId>(readStoredLook);
  const [page, setPage] = useState<PageKey>("overview");
  const [session, setSession] = useState<DemoSession | null>(null);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [catalog, setCatalog] = useState<PublicListing[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [intent, setIntent] = useState<BuyerIntent | null>(null);
  const [negotiation, setNegotiation] = useState<Negotiation | null>(null);
  const [agreements, setAgreements] = useState<AgreementSummary[]>([]);
  const [agreement, setAgreement] = useState<Agreement | null>(null);
  const [payload, setPayload] = useState<ApprovalPayload | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [selectedListing, setSelectedListing] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ listingId: string; itemId: string } | null>(null);
  const running = useRef(false);
  const keys = useRef(new Map<string, string>());

  const role: Role = session?.role ?? "buyer";

  const clearFlow = useCallback(() => {
    setIntent(null); setNegotiation(null); setAgreement(null); setAgreements([]);
    setPayload(null); setAudit(null); setConfirmed(false); keys.current.clear();
  }, []);

  async function perform(label: string, task: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(label);
    setError("");
    try {
      await task();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setSession(null);
        clearFlow();
      }
      setError(failure(cause));
    } finally {
      running.current = false;
      setBusy(null);
    }
  }

  useEffect(() => storeLook(look), [look]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const index = ["1", "2"].indexOf(event.key);
      if (index >= 0) setLook(LOOKS[index].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 5200);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.title = page === "overview" ? "Accord · 중고 GPU 협상" : `${nav.find((item) => item.id === page)?.label} · Accord`;
  }, [page]);

  const loadCatalog = useCallback(async () => {
    try {
      const response = await api.listListings();
      setCatalog(response.items);
      setCatalogError("");
    } catch (cause) {
      setCatalogError(failure(cause));
    }
  }, []);
  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  // Wallet changes end the session: a signature always belongs to the wallet that signed in.
  const sessionWallet = session?.wallet_address.toLowerCase();
  const sessionToken = session?.access_token;
  useEffect(() => {
    let active = true;
    const refresh = () => {
      setConfirmed(false);
      void currentWallet().then((value) => {
        if (!active) return;
        setWallet(value);
        if (sessionWallet && value?.address.toLowerCase() !== sessionWallet) {
          if (sessionToken) void api.logout(sessionToken).catch(() => undefined);
          setSession(null);
          clearFlow();
          setToast("지갑 계정이 바뀌어 로그아웃했어요. 새 계정으로 다시 로그인하세요.");
        }
      }).catch(() => { if (active) setWallet(null); });
    };
    refresh();
    const stop = watchWallet(refresh);
    return () => { active = false; stop(); };
  }, [sessionWallet, sessionToken, clearFlow]);

  // Negotiation progress.
  const negotiationId = negotiation?.id;
  const negotiationStatus = negotiation?.status;
  useEffect(() => {
    if (!session || !negotiationId || !negotiationStatus || !["NEGOTIATING", "PROPOSED"].includes(negotiationStatus)) return;
    const controller = new AbortController();
    let timer: number;
    const poll = async () => {
      try {
        const latest = await api.getNegotiation(session.access_token, negotiationId, controller.signal);
        if (!controller.signal.aborted) setNegotiation(latest);
      } catch (cause) {
        if (!controller.signal.aborted) setError(failure(cause));
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(poll, 2500);
      }
    };
    timer = window.setTimeout(poll, 2500);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [session, negotiationId, negotiationStatus]);

  // When a negotiation settles: load its audit (reasons per listing, Kiln usage) and its agreement.
  const flowId = agreement?.flow_id ?? negotiation?.flow_id;
  useEffect(() => {
    if (!session || !negotiation || ["NEGOTIATING", "PROPOSED"].includes(negotiation.status)) return;
    const controller = new AbortController();
    void api.getAudit(session.access_token, negotiation.flow_id).then((value) => {
      if (!controller.signal.aborted) setAudit(value);
    }).catch(() => undefined);
    if (negotiation.agreement_id && agreement?.id !== negotiation.agreement_id) {
      void api.getAgreement(session.access_token, negotiation.agreement_id, controller.signal).then((value) => {
        if (!controller.signal.aborted) { setAgreement(value); setPayload(null); setConfirmed(false); }
      }).catch(() => undefined);
      void api.listAgreements(session.access_token).then((list) => {
        if (!controller.signal.aborted) setAgreements(list.items);
      }).catch(() => undefined);
    }
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, negotiation?.status, negotiation?.flow_id]);

  // Agreement progress (other party's signature, relayer, receipt).
  const agreementId = agreement?.id;
  const agreementHash = agreement?.snapshot_hash;
  const agreementStatus = agreement?.status;
  useEffect(() => {
    if (!session || !agreementId || !agreementHash || !agreementStatus
      || ["RECORDED", "MOCK_RECORDED", "CHAIN_FAILED", "REJECTED", "EXPIRED"].includes(agreementStatus)) return;
    const controller = new AbortController();
    let timer: number;
    const poll = async () => {
      try {
        const latest = await api.getAgreement(session.access_token, agreementId, controller.signal);
        if (controller.signal.aborted) return;
        if (latest.snapshot_hash !== agreementHash || latest.status !== "AWAITING_APPROVALS") {
          setPayload(null);
          setConfirmed(false);
        }
        setAgreement(latest);
        if (latest.status === "RECORDED") {
          setToast("Base Sepolia에 합의가 기록됐어요.");
          void api.getAudit(session.access_token, latest.flow_id).then(setAudit).catch(() => undefined);
          void api.listAgreements(session.access_token).then((list) => setAgreements(list.items)).catch(() => undefined);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(failure(cause));
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(poll, 3500);
      }
    };
    timer = window.setTimeout(poll, 3500);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [session, agreementId, agreementHash, agreementStatus]);

  /* ── actions ── */

  const login = (next: Role) => perform("지갑 로그인", async () => {
    let connected = await connectWallet();
    setWallet(connected);
    if (connected.chainId !== 84532) {
      const switched = await switchToBaseSepolia();
      if (!switched) throw new Error("지갑 네트워크를 Base Sepolia로 바꿔주세요.");
      connected = switched;
      setWallet(switched);
    }
    const challenge = await api.createAuthChallenge(connected.address, next);
    const signature = await signLoginMessage(challenge.message, connected.address);
    const created = await api.createWalletSession(challenge.challenge_id, signature);
    clearFlow();
    setSession(created);
    const list = await api.listAgreements(created.access_token);
    setAgreements(list.items);
    const pending = list.items.find((item) => item.status === "AWAITING_APPROVALS"
      && !(created.role === "buyer" ? item.buyer_approved : item.seller_approved));
    if (pending) {
      setAgreement(await api.getAgreement(created.access_token, pending.id));
      setToast(`${created.role === "buyer" ? "구매자" : "판매자"}로 로그인했어요. 서명할 합의서가 있어요.`);
    } else {
      setToast(`${created.role === "buyer" ? "구매자" : "판매자"}로 로그인했어요. 로그인 서명은 거래가 아니에요.`);
    }
  });

  const logout = () => perform("로그아웃", async () => {
    const token = session?.access_token;
    try {
      if (token) await api.logout(token);
    } finally {
      setSession(null);
      clearFlow();
    }
    setToast("로그아웃했어요.");
  });

  const negotiate = (input: { model: string; budget: number; deadline: string; evidence: boolean; warranty: boolean }) =>
    perform("협상 시작", async () => {
      if (!session || session.role !== "buyer") throw new Error("구매자 지갑으로 로그인하세요.");
      const created = await api.createBuyerIntent(session.access_token, {
        gpu_model: input.model.trim(),
        max_total_krw: input.budget,
        delivery_deadline: endOfDay(input.deadline),
        must_have: [input.evidence ? "evidence_present" : null, input.warranty ? "warranty_active" : null]
          .filter((value): value is "evidence_present" | "warranty_active" => value !== null),
      });
      setIntent(created);
      let key = keys.current.get(created.id);
      if (!key) { key = crypto.randomUUID(); keys.current.set(created.id, key); }
      const started = await api.startNegotiation(session.access_token, created.id, key);
      setAgreement(null); setPayload(null); setAudit(null); setConfirmed(false); setSelectedListing(null);
      setNegotiation(await api.getNegotiation(session.access_token, started.id));
      setPage("negotiation");
    });

  const createListing = (input: ListingInput) => perform("매물 등록", async () => {
    if (!session || session.role !== "seller") throw new Error("판매자 지갑으로 로그인하세요.");
    const created = await api.createListing(session.access_token, input);
    await loadCatalog();
    setToast(`매물을 등록했어요 (${created.id}). 구매자 협상 후보에 바로 들어가요.`);
  });

  const selectAgreement = (id: string) => perform("합의서 조회", async () => {
    if (!session) return;
    const next = await api.getAgreement(session.access_token, id);
    setAgreement(next); setPayload(null); setConfirmed(false);
    setAudit(await api.getAudit(session.access_token, next.flow_id).catch(() => null));
    setPage("agreement");
  });

  const loadPayload = () => perform("서명 자료 확인", async () => {
    if (!session || !agreement) return;
    let active = await currentWallet();
    if (!active) active = await connectWallet();
    if (active.chainId !== 84532) active = (await switchToBaseSepolia()) ?? active;
    setWallet(active);
    const latest = await api.getAgreement(session.access_token, agreement.id);
    const next = await api.getApprovalPayload(session.access_token, agreement.id);
    setAgreement(latest); setPayload(next); setConfirmed(false);
    if (latest.snapshot_hash !== next.snapshot_hash || !(await snapshotHashMatches(next.snapshot, next.snapshot_hash))) {
      setPayload(null);
      throw new Error("서명 자료의 해시가 합의서와 달라요. 다시 확인하세요.");
    }
  });

  const approve = () => perform("지갑 서명", async () => {
    if (!session || !agreement || !payload || !confirmed) return;
    const latest = await api.getAgreement(session.access_token, agreement.id);
    const fresh = await api.getApprovalPayload(session.access_token, agreement.id);
    if (latest.snapshot_hash !== agreement.snapshot_hash || !sameSnapshot(latest.snapshot, agreement.snapshot)
      || latest.snapshot_hash !== fresh.snapshot_hash || !(await snapshotHashMatches(fresh.snapshot, fresh.snapshot_hash))) {
      setAgreement(latest); setPayload(null); setConfirmed(false);
      throw new Error("서명 직전에 합의 내용이 바뀌었어요. 다시 확인하세요.");
    }
    const active = await currentWallet();
    setWallet(active);
    const reason = approvalBlockReason(latest, fresh, session, active);
    if (reason) { setConfirmed(false); throw new Error(reason); }
    if (!active) throw new Error("지갑 연결을 확인하세요.");
    setToast("MetaMask에서 서명 요청을 확인하세요. 창이 안 보이면 확장 프로그램 아이콘을 누르세요.");
    const signature = await signApproval(fresh, active.address);
    await api.submitDecision(session.access_token, agreement.id, {
      decision: "approve", snapshot_hash: fresh.snapshot_hash, signature,
    });
    setAgreement(await api.getAgreement(session.access_token, agreement.id));
    setPayload(null); setConfirmed(false);
    void api.listAgreements(session.access_token).then((list) => setAgreements(list.items)).catch(() => undefined);
    setToast("서명을 제출했어요. 상대방 서명과 체인 기록을 자동으로 확인해요.");
  });

  const reject = () => perform("합의 거절", async () => {
    if (!session || !agreement) return;
    const latest = await api.getAgreement(session.access_token, agreement.id);
    if (latest.status !== "AWAITING_APPROVALS" || latest.snapshot_hash !== agreement.snapshot_hash) {
      setAgreement(latest); setPayload(null); setConfirmed(false);
      throw new Error("합의 상태가 바뀌었어요. 새로 확인하세요.");
    }
    await api.submitDecision(session.access_token, agreement.id, { decision: "reject", snapshot_hash: latest.snapshot_hash });
    setAgreement(await api.getAgreement(session.access_token, agreement.id));
    setPayload(null); setConfirmed(false);
    void api.listAgreements(session.access_token).then((list) => setAgreements(list.items)).catch(() => undefined);
    setToast("합의를 거절했어요.");
  });

  const refreshAudit = () => perform("기록 조회", async () => {
    if (!session || !flowId) return;
    setAudit(await api.getAudit(session.access_token, flowId));
  });

  /* ── derived ── */

  const verdicts = useMemo(() => {
    const map = new Map<string, string>();
    const assessments = [...(negotiation?.assessments ?? []), ...(agreement?.assessment ? [agreement.assessment] : [])];
    for (const item of assessments) {
      for (const finding of item.findings) if (finding.evidence_id) map.set(finding.evidence_id, finding.verdict);
    }
    return map;
  }, [negotiation, agreement]);

  const openSheet: OpenSheet = useCallback((listingId, itemId) => {
    const mediaId = MEDIA_ID[listingId] ?? listingId;
    const first = itemId ?? listingItems(mediaId)[0]?.id;
    if (first && LISTING_PHOTOS[mediaId]) setSheet({ listingId: mediaId, itemId: first });
  }, []);

  const pendingForMe = agreements.filter((item) => item.status === "AWAITING_APPROVALS"
    && !(role === "buyer" ? item.buyer_approved : item.seller_approved));

  const ctx = { session, role, catalog, verdicts, openSheet, setPage, busy, now };

  return (
    <div className="app connected">
      <LookBar look={look} setLook={setLook} />
      <header className="nav">
        <button className="brand" type="button" onClick={() => setPage("overview")} aria-label="개요로 이동">
          <BrandMark />
          <span>Accord</span>
        </button>
        <nav className="tabs" aria-label="주요 화면">
          {nav.map((item) => (
            <button
              key={item.id}
              type="button"
              className={"tab" + (page === item.id ? " is-active" : "")}
              onClick={() => setPage(item.id)}
              aria-current={page === item.id ? "page" : undefined}
            >
              {item.label}
              {item.id === "agreement" && pendingForMe.length > 0 && <i className="tab-dot" aria-label="서명할 합의서" />}
            </button>
          ))}
        </nav>
        <div className="nav-tools">
          <BackendChip />
          <WalletChip session={session} wallet={wallet} busy={Boolean(busy)} onLogin={(next) => void login(next)} onLogout={() => void logout()} />
        </div>
      </header>

      {(busy || error) && (
        <div className={"status-strip" + (error ? " is-error" : "")} role={error ? "alert" : "status"} aria-live="polite">
          {error ? <Icon name="alert" size={15} /> : <span className="spinner" aria-hidden="true" />}
          <span>{error || `${busy} 중…`}</span>
          {error && <button type="button" onClick={() => setError("")} aria-label="닫기"><Icon name="close" size={13} /></button>}
        </div>
      )}

      <main className={"page page-" + page}>
        {page !== "overview" && <PageHead page={page} role={role} />}
        {page === "overview" && (
          <Overview {...ctx} negotiation={negotiation} agreement={agreement} pending={pendingForMe} catalogError={catalogError}
            onLogin={(next) => void login(next)} selectAgreement={(id) => void selectAgreement(id)} />
        )}
        {page === "conditions" && (
          <Conditions {...ctx} intent={intent} catalogError={catalogError} onNegotiate={(input) => void negotiate(input)}
            onCreateListing={(input) => void createListing(input)} onLogin={(next) => void login(next)} />
        )}
        {page === "negotiation" && (
          <NegotiationPage {...ctx} intent={intent} negotiation={negotiation} audit={audit} agreements={agreements}
            selectedListing={selectedListing} setSelectedListing={setSelectedListing} onLogin={(next) => void login(next)}
            selectAgreement={(id) => void selectAgreement(id)} />
        )}
        {page === "agreement" && (
          <AgreementPage {...ctx} agreement={agreement} agreements={agreements} payload={payload} wallet={wallet}
            confirmed={confirmed} setConfirmed={setConfirmed} onLoadPayload={() => void loadPayload()} onApprove={() => void approve()}
            onReject={() => void reject()} selectAgreement={(id) => void selectAgreement(id)} onLogin={(next) => void login(next)} />
        )}
        {page === "audit" && (
          <AuditPage {...ctx} audit={audit} agreement={agreement} onRefresh={() => void refreshAudit()} onLogin={(next) => void login(next)} />
        )}
      </main>

      <footer className="footer">
        <span><Icon name="shield" size={13} /> 합의 기록은 Base Sepolia 테스트넷 · 실제 결제 없음</span>
        <span>Kiln qwen3-32b · AgreementRegistry</span>
        <details className="credits">
          <summary>사진 · 영상 출처 {ALL_CREDITS.length}건</summary>
          <p>매물 사진과 영상은 Wikimedia Commons의 자유 라이선스 자료예요. 시드 매물과 영수증·보증 조회 화면은 시연용 견본이에요.</p>
          <ul>
            {ALL_CREDITS.map((credit) => (
              <li key={credit.url}>
                <a href={credit.url} target="_blank" rel="noreferrer">{credit.title}</a> · {credit.author} · {credit.license}
                {credit.edited ? ` · ${credit.edited}` : ""}
              </li>
            ))}
          </ul>
        </details>
      </footer>

      {sheet && (
        <ListingSheet
          listingId={sheet.listingId}
          itemId={sheet.itemId}
          onSelect={(itemId) => setSheet((value) => (value ? { ...value, itemId } : value))}
          onClose={() => setSheet(null)}
          priceKrw={catalog.find((item) => MEDIA_ID[item.id] === sheet.listingId)
            ? (() => { const item = catalog.find((entry) => MEDIA_ID[entry.id] === sheet.listingId)!; return item.asking_price_krw + item.shipping_fee_krw; })()
            : undefined}
          now={now}
        />
      )}

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <Icon name="check" size={16} />
          <span>{toast}</span>
          <button onClick={() => setToast("")} aria-label="알림 닫기"><Icon name="close" size={14} /></button>
        </div>
      )}
    </div>
  );
}

interface Ctx {
  session: DemoSession | null;
  role: Role;
  catalog: PublicListing[];
  verdicts: Map<string, string>;
  openSheet: OpenSheet;
  setPage: (page: PageKey) => void;
  busy: string | null;
  now: number;
}

/* ───────────── header wallet ───────────── */

function WalletChip({ session, wallet, busy, onLogin, onLogout }: {
  session: DemoSession | null; wallet: WalletState | null; busy: boolean;
  onLogin: (role: Role) => void; onLogout: () => void;
}) {
  if (session) {
    return (
      <div className={"wallet-chip " + session.role}>
        <i className={"dot " + session.role} />
        <span>
          <b>{session.role === "buyer" ? "구매자" : "판매자"}</b>
          <small className="mono">{short(session.wallet_address)}</small>
        </span>
        <button type="button" onClick={onLogout} disabled={busy}>로그아웃</button>
      </div>
    );
  }
  return (
    <div className="role-switch login-switch" role="group" aria-label="지갑으로 로그인">
      <button type="button" onClick={() => onLogin("buyer")} disabled={busy} title={wallet ? `연결된 지갑 ${wallet.address}` : "MetaMask로 로그인"}>
        <i className="dot buyer" /> 구매자로 로그인
      </button>
      <button type="button" onClick={() => onLogin("seller")} disabled={busy}>
        <i className="dot seller" /> 판매자로 로그인
      </button>
    </div>
  );
}

function LoginCard({ onLogin, busy, text }: { onLogin: (role: Role) => void; busy: string | null; text: string }) {
  return (
    <section className="card login-card">
      <Icon name="wallet" size={22} />
      <div>
        <h2>지갑으로 로그인하세요</h2>
        <p>{text} 로그인 서명은 거래나 송금이 아니고, 가스비도 들지 않아요.</p>
      </div>
      <div className="login-actions">
        <button className="btn btn-primary" onClick={() => onLogin("buyer")} disabled={Boolean(busy)}>구매자로 로그인</button>
        <button className="btn btn-secondary" onClick={() => onLogin("seller")} disabled={Boolean(busy)}>판매자로 로그인</button>
      </div>
    </section>
  );
}

/* ───────────── listing card (catalog) ───────────── */

function ListingCard({ listing, ctx, badge, offerTotal }: { listing: PublicListing; ctx: Ctx; badge?: ReactNode; offerTotal?: number }) {
  const mediaId = MEDIA_ID[listing.id];
  const photos = mediaId ? LISTING_PHOTOS[mediaId] ?? [] : [];
  const cover = photos[0];
  const evidence = uiEvidence(listing, ctx.verdicts);
  const mine = ctx.session?.role === "seller" && ctx.session.actor_id === listing.seller_id;
  return (
    <article className="listing">
      <div className="listing-art">
        {cover ? (
          <button type="button" className="listing-cover" onClick={() => ctx.openSheet(listing.id, cover.id)} aria-label={`${listing.title} 사진 ${photos.length}장 보기`}>
            <Img src={cover.src} alt={cover.alt} width={cover.w} height={cover.h} focus={cover.focus} />
          </button>
        ) : (
          <span className="listing-cover placeholder" aria-hidden="true"><Icon name="box" size={28} /><b>{listing.gpu_model}</b></span>
        )}
        <span className="listing-strip" aria-hidden="true">
          {photos.slice(1, 4).map((photo) => <img key={photo.id} src={photo.src} alt="" loading="lazy" decoding="async" />)}
          {photos.length > 4 && <em>+{photos.length - 4}</em>}
        </span>
        {badge && <span className="listing-verdict">{badge}</span>}
      </div>
      <div className="listing-body">
        <p className="listing-seller">
          {sellerName(listing.seller_id)} · {listing.stock_status === "available" ? "판매 가능" : "판매 완료"}
          {mine && <span className="mine-tag">내 매물</span>}
        </p>
        <h3>{listing.title}</h3>
        <p className="listing-cond">{listing.condition_text}</p>
        <div className="listing-price">
          <span>{offerTotal ? "합의 제안 (배송비 포함)" : "상품가 + 배송비"}</span>
          <b>{money(offerTotal ?? listing.asking_price_krw + listing.shipping_fee_krw)}</b>
        </div>
        <dl className="listing-meta">
          <div><dt>출고 가능</dt><dd>{listing.earliest_delivery_at ? day(listing.earliest_delivery_at) : "-"}</dd></div>
          <div><dt>보증 (판매자 입력)</dt><dd>{listing.warranty_end ? day(listing.warranty_end) : "없음"}</dd></div>
        </dl>
        {evidence.length > 0 ? (
          <EvidenceList items={evidence} onOpen={(id) => ctx.openSheet(listing.id, id)} dense />
        ) : (
          <p className="note">첨부 증빙 없음</p>
        )}
      </div>
    </article>
  );
}

/* ───────────── overview ───────────── */

function Overview({
  catalog, negotiation, agreement, pending, catalogError, onLogin, selectAgreement, ...ctx
}: Ctx & {
  negotiation: Negotiation | null; agreement: Agreement | null; pending: AgreementSummary[]; catalogError: string;
  onLogin: (role: Role) => void; selectAgreement: (id: string) => void;
}) {
  const full = { ...ctx, catalog } as Ctx;
  const offers = negotiation?.offers ?? [];
  return (
    <div className="overview">
      <section className="hero">
        <div className="hero-copy">
          <p className="hero-kicker"><span className="hero-kicker-dot" /> AI 에이전트 중고 GPU 거래</p>
          <h1 className="hero-title">
            흥정은 <em>AI</em>가,
            <br />
            결정은 <em className="alt">당신</em>이.
          </h1>
          <p className="hero-lede">Kiln AI 에이전트가 협상하고, 서버가 규칙을 검사하고, 두 사람이 같은 합의서에 지갑으로 서명하면 Base Sepolia에 기록돼요.</p>
          <div className="hero-cta">
            {ctx.session ? (
              <button className="btn btn-primary" onClick={() => ctx.setPage(ctx.role === "buyer" ? "conditions" : "agreement")}>
                {ctx.role === "buyer" ? "조건 정하고 협상 시작" : "서명할 합의서 보기"} <Icon name="arrow" size={16} />
              </button>
            ) : (
              <>
                <button className="btn btn-primary" onClick={() => onLogin("buyer")} disabled={Boolean(ctx.busy)}>
                  구매자로 시작 <Icon name="arrow" size={16} />
                </button>
                <button className="btn btn-secondary" onClick={() => onLogin("seller")} disabled={Boolean(ctx.busy)}>판매자로 시작</button>
              </>
            )}
          </div>
        </div>
        <HeroBento openSheet={(listingId, itemId) => {
          const apiId = Object.keys(MEDIA_ID).find((key) => MEDIA_ID[key] === listingId) ?? listingId;
          ctx.openSheet(apiId, itemId);
        }} />
      </section>

      {pending.length > 0 && (
        <section className="section">
          <header className="section-head">
            <h2>서명할 합의서 <span className="count">{pending.length}</span></h2>
          </header>
          <div className="pending-list">
            {pending.map((item) => {
              const listing = catalog.find((entry) => entry.id === item.listing_id);
              return (
                <button key={item.id} type="button" className="pending-row" onClick={() => selectAgreement(item.id)}>
                  <Icon name="pen" size={16} />
                  <span><b>{listing?.title ?? item.listing_id}</b><small>{item.id}</small></span>
                  <strong>{money(item.total_krw)}</strong>
                  <StatusPill status={item.status} />
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="section">
        <header className="section-head">
          <h2>{offers.length > 0 ? "받은 제안" : "지금 올라온 매물"} <span className="count">{offers.length > 0 ? offers.length : catalog.length}</span></h2>
          <span className="section-meta">
            {agreement?.status === "RECORDED" && (
              <span className="c-pass"><Icon name="pass" size={14} /> 최근 합의 기록 완료</span>
            )}
            <button className="link-btn" onClick={() => ctx.setPage(offers.length > 0 ? "negotiation" : "conditions")}>
              {offers.length > 0 ? "협상 자세히" : "조건 · 매물"} <Icon name="arrow" size={14} />
            </button>
          </span>
        </header>
        {catalogError && <p className="error-text">매물을 불러오지 못했어요: {catalogError}</p>}
        <div className="listing-grid">
          {catalog.map((listing) => {
            const offer = offers.find((entry) => entry.listing_id === listing.id);
            return (
              <ListingCard key={listing.id} listing={listing} ctx={full} offerTotal={offer?.total_krw}
                badge={offer ? <span className="pill tone-pass"><Icon name="check" size={12} /> 제안 도착</span> : undefined} />
            );
          })}
        </div>
      </section>
    </div>
  );
}

/* ───────────── conditions ───────────── */

function Conditions({
  intent, catalogError, onNegotiate, onCreateListing, onLogin, ...ctx
}: Ctx & {
  intent: BuyerIntent | null; catalogError: string;
  onNegotiate: (input: { model: string; budget: number; deadline: string; evidence: boolean; warranty: boolean }) => void;
  onCreateListing: (input: ListingInput) => void; onLogin: (role: Role) => void;
}) {
  const [model, setModel] = useState("RTX 4090");
  const [budget, setBudget] = useState("2400000");
  const [deadline, setDeadline] = useState(localDay(10));
  const [evidence, setEvidence] = useState(true);
  const [warranty, setWarranty] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onNegotiate({ model, budget: Math.max(0, Number(budget) || 0), deadline, evidence, warranty });
  };
  const models = [...new Set(ctx.catalog.map((item) => item.gpu_model))];
  return (
    <div className="stack">
      {!ctx.session ? (
        <LoginCard onLogin={onLogin} busy={ctx.busy} text="구매자는 조건을 넣고 협상을 시작하고, 판매자는 매물을 올려요." />
      ) : ctx.role === "buyer" ? (
        <div className="split">
          <form className="card form" onSubmit={submit}>
            <header className="card-head">
              <div>
                <h2>구매 조건</h2>
                <p>이 조건으로 Kiln 에이전트가 매물마다 협상해요. 20초 정도 걸려요.</p>
              </div>
            </header>
            <div className="segmented presets" role="group" aria-label="예시 조건">
              {PRESETS.map((preset) => (
                <button type="button" key={preset.key}
                  className={Number(budget) === preset.budget && deadline === localDay(preset.days) ? "is-on" : ""}
                  onClick={() => { setBudget(String(preset.budget)); setDeadline(localDay(preset.days)); }}>
                  {preset.label}
                </button>
              ))}
            </div>
            <label className="field">
              <span>GPU 모델</span>
              <input value={model} onChange={(e) => setModel(e.currentTarget.value)} list="gpu-models" required maxLength={100} />
              <datalist id="gpu-models">{models.map((item) => <option key={item} value={item} />)}</datalist>
            </label>
            <label className="field private">
              <span>최고 총예산 <em><Icon name="lock" size={11} /> 나만 보기</em></span>
              <span className="money-input">
                <span>₩</span>
                <input type="number" min="10000" step="10000" value={budget} onChange={(e) => setBudget(e.currentTarget.value)} required />
              </span>
              <small>배송비 포함 · 판매자와 판매 에이전트에게는 보내지 않아요</small>
            </label>
            <div className="field-row">
              <label className="field">
                <span>배송 기한</span>
                <input type="date" value={deadline} min={localDay(1)} onChange={(e) => setDeadline(e.currentTarget.value)} required />
              </label>
              <div className="field">
                <span>필수 조건</span>
                <label className="check-inline"><input type="checkbox" checked={evidence} onChange={(e) => setEvidence(e.currentTarget.checked)} /> 증빙 있음</label>
                <label className="check-inline"><input type="checkbox" checked={warranty} onChange={(e) => setWarranty(e.currentTarget.checked)} /> 보증 남음</label>
              </div>
            </div>
            <div className="form-foot">
              {intent && <small className="muted">최근 조건 {intent.id} · {money(intent.max_total_krw)} · {day(intent.delivery_deadline)}</small>}
              <button className="btn btn-primary" disabled={Boolean(ctx.busy) || !model.trim()}>
                이 조건으로 협상 시작 <Icon name="arrow" size={14} />
              </button>
            </div>
          </form>
          <div className="stack">
            <Card title="이렇게 진행돼요" sub="AI와 서버가 하는 일이 달라요">
              <ul className="check-list">
                <li><span className="check-icon"><Icon name="shield" size={12} /></span>서버가 예산·기한으로 불가능한 매물을 먼저 걸러요 (AI 호출 생략)</li>
                <li><span className="check-icon"><Icon name="spark" size={12} /></span>Kiln 에이전트가 증빙을 검토하고 구매자·판매자 입장에서 흥정해요</li>
                <li><span className="check-icon"><Icon name="check" size={12} /></span>서버 규칙을 통과한 제안 중 가장 싼 것으로 합의서를 만들어요</li>
                <li><span className="check-icon"><Icon name="pen" size={12} /></span>두 사람이 지갑으로 서명하면 Base Sepolia에 기록돼요</li>
              </ul>
            </Card>
          </div>
        </div>
      ) : (
        <SellerListingForm catalog={ctx.catalog} session={ctx.session} busy={ctx.busy} onCreate={onCreateListing} />
      )}

      <div className="section-title">
        <h2>공개 매물 <span className="count">{ctx.catalog.length}</span></h2>
        <p>판매자가 올린 정보와 증빙이에요. 사진과 증빙을 눌러 자세히 볼 수 있어요.</p>
      </div>
      {catalogError && <p className="error-text">매물을 불러오지 못했어요: {catalogError}</p>}
      <div className="listing-grid">
        {ctx.catalog.map((listing) => <ListingCard key={listing.id} listing={listing} ctx={ctx} />)}
      </div>
    </div>
  );
}

function SellerListingForm({ catalog, session, busy, onCreate }: {
  catalog: PublicListing[]; session: DemoSession | null; busy: string | null; onCreate: (input: ListingInput) => void;
}) {
  const own = catalog.filter((item) => item.seller_id === session?.actor_id);
  const ownEvidence = own.flatMap((item) => item.evidence);
  const [model, setModel] = useState("RTX 4090");
  const [ask, setAsk] = useState("1990000");
  const [floor, setFloor] = useState("1900000");
  const [shipping, setShipping] = useState("20000");
  const [earliest, setEarliest] = useState(localDay(2));
  const [condition, setCondition] = useState("사용 12개월 · 박스 포함 (판매자 주장)");
  const [warranty, setWarranty] = useState("2027-02-14");
  const [picked, setPicked] = useState<string[]>([]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onCreate({
      gpu_model: model.trim(), asking_price_krw: Number(ask), min_item_price_krw: Number(floor),
      shipping_fee_krw: Number(shipping), earliest_delivery_at: new Date(`${earliest}T12:00:00`).toISOString(),
      condition_text: condition.trim(), warranty_end: warranty || null, stock_status: "available", evidence_ids: picked,
    });
  };
  return (
    <div className="split">
      <form className="card form" onSubmit={submit}>
        <header className="card-head">
          <div>
            <h2>매물 올리기</h2>
            <p>올리면 바로 구매자 협상 후보가 돼요. 같은 판매자의 새 매물이 이전 매물을 대신해요.</p>
          </div>
        </header>
        <div className="field-row">
          <label className="field"><span>GPU 모델</span><input value={model} onChange={(e) => setModel(e.currentTarget.value)} required maxLength={100} /></label>
          <label className="field"><span>희망 판매가</span><span className="money-input"><span>₩</span><input type="number" min="1" value={ask} onChange={(e) => setAsk(e.currentTarget.value)} required /></span></label>
        </div>
        <div className="field-row">
          <label className="field"><span>배송비</span><span className="money-input"><span>₩</span><input type="number" min="0" value={shipping} onChange={(e) => setShipping(e.currentTarget.value)} required /></span></label>
          <label className="field"><span>출고 가능일</span><input type="date" value={earliest} min={localDay(0)} onChange={(e) => setEarliest(e.currentTarget.value)} required /></label>
        </div>
        <div className="field-row">
          <label className="field"><span>보증 만료일</span><input type="date" value={warranty} onChange={(e) => setWarranty(e.currentTarget.value)} /></label>
          <label className="field"><span>상태 설명</span><input value={condition} onChange={(e) => setCondition(e.currentTarget.value)} required maxLength={400} /></label>
        </div>
        <label className="field private seller">
          <span>나의 최저가 <em><Icon name="lock" size={11} /> 나만 보기</em></span>
          <span className="money-input"><span>₩</span><input type="number" min="1" value={floor} onChange={(e) => setFloor(e.currentTarget.value)} required /></span>
          <small>판매 에이전트만 써요. 구매자 화면과 합의서에는 나오지 않아요.</small>
        </label>
        {ownEvidence.length > 0 && (
          <div className="field">
            <span>첨부할 증빙 (내가 등록한 것)</span>
            {ownEvidence.map((item) => (
              <label className="check-inline" key={item.id}>
                <input type="checkbox" checked={picked.includes(item.id)}
                  onChange={(e) => { const on = e.currentTarget.checked; setPicked((list) => on ? [...list, item.id] : list.filter((id) => id !== item.id)); }} />
                {item.label} <small className="muted">{item.id}</small>
              </label>
            ))}
          </div>
        )}
        <div className="form-foot">
          <button className="btn btn-primary" disabled={Boolean(busy)}>매물 등록 <Icon name="arrow" size={14} /></button>
        </div>
      </form>
      <Card title="내 매물" sub={own.length ? "이 판매자 계정으로 올린 매물이에요" : "아직 올린 매물이 없어요"}>
        <ul className="ev-rows">
          {own.map((item) => (
            <li key={item.id}><span className="ev-row static"><span className="ev-row-icon"><Icon name="box" size={16} /></span>
              <span className="ev-row-text"><b>{item.title}</b><small>{money(item.asking_price_krw + item.shipping_fee_krw)} · 증빙 {item.evidence.length}</small></span></span></li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/* ───────────── negotiation ───────────── */

function NegotiationPage({
  intent, negotiation, audit, agreements, selectedListing, setSelectedListing, onLogin, selectAgreement, ...ctx
}: Ctx & {
  intent: BuyerIntent | null; negotiation: Negotiation | null; audit: Audit | null; agreements: AgreementSummary[];
  selectedListing: string | null; setSelectedListing: (id: string) => void; onLogin: (role: Role) => void; selectAgreement: (id: string) => void;
}) {
  if (!ctx.session) return <LoginCard onLogin={onLogin} busy={ctx.busy} text="협상은 구매자 지갑으로 시작해요." />;
  if (ctx.role === "seller") {
    return (
      <div className="stack">
        <div className="callout">
          <Icon name="lock" size={18} />
          <p><b>판매자 화면에는 구매자 예산과 협상 과정이 보이지 않아요</b>
            판매 에이전트가 내 최저가 안에서 대신 흥정해요. 합의안이 생기면 아래와 합의·서명 탭에 나타나요.</p>
        </div>
        <AgreementListCard agreements={agreements} catalog={ctx.catalog} onSelect={selectAgreement} />
      </div>
    );
  }
  if (!negotiation) {
    return (
      <section className="card empty">
        <p>아직 시작한 협상이 없어요. 조건을 정하면 Kiln 에이전트가 매물마다 협상해요.</p>
        <button className="btn btn-primary" onClick={() => ctx.setPage("conditions")}>조건 정하러 가기 <Icon name="arrow" size={14} /></button>
      </section>
    );
  }
  const running = ["NEGOTIATING", "PROPOSED"].includes(negotiation.status);
  const candidates = ctx.catalog.filter((item) => item.gpu_model.toLowerCase() === (intent?.gpu_model ?? "").toLowerCase());
  const reasonOf = new Map<string, string>();
  for (const event of audit?.events ?? []) {
    if (event.object_id && event.reason_code && !reasonOf.has(event.object_id)) reasonOf.set(event.object_id, event.reason_code);
  }
  const rows: RulerRow[] = candidates.map((listing) => {
    const offer = negotiation.offers.find((item) => item.listing_id === listing.id);
    const reason = reasonOf.get(listing.id);
    return {
      id: listing.id,
      code: sellerName(listing.seller_id),
      title: listing.title.replace("RTX 4090 ", ""),
      ask: listing.asking_price_krw + listing.shipping_fee_krw,
      offer: offer?.total_krw ?? listing.asking_price_krw + listing.shipping_fee_krw,
      status: offer ? "pass" : "block",
      reason: offer ? undefined : running ? "협상 중" : REASON_KO[reason ?? ""] ?? "제안 없음",
    };
  });
  const current = selectedListing ?? negotiation.offers[0]?.listing_id ?? candidates[0]?.id ?? "";
  const listing = ctx.catalog.find((item) => item.id === current);
  const assessment = negotiation.assessments.find((item) => item.listing_id === current);
  const offer = negotiation.offers.find((item) => item.listing_id === current);
  const chosen = negotiation.offers.find((item) => item.id === negotiation.selected_offer_id);
  const usage = audit?.model_usage ?? [];
  const cost = typeof audit?.totals.cost_usd === "number" ? audit.totals.cost_usd : null;
  return (
    <div className="stack">
      <div className={"scenario live-status" + (running ? " is-running" : "")}>
        <div>
          <b>{running ? "Kiln 에이전트가 협상 중이에요…" : negotiation.status === "AWAITING_APPROVALS" ? "합의안이 나왔어요" : "맞는 제안이 없어요"}</b>
          <span>
            {intent ? `${intent.gpu_model} · 예산 ${money(intent.max_total_krw)} · ${day(intent.delivery_deadline)}까지 · ` : ""}
            {negotiation.flow_id}
          </span>
        </div>
        {running ? <span className="spinner big" aria-label="진행 중" />
          : negotiation.status === "AWAITING_APPROVALS"
            ? <span className="pill tone-pass"><i />합의안 생성</span>
            : <span className="pill tone-block"><i />{negotiation.status === "NO_MATCH" ? "매물 없음" : "제안 차단"}</span>}
      </div>

      <div className="split wide">
        <Card title="호가에서 제안까지" sub="파란 선은 나만 보는 예산 한도예요">
          {rows.length > 0
            ? <PriceRuler rows={rows} budget={intent?.max_total_krw ?? null} selectedId={current} onSelect={setSelectedListing} />
            : <p className="note">이 모델의 매물이 없어요.</p>}
        </Card>
        {listing && (
          <Card title="협상 대화" sub={`${sellerName(listing.seller_id)} · ${listing.title}`} className="thread-card">
            <ol className="thread">
              <li className="msg seller">
                <span className="msg-who">판매자 · 매물 등록</span>
                <p><b>{money(listing.asking_price_krw + listing.shipping_fee_krw)}</b>에 올렸어요. (배송비 포함)</p>
              </li>
              {assessment && (
                <li className="msg buyer">
                  <span className="msg-who">검토 에이전트 · Kiln</span>
                  <p>{assessment.summary}</p>
                  {assessment.findings.map((finding, index) => (
                    <p className={"msg-sub finding " + finding.verdict} key={`${finding.evidence_id}-${index}`}>
                      <b>{finding.verdict === "consistent" ? "일치" : finding.verdict === "conflicted" ? "불일치" : "확인 불가"}</b> {finding.note}
                    </p>
                  ))}
                </li>
              )}
              {offer && (
                <li className={"msg " + (offer.proposer === "seller" ? "seller" : "buyer")}>
                  <span className="msg-who">{offer.proposer === "seller" ? "판매 에이전트 역제안" : "구매 에이전트 제안 · 판매자 수락"} · {offer.round}라운드</span>
                  <p><b>{money(offer.total_krw)}</b> (상품 {money(offer.item_price_krw)} + 배송 {money(offer.shipping_fee_krw)}) · {day(offer.delivery_by)} 도착</p>
                  <p className="msg-sub">{offer.rationale}</p>
                </li>
              )}
              <li className={"msg system " + (offer ? "pass" : running ? "" : "block")}>
                <Icon name={offer ? "shield" : running ? "clock" : "alert"} size={14} />
                {offer ? "서버 검사 · 예산 · 최저가 · 기한 · 재고 · 필수 조건 통과"
                  : running ? "협상 진행 중"
                    : `제안 없음 · ${REASON_KO[reasonOf.get(current) ?? ""] ?? "조건 불일치"}`}
              </li>
            </ol>
            <p className="note">에이전트 판단은 Kiln qwen3-32b 실제 응답이에요. 통과 여부는 서버 코드가 정하고, 서명 대상은 합의서뿐이에요.</p>
          </Card>
        )}
      </div>

      <div className="split">
        <Card title="Kiln 호출" sub={usage.length ? `${usage.length}회 · 토큰 ${Number(audit?.totals.input_tokens ?? 0) + Number(audit?.totals.output_tokens ?? 0)}${cost !== null ? ` · $${cost.toFixed(6)}` : ""}` : running ? "협상이 끝나면 표시돼요" : "기록 없음"}>
          <ul className="usage-list">
            {usage.map((item, index) => (
              <li key={`${item.request_id}-${index}`} className={item.outcome && item.outcome !== "OK" ? "warn" : ""}>
                <b>{ACTOR_KO[item.actor] ?? item.actor}</b>
                <span>{STEP_KO[item.step] ?? item.step}</span>
                <span className="mono">{item.input_tokens ?? "-"}/{item.output_tokens ?? "-"}</span>
                <span className="mono">{item.latency_ms ? `${(item.latency_ms / 1000).toFixed(1)}s` : "-"}</span>
                <span>{item.outcome && item.outcome !== "OK" ? (item.outcome === "INVALID_OUTPUT" ? "규칙 위반 → 재질문" : REASON_KO[item.outcome] ?? item.outcome) : "OK"}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="결과" sub={chosen ? "서버 규칙을 통과한 제안 중 총액이 가장 낮은 것" : "합의안 없음"}>
          {chosen ? (
            <div className="result-box">
              <strong>{money(chosen.total_krw)}</strong>
              <span>{ctx.catalog.find((item) => item.id === chosen.listing_id)?.title}</span>
              <button className="btn btn-primary" onClick={() => negotiation.agreement_id && selectAgreement(negotiation.agreement_id)}>
                합의서로 가기 <Icon name="arrow" size={14} />
              </button>
            </div>
          ) : (
            <p className="note">{running ? "협상이 끝나면 결과가 나와요." : "조건을 바꿔 다시 협상해보세요."}</p>
          )}
          {!running && (
            <ul className="reason-list">
              {negotiation.blocked_events.map((item, index) => (
                <li key={index}><Icon name="block" size={13} /> {REASON_KO[item.reason_code] ?? item.reason_code}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function AgreementListCard({ agreements, catalog, onSelect }: { agreements: AgreementSummary[]; catalog: PublicListing[]; onSelect: (id: string) => void }) {
  return (
    <Card title="내 합의서" sub={agreements.length ? "눌러서 열기" : "아직 합의서가 없어요"}>
      <div className="pending-list">
        {agreements.map((item) => (
          <button key={item.id} type="button" className="pending-row" onClick={() => onSelect(item.id)}>
            <Icon name="agreement" size={16} />
            <span><b>{catalog.find((entry) => entry.id === item.listing_id)?.title ?? item.listing_id}</b><small>{item.id}</small></span>
            <strong>{money(item.total_krw)}</strong>
            <StatusPill status={item.status} />
          </button>
        ))}
      </div>
    </Card>
  );
}

/* ───────────── agreement ───────────── */

function AgreementPage({
  agreement, agreements, payload, wallet, confirmed, setConfirmed, onLoadPayload, onApprove, onReject, selectAgreement, onLogin, ...ctx
}: Ctx & {
  agreement: Agreement | null; agreements: AgreementSummary[]; payload: ApprovalPayload | null; wallet: WalletState | null;
  confirmed: boolean; setConfirmed: (value: boolean) => void; onLoadPayload: () => void; onApprove: () => void; onReject: () => void;
  selectAgreement: (id: string) => void; onLogin: (role: Role) => void;
}) {
  if (!ctx.session) return <LoginCard onLogin={onLogin} busy={ctx.busy} text="합의서는 구매자와 판매자가 각자 지갑으로 서명해요." />;
  if (!agreement) {
    return (
      <div className="stack">
        <section className="card empty">
          <p>{ctx.role === "buyer" ? "아직 합의서가 없어요. 협상이 끝나면 여기서 서명해요." : "아직 내 매물에 합의서가 없어요."}</p>
          {ctx.role === "buyer" && <button className="btn btn-secondary" onClick={() => ctx.setPage("conditions")}>협상 시작하기</button>}
        </section>
        <AgreementListCard agreements={agreements} catalog={ctx.catalog} onSelect={selectAgreement} />
      </div>
    );
  }
  const snapshot = agreement.snapshot;
  const listing = ctx.catalog.find((item) => item.id === snapshot.listing_id);
  const mediaId = MEDIA_ID[snapshot.listing_id];
  const cover = coverOf(mediaId);
  const status = agreement.status;
  const mine = ctx.role === "buyer" ? agreement.buyer_approved : agreement.seller_approved;
  const expected = ctx.role === "buyer" ? snapshot.buyer_wallet : snapshot.seller_wallet;
  const walletOk = Boolean(wallet && wallet.address.toLowerCase() === expected.toLowerCase() && wallet.chainId === 84532);
  const blockReason = approvalBlockReason(agreement, payload, ctx.session, wallet, ctx.now);
  const open = status === "AWAITING_APPROVALS" && !mine;
  const tx = agreement.chain.tx_hash;
  const detail = status === "RECORDED"
    ? "두 서명을 컨트랙트가 직접 검증하고 Base Sepolia에 기록했어요."
    : status === "RECORDING"
      ? "두 서명이 모였어요. relayer가 트랜잭션을 보내고 영수증을 확인하는 중이에요."
      : status === "AWAITING_APPROVALS"
        ? mine ? "내 서명은 끝났어요. 상대방 서명을 기다리는 중이에요." : "합의서 내용을 확인하고 지갑으로 서명해주세요."
        : status === "REJECTED" ? "한쪽이 거절해서 합의가 끝났어요."
          : status === "EXPIRED" ? "서명 기한이 지나 합의서가 만료됐어요."
            : status === "CHAIN_FAILED" ? "체인 기록에 실패했어요." : status;
  const steps = [
    { title: "지갑 확인", detail: walletOk ? short(wallet!.address) : `${short(expected)} 계정 · Base Sepolia`, done: walletOk || mine, active: open && !walletOk },
    { title: "서명 자료 확인", detail: payload ? "해시 일치" : "금액 · 배송 · 해시", done: Boolean(payload) || mine, active: open && walletOk && !payload },
    { title: "서명", detail: mine ? "서명 완료" : "MetaMask에서 서명", done: mine, active: open && Boolean(payload) },
  ];
  const tone = ["REJECTED", "EXPIRED", "CHAIN_FAILED"].includes(status) ? "block" : status === "RECORDED" ? "done" : "open";
  return (
    <div className="stack">
      <section className={"sign-hero tone-" + tone}>
        <div className={"party buyer" + (agreement.buyer_approved ? " on" : "")}>
          <span className="party-avatar">구</span>
          <span><b>구매자</b><small>{agreement.buyer_approved ? "서명 완료" : "서명 대기"}</small></span>
        </div>
        <div className="sign-bridge" aria-hidden="true">
          <span className={"bridge-line buyer" + (agreement.buyer_approved ? " on" : "")} />
          <span className="bridge-doc"><Icon name={tone === "block" ? "alert" : tone === "done" ? "check" : "agreement"} size={18} /></span>
          <span className={"bridge-line seller" + (agreement.seller_approved ? " on" : "")} />
        </div>
        <div className={"party seller" + (agreement.seller_approved ? " on" : "")}>
          <span className="party-avatar">판</span>
          <span><b>판매자</b><small>{agreement.seller_approved ? "서명 완료" : "서명 대기"}</small></span>
        </div>
        <div className="sign-status">
          <StatusPill status={status} />
          <p>{detail}</p>
        </div>
      </section>

      <div className="split">
        <section className="card doc">
          {cover && (
            <button type="button" className="doc-shot" onClick={() => ctx.openSheet(snapshot.listing_id, cover.id)} aria-label="매물 사진 크게 보기">
              <Img src={cover.src} alt={cover.alt} width={cover.w} height={cover.h} focus={cover.focus} />
              <span className="doc-shot-tag"><Icon name="camera" size={13} /> 사진 {LISTING_PHOTOS[mediaId]?.length ?? 0} · 증빙 {listing?.evidence.length ?? 0}</span>
            </button>
          )}
          <header className="doc-head">
            <div>
              <p className="eyebrow">합의서 · {agreement.id}</p>
              <h2>{listing?.title ?? snapshot.gpu_model}</h2>
              <p>{sellerName(snapshot.seller_id)} · {snapshot.listing_id}</p>
            </div>
            <HashDie hash={agreement.snapshot_hash} size={72} />
          </header>
          <div className="doc-total">
            <span>총 합의 금액</span>
            <strong>{money(snapshot.total_krw)}</strong>
            <small>상품 {money(snapshot.item_price_krw)} + 배송 {money(snapshot.shipping_fee_krw)}</small>
          </div>
          <dl className="kv">
            <div><dt>도착 예정</dt><dd>{day(snapshot.delivery_by)}까지</dd></div>
            <div><dt>보증</dt><dd>{snapshot.warranty_terms}</dd></div>
            <div><dt>서명 기한</dt><dd>{stamp(snapshot.expires_at)}</dd></div>
            <div>
              <dt>첨부 증빙</dt>
              <dd className="doc-ev">
                {(listing?.evidence ?? []).map((item, index) => (
                  <button type="button" key={item.id} className="doc-ev-row tone-idle" onClick={() => ctx.openSheet(snapshot.listing_id, item.id)}>
                    <Icon name="file" size={14} />
                    <span>{item.label}</span>
                    <code>{snapshot.evidence_hashes[index] ? short(snapshot.evidence_hashes[index], 10, 6) : ""}</code>
                  </button>
                ))}
              </dd>
            </div>
            <div><dt>구매자 지갑</dt><dd className="mono">{snapshot.buyer_wallet}</dd></div>
            <div><dt>판매자 지갑</dt><dd className="mono">{snapshot.seller_wallet}</dd></div>
            <div><dt>구매자 nonce</dt><dd className="mono">{snapshot.nonce}</dd></div>
          </dl>
          <div className="hash-box">
            <span>합의 해시 <em>RFC 8785 · SHA-256</em></span>
            <code>{agreement.snapshot_hash}</code>
            <small>두 사람은 이 해시가 들어간 EIP-712 데이터에 서명해요. 내용이 한 글자라도 바뀌면 해시가 달라져요.</small>
          </div>
        </section>

        <div className="stack">
          <section className={"card approve role-" + ctx.role}>
            <header className="card-head">
              <div>
                <h2>{ctx.role === "buyer" ? "구매자로 서명하기" : "판매자로 서명하기"}</h2>
                <p>로그인한 지갑이 합의서의 {ctx.role === "buyer" ? "구매자" : "판매자"} 지갑과 같아야 해요.</p>
              </div>
            </header>
            <ol className="steps">
              {steps.map((step, index) => (
                <li key={step.title} className={(step.done ? "is-done" : "") + (step.active ? " is-active" : "")}>
                  <span className="step-n">{step.done ? <Icon name="check" size={12} /> : index + 1}</span>
                  <span><b>{step.title}</b><small>{step.detail}</small></span>
                </li>
              ))}
            </ol>
            {open && (
              <>
                <button className="btn btn-secondary full" onClick={onLoadPayload} disabled={Boolean(ctx.busy)}>
                  {payload ? "서명 자료 다시 확인" : "지갑 확인 · 서명 자료 불러오기"}
                </button>
                <label className={"confirm" + (!payload ? " is-muted" : "")}>
                  <input type="checkbox" checked={confirmed} disabled={!payload} onChange={(e) => setConfirmed(e.currentTarget.checked)} />
                  <span className="confirm-box" aria-hidden="true"><Icon name="check" size={12} /></span>
                  금액, 배송, 보증, 증빙 해시와 지갑 주소를 확인했어요.
                </label>
                <button className="btn btn-primary full sign-btn" onClick={onApprove} disabled={!payload || !confirmed || Boolean(blockReason) || Boolean(ctx.busy)}>
                  MetaMask로 서명 <Icon name="pen" size={15} />
                </button>
                {payload && blockReason && <p className="error-text">{blockReason}</p>}
                <button className="btn btn-ghost full" onClick={onReject} disabled={Boolean(ctx.busy)}>합의 거절</button>
              </>
            )}
            {!open && mine && status === "AWAITING_APPROVALS" && <p className="note">상대방이 서명하면 자동으로 기록을 시작해요. 이 화면은 자동으로 새로고침돼요.</p>}
          </section>
          <section className="card chain">
            <header className="card-head">
              <div>
                <h2>체인 기록</h2>
                <p>AgreementRegistry · Base Sepolia</p>
              </div>
              <span className={"pill small tone-" + (status === "RECORDED" ? "pass" : status === "RECORDING" ? "info" : status === "CHAIN_FAILED" ? "block" : "idle")}>
                <i /> {status === "RECORDED" ? "기록 완료" : status === "RECORDING" ? "기록 중" : status === "CHAIN_FAILED" ? "실패" : "서명 대기"}
              </span>
            </header>
            {tx ? (
              <dl className="kv">
                <div><dt>트랜잭션</dt><dd className="mono"><a href={`${EXPLORER}/tx/${tx}`} target="_blank" rel="noreferrer">{short(tx, 12, 8)} <Icon name="external" size={12} /></a></dd></div>
                {agreement.chain.block_number ? <div><dt>블록</dt><dd className="mono">{agreement.chain.block_number}</dd></div> : null}
                {agreement.chain.event_name ? <div><dt>이벤트</dt><dd>{agreement.chain.event_name}</dd></div> : null}
              </dl>
            ) : (
              <p className="note">두 사람이 모두 서명하면 relayer가 기록해요. 영수증·이벤트·저장값이 모두 맞아야 기록 완료로 표시해요.</p>
            )}
          </section>
          {agreements.length > 1 && <AgreementListCard agreements={agreements} catalog={ctx.catalog} onSelect={selectAgreement} />}
        </div>
      </div>
    </div>
  );
}

/* ───────────── audit ───────────── */

function AuditPage({ audit, agreement, onRefresh, onLogin, ...ctx }: Ctx & {
  audit: Audit | null; agreement: Agreement | null; onRefresh: () => void; onLogin: (role: Role) => void;
}) {
  if (!ctx.session) return <LoginCard onLogin={onLogin} busy={ctx.busy} text="기록은 그 흐름의 구매자와 판매자만 볼 수 있어요." />;
  if (!audit) {
    return (
      <section className="card empty">
        <p>협상을 시작하거나 합의서를 열면 그 흐름의 기록이 여기 나와요.</p>
        {(agreement) && <button className="btn btn-secondary" onClick={onRefresh}>기록 불러오기</button>}
      </section>
    );
  }
  const events = [...audit.events].reverse();
  const cost = typeof audit.totals.cost_usd === "number" ? audit.totals.cost_usd : null;
  const tone = (decision: string | null) => decision === "allowed" || decision === "confirmed" ? "pass"
    : decision === "blocked" || decision === "rejected" || decision === "failed" ? "block"
      : decision === "pending" || decision === "awaiting_approvals" ? "info" : "idle";
  const tx = audit.chain.tx_hash;
  return (
    <div className="stack">
      <section className="stats">
        <div className="stat"><span>이벤트</span><b>{audit.events.length}</b></div>
        <div className="stat"><span>Kiln 호출</span><b>{audit.model_usage.length}</b></div>
        <div className="stat"><span>Kiln 비용</span><b className="c-pass">{cost !== null ? `$${cost.toFixed(5)}` : "-"}</b></div>
        <div className="stat"><span>체인</span><b className={tx ? "c-pass" : "muted"}>{tx ? "기록됨" : "없음"}</b></div>
      </section>
      <div className="split wide">
        <Card title="이벤트 타임라인" sub={`최신순 · ${audit.flow_id}`} action={<button className="btn btn-secondary small" onClick={onRefresh}>새로고침</button>}>
          <ol className="timeline">
            {events.map((event, index) => (
              <li key={`${event.at}-${index}`} className={"tl " + (tone(event.decision) === "pass" ? "allowed" : tone(event.decision) === "block" ? "blocked" : tone(event.decision) === "info" ? "pending" : "info")}>
                <span className="tl-dot" />
                <div className="tl-body">
                  <div className="tl-top"><b>{EVENT_KO[event.event_type] ?? event.event_type}</b><code>{event.event_type}</code></div>
                  <p>{event.actor}{event.object_id ? ` · ${event.object_id}` : ""}{event.reason_code ? ` · ${REASON_KO[event.reason_code] ?? event.reason_code}` : ""}</p>
                </div>
                <div className="tl-side">
                  <span className={"pill small tone-" + tone(event.decision)}><i />{event.decision ?? "기록"}</span>
                  <time>{stamp(event.at)}</time>
                </div>
              </li>
            ))}
          </ol>
        </Card>
        <div className="stack">
          <Card title="Kiln API 호출" sub="generation id는 Kiln 응답 헤더 x-neocloud-generation-id">
            <ul className="usage-list tall">
              {audit.model_usage.map((item, index) => (
                <li key={`${item.request_id}-${index}`} className={item.outcome && item.outcome !== "OK" ? "warn" : ""}>
                  <b>{ACTOR_KO[item.actor] ?? item.actor} · {STEP_KO[item.step] ?? item.step}</b>
                  <span className="mono">{item.request_id ? short(item.request_id, 8, 4) : "-"}</span>
                  <span className="mono">{item.input_tokens ?? "-"}/{item.output_tokens ?? "-"}</span>
                  <span className="mono">{typeof item.cost_usd === "number" ? `$${item.cost_usd.toFixed(6)}` : "-"}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="체인 기록" sub="Base Sepolia · AgreementRegistry">
            {tx ? (
              <p className="mono"><a href={`${EXPLORER}/tx/${tx}`} target="_blank" rel="noreferrer">{short(tx, 14, 10)} <Icon name="external" size={12} /></a></p>
            ) : <p className="note">아직 트랜잭션이 없어요.</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}
