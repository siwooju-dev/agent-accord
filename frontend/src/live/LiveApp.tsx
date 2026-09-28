import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, api } from "./api";
import { approvalBlockReason, sameSnapshot, snapshotHashMatches } from "./approval";
import {
  AgreementList, AgreementPanel, AuditPanel, BuyerForm, NegotiationPanel, SellerForm,
} from "./LivePanels";
import type {
  Agreement, AgreementSummary, ApprovalPayload, Audit, BuyerIntent, BuyerIntentInput,
  DemoSession, Listing, ListingInput, Negotiation,
} from "./types";
import {
  connectWallet, currentWallet, signApproval, switchToBaseSepolia, watchWallet,
  type WalletState,
} from "./wallet";
import "./LiveApp.css";

const failure = (error: unknown) => error instanceof ApiError
  ? `${error.message} (${error.code}${error.status ? ` / HTTP ${error.status}` : ""})`
  : error instanceof Error ? error.message : "요청을 완료하지 못했습니다.";

export default function LiveApp() {
  const [actorId, setActorId] = useState("buyer-demo");
  const [session, setSession] = useState<DemoSession | null>(null);
  const [intent, setIntent] = useState<BuyerIntent | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [negotiation, setNegotiation] = useState<Negotiation | null>(null);
  const [agreements, setAgreements] = useState<AgreementSummary[]>([]);
  const [agreement, setAgreement] = useState<Agreement | null>(null);
  const [payload, setPayload] = useState<ApprovalPayload | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const keys = useRef(new Map<string, string>());
  const running = useRef(false);

  async function perform(label: string, task: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setSession(null);
        setIntent(null); setListing(null); setNegotiation(null); setAgreement(null);
        setAgreements([]); setPayload(null); setAudit(null); setConfirmed(false);
        keys.current.clear();
      }
      setError(failure(cause));
    } finally {
      running.current = false;
      setBusy(null);
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      setConfirmed(false);
      void currentWallet().then((value) => { if (active) setWallet(value); }).catch(() => { if (active) setWallet(null); });
    };
    refresh();
    const stop = watchWallet(refresh);
    return () => { active = false; stop(); };
  }, []);

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
        if (!controller.signal.aborted) timer = window.setTimeout(poll, 3000);
      }
    };
    timer = window.setTimeout(poll, 3000);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [session, negotiationId, negotiationStatus]);

  useEffect(() => {
    if (!session || !negotiation?.agreement_id || agreement?.id === negotiation.agreement_id) return;
    const controller = new AbortController();
    void api.getAgreement(session.access_token, negotiation.agreement_id, controller.signal)
      .then((value) => { if (!controller.signal.aborted) { setAgreement(value); setPayload(null); setConfirmed(false); } })
      .catch((cause) => { if (!controller.signal.aborted) setError(failure(cause)); });
    return () => controller.abort();
  }, [session, negotiation?.agreement_id, agreement?.id]);

  const agreementId = agreement?.id;
  const agreementHash = agreement?.snapshot_hash;
  const agreementStatus = agreement?.status;
  useEffect(() => {
    if (!session || !agreementId || !agreementHash || !agreementStatus || ["RECORDED", "CHAIN_FAILED", "REJECTED", "EXPIRED"].includes(agreementStatus)) return;
    const controller = new AbortController();
    let timer: number;
    const poll = async () => {
      try {
        const latest = await api.getAgreement(session.access_token, agreementId, controller.signal);
        if (!controller.signal.aborted) {
          if (latest.snapshot_hash !== agreementHash || latest.status !== "AWAITING_APPROVALS") {
            setPayload(null);
            setConfirmed(false);
          }
          setAgreement(latest);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(failure(cause));
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(poll, 4000);
      }
    };
    timer = window.setTimeout(poll, 4000);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [session, agreementId, agreementHash, agreementStatus]);

  function startSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void perform("세션 연결", async () => {
      const next = await api.createSession(actorId.trim());
      keys.current.clear();
      setSession(next);
      setIntent(null); setListing(null); setNegotiation(null); setAgreement(null);
      setAgreements([]); setPayload(null); setAudit(null); setConfirmed(false);
      const list = await api.listAgreements(next.access_token);
      setAgreements(list.items);
      setNotice(`${next.actor_id} 세션을 열었습니다. 토큰은 메모리에만 보관됩니다.`);
    });
  }

  const createIntent = async (input: BuyerIntentInput) => perform("구매 의도 등록", async () => {
    if (!session || session.role !== "buyer") return;
    const next = await api.createBuyerIntent(session.access_token, input);
    setIntent(next); setNegotiation(null); setAgreement(null); setPayload(null); setAudit(null); setConfirmed(false);
    setNotice(`새 구매 의도 ${next.id}를 등록했습니다.`);
  });

  const createListing = async (input: ListingInput) => perform("매물 등록", async () => {
    if (!session || session.role !== "seller") return;
    const next = await api.createListing(session.access_token, input);
    setListing(next);
    setNotice(`매물 ${next.id}를 등록했습니다.`);
  });

  const startNegotiation = async () => perform("협상 시작", async () => {
    if (!session || !intent) return;
    let key = keys.current.get(intent.id);
    if (!key) { key = crypto.randomUUID(); keys.current.set(intent.id, key); }
    const started = await api.startNegotiation(session.access_token, intent.id, key);
    const latest = await api.getNegotiation(session.access_token, started.id);
    setNegotiation(latest); setAgreement(null); setPayload(null); setAudit(null); setConfirmed(false);
    setNotice(`협상 ${started.id}를 시작했습니다. 진행 상태를 자동 조회합니다.`);
  });

  const refreshNegotiation = async () => perform("협상 조회", async () => {
    if (!session || !negotiation) return;
    setNegotiation(await api.getNegotiation(session.access_token, negotiation.id));
  });

  const refreshAgreements = async () => perform("합의 목록 조회", async () => {
    if (!session) return;
    const list = await api.listAgreements(session.access_token);
    setAgreements(list.items);
  });

  const selectAgreement = async (id: string) => perform("합의 조회", async () => {
    if (!session) return;
    const next = await api.getAgreement(session.access_token, id);
    setAgreement(next); setPayload(null); setConfirmed(false); setAudit(null);
  });

  const refreshAgreement = async () => perform("합의 상태 조회", async () => {
    if (!session || !agreement) return;
    const next = await api.getAgreement(session.access_token, agreement.id);
    if (next.snapshot_hash !== agreement.snapshot_hash || next.status !== "AWAITING_APPROVALS") {
      setPayload(null); setConfirmed(false);
    }
    setAgreement(next);
  });

  const loadPayload = async () => perform("승인 자료 조회", async () => {
    if (!session || !agreement) return;
    setPayload(null); setConfirmed(false);
    const latest = await api.getAgreement(session.access_token, agreement.id);
    const next = await api.getApprovalPayload(session.access_token, agreement.id);
    setAgreement(latest); setPayload(next); setConfirmed(false);
    if (latest.snapshot_hash !== agreement.snapshot_hash) {
      setError("합의 스냅샷이 바뀌었습니다. 새 내용을 다시 확인하세요.");
    }
  });

  const connect = async () => perform("지갑 연결", async () => {
    setWallet(await connectWallet()); setConfirmed(false);
  });

  const switchChain = async () => perform("네트워크 전환", async () => {
    setWallet(await switchToBaseSepolia()); setConfirmed(false);
  });

  const approve = async () => perform("지갑 서명", async () => {
    if (!session || !agreement || !payload || !confirmed) return;
    const initialReason = approvalBlockReason(agreement, payload, session, wallet);
    if (initialReason) throw new Error(initialReason);
    if (agreement.snapshot_hash !== payload.snapshot_hash ||
        !(await snapshotHashMatches(payload.snapshot, payload.snapshot_hash))) {
      setConfirmed(false);
      throw new Error("합의 스냅샷의 SHA-256 해시가 일치하지 않습니다. 다시 조회하세요.");
    }
    const latest = await api.getAgreement(session.access_token, agreement.id);
    const freshPayload = await api.getApprovalPayload(session.access_token, agreement.id);
    setAgreement(latest); setPayload(freshPayload);
    if (latest.snapshot_hash !== agreement.snapshot_hash ||
        !sameSnapshot(latest.snapshot, agreement.snapshot) ||
        latest.snapshot_hash !== freshPayload.snapshot_hash ||
        !(await snapshotHashMatches(latest.snapshot, latest.snapshot_hash)) ||
        !(await snapshotHashMatches(freshPayload.snapshot, freshPayload.snapshot_hash))) {
      setConfirmed(false);
      throw new Error("서명 직전에 합의 내용이나 해시가 바뀌었습니다. 다시 확인하세요.");
    }
    const activeWallet = await currentWallet();
    setWallet(activeWallet);
    const reason = approvalBlockReason(latest, freshPayload, session, activeWallet);
    if (reason) { setConfirmed(false); throw new Error(reason); }
    if (!activeWallet) throw new Error("지갑 연결을 확인하세요.");
    const signature = await signApproval(freshPayload, activeWallet.address);
    await api.submitDecision(session.access_token, agreement.id, {
      decision: "approve", snapshot_hash: freshPayload.snapshot_hash, signature,
    });
    setAgreement(await api.getAgreement(session.access_token, agreement.id));
    setPayload(null); setConfirmed(false);
    setNotice("서명을 서버에 제출했습니다. 양측 승인과 체인 검증 상태를 계속 조회합니다.");
  });

  const reject = async () => perform("합의 거절", async () => {
    if (!session || !agreement) return;
    const latest = await api.getAgreement(session.access_token, agreement.id);
    setAgreement(latest);
    if (latest.status !== "AWAITING_APPROVALS" || latest.snapshot_hash !== agreement.snapshot_hash ||
        Date.parse(latest.snapshot.expires_at) <= Date.now()) {
      setPayload(null); setConfirmed(false);
      throw new Error("합의 상태 또는 내용이 바뀌었습니다. 새로 확인하세요.");
    }
    await api.submitDecision(session.access_token, agreement.id, {
      decision: "reject", snapshot_hash: latest.snapshot_hash,
    });
    setAgreement(await api.getAgreement(session.access_token, agreement.id));
    setPayload(null); setConfirmed(false);
    setNotice("합의를 거절했습니다.");
  });

  const refreshAudit = async () => perform("감사 조회", async () => {
    if (!session) return;
    const flowId = agreement?.flow_id ?? negotiation?.flow_id;
    if (!flowId) throw new Error("조회할 흐름이 없습니다.");
    setAudit(await api.getAudit(session.access_token, flowId));
  });

  const blockReason = approvalBlockReason(agreement, payload, session, wallet, now);

  return <div className="live-shell">
    <header className="live-header"><div><a className="live-brand" href="?mode=mock">accord</a><span>실제 API 연결 모드</span></div><a href="?mode=mock">mock 화면으로 돌아가기</a></header>
    <main className="live-main">
      <div className="live-intro"><span className="live-eyebrow">AGENT ACCORD / BASE SEPOLIA</span><h1>조건부터 온체인 기록까지</h1><p>이 화면은 `/api` 백엔드 응답을 사용합니다. 백엔드가 실행 중이지 않으면 연결 오류를 표시합니다. 지갑 서명과 체인 기록은 서버 상태로 확인합니다.</p></div>
      <section className="live-card live-session"><div className="live-card-head"><h2>데모 세션</h2><span>토큰은 화면·로그·저장소에 남기지 않습니다</span></div>
        <form className="live-session-form" onSubmit={startSession}><label>데모 계정 ID<input list="live-actors" required value={actorId} onChange={(event) => setActorId(event.target.value)} /></label>
          <datalist id="live-actors"><option value="buyer-demo" /><option value="seller-demo-1" /><option value="seller-demo-2" /><option value="seller-demo-3" /></datalist>
          <button className="live-primary" disabled={Boolean(busy)}>세션 열기</button></form>
        {session && <p className="live-session-status">{session.actor_id} · {session.role === "buyer" ? "구매자" : "판매자"} · 지갑 {session.wallet_address}</p>}
      </section>
      {busy && <p className="live-alert" role="status" aria-live="polite">{busy} 중…</p>}
      {error && <p className="live-alert live-error" role="alert">{error}</p>}
      {notice && <p className="live-alert live-notice" role="status">{notice}</p>}
      {session && <>
        <div className="live-columns"><div>
          {session.role === "buyer" ? <BuyerForm busy={Boolean(busy)} intent={intent} onCreate={createIntent} onStart={startNegotiation} /> :
            <SellerForm busy={Boolean(busy)} listing={listing} onCreate={createListing} />}
        </div><div>
          <AgreementList items={agreements} busy={Boolean(busy)} onRefresh={refreshAgreements} onSelect={selectAgreement} />
          {negotiation && <section className="live-card live-mini"><b>협상 상태: {negotiation.status}</b><button type="button" disabled={Boolean(busy)} onClick={() => void refreshNegotiation()}>지금 조회</button></section>}
        </div></div>
        {session.role === "buyer" && <NegotiationPanel negotiation={negotiation} />}
        <AgreementPanel agreement={agreement} payload={payload} session={session} wallet={wallet} blockReason={blockReason} confirmed={confirmed} busy={Boolean(busy)} now={now} onConfirm={setConfirmed} onPayload={loadPayload} onConnect={connect} onSwitch={switchChain} onApprove={approve} onReject={reject} onRefresh={refreshAgreement} />
        <AuditPanel audit={audit} busy={Boolean(busy)} onRefresh={refreshAudit} />
      </>}
    </main>
  </div>;
}
