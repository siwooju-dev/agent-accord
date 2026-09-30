import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { HashDie } from "./components/HashDie";
import { Icon } from "./components/Icon";
import { Img } from "./components/Img";
import { EVIDENCE_ICON, EvidenceChip, EvidenceStatus, ListingSheet, clock, listingItems } from "./components/ListingSheet";
import { PriceRuler, type RulerRow } from "./components/PriceRuler";
import {
  DEMO_BUYER_INTENT,
  DEMO_EVIDENCE,
  DEMO_LISTINGS,
  DEMO_OFFERS,
  INITIAL_AUDIT_EVENTS,
} from "./data/demo";
import { ALL_CREDITS, EVIDENCE_VIEWS, LISTING_PHOTOS, coverOf } from "./data/media";
import {
  approvalPayloadMatches,
  createAgreementSnapshot,
  inspectOffer,
  mockWalletAddress,
  validateOffers,
} from "./lib/mockApi";
import { LOOKS, lookById, readStoredLook, storeLook, type LookId } from "./looks";
import type { AgreementSnapshot, AuditEvent, BuyerIntent, Evidence, Listing, PageKey, UserRole } from "./types";
import "./App.css";

type Evaluation = ReturnType<typeof validateOffers>[number];
type OpenSheet = (listingId: string, itemId?: string) => void;

const nav: { id: PageKey; label: string }[] = [
  { id: "overview", label: "개요" },
  { id: "conditions", label: "조건 · 매물" },
  { id: "negotiation", label: "협상" },
  { id: "agreement", label: "합의 · 서명" },
  { id: "audit", label: "기록" },
];

const pageCopy: Record<Exclude<PageKey, "overview">, { eyebrow: string; title: string; lede: string }> = {
  conditions: {
    eyebrow: "Step 1 · 조건",
    title: "살 조건을 정하고 매물을 비교해요",
    lede: "예산과 배송 기한은 나에게만 보여요. 에이전트는 이 조건 안에서만 흥정합니다.",
  },
  negotiation: {
    eyebrow: "Step 2 · 협상",
    title: "에이전트가 흥정하고, 서버가 검사해요",
    lede: "모든 제안은 같은 규칙으로 검사돼요. 에이전트의 설명은 참고용이고 통과 여부는 서버 코드가 정합니다.",
  },
  agreement: {
    eyebrow: "Step 3 · 합의",
    title: "같은 합의서에 두 사람이 서명해요",
    lede: "구매자와 판매자가 똑같은 스냅샷 해시에 각자 서명해야 거래가 확정돼요. 한쪽 승인만으로는 끝나지 않습니다.",
  },
  audit: {
    eyebrow: "기록",
    title: "모든 판단을 시간순으로 남겨요",
    lede: "누가 무엇을 입력했고 서버가 어떻게 판정했는지 확인할 수 있어요. 로컬 데모 로그예요.",
  },
};

const money = (n: number) => "₩" + new Intl.NumberFormat("ko-KR").format(n);
const date = (value: string) =>
  new Date(value + (value.length === 10 ? "T12:00:00" : "")).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
const reasonKo: Record<string, string> = {
  BUDGET_EXCEEDED: "예산 초과",
  DELIVERY_DEADLINE: "배송 기한 초과",
  TOTAL_MISMATCH: "총액 불일치",
};
const evidenceOf = (ids: string[] | undefined) => DEMO_EVIDENCE.filter((item) => ids?.includes(item.id));
const flagged = (ids: string[] | undefined) => evidenceOf(ids).filter((item) => item.status === "conflicted").length;

function readItemParam() {
  try {
    return new URLSearchParams(window.location.search).get("item");
  } catch {
    return null;
  }
}
function writeItemParam(item: string | null) {
  try {
    const url = new URL(window.location.href);
    if (item) url.searchParams.set("item", item);
    else url.searchParams.delete("item");
    window.history.replaceState(null, "", url);
  } catch {
    /* deep links are a convenience */
  }
}
function listingOfItem(item: string | null) {
  if (!item) return undefined;
  return DEMO_LISTINGS.find(
    (listing) => listing.evidenceIds.includes(item) || LISTING_PHOTOS[listing.id]?.some((photo) => photo.id === item),
  );
}

