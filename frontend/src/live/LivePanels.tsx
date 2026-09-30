import { useState, type FormEvent } from "react";
import type {
  Agreement, AgreementSummary, ApprovalPayload, Audit, BuyerIntent,
  BuyerIntentInput, DemoSession, Listing, ListingInput, Negotiation, PublicListing, Role,
} from "./types";
import type { WalletState } from "./wallet";

const won = (value: number) => `${new Intl.NumberFormat("ko-KR").format(value)}원`;
const when = (value: string) => new Date(value).toLocaleString("ko-KR");
const localDate = (days: number) => {
  const date = new Date(Date.now() + days * 86_400_000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const short = (value: string) => value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-10)}` : value;

export function WalletLogin({ busy, onLogin }: { busy: boolean; onLogin: (role: Role) => void }) {
  return <section className="live-card live-session">
    <div className="live-card-head"><h2>지갑으로 시작</h2><span>로그인 서명은 거래 승인이 아닙니다</span></div>
    <p>MetaMask 지갑으로 구매자 또는 판매자 역할을 확인합니다. 서명은 이 사이트에만 보내며, 로그인할 때 블록체인 트랜잭션은 발생하지 않습니다.</p>
    <div className="live-actions live-login-actions">
      <button className="live-primary" type="button" disabled={busy} onClick={() => onLogin("buyer")}>구매자로 지갑 연결</button>
      <button type="button" disabled={busy} onClick={() => onLogin("seller")}>판매자로 지갑 연결</button>
    </div>
    <small>구매자와 판매자 역할은 서명한 지갑 주소에 연결됩니다. 합의 기록은 Base Sepolia 테스트넷에만 전송됩니다.</small>
  </section>;
}

export function ListingCatalog({ items, busy, error }: {
  items: PublicListing[];
  busy: boolean;
  error: string;
}) {
  return <section className="live-card live-catalog">
    <div className="live-card-head"><h2>GPU 매물</h2><span>{busy ? "불러오는 중…" : `${items.length}개 · API 데이터`}</span></div>
    {error && <p className="live-alert live-error" role="alert">매물을 불러오지 못했습니다. {error}</p>}
    {!busy && !error && items.length === 0 && <p className="live-empty">등록된 매물이 없습니다.</p>}
    <div className="live-catalog-grid">
      {items.map((item) => <article className="live-listing" key={item.id}>
        <div className="live-listing-head">
          <span className={`live-listing-tag ${item.source === "demo" ? "demo" : "seller"}`}>
            {item.source === "demo" ? "데모 매물" : "판매자 등록"}
          </span>
          <span className={item.stock_status === "available" ? "live-stock" : "live-stock sold"}>
            {item.stock_status === "available" ? "판매 가능" : "판매 완료"}
          </span>
        </div>
        <h3>{item.title}</h3>
        <p className="live-listing-model">{item.gpu_model}</p>
        <strong className="live-listing-price">{won(item.asking_price_krw + item.shipping_fee_krw)}</strong>
        <p className="live-listing-price-detail">상품 {won(item.asking_price_krw)} · 배송 {won(item.shipping_fee_krw)}</p>
        <p className="live-listing-condition">{item.condition_text}</p>
        <dl className="live-listing-meta">
          <div><dt>보증 만료</dt><dd>{item.warranty_end ?? "미기재"}</dd></div>
          <div><dt>가장 빠른 배송</dt><dd>{item.earliest_delivery_at ? when(item.earliest_delivery_at) : "미기재"}</dd></div>
          <div><dt>증빙</dt><dd>{item.evidence.length ? `${item.evidence.length}개 · 판매자 제출` : "없음"}</dd></div>
        </dl>
        {item.evidence.length > 0 && <details className="live-evidence-details">
          <summary>증빙 요약 보기</summary>
          <ul>{item.evidence.map((evidence) => <li key={evidence.id}><b>{evidence.label}</b> · {evidence.summary}</li>)}</ul>
          <small>자료 설명은 제출자 주장입니다. AI의 일치 판정도 실물 검증을 뜻하지 않습니다.</small>
        </details>}
      </article>)}
    </div>
  </section>;
}

export function BuyerForm({ busy, intent, onCreate, onStart }: {
  busy: boolean;
  intent: BuyerIntent | null;
  onCreate: (value: BuyerIntentInput) => Promise<void>;
  onStart: () => Promise<void>;
}) {
  const [model, setModel] = useState("RTX 4090");
  const [budget, setBudget] = useState("2400000");
  const [deadline, setDeadline] = useState(localDate(10));
  const [warranty, setWarranty] = useState(false);
  const [evidence, setEvidence] = useState(true);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onCreate({
      gpu_model: model.trim(),
      max_total_krw: Number(budget),
      delivery_deadline: new Date(deadline).toISOString(),
      must_have: [warranty ? "warranty_active" : null, evidence ? "evidence_present" : null]
        .filter((value): value is "warranty_active" | "evidence_present" => value !== null),
    });
  }
  return <section className="live-card">
    <div className="live-card-head"><h2>구매 조건</h2><span>구매자 본인에게만 예산 표시</span></div>
    <div className="live-scenarios" aria-label="데모 조건">
      <button type="button" onClick={() => { setBudget("2400000"); setDeadline(localDate(10)); }}>A 기본 · 240만원 · 10일</button>
      <button type="button" onClick={() => { setBudget("2000000"); setDeadline(localDate(10)); }}>B 예산 감소 · 200만원</button>
      <button type="button" onClick={() => { setBudget("2400000"); setDeadline(localDate(3)); }}>C 기한 단축 · 3일</button>
    </div>
    <form onSubmit={submit} className="live-form">
      <label>GPU 모델<input required value={model} onChange={(event) => setModel(event.target.value)} /></label>
      <label>최고 총예산 (KRW)<input required type="number" min="1" step="1" value={budget} onChange={(event) => setBudget(event.target.value)} /></label>
      <label>배송 기한<input required type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} /></label>
      <fieldset><legend>필수 조건</legend>
        <label><input type="checkbox" checked={warranty} onChange={(event) => setWarranty(event.target.checked)} /> 보증 기한 유효</label>
        <label><input type="checkbox" checked={evidence} onChange={(event) => setEvidence(event.target.checked)} /> 증빙 있음</label>
      </fieldset>
      <button className="live-primary" disabled={busy}>새 구매 의도 등록</button>
    </form>
    {intent && <div className="live-result"><b>현재 의도 {intent.id}</b><span>{intent.gpu_model} · {won(intent.max_total_krw)} · {when(intent.delivery_deadline)}</span><p>조건을 바꾸면 새 의도와 새 흐름을 만듭니다.</p><button type="button" onClick={() => void onStart()} disabled={busy}>이 조건으로 협상 시작</button></div>}
  </section>;
}

export function SellerForm({ busy, listing, onCreate }: {
  busy: boolean;
  listing: Listing | null;
  onCreate: (value: ListingInput) => Promise<void>;
}) {
  const [model, setModel] = useState("RTX 4090");
  const [ask, setAsk] = useState("1990000");
  const [minimum, setMinimum] = useState("1900000");
  const [shipping, setShipping] = useState("20000");
  const [earliest, setEarliest] = useState(localDate(2));
  const [condition, setCondition] = useState("");
  const [warranty, setWarranty] = useState("");
  const [stock, setStock] = useState<"available" | "sold">("available");
  const [evidence, setEvidence] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onCreate({
      gpu_model: model.trim(), asking_price_krw: Number(ask), min_item_price_krw: Number(minimum),
      shipping_fee_krw: Number(shipping), earliest_delivery_at: new Date(earliest).toISOString(),
      condition_text: condition.trim(), warranty_end: warranty || null, stock_status: stock,
      evidence_ids: evidence.split(",").map((value) => value.trim()).filter(Boolean),
    });
  }
  return <section className="live-card">
    <div className="live-card-head"><h2>판매 매물</h2><span>최저가는 해당 판매자에게만 표시</span></div>
    <form onSubmit={submit} className="live-form">
      <label>GPU 모델<input required value={model} onChange={(event) => setModel(event.target.value)} /></label>
      <label>호가 (KRW)<input required type="number" min="1" step="1" value={ask} onChange={(event) => setAsk(event.target.value)} /></label>
      <label>비공개 최저 상품가<input required type="number" min="1" max={ask} step="1" value={minimum} onChange={(event) => setMinimum(event.target.value)} /></label>
      <label>배송비 (KRW)<input required type="number" min="0" step="1" value={shipping} onChange={(event) => setShipping(event.target.value)} /></label>
      <label>가장 빠른 배송<input required type="datetime-local" value={earliest} onChange={(event) => setEarliest(event.target.value)} /></label>
      <label>상태 설명<textarea required placeholder="사용 기간, 구성품, 점검 내용 등을 적어주세요. 미확인 내용은 판매자 주장으로 표시됩니다." value={condition} onChange={(event) => setCondition(event.target.value)} /></label>
      <label>보증 만료일<input type="date" value={warranty} onChange={(event) => setWarranty(event.target.value)} /></label>
      <label>재고<select value={stock} onChange={(event) => setStock(event.target.value as "available" | "sold")}><option value="available">판매 가능</option><option value="sold">판매 완료</option></select></label>
      <label>데모 증빙 ID (선택, 쉼표로 구분)<input placeholder="아직 연결한 증빙이 없으면 비워 두세요" value={evidence} onChange={(event) => setEvidence(event.target.value)} /></label>
      <button className="live-primary" disabled={busy}>매물 등록</button>
    </form>
    {listing && <div className="live-result"><b>등록된 매물 {listing.id}</b><span>{listing.gpu_model} · {won(listing.asking_price_krw + listing.shipping_fee_krw)}</span><p>비공개 최저가: {won(listing.private_policy.min_item_price_krw)}</p></div>}
  </section>;
}

export function NegotiationPanel({ negotiation }: { negotiation: Negotiation | null }) {
  if (!negotiation) return null;
  return <section className="live-card">
    <div className="live-card-head"><h2>협상 진행</h2><span>{negotiation.status} · {negotiation.flow_id}</span></div>
    <p>서버 검사를 통과한 제안만 승인 대상이 됩니다. 차단된 제안의 비공개 가격은 표시하지 않습니다.</p>
    {(negotiation.blocked_events ?? []).length > 0 && <div className="live-warning"><b>차단 이유</b><ul>{negotiation.blocked_events.map((item, index) => <li key={`${item.reason_code}-${index}`}>{item.reason_code}</li>)}</ul></div>}
    {(negotiation.assessments ?? []).map((item) => <article className="live-subcard" key={item.listing_id}>
      <h3>매물 평가 · {item.listing_id} <small>{item.source}</small></h3><p>{item.summary}</p>
      <ul>{item.findings.map((finding, index) => <li key={`${finding.evidence_id}-${index}`}><b>{finding.verdict}</b> · {finding.evidence_id ?? "증빙 없음"} · {finding.note}</li>)}</ul>
      <small>consistent는 기록 간 일치만 뜻하며 진품·작동 검증이 아닙니다.</small>
    </article>)}
    <div className="live-grid">{(negotiation.offers ?? []).map((offer) => <article className="live-subcard" key={offer.id}>
      <h3>제안 {offer.id} {offer.id === negotiation.selected_offer_id && <small>선택됨</small>}</h3>
      <p>라운드 {offer.round} · {offer.proposer} · {offer.valid ? "서버 유효" : "차단"}</p>
      <strong>{won(offer.total_krw)}</strong><p>상품가 {won(offer.item_price_krw)} + 배송비 {won(offer.shipping_fee_krw)}</p>
      <p>배송 {when(offer.delivery_by)} · 만료 {when(offer.expires_at)}</p><p>보증 {offer.warranty_terms}</p>
      <p><b>AI·협상 설명</b> {offer.rationale}</p><small>증빙 ID: {offer.evidence_ids.join(", ") || "없음"}</small>
    </article>)}</div>
    {(negotiation.offers ?? []).length === 0 && <p className="live-empty">표시할 유효 제안이 없습니다.</p>}
  </section>;
}

export function AgreementList({ items, busy, onRefresh, onSelect }: {
  items: AgreementSummary[];
  busy: boolean;
  onRefresh: () => Promise<void>;
  onSelect: (id: string) => Promise<void>;
}) {
  return <section className="live-card">
    <div className="live-card-head"><h2>내 합의 목록</h2><button type="button" disabled={busy} onClick={() => void onRefresh()}>새로고침</button></div>
    {items.length === 0 ? <p className="live-empty">세션에 허용된 합의만 표시됩니다. 목록을 새로고침하세요.</p> :
      <ul className="live-agreement-list">{items.map((item) => <li key={item.id}>
        <span><b>{item.id}</b><small>{item.status} · {won(item.total_krw)} · 구매자 {item.buyer_approved ? "승인" : "대기"} / 판매자 {item.seller_approved ? "승인" : "대기"}</small></span>
        <button type="button" disabled={busy} onClick={() => void onSelect(item.id)}>상세 보기</button>
      </li>)}</ul>}
  </section>;
}

export function AgreementPanel({ agreement, payload, session, wallet, blockReason, confirmed, busy, now, onConfirm, onPayload, onConnect, onSwitch, onApprove, onReject, onRefresh }: {
  agreement: Agreement | null;
  payload: ApprovalPayload | null;
  session: DemoSession;
  wallet: WalletState | null;
  blockReason: string | null;
  confirmed: boolean;
  busy: boolean;
  now: number;
  onConfirm: (value: boolean) => void;
  onPayload: () => Promise<void>;
  onConnect: () => Promise<void>;
  onSwitch: () => Promise<void>;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  if (!agreement) return null;
  const snapshot = agreement.snapshot;
  const ownApproved = session.role === "buyer" ? agreement.buyer_approved : agreement.seller_approved;
  const expiry = Date.parse(snapshot.expires_at);
  const expired = !Number.isFinite(expiry) || expiry <= now;
  const recorded = agreement.status === "RECORDED" && agreement.chain.mode === "testnet" &&
    agreement.chain.chain_id === 84532 && agreement.chain.receipt_status === "success" &&
    agreement.chain.event_name === "AgreementRecorded" &&
    agreement.chain.recorded_hash?.toLowerCase() === agreement.snapshot_hash.toLowerCase() &&
    /^0x[0-9a-fA-F]{64}$/.test(agreement.chain.tx_hash ?? "");
  const explorer = agreement.chain.mode === "testnet" && /^0x[0-9a-fA-F]{64}$/.test(agreement.chain.tx_hash ?? "")
    ? `https://sepolia.basescan.org/tx/${agreement.chain.tx_hash}` : null;
  return <section className="live-card">
    <div className="live-card-head"><h2>합의안 · 승인</h2><button type="button" disabled={busy} onClick={() => void onRefresh()}>상태 새로고침</button></div>
    <div className={`live-state ${recorded ? "success" : ""}`} role="status">
      <b>{recorded ? "체인 기록 확인" : agreement.status === "RECORDED" ? "체인 증거 불일치" : agreement.status === "MOCK_RECORDED" ? "양측 서명 완료 · mock 기록 (체인 전송 없음)" : agreement.status}</b>
      <span>구매자 {agreement.buyer_approved ? "승인" : "대기"} · 판매자 {agreement.seller_approved ? "승인" : "대기"}</span>
    </div>
    <div className="live-subcard live-snapshot">
      <h3>서명 대상 · 불변 스냅샷 v{snapshot.snapshot_version}</h3>
      <dl>
        <div><dt>합의 / 제안</dt><dd>{snapshot.agreement_id} / {snapshot.offer_id}</dd></div>
        <div><dt>매물</dt><dd>{snapshot.gpu_model} · {snapshot.listing_id}</dd></div>
        <div><dt>상품가</dt><dd>{won(snapshot.item_price_krw)}</dd></div>
        <div><dt>배송비</dt><dd>{won(snapshot.shipping_fee_krw)}</dd></div>
        <div><dt>총액</dt><dd><strong>{won(snapshot.total_krw)}</strong></dd></div>
        <div><dt>배송 기한</dt><dd>{when(snapshot.delivery_by)}</dd></div>
        <div><dt>보증</dt><dd>{snapshot.warranty_terms}</dd></div>
        <div><dt>만료</dt><dd>{when(snapshot.expires_at)}</dd></div>
        <div><dt>구매자 지갑</dt><dd className="live-code">{snapshot.buyer_wallet}</dd></div>
        <div><dt>판매자 지갑</dt><dd className="live-code">{snapshot.seller_wallet}</dd></div>
        <div><dt>스냅샷 해시</dt><dd className="live-code">{agreement.snapshot_hash}</dd></div>
      </dl>
      <p className="live-hashes">증빙 해시: {snapshot.evidence_hashes.length ? snapshot.evidence_hashes.map((hash) => short(hash)).join(", ") : "없음"}</p>
    </div>
    {(agreement.assessment || agreement.rationale) && <div className="live-subcard live-explanation">
      <h3>판단 근거 · 서명 대상 아님</h3>
      {agreement.assessment && <><p>{agreement.assessment.summary} <small>출처 {agreement.assessment.source}</small></p><ul>{agreement.assessment.findings.map((finding, index) => <li key={index}>{finding.verdict} · {finding.note}</li>)}</ul></>}
      {agreement.rationale && <p>협상 이유: {agreement.rationale}</p>}
      <small>consistent는 판매자 자료의 일치 여부이며 진품·작동 검증이 아닙니다.</small>
    </div>}
    <div className="live-subcard">
      <h3>지갑 확인과 결정</h3>
      <p>세션 지갑 {short(session.wallet_address)} · 연결된 지갑 {wallet ? short(wallet.address) : "없음"} · 체인 {wallet?.chainId ?? "미연결"}</p>
      <div className="live-actions"><button type="button" disabled={busy} onClick={() => void onConnect()}>지갑 연결·갱신</button>
        {wallet && wallet.chainId !== 84532 && <button type="button" disabled={busy} onClick={() => void onSwitch()}>Base Sepolia로 전환</button>}
        <button type="button" disabled={busy || agreement.status !== "AWAITING_APPROVALS" || ownApproved || expired} onClick={() => void onPayload()}>승인 자료 확인</button></div>
      {payload && <p className="live-code">서명 계약 {payload.typed_data.domain.verifyingContract} · chain ID {payload.typed_data.domain.chainId}</p>}
      {blockReason && <p className="live-warning" role="alert">{blockReason}</p>}
      <label className="live-confirm"><input type="checkbox" checked={confirmed} disabled={Boolean(blockReason) || busy} onChange={(event) => onConfirm(event.target.checked)} /> 표시된 상품가·배송비·총액·배송·보증·만료·증빙 해시와 서명 내용을 확인했습니다.</label>
      <div className="live-actions"><button type="button" className="live-primary" disabled={busy || Boolean(blockReason) || !confirmed} onClick={() => void onApprove()}>지갑으로 서명하고 승인</button>
        <button type="button" className="live-danger" disabled={busy || agreement.status !== "AWAITING_APPROVALS" || ownApproved || expired} onClick={() => void onReject()}>합의 거절</button></div>
    </div>
    <div className="live-subcard"><h3>체인 결과</h3>
      <p>모드 {agreement.chain.mode ?? "미제출"} · 영수증 {agreement.chain.receipt_status ?? "없음"} · 블록 {agreement.chain.block_number ?? "대기"}</p>
      {explorer && <a href={explorer} target="_blank" rel="noopener noreferrer">BaseScan에서 트랜잭션 보기</a>}
      {agreement.chain.reason_code && <p role="alert">오류: {agreement.chain.reason_code}</p>}
      {agreement.chain.mode === "mock" && <p>mock 체인 응답입니다. 실제 트랜잭션 증거가 아닙니다.</p>}
    </div>
  </section>;
}

