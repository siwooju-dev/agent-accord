import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Icon } from "./components/Icon";
import {
  DEMO_BUYER_INTENT,
  DEMO_EVIDENCE,
  DEMO_LISTINGS,
  DEMO_NOTICE,
  DEMO_OFFERS,
  INITIAL_AUDIT_EVENTS,
} from "./data/demo";
import {
  approvalPayloadMatches,
  createAgreementSnapshot,
  mockWalletAddress,
  validateOffers,
} from "./lib/mockApi";
import type { AuditEvent, BuyerIntent, PageKey, UserRole } from "./types";
import "./App.css";

const nav: {
  id: PageKey;
  label: string;
  icon: "overview" | "conditions" | "negotiation" | "agreement" | "audit";
}[] = [
  { id: "overview", label: "협상 개요", icon: "overview" },
  { id: "conditions", label: "조건 · 매물", icon: "conditions" },
  { id: "negotiation", label: "협상 라운드", icon: "negotiation" },
  { id: "agreement", label: "합의 · 승인", icon: "agreement" },
  { id: "audit", label: "감사 로그", icon: "audit" },
];
const titles: Record<PageKey, string> = {
  overview: "협상 개요",
  conditions: "조건과 매물",
  negotiation: "협상 라운드",
  agreement: "합의안과 승인",
  audit: "감사 로그",
};
const money = (n: number) => "₩" + new Intl.NumberFormat("ko-KR").format(n);
const date = (value: string) =>
  new Date(value + (value.length === 10 ? "T12:00:00" : "")).toLocaleDateString(
    "ko-KR",
    { month: "long", day: "numeric" },
  );