function App() {
  const [look] = useState<LookId>(readStoredLook);
  const [page, setPage] = useState<PageKey>("overview");
  const [role, setRole] = useState<UserRole>("buyer");
  const [intent, setIntent] = useState<BuyerIntent>(DEMO_BUYER_INTENT);
  const [modelDraft, setModelDraft] = useState(intent.gpuModel);
  const [budgetDraft, setBudgetDraft] = useState(String(intent.maxTotalKrw));
  const [deadlineDraft, setDeadlineDraft] = useState(intent.deliveryDeadline);
  const [mustHaveDraft, setMustHaveDraft] = useState(intent.mustHave.join(", "));
  const [sellerMinimum, setSellerMinimum] = useState("1940000");
  const [sellerPrice, setSellerPrice] = useState("2060000");
  const [selectedId, setSelectedId] = useState("offer-02");
  const [buyerSigned, setBuyerSigned] = useState(false);
  const [sellerSigned, setSellerSigned] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [connected, setConnected] = useState<Record<UserRole, boolean>>({ buyer: false, seller: false });
  const [checked, setChecked] = useState<Record<UserRole, boolean>>({ buyer: false, seller: false });
  const [events, setEvents] = useState<AuditEvent[]>(INITIAL_AUDIT_EVENTS);
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [sheet, setSheet] = useState<{ listingId: string; itemId: string } | null>(() => {
    const item = readItemParam();
    const owner = listingOfItem(item);
    return owner && item ? { listingId: owner.id, itemId: item } : null;
  });
  const openSheet: OpenSheet = useCallback((listingId, itemId) => {
    const first = itemId ?? listingItems(listingId)[0]?.id;
    if (first) setSheet({ listingId, itemId: first });
  }, []);
  const selectSheetItem = useCallback((itemId: string) => setSheet((value) => (value ? { ...value, itemId } : value)), []);
  const closeSheet = useCallback(() => setSheet(null), []);

  useEffect(() => storeLook(look), [look]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4800);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.title = page === "overview" ? "Accord · 중고 GPU 협상" : `${nav.find((item) => item.id === page)?.label} · Accord`;
  }, [page]);
  useEffect(() => writeItemParam(sheet?.itemId ?? null), [sheet]);

  const evaluations = useMemo(() => validateOffers(DEMO_OFFERS, intent), [intent]);
  const visibleEvaluations =
    role === "seller" ? evaluations.filter((item) => item.offer.listingId === "listing-02") : evaluations;
  const selected = evaluations.find((item) => item.offer.id === selectedId) ?? evaluations[0];
  const offer = selected?.offer;
  const listing = offer ? DEMO_LISTINGS.find((item) => item.id === offer.listingId) : undefined;
  const snapshot = useMemo(() => (offer ? createAgreementSnapshot(offer) : null), [offer]);
  const matches = approvalPayloadMatches(snapshot, offer);
  const expired = Boolean(offer && new Date(offer.expiresAt).getTime() <= now);
  const bothSigned = buyerSigned && sellerSigned;
  const status = rejected
    ? "REJECTED"
    : expired
      ? "EXPIRED"
      : selected?.status === "blocked"
        ? "BLOCKED"
        : bothSigned
          ? "RECORDING"
          : buyerSigned || sellerSigned
            ? "AWAITING_APPROVALS"
            : "PROPOSED";
  const address = snapshot ? mockWalletAddress(role, role === "seller" ? "seller-02" : listing?.sellerId) : "";
  const expected = snapshot ? (role === "buyer" ? snapshot.buyerWallet : snapshot.sellerWallet) : "";
  const addressMatches = address.toLowerCase() === expected.toLowerCase();
  const signed = role === "buyer" ? buyerSigned : sellerSigned;
  const canSign = Boolean(
    selected?.status === "valid" && !expired && !rejected && !signed && connected[role] && checked[role] && matches && addressMatches,
  );

  function log(actor: string, eventType: string, decision: AuditEvent["decision"], detail: string) {
    const at = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul", hour12: false }).replace("T", " ");
    setEvents((current) => [
      { id: "event-" + Date.now(), at, actor, eventType, decision, detail: detail + " · demo/mock", source: "demo/mock" },
      ...current,
    ]);
  }
  function resetApprovals() {
    setBuyerSigned(false);
    setSellerSigned(false);
    setRejected(false);
    setChecked({ buyer: false, seller: false });
  }
  function saveIntent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIntent({
      ...intent,
      gpuModel: modelDraft.trim(),
      maxTotalKrw: Math.max(0, Number(budgetDraft) || 0),
      deliveryDeadline: deadlineDraft,
      mustHave: mustHaveDraft
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    });
    resetApprovals();
    log("구매자", "INTENT_UPDATED", "info", "조건 변경 · 이전 승인을 초기화했습니다.");
    setToast("조건을 저장했어요. 이전 승인은 초기화하고 모든 제안을 다시 검사했어요.");
  }
  function scenario(which: "A" | "B" | "C") {
    if (role === "seller") {
      setToast("구매 조건 변경은 구매자 화면에서만 할 수 있어요.");
      return;
    }
    const next =
      which === "A"
        ? DEMO_BUYER_INTENT
        : which === "B"
          ? { ...DEMO_BUYER_INTENT, maxTotalKrw: 1_950_000 }
          : { ...DEMO_BUYER_INTENT, deliveryDeadline: "2026-10-02" };
    setIntent(next);
    setModelDraft(next.gpuModel);
    setBudgetDraft(String(next.maxTotalKrw));
    setDeadlineDraft(next.deliveryDeadline);
    setMustHaveDraft(next.mustHave.join(", "));
    setSelectedId("offer-01");
    resetApprovals();
    log(
      "데모 시나리오",
      "CONDITION_RECHECKED",
      "info",
      which === "A" ? "기본 조건 적용" : which === "B" ? "예산 변경 후 제안 재검사" : "기한 변경 후 제안 재검사",
    );
    setToast(which === "A" ? "기본 조건으로 돌렸어요." : "조건을 바꿨어요. 어떤 제안이 막히는지 확인해보세요.");
  }
  function switchRole(next: UserRole) {
    if (next === "seller" && selectedId !== "offer-02") {
      setSelectedId("offer-02");
      resetApprovals();
    }
    setRole(next);
  }
  function chooseOffer(id: string) {
    if (id === selectedId) return;
    if (role === "seller" && id !== "offer-02") return;
    setSelectedId(id);
    resetApprovals();
    log(role, "OFFER_SELECTED", "info", "합의 스냅샷 변경 · 이전 승인 초기화");
    setToast("다른 제안을 골랐어요. 합의서가 바뀌어 이전 승인은 초기화됐어요.");
  }
  function connectWallet() {
    if (!matches || !addressMatches) {
      setToast("지갑 주소가 합의서와 달라요.");
      return;
    }
    setConnected((value) => ({ ...value, [role]: true }));
    setChecked((value) => ({ ...value, [role]: false }));
    log(role, "DEMO_WALLET_CONNECTED", "info", "데모 지갑 주소 확인");
    setToast("데모 지갑을 연결했어요. 실제 지갑은 연결하지 않았어요.");
  }
  function sign() {
    if (!canSign) return;
    if (role === "buyer") setBuyerSigned(true);
    else setSellerSigned(true);
    log(role, "DEMO_APPROVAL_SUBMITTED", "pending", "사용자가 합의 스냅샷 확인 후 데모 승인");
    setToast("데모 서명을 남겼어요. 실제 체인 기록은 아직 없어요.");
  }
  function reject() {
    if (!selected || selected.status !== "valid" || bothSigned) return;
    setRejected(true);
    setBuyerSigned(false);
    setSellerSigned(false);
    setChecked({ buyer: false, seller: false });
    log(role, "AGREEMENT_REJECTED", "rejected", "합의 거절");
    setToast("합의를 거절했어요.");
  }
  function saveSeller(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    log("판매자 셀러 02", "LISTING_DRAFT_SAVED", "info", "매물 초안 브라우저 임시 저장");
    setToast("매물 초안을 이 브라우저에만 임시 저장했어요.");
  }

  return (
    <div className="app">
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
              {item.id === "agreement" && buyerSigned !== sellerSigned && !rejected && <i className="tab-dot" aria-label="상대 서명 대기" />}
            </button>
          ))}
        </nav>
        <div className="nav-tools">
          <span className="mock-badge">Demo · mock</span>
          <BackendChip />
          <a className="live-link" href="?mode=live">
            실제 API
          </a>
          <div className="role-switch" role="group" aria-label="보는 사람">
            <button className={role === "buyer" ? "is-on" : ""} onClick={() => switchRole("buyer")} aria-pressed={role === "buyer"}>
              <i className="dot buyer" /> 구매자
            </button>
            <button className={role === "seller" ? "is-on" : ""} onClick={() => switchRole("seller")} aria-pressed={role === "seller"}>
              <i className="dot seller" /> 판매자
            </button>
          </div>
        </div>
      </header>

      <main className={"page page-" + page}>
        {page !== "overview" && <PageHead page={page} role={role} />}
        {page === "overview" && (
          <Overview
            role={role}
            intent={intent}
            evaluations={visibleEvaluations}
            selectedId={selectedId}
            chooseOffer={chooseOffer}
            status={status}
            buyerSigned={buyerSigned}
            sellerSigned={sellerSigned}
            setPage={setPage}
            openSheet={openSheet}
          />
        )}
        {page === "conditions" && (
          <Conditions
            role={role}
            intent={intent}
            model={modelDraft}
            setModel={setModelDraft}
            budget={budgetDraft}
            setBudget={setBudgetDraft}
            deadline={deadlineDraft}
            setDeadline={setDeadlineDraft}
            mustHave={mustHaveDraft}
            setMustHave={setMustHaveDraft}
            saveIntent={saveIntent}
            sellerMinimum={sellerMinimum}
            setSellerMinimum={setSellerMinimum}
            sellerPrice={sellerPrice}
            setSellerPrice={setSellerPrice}
            saveSeller={saveSeller}
            evaluations={evaluations}
            openSheet={openSheet}
          />
        )}
        {page === "negotiation" && (
          <Negotiation
            role={role}
            intent={intent}
            evaluations={visibleEvaluations}
            selectedId={selectedId}
            setSelectedId={chooseOffer}
            setPage={setPage}
            scenario={scenario}
            openSheet={openSheet}
          />
        )}
        {page === "agreement" && (
          <Agreement
            role={role}
            listing={listing}
            snapshot={snapshot}
            evaluation={selected}
            status={status}
            expired={expired}
            matches={matches}
            address={address}
            addressMatches={addressMatches}
            connected={connected[role]}
            checked={checked[role]}
            signed={signed}
            buyerSigned={buyerSigned}
            sellerSigned={sellerSigned}
            canSign={canSign}
            bothSigned={bothSigned}
            rejected={rejected}
            connect={connectWallet}
            setChecked={(value) => setChecked((old) => ({ ...old, [role]: value }))}
            sign={sign}
            reject={reject}
            setPage={setPage}
            openSheet={openSheet}
          />
        )}
        {page === "audit" && <Audit events={events} />}
      </main>

      <footer className="footer">
        <span><Icon name="alert" size={13} /> 오프라인 디자인 시안 · 실제 API와 지갑 서명은 연결되지 않음</span>
        <span>합의 기록은 테스트넷 전용 · 실제 결제 없음</span>
        <details className="credits">
          <summary>사진 · 영상 출처 {ALL_CREDITS.length}건</summary>
          <p>매물 사진과 영상은 Wikimedia Commons의 자유 라이선스 자료예요. 매물·판매자·영수증은 가상이에요.</p>
          <ul>
            {ALL_CREDITS.map((credit) => (
              <li key={credit.url}>
                <a href={credit.url} target="_blank" rel="noreferrer">
                  {credit.title}
                </a>{" "}
                · {credit.author} · {credit.license}
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
          onSelect={selectSheetItem}
          onClose={closeSheet}
          priceKrw={evaluations.find((item) => item.offer.listingId === sheet.listingId)?.offer.totalKrw}
          now={now}
        />
      )}

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <Icon name="check" size={16} />
          <span>{toast}</span>
          <button onClick={() => setToast("")} aria-label="알림 닫기">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

/* ───────────── design switcher (top bar) ───────────── */

export function LookBar({ look, setLook }: { look: LookId; setLook: (id: LookId) => void }) {
  const current = lookById(look);
  return (
    <div className="lookbar" role="region" aria-label="디자인 시안 선택">
      <span className="lookbar-label">디자인 시안</span>
      <div className="lookbar-options" role="radiogroup" aria-label="시안">
        {LOOKS.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={item.id === look}
            className={"look-option" + (item.id === look ? " is-on" : "")}
            onClick={() => setLook(item.id)}
            title={`${item.name} · ${item.tagline} (키보드 ${index + 1})`}
          >
            <span className="look-swatch" aria-hidden="true">
              {item.swatch.map((color) => (
                <i key={color} style={{ background: color }} />
              ))}
            </span>
            <b>
              {item.key} · {item.name}
            </b>
          </button>
        ))}
      </div>
      <span className="lookbar-note">
        {current.tagline} <kbd>1</kbd> <kbd>2</kbd>
      </span>
    </div>
  );
}