export function AuditPanel({ audit, busy, onRefresh }: { audit: Audit | null; busy: boolean; onRefresh: () => Promise<void> }) {
  const tokenTotal = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) ? value : "미수집";
  return <section className="live-card"><div className="live-card-head"><h2>흐름 감사</h2><button type="button" disabled={busy} onClick={() => void onRefresh()}>감사 조회</button></div>
    {!audit ? <p className="live-empty">흐름을 시작하거나 합의안을 선택한 뒤 조회하세요.</p> : <>
      <p>{audit.flow_id} · {audit.status}</p>
      <ul className="live-audit">{audit.events.map((event, index) => <li key={`${event.at}-${index}`}><time>{when(event.at)}</time><b>{event.event_type}</b><span>{event.actor} · {event.decision ?? "-"} · {event.reason_code ?? "-"}</span></li>)}</ul>
      <h3>모델 사용량</h3>{audit.model_usage.length > 0
        ? <ul>{audit.model_usage.map((usage, index) => <li key={`${usage.request_id ?? usage.step}-${index}`}>{usage.actor} / {usage.step} · {usage.model_id} · 입력 {usage.input_tokens ?? "미수집"}, 출력 {usage.output_tokens ?? "미수집"} 토큰{typeof usage.cost_usd === "number" ? ` · $${usage.cost_usd.toFixed(6)}` : ""} · {usage.outcome && usage.outcome !== "OK" ? usage.outcome : usage.source}{usage.request_id ? <code> {usage.request_id}</code> : null}</li>)}</ul>
        : <p>{audit.totals.usage_source === "mock" ? "로컬 mock 에이전트는 Kiln API를 호출하지 않았습니다." : "확인 가능한 모델 사용량 기록이 없습니다."}</p>}
      <p>모델 사용량 기록: {audit.model_usage.length}건 · 입력 {tokenTotal(audit.totals.input_tokens)}토큰 · 출력 {tokenTotal(audit.totals.output_tokens)}토큰{typeof audit.totals.cost_usd === "number" ? ` · 비용 $${audit.totals.cost_usd.toFixed(6)}` : ""}</p>
    </>}
  </section>;
}