function App() {
  const [page, setPage] = useState<PageKey>("overview");
  const [role, setRole] = useState<UserRole>("buyer");
  const [intent, setIntent] = useState<BuyerIntent>(DEMO_BUYER_INTENT);
  const [modelDraft, setModelDraft] = useState(intent.gpuModel);
  const [budgetDraft, setBudgetDraft] = useState(String(intent.maxTotalKrw));
  const [deadlineDraft, setDeadlineDraft] = useState(intent.deliveryDeadline);
  const [mustHaveDraft, setMustHaveDraft] = useState(
    intent.mustHave.join(", "),
  );
  const [sellerMinimum, setSellerMinimum] = useState("1940000");
  const [sellerPrice, setSellerPrice] = useState("2060000");
  const [selectedId, setSelectedId] = useState("offer-02");
  const [buyerSigned, setBuyerSigned] = useState(false);
  const [sellerSigned, setSellerSigned] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [connected, setConnected] = useState<Record<UserRole, boolean>>({
    buyer: false,
    seller: false,
  });
  const [checked, setChecked] = useState<Record<UserRole, boolean>>({
    buyer: false,
    seller: false,
  });
  const [events, setEvents] = useState<AuditEvent[]>(INITIAL_AUDIT_EVENTS);
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const evaluations = useMemo(
    () => validateOffers(DEMO_OFFERS, intent),
    [intent],
  );
  const visibleEvaluations =
    role === "seller"
      ? evaluations.filter((item) => item.offer.listingId === "listing-02")
      : evaluations;
  const selected =
    evaluations.find((item) => item.offer.id === selectedId) ?? evaluations[0];
  const offer = selected?.offer;
  const listing = offer
    ? DEMO_LISTINGS.find((item) => item.id === offer.listingId)
    : undefined;
  const snapshot = offer ? createAgreementSnapshot(offer) : null;
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
  const address = snapshot
    ? mockWalletAddress(
        role,
        role === "seller" ? "seller-02" : listing?.sellerId,
      )
    : "";
  const expected = snapshot
    ? role === "buyer"
      ? snapshot.buyerWallet
      : snapshot.sellerWallet
    : "";
  const addressMatches = address.toLowerCase() === expected.toLowerCase();
  const signed = role === "buyer" ? buyerSigned : sellerSigned;
  const canSign = Boolean(
    selected?.status === "valid" &&
    !expired &&
    !rejected &&
    !signed &&
    connected[role] &&
    checked[role] &&
    matches &&
    addressMatches,
  );
  const title = titles[page];

  function log(
    actor: string,
    eventType: string,
    decision: AuditEvent["decision"],
    detail: string,
  ) {
    const at = new Date()
      .toLocaleString("sv-SE", { timeZone: "Asia/Seoul", hour12: false })
      .replace("T", " ");
    setEvents((current) => [
      {
        id: "event-" + Date.now(),
        at,
        actor,
        eventType,
        decision,
        detail: detail + " · demo/mock",
        source: "demo/mock",
      },
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
    log(
      "구매자",
      "INTENT_UPDATED",
      "info",
      "조건 변경 · 이전 승인을 초기화했습니다.",
    );
    setToast("조건을 저장했습니다. 이전 승인은 초기화됐습니다.");
  }
  function scenario(which: "A" | "B" | "C") {
    if (role === "seller") {
      setToast("구매 조건 변경은 구매자 데모에서만 사용할 수 있습니다.");
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
      which === "A"
        ? "기본 조건 적용"
        : which === "B"
          ? "예산 변경 후 제안 재검사"
          : "기한 변경 후 제안 재검사",
    );
    setToast("조건을 바꿨습니다. 차단 이유를 확인하세요.");
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
    setSelectedId(id);
    resetApprovals();
    log(role, "OFFER_SELECTED", "info", "합의 스냅샷 변경 · 이전 승인 초기화");
    setToast("다른 제안을 선택해 이전 승인을 초기화했습니다.");
  }
  function connectWallet() {
    if (!matches || !addressMatches) {
      setToast("주소가 합의 스냅샷과 다릅니다.");
      return;
    }
    setConnected((value) => ({ ...value, [role]: true }));
    setChecked((value) => ({ ...value, [role]: false }));
    log(role, "DEMO_WALLET_CONNECTED", "info", "데모 지갑 주소 확인");
    setToast("데모 주소를 연결했습니다. 실제 지갑은 연결하지 않았습니다.");
  }
  function sign() {
    if (!canSign) return;
    if (role === "buyer") setBuyerSigned(true);
    else setSellerSigned(true);
    log(
      role,
      "DEMO_APPROVAL_SUBMITTED",
      "pending",
      "사용자가 합의 스냅샷 확인 후 데모 승인",
    );
    setToast("데모 승인 입력을 기록했습니다. 체인 영수증은 없습니다.");
  }
  function reject() {
    if (!selected || selected.status !== "valid" || bothSigned) return;
    setRejected(true);
    setBuyerSigned(false);
    setSellerSigned(false);
    setChecked({ buyer: false, seller: false });
    log(role, "AGREEMENT_REJECTED", "rejected", "합의 거절");
    setToast("합의안을 거절했습니다.");
  }
  function saveSeller(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    log(
      "판매자 셀러 02",
      "LISTING_DRAFT_SAVED",
      "info",
      "매물 초안 브라우저 임시 저장",
    );
    setToast("매물 초안은 이 브라우저 데모에만 저장했습니다.");
  }

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <button
          className="brand"
          type="button"
          onClick={() => setPage("overview")}
        >
          <span className="brand-mark">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            <b>accord</b>
            <small>PRIVATE NEGOTIATION</small>
          </span>
        </button>
        <div className="workspace-select">
          <span className="workspace-avatar">A</span>
          <span>
            <b>GPU 구매 협상</b>
            <small>개인 데모 워크스페이스</small>
          </span>
          <Icon name="chevron" size={15} />
        </div>
        <p className="nav-caption">워크스페이스</p>
        <nav className="nav-list" aria-label="주요 화면">
          {nav.map((item) => (
            <button
              key={item.id}
              type="button"
              className={"nav-item" + (page === item.id ? " active" : "")}
              onClick={() => setPage(item.id)}
              aria-current={page === item.id ? "page" : undefined}
            >
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
              {item.id === "agreement" &&
                buyerSigned !== sellerSigned &&
                !rejected && <i className="nav-ping" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="connection-card">
          <span>
            <i className="status-dot muted" /> 외부 연결 <b>미연결</b>
          </span>
          <p>
            KILN API <small>미연결</small>
          </p>
          <p>
            테스트넷 <small>미연결</small>
          </p>
          <p>
            지갑 <small>데모 전용</small>
          </p>
        </div>
        <div className="sidebar-user">
          <span className="user-avatar">{role === "buyer" ? "구" : "셀"}</span>
          <span>
            <b>{role === "buyer" ? "구매자 데모" : "판매자 데모"}</b>
            <small>
              {role === "buyer" ? "buyer · demo" : "seller-02 · demo"}
            </small>
          </span>
          <span>···</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            워크스페이스 <span>/</span> <b>{title}</b>
          </div>
          <div className="top-actions">
            <a className="live-mode-link" href="?mode=live">실제 API 연결</a>
            <span className="environment">
              <i className="status-dot amber" /> DEMO / MOCK
            </span>
            <div
              className="role-switch"
              role="group"
              aria-label="데모 사용자 역할"
            >
              <button
                className={role === "buyer" ? "selected" : ""}
                onClick={() => switchRole("buyer")}
                aria-pressed={role === "buyer"}
              >
                구매자
              </button>
              <button
                className={role === "seller" ? "selected" : ""}
                onClick={() => switchRole("seller")}
                aria-pressed={role === "seller"}
              >
                판매자
              </button>
            </div>
          </div>
        </header>
        <main className="workspace">
          <div className="page-heading">
            <div>
              <p className="eyebrow">ACCORD / {page.toUpperCase()}</p>
              <h1>{title}</h1>
              <p className="page-description">
                조건, 제안, 양측 승인 진행 상황을 확인합니다.
              </p>
            </div>
            <span className="flow-id">
              <i /> FLOW-049
            </span>
          </div>

          {page === "overview" && (
            <Overview
              role={role}
              intent={role === "buyer" ? intent : null}
              evaluations={visibleEvaluations}
              status={status}
              setPage={setPage}
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
            />
          )}
          {page === "negotiation" && (
            <Negotiation
              role={role}
              evaluations={visibleEvaluations}
              selectedId={selectedId}
              setSelectedId={chooseOffer}
              setPage={setPage}
              scenario={scenario}
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
              setChecked={(value) =>
                setChecked((old) => ({ ...old, [role]: value }))
              }
              sign={sign}
              reject={reject}
              setPage={setPage}
            />
          )}
          {page === "audit" && <Audit events={events} />}
          <footer className="workspace-footer">
            <span>
              <Icon name="lock" size={13} /> 비공개 가격 한계는 상대 역할에
              표시하지 않습니다.
            </span>
            <span>UI prototype · local demo</span>
          </footer>
        </main>
      </div>
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

function Overview({
  role,
  intent,
  evaluations,
  status,
  setPage,
}: {
  role: UserRole;
  intent: BuyerIntent | null;
  evaluations: ReturnType<typeof validateOffers>;
  status: string;
  setPage: (page: PageKey) => void;
}) {
  const valid = evaluations.filter((item) => item.status === "valid").length;
  return (
    <div className="page-stack">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">NEGOTIATION ROOM / 01</span>
          <h2>
            조건은 명확하게,
            <br />
            <em>승인은 사람의 손으로.</em>
          </h2>
          <p>
            에이전트가 제안을 정리하고 서버가 조건을 검사합니다.
            <br />
            거래 기록은 양측이 같은 합의안에 승인한 뒤에 이어집니다.
          </p>
          <button
            className="button button-light"
            onClick={() => setPage("negotiation")}
          >
            협상 검토하기 <Icon name="arrow" size={15} />
          </button>
        </div>
        <div className="hero-object">
          <div className="hero-orbit" />
          <div className="gpu-hero">
            <span>ACCORD</span>
            <i />
            <i />
            <b>RTX 4090</b>
          </div>
          <div className="hero-seal">
            <Icon name="shield" size={18} />
          </div>
          <div className="hero-caption">
            SAME SNAPSHOT
            <br />
            <b>DUAL APPROVAL</b>
          </div>
        </div>
        <div className="hero-foot">
          <span>
            <i /> {valid}개 제안이 현재 조건 통과
          </span>
          <StatusBadge status={status} />
        </div>
      </section>
      <div className="stat-grid">
        <Stat label="검토한 매물" value="03" sub="GPU · demo/mock" icon="box" />
        <Stat
          label="유효 제안"
          value={String(valid).padStart(2, "0")}
          sub="현재 조건 기준"
          icon="check"
        />
        <Stat
          label="협상 라운드"
          value="02 / 03"
          sub="최대 2회 반대 제안"
          icon="negotiation"
        />
        <Stat
          label="온체인 상태"
          value="대기 중"
          sub="테스트넷 미연결"
          icon="network"
        />
      </div>
      <div className="overview-grid">
        <section className="panel">
          <PanelHeading
            label="NEGOTIATION FLOW"
            title="진행 단계"
            action={
              <button
                className="text-button"
                onClick={() => setPage("agreement")}
              >
                합의 보기 <Icon name="arrow" size={13} />
              </button>
            }
          />
          <div className="flow-list">
            <Flow
              n="01"
              title="조건 등록"
              detail="구매자 의도 확인"
              state="done"
            />
            <Flow
              n="02"
              title="제안 정리"
              detail="후보 3개 · demo/mock"
              state="done"
            />
            <Flow
              n="03"
              title="합의안 검토"
              detail="사용자가 직접 결정"
              state="now"
            />
            <Flow
              n="04"
              title="체인 기록"
              detail="테스트넷 연결 대기"
              state="later"
            />
          </div>
        </section>
        <section className="panel private-card">
          <PanelHeading
            label={
              role === "buyer" ? "YOUR PRIVATE INTENT" : "YOUR SELLER PROFILE"
            }
            title={role === "buyer" ? "내 구매 조건" : "내 판매 조건"}
            action={
              <button
                className="icon-button"
                onClick={() => setPage("conditions")}
                aria-label="조건 수정"
              >
                <Icon name="conditions" size={16} />
              </button>
            }
          />
          {role === "buyer" ? (
            <>
              <span className="private-tag">
                <Icon name="lock" size={12} /> 나에게만 표시
              </span>
              <strong className="private-amount">
                {money(intent?.maxTotalKrw ?? 0)}
              </strong>
              <small>최고 총예산 · 본인 비공개</small>
              <div className="summary-line">
                <span>GPU</span>
                <b>{intent?.gpuModel}</b>
              </div>
              <div className="summary-line">
                <span>배송 기한</span>
                <b>{date(intent?.deliveryDeadline ?? "2026-10-14")}까지</b>
              </div>
            </>
          ) : (
            <>
              <span className="private-tag">
                <Icon name="lock" size={12} /> 나에게만 표시
              </span>
              <strong className="private-amount">셀러 02</strong>
              <small>본인 계정 · 정책 별도 관리</small>
              <div className="summary-line">
                <span>내 매물</span>
                <b>RTX 4090 Gaming OC</b>
              </div>
              <div className="summary-line">
                <span>상태</span>
                <b>판매 가능 · demo</b>
              </div>
            </>
          )}
          <p className="privacy-note">
            <Icon name="shield" size={14} /> 상대방의 비공개 한계는 표시하지
            않습니다.
          </p>
        </section>
      </div>
      <section className="panel">
        <PanelHeading
          label="LATEST OFFERS"
          title="최근 제안"
          action={
            <button
              className="text-button"
              onClick={() => setPage("negotiation")}
            >
              전체 제안 <Icon name="arrow" size={13} />
            </button>
          }
        />
        <OfferRows evaluations={evaluations} setPage={setPage} compact />
      </section>
      <DemoNote />
    </div>
  );
}

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
}) {
  return (
    <div className="page-stack">
      <section className="section-heading">
        <span>{role === "buyer" ? "A" : "A"}</span>
        <div>
          <h2>{role === "buyer" ? "구매 조건" : "내 판매 매물"}</h2>
          <p>
            {role === "buyer"
              ? "최고 총예산은 구매자 본인에게만 표시됩니다."
              : "현재 데모 계정의 정보만 수정할 수 있습니다."}
          </p>
        </div>
      </section>
      {role === "buyer" ? (
        <div className="condition-layout">
          <form className="panel form-panel" onSubmit={saveIntent}>
            <PanelHeading label="BUYER INTENT" title="거래 의도" />
            <label>
              GPU 모델
              <input
                value={model}
                onChange={(e) => setModel(e.currentTarget.value)}
              />
            </label>
            <label>
              최고 총예산 · 비공개
              <div className="prefix-input">
                <span>₩</span>
                <input
                  type="number"
                  min="0"
                  step="10000"
                  value={budget}
                  onChange={(e) => setBudget(e.currentTarget.value)}
                />
              </div>
              <small>배송비를 포함한 한도 · 상대에게 비공개</small>
            </label>
            <label>
              배송 기한
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.currentTarget.value)}
              />
            </label>
            <label>
              필수 조건 · 쉼표로 구분
              <textarea
                rows={3}
                value={mustHave}
                onChange={(e) => setMustHave(e.currentTarget.value)}
              />
            </label>
            <div className="privacy-box">
              <Icon name="lock" size={15} /> 조건을 바꾸면 이전 승인은
              초기화됩니다.
            </div>
            <button className="button button-primary">
              조건 저장 <Icon name="arrow" size={14} />
            </button>
          </form>
          <section className="panel requirements">
            <PanelHeading label="MUST-HAVE" title="필수 조건 체크리스트" />
            {intent.mustHave.map((item, i) => (
              <div className="requirement" key={item}>
                <span>0{i + 1}</span>
                <b>{item}</b>
                <Icon name="check" size={14} />
              </div>
            ))}
            <div className="server-note">
              <Icon name="shield" size={16} />
              <span>
                <b>서버 조건 검사</b>
                <small>
                  브라우저 예산 검사는 입력 편의용입니다. 최종 승인 가능 여부는
                  서버가 결정합니다.
                </small>
              </span>
            </div>
          </section>
        </div>
      ) : (
        <div className="condition-layout">
          <form className="panel form-panel" onSubmit={saveSeller}>
            <PanelHeading
              label="SELLER LISTING"
              title="셀러 02 · RTX 4090 Gaming OC"
            />
            <label>
              상품 희망가
              <div className="prefix-input">
                <span>₩</span>
                <input
                  type="number"
                  value={sellerPrice}
                  onChange={(e) => setSellerPrice(e.currentTarget.value)}
                />
              </div>
            </label>
            <label>
              배송비
              <div className="prefix-input">
                <span>₩</span>
                <input type="number" defaultValue="30000" />
              </div>
            </label>
            <label>
              보증 만료일
              <input type="date" defaultValue="2027-09-02" />
            </label>
            <label>
              상태 설명
              <textarea
                rows={3}
                defaultValue="사용 11개월 · 박스 및 구성품 포함 (판매자 주장)"
              />
            </label>
            <div className="private-price">
              <div>
                <b>
                  <Icon name="lock" size={14} /> 나의 비공개 최저가
                </b>
                <span>본인만 표시</span>
              </div>
              <div className="prefix-input">
                <span>₩</span>
                <input
                  type="number"
                  value={sellerMinimum}
                  onChange={(e) => setSellerMinimum(e.currentTarget.value)}
                />
              </div>
              <small>
                구매자 화면이나 공개 제안 카드에는 포함하지 않습니다. 로컬
                데모에만 저장됩니다.
              </small>
            </div>
            <button className="button button-primary">
              매물 초안 저장 <Icon name="arrow" size={14} />
            </button>
          </form>
          <section className="panel requirements">
            <PanelHeading label="EVIDENCE ATTACHED" title="매물 증빙" />
            {DEMO_EVIDENCE.filter((item) =>
              DEMO_LISTINGS[1].evidenceIds.includes(item.id),
            ).map((item) => (
              <div className="evidence-line" key={item.id}>
                <Icon name="file" size={15} />
                <span>{item.label}</span>
                <EvidenceBadge state={item.status} />
              </div>
            ))}
            <div className="server-note">
              <Icon name="lock" size={16} />
              <span>
                <b>비공개 정책 분리</b>
                <small>
                  이 입력은 현재 서버로 전송하지 않습니다. 다른 판매자의
                  최저가는 표시하지 않습니다.
                </small>
              </span>
            </div>
          </section>
        </div>
      )}
      <section className="section-heading">
        <span>B</span>
        <div>
          <h2>공개 매물</h2>
          <p>상품가·배송비·상태·보증과 증빙 확인 상태를 비교합니다.</p>
        </div>
        <small>3 LISTINGS · DEMO</small>
      </section>
      <div className="listing-grid">
        {DEMO_LISTINGS.map((item, index) => (
          <article className="listing-card" key={item.id}>
            <div className={"listing-visual " + item.accent}>
              <span className="listing-count">0{index + 1}</span>
              <div className="gpu-mini">
                <i />
                <i />
                <b>RTX 4090</b>
              </div>
              <span className="stock-tag">{item.stockStatus}</span>
            </div>
            <h3>{item.model}</h3>
            <p className="listing-owner">{item.sellerName} · demo</p>
            <p className="listing-condition">{item.condition}</p>
            <div className="listing-price">
              <span>상품가 + 배송비</span>
              <b>{money(item.askingPriceKrw + item.shippingFeeKrw)}</b>
            </div>
            <div className="listing-bottom">
              <span>배송 {date(item.deliveryBy)}</span>
              <span>보증 {date(item.warrantyEnd)}</span>
            </div>
            <div className="evidence-chips">
              {DEMO_EVIDENCE.filter((e) => item.evidenceIds.includes(e.id)).map(
                (e) => (
                  <EvidenceBadge key={e.id} state={e.status} />
                ),
              )}
            </div>
          </article>
        ))}
      </div>
      <DemoNote />
    </div>
  );
}

function Negotiation({
  role,
  evaluations,
  selectedId,
  setSelectedId,
  setPage,
  scenario,
}: {
  role: UserRole;
  evaluations: ReturnType<typeof validateOffers>;
  selectedId: string;
  setSelectedId: (id: string) => void;
  setPage: (page: PageKey) => void;
  scenario: (kind: "A" | "B" | "C") => void;
}) {
  const selected =
    evaluations.find((item) => item.offer.id === selectedId) ?? evaluations[0];
  const listing = DEMO_LISTINGS.find(
    (item) => item.id === selected?.offer.listingId,
  );
  const evidence = DEMO_EVIDENCE.filter((item) =>
    selected?.offer.evidenceIds.includes(item.id),
  );
  const reasonText =
    role === "seller" && selected?.reasonCode === "BUDGET_EXCEEDED"
      ? "요청된 조건을 만족하지 않아 서버 검증에서 차단됐습니다."
      : selected?.reason;
  const reasonCode =
    role === "seller" && selected?.reasonCode === "BUDGET_EXCEEDED"
      ? "POLICY CHECK"
      : selected?.reasonCode;
  return (
    <div className="page-stack">
      <section className="scenario-bar">
        <div>
          <span>
            <Icon name="spark" size={13} /> DEMO SCENARIOS
          </span>
          <b>조건 변경 결과 재현</b>
          <small>demo/mock 검사 · Kiln 호출 없음</small>
        </div>
        <div className="scenario-buttons">
          <button onClick={() => scenario("A")}>
            <i>A</i> 기본
          </button>
          <button onClick={() => scenario("B")}>
            <i>B</i> 예산 변경
          </button>
          <button onClick={() => scenario("C")}>
            <i>C</i> 기한 변경
          </button>
        </div>
      </section>
      <div className="neg-meta">
        <span>
          <small>NEGOTIATION ID</small>
          <b>NEG-DEMO-049</b>
        </span>
        <span>
          <small>ROUND LIMIT</small>
          <b>초기 제안 + 최대 2회 반대 제안</b>
        </span>
        <span>
          <small>현재 조건 결과</small>
          <b className="valid-count">
            {evaluations.filter((item) => item.status === "valid").length} 유효{" "}
            <i>·</i>{" "}
            {evaluations.filter((item) => item.status === "blocked").length}{" "}
            차단
          </b>
        </span>
      </div>
      <section className="panel">
        <PanelHeading
          label="SELLER OFFERS"
          title="판매자별 제안"
          action={<span className="mock-label">정책 검사 · demo/mock</span>}
        />
        <OfferRows
          evaluations={evaluations}
          selectedId={selectedId}
          choose={setSelectedId}
          sellerMode={role === "seller"}
        />
      </section>
      {selected && (
        <section className="panel rationale-panel">
          <div className="rationale-heading">
            <div>
              <small>SELECTED OFFER</small>
              <h2>제안 근거와 증빙 출처</h2>
            </div>
            <span className="ai-label">
              <Icon name="spark" size={13} /> DEMO 설명 · Kiln 미연결
            </span>
          </div>
          <div className="rationale-body">
            <div className="rationale-text">
              <Icon name="spark" size={17} />
              <div>
                <small>제안 설명 · demo/mock</small>
                <p>{selected.offer.explanation}</p>
                <span>실제 AI 모델 호출 없음 · 예시 문구</span>
              </div>
            </div>
            <div className="rationale-item">
              <small>매물 설명</small>
              <b>{listing?.condition}</b>
              <span>
                {listing?.model} · {listing?.sellerName}
              </span>
            </div>
            <div className="rationale-evidence">
              <small>참조 증빙</small>
              {evidence.map((item) => (
                <div key={item.id}>
                  <Icon name="file" size={14} />
                  <span>{item.label}</span>
                  <EvidenceBadge state={item.status} />
                </div>
              ))}
            </div>
          </div>
          {selected.status === "blocked" && (
            <div className="blocked-reason">
              <Icon name="alert" size={16} />
              <span>
                <b>서버 차단 이유 · {reasonCode}</b>
                <small>{reasonText}</small>
              </span>
            </div>
          )}
          <div className="rationale-footer">
            <span>
              <Icon name="clock" size={14} /> 제안 만료{" "}
              {date(selected.offer.expiresAt.slice(0, 10))} · 총액/기한 재검증
              필요
            </span>
            <button
              className="button button-primary"
              onClick={() => setPage("agreement")}
              disabled={selected.status !== "valid"}
            >
              합의 스냅샷 열기 <Icon name="arrow" size={14} />
            </button>
          </div>
        </section>
      )}
      <DemoNote />
    </div>
  );
}

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
}: {
  role: UserRole;
  listing: import("./types").Listing | undefined;
  snapshot: import("./types").AgreementSnapshot | null;
  evaluation: ReturnType<typeof validateOffers>[number] | undefined;
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
}) {
  const valid = evaluation?.status === "valid";
  const heading =
    status === "RECORDING"
      ? "체인 기록 대기"
      : status === "AWAITING_APPROVALS"
        ? "다른 당사자 승인 대기"
        : status === "BLOCKED"
          ? "조건 검사 차단"
          : status === "EXPIRED"
            ? "제안 만료"
            : status === "REJECTED"
              ? "합의 거절"
              : "양측 승인 전";
  const detail =
    status === "RECORDING"
      ? "데모 승인 입력을 받았습니다. 실제 체인 영수증이 없어 RECORDED 상태는 아닙니다."
      : status === "AWAITING_APPROVALS"
        ? "한쪽만 승인했습니다. 다른 당사자의 명시적 승인과 실제 체인 기록 확인이 필요합니다."
        : status === "BLOCKED"
          ? "현재 조건 검사에서 차단됐습니다. 유효 제안을 선택하거나 조건을 조정하세요."
          : status === "EXPIRED"
            ? "제안 만료 시각이 지나 승인을 진행할 수 없습니다."
            : status === "REJECTED"
              ? "한쪽이 거절하여 데모 승인 입력을 초기화했습니다."
              : "서명 전에 같은 합의 스냅샷과 지갑 주소를 확인하세요.";
  return (
    <div className="page-stack">
      <section className={"agreement-banner " + status.toLowerCase()}>
        <span className="banner-icon">
          <Icon
            name={
              status === "RECORDING"
                ? "clock"
                : status === "BLOCKED" ||
                    status === "REJECTED" ||
                    status === "EXPIRED"
                  ? "alert"
                  : "agreement"
            }
            size={20}
          />
        </span>
        <div>
          <small>AGREEMENT STATUS</small>
          <h2>{heading}</h2>
          <p>{detail}</p>
        </div>
        <StatusBadge status={status} />
      </section>
      {!snapshot ? (
        <section className="panel empty-agreement">
          <Icon name="agreement" size={25} />
          <p>합의안을 만들 수 없습니다.</p>
          <button
            className="text-button"
            onClick={() => setPage("negotiation")}
          >
            유효 제안 선택 <Icon name="arrow" size={13} />
          </button>
        </section>
      ) : (
        <div className="agreement-grid">
          <section className="panel snapshot-panel">
            <div className="snapshot-head">
              <div>
                <small>IMMUTABLE SNAPSHOT · DEMO</small>
                <h2>합의 내용</h2>
              </div>
              <code>{snapshot.agreementId}</code>
            </div>
            <div className="snapshot-product">
              <div className={"product-cube " + (listing?.accent ?? "blue")}>
                <i />
                <i />
                <b>4090</b>
              </div>
              <div>
                <b>{snapshot.model}</b>
                <span>
                  {listing?.sellerName} · {snapshot.listingId}
                </span>
              </div>
              <span className="demo-chip">DEMO</span>
            </div>
            <div className="price-lines">
              <div>
                <span>상품가</span>
                <b>{money(snapshot.itemPriceKrw)}</b>
              </div>
              <div>
                <span>배송비</span>
                <b>{money(snapshot.shippingFeeKrw)}</b>
              </div>
              <div className="total-line">
                <span>총 합의 금액</span>
                <strong>{money(snapshot.totalKrw)}</strong>
              </div>
            </div>
            <div className="snapshot-details">
              <div>
                <span>배송 예정</span>
                <b>{date(snapshot.deliveryBy)}까지</b>
              </div>
              <div>
                <span>보증 조건</span>
                <b>{snapshot.warrantyTerms}</b>
              </div>
              <div>
                <span>매물 상태</span>
                <b>{snapshot.condition}</b>
              </div>
              <div>
                <span>제안 만료</span>
                <b>{date(snapshot.expiresAt.slice(0, 10))}</b>
              </div>
            </div>
            <div className="hash-row">
              <span>
                <Icon name="shield" size={14} /> 스냅샷 해시
              </span>
              <code>{snapshot.snapshotHash}</code>
              <i>MOCK</i>
            </div>
            <div className="wallet-pair">
              <WalletAddress
                label="구매자 주소"
                address={snapshot.buyerWallet}
                signed={buyerSigned}
              />
              <span className="wallet-link">
                <Icon name="network" size={15} />
              </span>
              <WalletAddress
                label="판매자 주소"
                address={snapshot.sellerWallet}
                signed={sellerSigned}
              />
            </div>
            <div className="snapshot-evidence">
              <div>
                <b>스냅샷 증빙 참조</b>
                <small>원본 파일은 체인에 올리지 않습니다.</small>
              </div>
              <div>
                {snapshot.evidenceHashes.map((hash) => (
                  <code key={hash}>{hash}</code>
                ))}
              </div>
            </div>
            <div className={"integrity " + (matches ? "good" : "bad")}>
              <Icon name={matches ? "check" : "alert"} size={15} />
              <span>
                {matches
                  ? "approval-payload와 화면의 금액·배송·보증·증빙이 일치합니다."
                  : "승인 자료가 화면 내용과 달라 서명을 중단했습니다."}
              </span>
              <b>{matches ? "일치" : "불일치"}</b>
            </div>
          </section>
          <aside className="approval-side">
            <section className="panel approval-panel">
              <div className="approval-head">
                <small>YOUR APPROVAL</small>
                <h2>{role === "buyer" ? "구매자 확인" : "판매자 확인"}</h2>
                <p>선택한 역할 본인의 지갑으로만 승인할 수 있습니다.</p>
              </div>
              <SignStep
                number="1"
                title="지갑 연결"
                detail={connected ? "데모 지갑 연결됨" : "주소 및 체인 확인"}
                active={!connected}
                done={connected}
              />
              <SignStep
                number="2"
                title="내용 재확인"
                detail="같은 합의 스냅샷 확인"
                active={connected && !checked}
                done={checked}
              />
              <SignStep
                number="3"
                title="사용자 승인"
                detail={
                  signed ? "demo/mock 승인 입력" : "직접 버튼을 눌러 승인"
                }
                active={checked && !signed}
                done={signed}
              />
              <div className="wallet-connect">
                <div>
                  <Icon name="wallet" size={16} />
                  <span>
                    <b>{connected ? "데모 지갑 연결됨" : "지갑 연결"}</b>
                    <small>로컬 시뮬레이션 · 실제 지갑 아님</small>
                  </span>
                  <i className={connected ? "on" : ""} />
                </div>
                {connected && <code>{address}</code>}
                <small className="chain-id">
                  CHAIN ID <b>31337</b> · demo placeholder · 미확정
                </small>
                <button
                  className={
                    connected
                      ? "button button-secondary full"
                      : "button button-primary full"
                  }
                  onClick={connect}
                  disabled={!valid || expired || rejected}
                >
                  {connected ? "데모 주소 재확인" : "데모 지갑 연결"}{" "}
                  <Icon name="wallet" size={14} />
                </button>
              </div>
              <label
                className={
                  "snapshot-check" + (!connected || !matches ? " muted" : "")
                }
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={
                    !connected || !matches || !valid || expired || rejected
                  }
                  onChange={(e) => setChecked(e.currentTarget.checked)}
                />
                <span>합의 내용과 서명할 주소를 확인했습니다.</span>
              </label>
              <button
                className="button button-approve full"
                onClick={sign}
                disabled={!canSign}
              >
                {signed ? "데모 승인 제출됨" : "이 내용에 데모 승인 제출"}{" "}
                <Icon name="check" size={15} />
              </button>
              <button
                className="reject-button"
                onClick={reject}
                disabled={!valid || expired || rejected || bothSigned}
              >
                합의 거절
              </button>
              {connected && !addressMatches && (
                <p className="inline-error">
                  합의 스냅샷의 주소와 연결 주소가 다릅니다.
                </p>
              )}
            </section>
            <section className="recording-card">
              <span>
                <Icon name="network" size={16} />{" "}
                {status === "RECORDING" ? "RECORDING" : "CHAIN RECORD"}
              </span>
              <b>
                {status === "RECORDING" ? "영수증 확인 대기" : "체인 연결 대기"}
              </b>
              <p>
                실제 서버 응답과 체인 영수증 검증 전에는 RECORDED를 표시하지
                않습니다.
              </p>
              <div>
                <small>TX HASH</small>
                <code>생성되지 않음 · mock</code>
              </div>
            </section>
          </aside>
        </div>
      )}
      <div className="approval-rule">
        <Icon name="lock" size={14} /> 한쪽 승인만으로 거래가 완료되지 않습니다.
        조건 변경·만료·거절·스냅샷 불일치 시 서명이 차단됩니다.
      </div>
      <DemoNote />
    </div>
  );
}

function Audit({ events }: { events: AuditEvent[] }) {
  return (
    <div className="page-stack">
      <div className="audit-metrics">
        <div>
          <small>기록 이벤트</small>
          <b>{String(events.length).padStart(2, "0")}</b>
        </div>
        <div>
          <small>조건 통과</small>
          <b className="green-text">
            {String(
              events.filter((e) => e.decision === "allowed").length,
            ).padStart(2, "0")}
          </b>
        </div>
        <div>
          <small>차단 · 거절</small>
          <b className="amber-text">
            {String(
              events.filter(
                (e) => e.decision === "blocked" || e.decision === "rejected",
              ).length,
            ).padStart(2, "0")}
          </b>
        </div>
        <div>
          <small>호출 출처</small>
          <b className="source-text">demo/mock</b>
        </div>
      </div>
      <section className="panel audit-panel">
        <PanelHeading
          label="ORDERED EVENT STREAM"
          title="흐름 이벤트"
          action={<span className="mock-label">{events.length} EVENTS</span>}
        />
        <div className="audit-scroll">
          <table>
            <thead>
              <tr>
                <th>시각 (KST)</th>
                <th>행위자</th>
                <th>이벤트</th>
                <th>결과</th>
                <th>상세</th>
                <th>출처</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{event.at}</td>
                  <td>{event.actor}</td>
                  <td>
                    <code>{event.eventType}</code>
                  </td>
                  <td>
                    <Decision decision={event.decision} />
                  </td>
                  <td>{event.detail}</td>
                  <td>
                    <span className="mock-label">demo/mock</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="audit-note">
        <Icon name="shield" size={17} />
        <span>
          <b>로컬 데모 로그입니다.</b>
          <small>
            실제 감사 API, Kiln 호출·토큰 사용량, 온체인 거래는 연결되지
            않았습니다.
          </small>
        </span>
      </div>
    </div>
  );
}

function PanelHeading({
  label,
  title,
  action,
}: {
  label: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="panel-heading">
      <div>
        <small>{label}</small>
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}
function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    PROPOSED: "승인 전",
    AWAITING_APPROVALS: "한쪽 승인",
    RECORDING: "기록 대기",
    RECORDED: "기록 완료",
    CHAIN_FAILED: "체인 실패",
    BLOCKED: "조건 차단",
    REJECTED: "거절",
    EXPIRED: "만료",
  };
  const color =
    status === "RECORDING"
      ? "blue"
      : status === "RECORDED"
        ? "green"
        : ["BLOCKED", "REJECTED", "EXPIRED", "CHAIN_FAILED"].includes(status)
          ? "red"
          : "amber";
  return (
    <span className={"status-badge " + color}>
      <i />
      {labels[status] ?? status}
    </span>
  );
}
function EvidenceBadge({ state }: { state: string }) {
  const label: Record<string, string> = {
    checked: "확인",
    seller_claimed: "판매자 주장",
    conflicted: "모순",
    unknown: "미확인",
  };
  return (
    <span className={"evidence-badge " + state}>
      <i />
      {label[state] ?? state}
    </span>
  );
}
function Stat({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  icon: string;
}) {
  return (
    <div className="stat">
      <span className={"stat-icon " + icon}>
        <Icon
          name={icon as "box" | "check" | "negotiation" | "network"}
          size={16}
        />
      </span>
      <small>{label}</small>
      <b>{value}</b>
      <span>{sub}</span>
    </div>
  );
}
function Flow({
  n,
  title,
  detail,
  state,
}: {
  n: string;
  title: string;
  detail: string;
  state: "done" | "now" | "later";
}) {
  return (
    <div className={"flow-step " + state}>
      <i>{state === "done" ? <Icon name="check" size={12} /> : n}</i>
      <span>
        <b>{title}</b>
        <small>{detail}</small>
      </span>
      <em />
    </div>
  );
}
function SignStep({
  number,
  title,
  detail,
  active,
  done,
}: {
  number: string;
  title: string;
  detail: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <div
      className={
        "sign-step" + (active ? " active" : "") + (done ? " done" : "")
      }
    >
      <i>{done ? <Icon name="check" size={12} /> : number}</i>
      <span>
        <b>{title}</b>
        <small>{detail}</small>
      </span>
    </div>
  );
}
function WalletAddress({
  label,
  address,
  signed,
}: {
  label: string;
  address: string;
  signed: boolean;
}) {
  return (
    <div className={"wallet-address" + (signed ? " signed" : "")}>
      <Icon name="wallet" size={14} />
      <span>
        <small>{label}</small>
        <code>{address}</code>
      </span>
      <b>{signed ? "승인 입력" : "대기"}</b>
    </div>
  );
}
function Decision({ decision }: { decision: AuditEvent["decision"] }) {
  const labels = {
    info: "정보",
    allowed: "통과",
    blocked: "차단",
    pending: "대기",
    rejected: "거절",
  };
  return (
    <span className={"decision " + decision}>
      <i />
      {labels[decision]}
    </span>
  );
}
function OfferRows({
  evaluations,
  selectedId,
  choose,
  setPage,
  compact = false,
  sellerMode = false,
}: {
  evaluations: ReturnType<typeof validateOffers>;
  selectedId?: string;
  choose?: (id: string) => void;
  setPage?: (page: PageKey) => void;
  compact?: boolean;
  sellerMode?: boolean;
}) {
  return (
    <div className="offer-list">
      <div className="offer-list-head">
        <span>판매자 / 매물</span>
        <span>라운드</span>
        <span>총액</span>
        <span>배송</span>
        <span>검증</span>
        <span />
      </div>
      {evaluations.map((item) => {
        const listing = DEMO_LISTINGS.find(
          (candidate) => candidate.id === item.offer.listingId,
        );
        return (
          <div
            className={
              "offer-row" + (selectedId === item.offer.id ? " selected" : "")
            }
            key={item.offer.id}
          >
            <div className="offer-seller">
              <i className={listing?.accent}>{listing?.sellerName.slice(-2)}</i>
              <span>
                <b>{listing?.sellerName}</b>
                <small>{listing?.model}</small>
              </span>
            </div>
            <div>
              <b className="round-chip">R{item.offer.round}</b>
              <small className="subline">
                {item.offer.proposer === "buyer_agent"
                  ? "구매 제안"
                  : "반대 제안"}
              </small>
            </div>
            <div>
              <b>{money(item.offer.totalKrw)}</b>
              <small className="subline">
                상품 {money(item.offer.itemPriceKrw)} + 배송{" "}
                {money(item.offer.shippingFeeKrw)}
              </small>
            </div>
            <div>{date(item.offer.deliveryBy)}</div>
            <div>
              {item.status === "valid" ? (
                <span className="valid-chip">✓ 유효</span>
              ) : (
                <span className="blocked-chip">! 차단</span>
              )}
              <small className="subline">
                {item.status === "valid"
                  ? "조건 통과 · mock"
                  : sellerMode
                    ? "정책 검사 · mock"
                    : item.reasonCode}
              </small>
            </div>
            <div>
              {choose ? (
                <button
                  className="row-button"
                  onClick={() => choose(item.offer.id)}
                >
                  {selectedId === item.offer.id ? "선택됨" : "검토"}
                </button>
              ) : setPage ? (
                <button
                  className="row-button"
                  onClick={() => setPage("negotiation")}
                >
                  열기 <Icon name="arrow" size={12} />
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
      {compact && (
        <div className="table-foot">
          <span>
            <Icon name="lock" size={12} /> 비공개 가격 한계는 제안에 포함되지
            않습니다.
          </span>
          <span>표시 정보 · demo/mock</span>
        </div>
      )}
    </div>
  );
}
function DemoNote() {
  return (
    <div className="demo-note">
      <Icon name="alert" size={13} />
      <span>{DEMO_NOTICE}</span>
      <i /> <span>실제 API · 지갑 · 체인 미연결</span>
    </div>
  );
}

export default App;