/** Shows the backend behind the dev/preview proxy when one answers; stays hidden on static hosting. */
interface BackendHealth {
  status?: string;
  mode?: string;
  contract_version?: string;
  chain_mode?: string;
  kiln?: { agent?: string; model_id?: string; api_key_configured?: boolean };
  chain?: { chain_id?: number; contract_address?: string | null };
}

export function BackendChip() {
  const [info, setInfo] = useState<BackendHealth | null>(null);
  useEffect(() => {
    if (import.meta.env.VITE_BACKEND_PROBE === "off") return;
    const controller = new AbortController();
    fetch("/__backend/health", { signal: controller.signal, headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: BackendHealth | null) => {
        if (data?.status === "ok") setInfo(data);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  if (!info) return null;
  const kiln = info.kiln?.agent === "kiln" && info.kiln.api_key_configured;
  const chain = info.chain_mode === "live" && info.chain?.chain_id === 84532;
  const parts = [info.mode ?? "on", kiln ? "Kiln" : null, chain ? "Base Sepolia" : null].filter(Boolean);
  return (
    <span
      className={"backend-chip" + (kiln && chain ? " is-live" : "")}
      title={`백엔드 연결됨 · mode ${info.mode ?? "?"} · chain ${info.chain_mode ?? "?"}`
        + (info.kiln?.model_id ? ` · 모델 ${info.kiln.model_id}` : "")
        + (info.chain?.contract_address ? ` · 컨트랙트 ${info.chain.contract_address}` : "")}
    >
      <i /> 백엔드 {parts.join(" · ")}
    </span>
  );
}

export function BrandMark() {
  return (
    <svg className="brand-mark" width="26" height="26" viewBox="0 0 28 28" aria-hidden="true">
      <rect width="28" height="28" rx="8" className="brand-mark-bg" />
      <path d="M8.5 14a5.5 5.5 0 0 1 5.5-5.5" className="brand-mark-buyer" />
      <path d="M19.5 14a5.5 5.5 0 0 1-5.5 5.5" className="brand-mark-seller" />
      <circle cx="14" cy="14" r="2.2" className="brand-mark-core" />
    </svg>
  );
}

export function PageHead({ page, role }: { page: Exclude<PageKey, "overview">; role: UserRole }) {
  const copy = pageCopy[page];
  return (
    <header className="page-head">
      <p className="eyebrow">
        {copy.eyebrow}
        <span className={"role-chip " + role}>{role === "buyer" ? "구매자 화면" : "판매자 화면"}</span>
      </p>
      <h1>{copy.title}</h1>
      <p className="page-lede">{copy.lede}</p>
    </header>
  );
}

export function Card({ title, sub, action, className = "", children }: { title: string; sub?: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={"card " + className}>
      <header className="card-head">
        <div>
          <h2>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function StatusPill({ status }: { status: string }) {
  const labels: Record<string, string> = {
    PROPOSED: "서명 전",
    AWAITING_APPROVALS: "한쪽 서명 완료",
    RECORDING: "기록 대기",
    RECORDED: "기록 완료",
    MOCK_RECORDED: "서명 완료 · mock 체인",
    CHAIN_FAILED: "기록 실패",
    BLOCKED: "검사 차단",
    REJECTED: "거절됨",
    EXPIRED: "만료됨",
  };
  const tone =
    status === "RECORDED"
      ? "pass"
      : status === "RECORDING" || status === "AWAITING_APPROVALS"
        ? "info"
        : ["BLOCKED", "REJECTED", "EXPIRED", "CHAIN_FAILED"].includes(status)
          ? "block"
          : "idle";
  return (
    <span className={"pill tone-" + tone}>
      <i />
      {labels[status] ?? status}
    </span>
  );
}

function Verdict({ status, sellerMode = false, reason }: { status: Evaluation["status"]; sellerMode?: boolean; reason?: string }) {
  return status === "valid" ? (
    <span className="pill tone-pass">
      <Icon name="check" size={12} /> 조건 통과
    </span>
  ) : (
    <span className="pill tone-block">
      <Icon name="alert" size={12} /> {sellerMode ? "정책 검사 차단" : (reasonKo[reason ?? ""] ?? "차단")}
    </span>
  );
}

/* ───────────── overview ───────────── */

function Overview({
  role,
  intent,
  evaluations,
  selectedId,
  chooseOffer,
  status,
  buyerSigned,
  sellerSigned,
  setPage,
  openSheet,
}: {
  role: UserRole;
  intent: BuyerIntent;
  evaluations: Evaluation[];
  selectedId: string;
  chooseOffer: (id: string) => void;
  status: string;
  buyerSigned: boolean;
  sellerSigned: boolean;
  setPage: (page: PageKey) => void;
  openSheet: OpenSheet;
}) {
  const valid = evaluations.filter((item) => item.status === "valid").length;
  const conflicts = evaluations.reduce((sum, item) => sum + flagged(item.offer.evidenceIds), 0);
  return (
    <div className="overview">
      <section className="hero">
        <div className="hero-copy">
          <p className="hero-kicker">
            <span className="hero-kicker-dot" /> AI 에이전트 중고 GPU 거래
          </p>
          <h1 className="hero-title">
            흥정은 <em>AI</em>가,
            <br />
            결정은 <em className="alt">당신</em>이.
          </h1>
          <p className="hero-lede">에이전트가 협상하고, 서버가 검사하고, 두 사람이 같은 합의서에 서명해요.</p>
          <div className="hero-cta">
            <button className="btn btn-primary" onClick={() => setPage("negotiation")}>
              협상 보기 <Icon name="arrow" size={16} />
            </button>
            <button className="btn btn-secondary" onClick={() => setPage("agreement")}>
              합의서 보기
            </button>
          </div>
        </div>
        <HeroBento openSheet={openSheet} />
      </section>

      <section className="section">
        <header className="section-head">
          <h2>
            받은 제안 <span className="count">{evaluations.length}</span>
          </h2>
          <span className="section-meta">
            <span className="c-pass">
              <Icon name="pass" size={14} /> 조건 통과 {valid}
            </span>
            {conflicts > 0 && role === "buyer" && (
              <span className="c-block">
                <Icon name="block" size={14} /> 증빙 충돌 {conflicts}
              </span>
            )}
            <button className="link-btn" onClick={() => setPage("negotiation")}>
              협상 자세히 <Icon name="arrow" size={14} />
            </button>
          </span>
        </header>
        <div className="offer-grid">
          {evaluations.map((item) => (
            <OfferCard
              key={item.offer.id}
              evaluation={item}
              active={item.offer.id === selectedId}
              onSelect={() => chooseOffer(item.offer.id)}
              openSheet={openSheet}
              sellerMode={role === "seller"}
            />
          ))}
          {role === "seller" && (
            <div className="offer-hidden">
              <Icon name="lock" size={18} />
              <p>
                <b>다른 판매자의 제안은 보이지 않아요</b>
                판매자 화면에는 내 매물의 협상만 표시돼요.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="summary">
        <div className="summary-item">
          <span>
            <Icon name="lock" size={14} /> {role === "buyer" ? "내 최고 총예산" : "내 매물"}
          </span>
          <b>{role === "buyer" ? money(intent.maxTotalKrw) : "RTX 4090 Gaming OC"}</b>
        </div>
        <div className="summary-item">
          <span>
            <Icon name="truck" size={14} /> 배송 기한
          </span>
          <b>{date(intent.deliveryDeadline)}까지</b>
        </div>
        <div className="summary-item">
          <span>
            <Icon name="pen" size={14} /> 서명
          </span>
          <b className="summary-sign">
            <span className={"sig-dot buyer" + (buyerSigned ? " on" : "")}>구매자</span>
            <span className={"sig-dot seller" + (sellerSigned ? " on" : "")}>판매자</span>
            <StatusPill status={status} />
          </b>
        </div>
        <button className="btn btn-secondary small" onClick={() => setPage("conditions")}>
          조건 수정
        </button>
      </section>
    </div>
  );
}

const prefersReducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

export function HeroBento({ openSheet }: { openSheet: OpenSheet }) {
  const main = LISTING_PHOTOS["listing-01"][0];
  const clip = EVIDENCE_VIEWS["evidence-03"].media;
  const serial = EVIDENCE_VIEWS["evidence-04"].media;
  const [time, setTime] = useState(0);
  const [motion] = useState(() => !prefersReducedMotion());
  const readout = clip.type === "video" ? clip.readout?.find((entry) => time >= entry.from) : undefined;
  return (
    <div className="hero-visual">
      <div className="bento">
        <button type="button" className="tile tile-main" onClick={() => openSheet("listing-01", main.id)} aria-label="셀러 01 RTX 4090 Founders Edition 사진 보기">
          <Img src={main.src} alt={main.alt} width={main.w} height={main.h} focus={main.focus} eager />
          <span className="tile-cap">
            <small>셀러 01 · 사진 {LISTING_PHOTOS["listing-01"].length}</small>
            <b>RTX 4090 Founders Edition</b>
          </span>
          <span className="tile-badge tone-warn">
            <Icon name="receipt" size={13} /> 영수증 · 판매자 주장
          </span>
        </button>
        {clip.type === "video" && (
          <button type="button" className="tile tile-video" onClick={() => openSheet("listing-02", "evidence-03")} aria-label="셀러 02 작동 영상 보기">
            <video
              poster={clip.poster}
              muted
              loop
              playsInline
              autoPlay={motion}
              preload="metadata"
              onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
              aria-hidden="true"
            >
              <source src={clip.src} type="video/mp4" />
              <source src={clip.webm} type="video/webm" />
            </video>
            <span className="tile-badge on-dark">
              <i className="rec" /> 작동 영상 · {clock(clip.duration)}
            </span>
            <span className={"tile-read" + (readout ? " is-on" : "")} aria-hidden="true">
              <small>GPU</small>
              <b>{readout ? readout.value : "--°C"}</b>
            </span>
          </button>
        )}
        {serial.type === "serial" && (
          <button type="button" className="tile tile-serial" onClick={() => openSheet("listing-02", "evidence-05")} aria-label="셀러 02 보증 조회 결과 보기">
            <span className="tile-serial-img">
              <Img src={serial.photo.src} alt="" width={serial.photo.w} height={serial.photo.h} focus="0% 42%" />
            </span>
            <span className="tile-badge tone-block">
              <Icon name="block" size={13} /> 보증 조회 · 모델 불일치
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

function OfferCard({
  evaluation,
  active,
  onSelect,
  openSheet,
  sellerMode,
}: {
  evaluation: Evaluation;
  active: boolean;
  onSelect: () => void;
  openSheet: OpenSheet;
  sellerMode: boolean;
}) {
  const owner = DEMO_LISTINGS.find((entry) => entry.id === evaluation.offer.listingId);
  const cover = coverOf(owner?.id);
  const photos = owner ? LISTING_PHOTOS[owner.id]?.length ?? 0 : 0;
  const evidence = evidenceOf(evaluation.offer.evidenceIds);
  return (
    <article className={"offer-card" + (active ? " is-active" : "")}>
      <button
        type="button"
        className="offer-select"
        onClick={onSelect}
        aria-pressed={active}
        aria-label={`${owner?.sellerName} ${owner?.model} ${money(evaluation.offer.totalKrw)} 제안 선택`}
      />
      <span className="offer-shot">
        {cover && <Img src={cover.src} alt={cover.alt} width={cover.w} height={cover.h} focus={cover.focus} />}
        <span className={"offer-radio" + (active ? " on" : "")} aria-hidden="true" />
        {owner && cover && (
          <button type="button" className="offer-photos" onClick={() => openSheet(owner.id, cover.id)} aria-label={`사진 ${photos}장 보기`}>
            <Icon name="camera" size={13} /> {photos}
          </button>
        )}
      </span>
      <span className="offer-body">
        <span className="offer-seller">
          {owner?.sellerName} · {evaluation.offer.round}라운드 {evaluation.offer.proposer === "buyer_agent" ? "구매 제안" : "반대 제안"}
        </span>
        <b className="offer-model">{owner?.model}</b>
        <span className="offer-foot">
          <strong>{money(evaluation.offer.totalKrw)}</strong>
          <Verdict status={evaluation.status} sellerMode={sellerMode} reason={evaluation.reasonCode} />
        </span>
        <span className="ev-chips">
          {evidence.map((item) => (
            <EvidenceChip key={item.id} evidence={item} onOpen={() => owner && openSheet(owner.id, item.id)} />
          ))}
        </span>
        <span className="offer-meta">
          <Icon name="truck" size={14} /> {date(evaluation.offer.deliveryBy)} 도착 · 배송비 {money(evaluation.offer.shippingFeeKrw)}
        </span>
      </span>
    </article>
  );
}

/* ───────────── conditions ───────────── */

function Conditions({
  role,
  intent,
  model,
  setModel,
  budget,
  setBudget,
  deadline,
  setDeadline,
  mustHave,
  setMustHave,
  saveIntent,
  sellerMinimum,
  setSellerMinimum,
  sellerPrice,
  setSellerPrice,
  saveSeller,
  evaluations,
  openSheet,
}: {
  role: UserRole;
  intent: BuyerIntent;
  model: string;
  setModel: (value: string) => void;
  budget: string;
  setBudget: (value: string) => void;
  deadline: string;
  setDeadline: (value: string) => void;
  mustHave: string;
  setMustHave: (value: string) => void;
  saveIntent: (event: FormEvent<HTMLFormElement>) => void;
  sellerMinimum: string;
  setSellerMinimum: (value: string) => void;
  sellerPrice: string;
  setSellerPrice: (value: string) => void;
  saveSeller: (event: FormEvent<HTMLFormElement>) => void;
  evaluations: Evaluation[];
  openSheet: OpenSheet;
}) {
  const dirty =
    model.trim() !== intent.gpuModel ||
    Number(budget) !== intent.maxTotalKrw ||
    deadline !== intent.deliveryDeadline ||
    mustHave
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .join("|") !== intent.mustHave.join("|");
  return (
    <div className="stack">
      <div className="split">
        {role === "buyer" ? (
          <form className="card form" onSubmit={saveIntent}>
            <header className="card-head">
              <div>
                <h2>구매 조건</h2>
                <p>바꾸면 이전 승인은 초기화되고 모든 제안을 다시 검사해요.</p>
              </div>
              <span className={"pill small " + (dirty ? "tone-info" : "tone-idle")}>
                <i />
                {dirty ? "저장 안 됨" : "저장됨"}
              </span>
            </header>
            <label className="field">
              <span>GPU 모델</span>
              <input id="intent-model" value={model} onChange={(e) => setModel(e.currentTarget.value)} />
            </label>
            <label className="field private">
              <span>
                최고 총예산{" "}
                <em>
                  <Icon name="lock" size={11} /> 나만 보기
                </em>
              </span>
              <span className="money-input">
                <span>₩</span>
                <input id="intent-budget" type="number" min="0" step="10000" value={budget} onChange={(e) => setBudget(e.currentTarget.value)} />
              </span>
              <small>배송비 포함 · 판매자 에이전트와 판매자 화면에는 전달하지 않아요</small>
            </label>
            <div className="field-row">
              <label className="field">
                <span>배송 기한</span>
                <input id="intent-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.currentTarget.value)} />
              </label>
              <label className="field">
                <span>필수 조건 (쉼표로 구분)</span>
                <input id="intent-must" value={mustHave} onChange={(e) => setMustHave(e.currentTarget.value)} />
              </label>
            </div>
            <div className="form-foot">
              <button className="btn btn-primary">
                조건 저장 <Icon name="arrow" size={14} />
              </button>
            </div>
          </form>
        ) : (
          <form className="card form" onSubmit={saveSeller}>
            <header className="card-head">
              <div>
                <h2>셀러 02 · RTX 4090 Gaming OC</h2>
                <p>이 브라우저 데모에만 임시 저장돼요.</p>
              </div>
            </header>
            <div className="field-row">
              <label className="field">
                <span>희망 판매가</span>
                <span className="money-input">
                  <span>₩</span>
                  <input id="seller-price" type="number" value={sellerPrice} onChange={(e) => setSellerPrice(e.currentTarget.value)} />
                </span>
              </label>
              <label className="field">
                <span>배송비</span>
                <span className="money-input">
                  <span>₩</span>
                  <input id="seller-ship" type="number" defaultValue="30000" />
                </span>
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>보증 만료일</span>
                <input id="seller-warranty" type="date" defaultValue="2027-09-02" />
              </label>
              <label className="field">
                <span>상태 설명</span>
                <input id="seller-condition" defaultValue="사용 11개월 · 박스 및 구성품 포함 (판매자 주장)" />
              </label>
            </div>
            <label className="field private seller">
              <span>
                나의 최저가{" "}
                <em>
                  <Icon name="lock" size={11} /> 나만 보기
                </em>
              </span>
              <span className="money-input">
                <span>₩</span>
                <input id="seller-min" type="number" value={sellerMinimum} onChange={(e) => setSellerMinimum(e.currentTarget.value)} />
              </span>
              <small>구매자 화면과 공개 제안에는 포함하지 않아요. 서버로 보내지도 않아요.</small>
            </label>
            <div className="form-foot">
              <button className="btn btn-primary">
                매물 초안 저장 <Icon name="arrow" size={14} />
              </button>
            </div>
          </form>
        )}
        <div className="stack">
          {role === "buyer" ? (
            <Card title="필수 조건" sub="제안마다 이 항목의 증빙을 확인해요">
              <ul className="check-list">
                {intent.mustHave.map((item) => (
                  <li key={item}>
                    <span className="check-icon">
                      <Icon name="check" size={12} />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <Card title="첨부한 증빙" sub="구매자 에이전트가 확인하는 자료예요">
              <EvidenceList items={evidenceOf(DEMO_LISTINGS[1].evidenceIds)} onOpen={(id) => openSheet("listing-02", id)} />
            </Card>
          )}
          <div className="callout">
            <Icon name="shield" size={18} />
            <p>
              <b>최종 판정은 서버가 해요</b>
              화면의 예산 확인은 입력을 돕기 위한 것이고, 승인 가능 여부는 서버가 다시 검사해요.
            </p>
          </div>
        </div>
      </div>

      <div className="section-title">
        <h2>공개 매물</h2>
      </div>
      <div className="listing-grid">
        {DEMO_LISTINGS.map((item) => {
          const evaluation = evaluations.find((entry) => entry.offer.listingId === item.id);
          const hidden = role === "seller" && item.id !== "listing-02";
          const photos = LISTING_PHOTOS[item.id] ?? [];
          const cover = photos[0];
          return (
            <article className="listing" key={item.id}>
              <div className="listing-art">
                {cover && (
                  <button type="button" className="listing-cover" onClick={() => openSheet(item.id, cover.id)} aria-label={`${item.model} 사진 ${photos.length}장 보기`}>
                    <Img src={cover.src} alt={cover.alt} width={cover.w} height={cover.h} focus={cover.focus} />
                  </button>
                )}
                <span className="listing-strip" aria-hidden="true">
                  {photos.slice(1, 4).map((photo) => (
                    <img key={photo.id} src={photo.src} alt="" loading="lazy" decoding="async" />
                  ))}
                  {photos.length > 4 && <em>+{photos.length - 4}</em>}
                </span>
                {!hidden && evaluation && (
                  <span className="listing-verdict">
                    <Verdict status={evaluation.status} reason={evaluation.reasonCode} />
                  </span>
                )}
              </div>
              <div className="listing-body">
                <p className="listing-seller">
                  {item.sellerName} · {item.stockStatus}
                </p>
                <h3>{item.model}</h3>
                <p className="listing-cond">{item.condition}</p>
                <div className="listing-price">
                  <span>상품가 + 배송비</span>
                  <b>{money(item.askingPriceKrw + item.shippingFeeKrw)}</b>
                </div>
                <dl className="listing-meta">
                  <div>
                    <dt>도착</dt>
                    <dd>{date(item.deliveryBy)}</dd>
                  </div>
                  <div>
                    <dt>보증 (판매자 입력)</dt>
                    <dd>{date(item.warrantyEnd)}</dd>
                  </div>
                </dl>
                <EvidenceList items={evidenceOf(item.evidenceIds)} onOpen={(id) => openSheet(item.id, id)} dense />
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function EvidenceList({ items, onOpen, dense = false }: { items: Evidence[]; onOpen: (id: string) => void; dense?: boolean }) {
  return (
    <ul className={"ev-rows" + (dense ? " dense" : "")}>
      {items.map((item) => {
        const view = EVIDENCE_VIEWS[item.id];
        return (
          <li key={item.id}>
            <button type="button" className="ev-row" onClick={() => onOpen(item.id)}>
              <span className="ev-row-icon">
                <Icon name={EVIDENCE_ICON[item.kind]} size={16} />
              </span>
              <span className="ev-row-text">
                <b>
                  {item.label}
                  {view?.media.type === "video" && <em>{clock(view.media.duration)}</em>}
                </b>
                {!dense && <small>{item.source}</small>}
              </span>
              <EvidenceStatus status={item.status} />
              <Icon name="next" size={15} className="ev-row-go" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ───────────── negotiation ───────────── */

function Negotiation({
  role,
  intent,
  evaluations,
  selectedId,
  setSelectedId,
  setPage,
  scenario,
  openSheet,
}: {
  role: UserRole;
  intent: BuyerIntent;
  evaluations: Evaluation[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  setPage: (page: PageKey) => void;
  scenario: (kind: "A" | "B" | "C") => void;
  openSheet: OpenSheet;
}) {
  const selected = evaluations.find((item) => item.offer.id === selectedId) ?? evaluations[0];
  const listing = DEMO_LISTINGS.find((item) => item.id === selected?.offer.listingId);
  const evidence = evidenceOf(selected?.offer.evidenceIds);
  const conflicts = flagged(selected?.offer.evidenceIds);
  const sellerMode = role === "seller";
  const checks = selected ? inspectOffer(selected.offer, intent) : [];
  const reasonText =
    sellerMode && selected?.reasonCode === "BUDGET_EXCEEDED"
      ? "요청된 조건을 만족하지 않아 서버 검증에서 차단됐어요."
      : selected?.reason;
  const active =
    intent.maxTotalKrw === DEMO_BUYER_INTENT.maxTotalKrw && intent.deliveryDeadline === DEMO_BUYER_INTENT.deliveryDeadline
      ? "A"
      : intent.maxTotalKrw === 1_950_000 && intent.deliveryDeadline === DEMO_BUYER_INTENT.deliveryDeadline
        ? "B"
        : intent.deliveryDeadline === "2026-10-02" && intent.maxTotalKrw === DEMO_BUYER_INTENT.maxTotalKrw
          ? "C"
          : "";
  const rows: RulerRow[] = evaluations.map((item) => {
    const owner = DEMO_LISTINGS.find((entry) => entry.id === item.offer.listingId)!;
    return {
      id: item.offer.id,
      code: owner.sellerName,
      title: owner.model.replace("RTX 4090 ", ""),
      ask: owner.askingPriceKrw + owner.shippingFeeKrw,
      offer: item.offer.totalKrw,
      status: item.status === "valid" ? "pass" : "block",
      reason: sellerMode ? "정책 검사" : reasonKo[item.reasonCode ?? ""],
    };
  });
  const ask = listing ? listing.askingPriceKrw + listing.shippingFeeKrw : 0;
  const fromBuyer = selected?.offer.proposer === "buyer_agent";
  return (
    <div className="stack">
      <div className="scenario">
        <div>
          <b>조건을 바꿔서 결과를 확인해보세요</b>
          <span>mock 검사 · Kiln 호출 없음</span>
        </div>
        <div className="segmented" role="group" aria-label="데모 시나리오">
          {[
            { key: "A" as const, label: "기본" },
            { key: "B" as const, label: "예산 ₩195만" },
            { key: "C" as const, label: "기한 10월 2일" },
          ].map((item) => (
            <button key={item.key} className={active === item.key ? "is-on" : ""} onClick={() => scenario(item.key)} disabled={sellerMode} aria-pressed={active === item.key}>
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="split wide">
        <Card title="호가에서 제안까지" sub={sellerMode ? "판매자 화면에는 내 매물만 보여요" : "파란 선은 나만 보는 예산 한도예요"}>
          <PriceRuler rows={rows} budget={sellerMode ? null : intent.maxTotalKrw} selectedId={selectedId} onSelect={setSelectedId} />
        </Card>
        {selected && listing && (
          <Card title="협상 대화" sub={`${listing.sellerName} · ${listing.model}`} className="thread-card">
            <ol className="thread">
              <li className="msg seller">
                <span className="msg-who">판매자 · 매물 등록</span>
                <p>
                  <b>{money(ask)}</b>에 올렸어요. (배송비 포함)
                </p>
              </li>
              <li className={"msg " + (fromBuyer ? "buyer" : "seller")}>
                <span className="msg-who">
                  {fromBuyer ? "구매자 에이전트" : "판매자 에이전트"} · {selected.offer.round}라운드
                </span>
                <p>
                  <b>{money(selected.offer.totalKrw)}</b> 제안해요.
                </p>
                <p className="msg-sub">{selected.offer.explanation}</p>
              </li>
              <li className={"msg system " + (selected.status === "valid" ? "pass" : "block")}>
                <Icon name={selected.status === "valid" ? "shield" : "alert"} size={14} />
                {selected.status === "valid"
                  ? "서버 검사 · 규칙 4개 모두 통과"
                  : `서버 차단 · ${sellerMode ? "정책 검사" : reasonKo[selected.reasonCode ?? ""]}`}
              </li>
            </ol>
            <p className="note">에이전트 문구는 예시예요 (Kiln 미연결). 서명 대상이 아니에요.</p>
          </Card>
        )}
      </div>

      {selected && (
        <div className="split">
          <Card
            title="서버 검사 결과"
            sub="같은 입력이면 언제나 같은 결과가 나와요"
            action={<Verdict status={selected.status} sellerMode={sellerMode} reason={selected.reasonCode} />}
          >
            <ul className="rules">
              {checks.map((check) => (
                <li key={check.rule} className={check.passed ? "pass" : "block"}>
                  <span className="rule-icon">
                    <Icon name={check.passed ? "check" : "alert"} size={12} />
                  </span>
                  <span className="rule-name">{check.label}</span>
                  <span className="rule-values">
                    <span>기준 {check.privateExpected && sellerMode ? "비공개" : check.expected}</span>
                    <span>실제 {check.actual}</span>
                  </span>
                </li>
              ))}
            </ul>
            {selected.status === "blocked" && (
              <div className="callout danger">
                <Icon name="alert" size={18} />
                <p>
                  <b>이 제안은 합의서로 넘어갈 수 없어요</b>
                  {reasonText}
                </p>
              </div>
            )}
          </Card>
          <Card title="증빙 상태" sub="눌러서 영상 · 사진 · 조회 결과를 직접 확인하세요">
            <EvidenceList items={evidence} onOpen={(id) => listing && openSheet(listing.id, id)} />
            {conflicts > 0 && !sellerMode && (
              <div className="callout danger">
                <Icon name="block" size={18} />
                <p>
                  <b>서버 규칙은 통과했지만 증빙이 서로 달라요</b>
                  규칙 통과는 금액·기한 검사예요. 진품이나 시리얼 일치를 보장하지 않으니, 서명 전에 판매자에게 다시 확인하세요.
                </p>
              </div>
            )}
            <div className="card-foot">
              <span>
                <Icon name="clock" size={13} /> {date(selected.offer.expiresAt.slice(0, 10))}에 만료
              </span>
              <button className="btn btn-primary" onClick={() => setPage("agreement")} disabled={selected.status !== "valid"}>
                {selected.status === "valid" ? "합의서로 가기" : "차단된 제안"} <Icon name="arrow" size={14} />
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

/* ───────────── agreement ───────────── */

function Agreement({
  role,
  listing,
  snapshot,
  evaluation,
  status,
  expired,
  matches,
  address,
  addressMatches,
  connected,
  checked,
  signed,
  buyerSigned,
  sellerSigned,
  canSign,
  bothSigned,
  rejected,
  connect,
  setChecked,
  sign,
  reject,
  setPage,
  openSheet,
}: {
  role: UserRole;
  listing: Listing | undefined;
  snapshot: AgreementSnapshot | null;
  evaluation: Evaluation | undefined;
  status: string;
  expired: boolean;
  matches: boolean;
  address: string;
  addressMatches: boolean;
  connected: boolean;
  checked: boolean;
  signed: boolean;
  buyerSigned: boolean;
  sellerSigned: boolean;
  canSign: boolean;
  bothSigned: boolean;
  rejected: boolean;
  connect: () => void;
  setChecked: (value: boolean) => void;
  sign: () => void;
  reject: () => void;
  setPage: (page: PageKey) => void;
  openSheet: OpenSheet;
}) {
  const valid = evaluation?.status === "valid";
  const cover = coverOf(listing?.id);
  const attached = evidenceOf(evaluation?.offer.evidenceIds);
  const detail =
    status === "RECORDING"
      ? "양쪽 데모 서명을 받았어요. 실제 체인 영수증이 없어서 '기록 완료'로 표시하지 않아요."
      : status === "AWAITING_APPROVALS"
        ? "한쪽만 서명했어요. 상대방의 서명과 체인 기록 확인이 더 필요해요."
        : status === "BLOCKED"
          ? "이 제안은 서버 검사에서 막혔어요. 통과한 제안을 고르거나 조건을 바꿔주세요."
          : status === "EXPIRED"
            ? "제안 만료 시각이 지나 서명할 수 없어요."
            : status === "REJECTED"
              ? "한쪽이 거절해서 서명을 초기화했어요."
              : "서명하기 전에 합의서 내용과 지갑 주소를 확인해주세요.";
  const steps = [
    { title: "지갑 연결", detail: connected ? "주소 확인됨" : "데모 지갑 주소 확인", done: connected, active: !connected },
    { title: "합의서 확인", detail: "금액 · 배송 · 해시", done: checked, active: connected && !checked },
    { title: "서명", detail: signed ? "데모 서명 완료" : "직접 눌러서 서명", done: signed, active: checked && !signed },
  ];
  const tone = ["BLOCKED", "REJECTED", "EXPIRED"].includes(status) ? "block" : bothSigned ? "done" : "open";
  return (
    <div className="stack">
      <section className={"sign-hero tone-" + tone}>
        <div className={"party buyer" + (buyerSigned ? " on" : "")}>
          <span className="party-avatar">구</span>
          <span>
            <b>구매자</b>
            <small>{buyerSigned ? "서명 완료" : "서명 대기"}</small>
          </span>
        </div>
        <div className="sign-bridge" aria-hidden="true">
          <span className={"bridge-line buyer" + (buyerSigned ? " on" : "")} />
          <span className="bridge-doc">
            <Icon name={tone === "block" ? "alert" : tone === "done" ? "check" : "agreement"} size={18} />
          </span>
          <span className={"bridge-line seller" + (sellerSigned ? " on" : "")} />
        </div>
        <div className={"party seller" + (sellerSigned ? " on" : "")}>
          <span className="party-avatar">판</span>
          <span>
            <b>판매자</b>
            <small>{sellerSigned ? "서명 완료" : "서명 대기"}</small>
          </span>
        </div>
        <div className="sign-status">
          <StatusPill status={status} />
          <p>{detail}</p>
        </div>
      </section>

      {!snapshot ? (
        <section className="card empty">
          <p>합의서를 만들 수 없어요.</p>
          <button className="btn btn-secondary" onClick={() => setPage("negotiation")}>
            제안 고르러 가기
          </button>
        </section>
      ) : (
        <div className="split">
          <section className="card doc">
            {cover && listing && (
              <button type="button" className="doc-shot" onClick={() => openSheet(listing.id, cover.id)} aria-label="매물 사진 크게 보기">
                <Img src={cover.src} alt={cover.alt} width={cover.w} height={cover.h} focus={cover.focus} />
                <span className="doc-shot-tag">
                  <Icon name="camera" size={13} /> 사진 {LISTING_PHOTOS[listing.id]?.length ?? 0} · 증빙 {attached.length}
                </span>
              </button>
            )}
            <header className="doc-head">
              <div>
                <p className="eyebrow">합의서 · {snapshot.agreementId}</p>
                <h2>{snapshot.model}</h2>
                <p>
                  {listing?.sellerName} · {snapshot.listingId} · demo
                </p>
              </div>
              <HashDie hash={snapshot.snapshotHash} size={72} />
            </header>
            <div className="doc-total">
              <span>총 합의 금액</span>
              <strong>{money(snapshot.totalKrw)}</strong>
              <small>
                상품 {money(snapshot.itemPriceKrw)} + 배송 {money(snapshot.shippingFeeKrw)}
              </small>
            </div>
            <dl className="kv">
              <div>
                <dt>도착 예정</dt>
                <dd>{date(snapshot.deliveryBy)}까지</dd>
              </div>
              <div>
                <dt>보증</dt>
                <dd>{snapshot.warrantyTerms}</dd>
              </div>
              <div>
                <dt>상태</dt>
                <dd>{snapshot.condition}</dd>
              </div>
              <div>
                <dt>제안 만료</dt>
                <dd>{date(snapshot.expiresAt.slice(0, 10))}</dd>
              </div>
              <div>
                <dt>첨부 증빙</dt>
                <dd className="doc-ev">
                  {attached.map((item, index) => (
                    <button type="button" key={item.id} className={"doc-ev-row tone-" + (item.status === "checked" ? "pass" : item.status === "conflicted" ? "block" : item.status === "seller_claimed" ? "warn" : "idle")} onClick={() => listing && openSheet(listing.id, item.id)}>
                      <Icon name={EVIDENCE_ICON[item.kind]} size={14} />
                      <span>{item.label}</span>
                      <code>{snapshot.evidenceHashes[index]}</code>
                    </button>
                  ))}
                </dd>
              </div>
              <div>
                <dt>구매자 지갑</dt>
                <dd className="mono">{snapshot.buyerWallet}</dd>
              </div>
              <div>
                <dt>판매자 지갑</dt>
                <dd className="mono">{snapshot.sellerWallet}</dd>
              </div>
            </dl>
            <div className="hash-box">
              <span>
                스냅샷 해시 <em>SHA-256 · mock</em>
              </span>
              <code>{snapshot.snapshotHash}</code>
              <small>내용이 한 글자라도 바뀌면 해시와 오른쪽 위 지문이 완전히 달라져요.</small>
            </div>
            <div className={"integrity " + (matches ? "good" : "bad")}>
              <Icon name={matches ? "check" : "alert"} size={14} />
              {matches ? "서명 자료와 화면의 금액·배송·보증·증빙이 일치해요" : "서명 자료가 화면과 달라 서명을 멈췄어요"}
            </div>
          </section>

          <div className="stack">
            <section className={"card approve role-" + role}>
              <header className="card-head">
                <div>
                  <h2>{role === "buyer" ? "구매자로 서명하기" : "판매자로 서명하기"}</h2>
                  <p>내 역할의 지갑으로만 서명할 수 있어요.</p>
                </div>
              </header>
              <ol className="steps">
                {steps.map((step, index) => (
                  <li key={step.title} className={(step.done ? "is-done" : "") + (step.active ? " is-active" : "")}>
                    <span className="step-n">{step.done ? <Icon name="check" size={12} /> : index + 1}</span>
                    <span>
                      <b>{step.title}</b>
                      <small>{step.detail}</small>
                    </span>
                  </li>
                ))}
              </ol>
              <div className={"wallet" + (connected ? " on" : "")}>
                <span className="wallet-dot" />
                <span className="wallet-info">
                  <b>{connected ? "데모 지갑 연결됨" : "지갑 미연결"}</b>
                  <small className="mono">{connected ? address : "로컬 시뮬레이션 · Chain ID 31337"}</small>
                </span>
                <button className="btn btn-secondary small" onClick={connect} disabled={!valid || expired || rejected}>
                  {connected ? "다시 확인" : "연결"}
                </button>
              </div>
              <label className={"confirm" + (!connected || !matches ? " is-muted" : "")}>
                <input
                  type="checkbox"
                  id="confirm-snapshot"
                  checked={checked}
                  disabled={!connected || !matches || !valid || expired || rejected}
                  onChange={(e) => setChecked(e.currentTarget.checked)}
                />
                <span className="confirm-box" aria-hidden="true">
                  <Icon name="check" size={12} />
                </span>
                합의서 내용, 지갑 주소, 스냅샷 해시를 확인했어요.
              </label>
              <button className="btn btn-primary full sign-btn" onClick={sign} disabled={!canSign}>
                {signed ? "서명을 남겼어요" : "이 합의서에 서명"} <Icon name="check" size={15} />
              </button>
              <button className="btn btn-ghost full" onClick={reject} disabled={!valid || expired || rejected || bothSigned}>
                합의 거절
              </button>
              {connected && !addressMatches && <p className="error-text">합의서의 주소와 연결한 주소가 달라요.</p>}
            </section>
            <section className="card chain">
              <header className="card-head">
                <div>
                  <h2>체인 기록</h2>
                  <p>{status === "RECORDING" ? "영수증 확인 대기" : "양측 서명 후 시작돼요"}</p>
                </div>
                <span className="pill small tone-idle">
                  <i /> mock
                </span>
              </header>
              <p className="note">TX 해시 없음 · 실제 서버 응답과 체인 영수증 검증 전에는 기록 완료로 표시하지 않아요.</p>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────── audit ───────────── */

function Audit({ events }: { events: AuditEvent[] }) {
  const count = (fn: (event: AuditEvent) => boolean) => events.filter(fn).length;
  const label: Record<AuditEvent["decision"], string> = { info: "기록", allowed: "통과", blocked: "차단", pending: "대기", rejected: "거절" };
  return (
    <div className="stack">
      <section className="stats">
        <div className="stat">
          <span>전체 이벤트</span>
          <b>{events.length}</b>
        </div>
        <div className="stat">
          <span>통과 판정</span>
          <b className="c-pass">{count((e) => e.decision === "allowed")}</b>
        </div>
        <div className="stat">
          <span>차단 · 거절</span>
          <b className="c-block">{count((e) => e.decision === "blocked" || e.decision === "rejected")}</b>
        </div>
        <div className="stat">
          <span>출처</span>
          <b className="muted">demo/mock</b>
        </div>
      </section>
      <Card title="이벤트 타임라인" sub="최신순 · FLOW-049">
        <ol className="timeline">
          {events.map((event) => (
            <li key={event.id} className={"tl " + event.decision}>
              <span className="tl-dot" />
              <div className="tl-body">
                <div className="tl-top">
                  <b>{event.actor}</b>
                  <code>{event.eventType}</code>
                </div>
                <p>{event.detail}</p>
              </div>
              <div className="tl-side">
                <span
                  className={
                    "pill small tone-" +
                    (event.decision === "allowed" ? "pass" : event.decision === "pending" ? "info" : event.decision === "info" ? "idle" : "block")
                  }
                >
                  <i />
                  {label[event.decision]}
                </span>
                <time>{event.at.slice(5)}</time>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

export default App;
