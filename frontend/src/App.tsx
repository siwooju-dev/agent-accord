import { useEffect, useState } from 'react'
import { api, mutationHeaders, acknowledgeMutation, result, setCsrf } from './api'
import type { Deal, Policy, Product, Evidence, Usage } from './api'

const won = (n:number) => n.toLocaleString('ko-KR') + '원'
const future = (days:number) => new Date(Date.now()+days*86400000).toISOString().slice(0,10)
const labels:Record<string,string> = {DRAFT:'조건 확인 대기',POLICY_CONFIRMED:'조건 확정',NEGOTIATING:'협상 중',AWAITING_APPROVAL:'구매자 승인 대기',BLOCKED:'정책 차단',REJECTED:'거절됨',RECORDING:'감사 기록 확인 중',RECORDED:'테스트넷 감사 기록 확인',MOCK_RECORDED:'모의 감사 기록 완료',CHAIN_FAILED:'체인 기록 실패'}
const ruleLabels:Record<string,string> = {budget_includes_shipping_and_fee:'총비용 예산',seller_floor:'판매자 가격 조건',seller_allowlist:'허용 판매자',ram_ssd:'RAM / SSD',delivery:'배송 기한',stock:'재고',policy_expiry:'조건 유효기간',product_expiry:'매물 유효기간',round_limit:'협상 횟수',model_output:'모델 응답 형식',model_protocol:'제안 형식',data_integrity:'데이터 유효성'}

export default function App() {
  const [ready,setReady] = useState(false), [mode,setMode] = useState(''), [credential,setCredential] = useState('')
  const [products,setProducts] = useState<Product[]>([]), [productId,setProductId] = useState('laptop-a')
  const [budget,setBudget] = useState(1000000), [ram,setRam] = useState(16), [ssd,setSsd] = useState(512)
  const [sellers,setSellers] = useState('seller-a'), [delivery,setDelivery] = useState(future(7))
  const [roundLimit,setRoundLimit] = useState(6)
  const [expiry,setExpiry] = useState(new Date(Date.now()+3600000).toISOString().slice(0,16))
  const [deal,setDeal] = useState<Deal|null>(null), [evidence,setEvidence] = useState<Evidence|null>(null), [usage,setUsage] = useState<Usage|null>(null)
  const [busy,setBusy] = useState(false), [error,setError] = useState('')
  const [approvalChecked,setApprovalChecked] = useState(false)

  async function refresh(id:string) {
    const response = await api.GET('/api/v1/deals/{deal_id}',{params:{path:{deal_id:id}}})
    const latest = result(response.data,response.error)
    setDeal(latest)
    const [ev,us] = await Promise.all([
      api.GET('/api/v1/deals/{deal_id}/evidence',{params:{path:{deal_id:id}}}),
      api.GET('/api/v1/deals/{deal_id}/usage',{params:{path:{deal_id:id}}})])
    setEvidence(result(ev.data,ev.error)); setUsage(result(us.data,us.error))
    return latest
  }
  async function load() {
    const catalog = await api.GET('/api/v1/products')
    setProducts(result(catalog.data,catalog.error)); setReady(true)
    const saved = localStorage.getItem('dealbattle:deal')
    if (saved) {
      const restored = await refresh(saved)
      setBudget(restored.policy.max_total_krw); setRam(restored.policy.min_ram_gb); setSsd(restored.policy.min_ssd_gb)
      setSellers(restored.policy.allowed_seller_ids.join(',')); setDelivery(restored.policy.delivery_by)
      setExpiry(restored.policy.expires_at.slice(0,16)); setRoundLimit(restored.policy.max_rounds ?? 6)
      setProductId(restored.product.product_id)
    }
  }
  async function guarded(action:()=>Promise<void>) {
    setBusy(true); setError('')
    try { await action() } catch (e) {
      setError(e instanceof Error ? e.message : '요청 실패')
      if (deal) { try { await refresh(deal.id) } catch { /* Keep last verified state. */ } }
    } finally { setBusy(false) }
  }
  useEffect(()=>{
    let cancelled=false
    void (async()=>{
      try {
        const health = await api.GET('/health'); const info = result(health.data,health.error)
        if(cancelled) return
        setMode(info.mode)
        const session = await api.GET('/api/v1/session')
        if(session.data) { setCsrf(session.data.csrf_token); await load() }
      } catch(e) { if(!cancelled) setError(e instanceof Error?e.message:'서버 연결 실패') }
    })()
    return ()=>{cancelled=true}
  },[])
  useEffect(()=>{
    if (!deal || !['NEGOTIATING','RECORDING'].includes(deal.status)) return
    const timer = setInterval(()=>{void refresh(deal.id).catch(e=>setError(e.message))},2500)
    return ()=>clearInterval(timer)
  },[deal?.id,deal?.status])
  const dirty = !!deal && (budget!==deal.policy.max_total_krw || ram!==deal.policy.min_ram_gb || ssd!==deal.policy.min_ssd_gb ||
    sellers.split(',').map(s=>s.trim()).filter(Boolean).sort().join(',')!==deal.policy.allowed_seller_ids.join(',') ||
    delivery!==deal.policy.delivery_by || expiry!==deal.policy.expires_at.slice(0,16) || roundLimit!==(deal.policy.max_rounds??6))
  useEffect(()=>setApprovalChecked(false),[deal?.agreement?.snapshot_hash,dirty])

  const policy = ():Policy => ({max_total_krw:budget,min_ram_gb:ram,min_ssd_gb:ssd,
    allowed_seller_ids:sellers.split(',').map(s=>s.trim()).filter(Boolean),delivery_by:delivery,
    expires_at:new Date(expiry+'Z').toISOString(),max_rounds:roundLimit})
  async function savePolicy() {
    if (!deal) {
      const body={product_id:productId,policy:policy()}
      const response=await api.POST('/api/v1/deals',{body,headers:mutationHeaders('create',body)})
      const created=result(response.data,response.error)
      localStorage.setItem('dealbattle:deal',created.id); await refresh(created.id)
    } else {
      const body={expected_policy_version:deal.policy_version,policy:policy()}
      const response=await api.PUT('/api/v1/deals/{deal_id}/policy',{params:{path:{deal_id:deal.id}},body,headers:mutationHeaders(deal.id+':policy',body)})
      result(response.data,response.error); await refresh(deal.id)
    }
  }
  const params=deal?{path:{deal_id:deal.id}}:undefined
  const versionBody={expected_policy_version:deal?.policy_version ?? 0}
  async function confirm() {
    if(!deal || !params || dirty) return
    const response=await api.POST('/api/v1/deals/{deal_id}/policy/confirm',{params,body:versionBody,headers:mutationHeaders(deal.id+':confirm',versionBody)})
    result(response.data,response.error); await refresh(deal.id)
  }
  async function start() {
    if(!deal || !params || dirty) return
    const response=await api.POST('/api/v1/deals/{deal_id}/negotiation/start',{params,body:versionBody,headers:mutationHeaders(deal.id+':start',versionBody)})
    result(response.data,response.error); await refresh(deal.id)
  }
  async function approve() {
    if(!deal?.agreement || !params || !approvalChecked || dirty) return
    const body={...versionBody,snapshot_hash:deal.agreement.snapshot_hash}
    const response=await api.POST('/api/v1/deals/{deal_id}/agreement/approve',{params,body,headers:mutationHeaders(deal.id+':approve',body)})
    result(response.data,response.error); await refresh(deal.id)
  }
  async function reject() {
    if(!deal || !params) return
    const response=await api.POST('/api/v1/deals/{deal_id}/agreement/reject',{params,body:versionBody,headers:mutationHeaders(deal.id+':reject',versionBody)})
    result(response.data,response.error); await refresh(deal.id)
  }
  async function reconcile() {
    if(!deal || !params) return
    const response=await api.POST('/api/v1/deals/{deal_id}/chain/reconcile',{params,body:versionBody,headers:mutationHeaders(deal.id+':reconcile',versionBody)})
    result(response.data,response.error); acknowledgeMutation(deal.id+':reconcile',versionBody); await refresh(deal.id)
  }
  function newDeal() { localStorage.removeItem('dealbattle:deal'); setDeal(null); setEvidence(null); setUsage(null); setError('');
    for(const key of Object.keys(sessionStorage)) if(key.startsWith('dealbattle:idem:create')) sessionStorage.removeItem(key)
  }
  const immutable = !!deal?.chain
  const snapshot=deal?.agreement?.snapshot

  return <main>
    <header><div><span className="eyebrow">AI NEGOTIATION · POLICY GUARD</span><h1>DealBattle<span>.</span></h1><p>노트북 가격 협상부터 승인한 합의의 감사 기록까지.</p></div><div className="mode">{mode.toUpperCase() || '연결 확인 중'}<small>상품 데이터: simulated</small></div></header>
    <aside className="notice">실제 결제·송금·배송을 수행하지 않습니다. {mode==='mock'?'현재는 모의 에이전트·모의 체인 데모입니다.':mode==='live'?'실제 모델·허용 테스트넷 기록 모드입니다.':'서버 모드를 확인하고 있습니다.'}</aside>
    {error && <div role="alert" className="error">{error}<button onClick={()=>void guarded(async()=>{if(deal) await refresh(deal.id)})}>서버 상태 다시 조회</button><button onClick={newDeal}>새 딜</button></div>}
    {!ready ? <section><h2>세션 시작</h2>{mode==='live'&&<label>인증된 로그인 자격 증명<input type="password" value={credential} onChange={e=>setCredential(e.target.value)} autoComplete="off"/></label>}
      <button disabled={busy||!mode} onClick={()=>void guarded(async()=>{const response=await api.POST('/api/v1/session',{body:mode==='mock'?{}:{credential}});const session=result(response.data,response.error);setCsrf(session.csrf_token);setCredential('');await load()})}>{mode==='mock'?'모의 데모 시작':'인증 후 시작'}</button></section> : <>
    <div className="steps"><span>01 조건 확정</span><span>02 에이전트 협상</span><span>03 구매자 승인</span><span>04 감사 기록</span></div>
    <div className="grid"><section><div className="title"><h2>구매 조건</h2><button className="secondary" onClick={newDeal} disabled={busy}>새 딜</button></div>
      <form onSubmit={e=>{e.preventDefault();void guarded(savePolicy)}}>
        <fieldset disabled={busy||immutable}>
        <label>노트북<select value={productId} disabled={!!deal} onChange={e=>setProductId(e.target.value)}>{products.map(p=><option key={p.product_id} value={p.product_id}>{p.name} · {won(p.asking_price_krw)} · {p.source}</option>)}</select></label>
        <label>최대 총예산 (상품가 + 배송비 + 수수료)<input type="number" min="1" max="100000000" step="1" value={budget} onChange={e=>setBudget(Number(e.target.value))}/></label>
        <div className="pair"><label>최소 RAM (GB)<input type="number" min="1" max="256" value={ram} onChange={e=>setRam(Number(e.target.value))}/></label><label>최소 SSD (GB)<input type="number" min="1" max="8192" value={ssd} onChange={e=>setSsd(Number(e.target.value))}/></label></div>
        <label>허용 판매자 ID (쉼표로 구분)<input value={sellers} onChange={e=>setSellers(e.target.value)}/></label>
        <label>배송 마감일<input type="date" value={delivery} onChange={e=>setDelivery(e.target.value)}/></label>
        <label>조건 만료 (UTC)<input type="datetime-local" value={expiry} onChange={e=>setExpiry(e.target.value)}/></label>
        <label>최대 제안 수 (양측 합계)<input type="number" min="2" max="12" value={roundLimit} onChange={e=>setRoundLimit(Number(e.target.value))}/></label>
        <button type="submit">{deal?'조건 변경 저장':'딜 생성'}</button></fieldset>
      </form>
      {deal&&<><p>조건 버전 {deal.policy_version} · {deal.policy_confirmed?'확정':'검토 후 확정 필요'}</p>
        {dirty&&<p className="block">변경한 조건을 저장한 뒤 확정·협상·승인을 진행하세요.</p>}
        {deal.status==='DRAFT'&&<button disabled={busy||dirty} onClick={()=>void guarded(confirm)}>표시된 조건 확정</button>}
        {deal.status==='POLICY_CONFIRMED'&&<button disabled={busy||dirty} onClick={()=>void guarded(start)}>Buyer / Seller 협상 시작</button>}
        {immutable&&<p>승인된 딜의 변경은 새 딜에서 진행하세요.</p>}</>}
    </section>
    <section><div className="title"><h2>협상 타임라인</h2><span className="status">{deal?labels[deal.status]:'딜 생성 대기'}</span></div>
      {!evidence?.rounds.length&&<p className="empty">조건을 확정하면 협상을 시작할 수 있습니다. 불가능한 조건은 모델 호출 전에 차단합니다.</p>}
      {deal?.reason_codes.map(code=><p className="block" key={code}>BLOCK · {code}</p>)}
      {evidence?.rounds.map(r=><article key={r.id} className={'round '+r.actor}>
        <div className="title"><strong>{r.actor==='buyer'?'Buyer Agent':'Seller Agent'} · 제안 {r.number}</strong><span className={r.decision.allowed?'pass':'block'}>{r.decision.allowed?'PASS':'BLOCK'}{!r.valid?' · 무효':''}</span></div>
        {r.proposal&&<><p className="price">{r.proposal.action} · {won(r.proposal.item_price_krw)}</p><p>{r.proposal.reason}</p></>}
        <small>정책 버전 {r.decision.policy_version}</small><div className="checks">{r.decision.checks.map((c,i)=><span key={i} className={c.passed?'pass':'block'}>{c.passed?'✓':'×'} {ruleLabels[c.rule]??c.rule}{c.reason_code?' · '+c.reason_code:''}</span>)}</div>
      </article>)}
      {snapshot&&<article className="agreement"><h3>최종 합의 확인</h3><p>{snapshot.name} · {snapshot.seller_id}</p><dl><dt>상품가</dt><dd>{won(snapshot.item_price_krw)}</dd><dt>배송비 / 수수료</dt><dd>{won(snapshot.shipping_fee_krw)} / {won(snapshot.fee_krw)}</dd><dt>총액</dt><dd className="price">{won(snapshot.total_krw)}</dd><dt>배송일</dt><dd>{snapshot.delivery_date}</dd><dt>승인 만료</dt><dd>{snapshot.expiry} (UTC)</dd></dl>
        <details><summary>승인 대상 해시</summary><code>{deal?.agreement?.snapshot_hash}</code></details>
        {deal?.status==='AWAITING_APPROVAL'&&<><label className="checkbox"><input type="checkbox" disabled={dirty} checked={approvalChecked} onChange={e=>setApprovalChecked(e.target.checked)}/>총액·판매자·배송일을 확인했고 이 합의 해시를 승인합니다.</label><div className="actions"><button disabled={busy||!approvalChecked||dirty} onClick={()=>void guarded(approve)}>합의 승인 및 감사 기록</button><button className="secondary" disabled={busy} onClick={()=>void guarded(reject)}>거절</button></div></>}
      </article>}
    </section></div>
    <section><h2>딜별 증거와 모델 사용량</h2>{deal&&<p className="muted">딜 ID: {deal.id}</p>}
      {deal?.chain&&<article><h3>{deal.chain.adapter_mode==='mock'?'모의 감사 기록':'테스트넷 감사 기록'} · {deal.chain.status}</h3><p>결제 영수증이 아닙니다.</p>
        {deal.chain.tx_hash&&<p>chain ID {deal.chain.chain_id} · 계약 {deal.chain.contract}<br/>{deal.chain.explorer_url?<a href={deal.chain.explorer_url} target="_blank" rel="noreferrer">트랜잭션 조회</a>:deal.chain.tx_hash}</p>}
        <details><summary>기록 ID · 해시 · receipt · 이벤트</summary><pre>{JSON.stringify(deal.chain,null,2)}</pre></details>
        {['UNKNOWN','PENDING','SUBMITTING'].includes(deal.chain.status)&&<button disabled={busy} onClick={()=>void guarded(reconcile)}>기존 기록 상태 확인</button>}
      </article>}
      {usage&&<><p>호출 {usage.call_count}회 · 제공된 total tokens {usage.provider_total_tokens ?? '미제공'} · 사용량 미제공 {usage.unavailable_calls}회 · 에너지: 미측정</p>
        <div className="tablewrap"><table><thead><tr><th>단계 / 역할</th><th>모델 / 모드</th><th>prompt</th><th>completion</th><th>total</th><th>지연 / 요청 ID</th></tr></thead><tbody>{usage.calls.map(c=><tr key={c.id}><td>{c.stage} / {c.actor}</td><td>{c.model_id} / {c.adapter_mode}</td><td>{c.prompt_tokens??'미제공'}</td><td>{c.completion_tokens??'미제공'}</td><td>{c.total_tokens??'미제공'}</td><td>{c.latency_ms}ms / {c.request_id??'미제공'} {c.error_code}</td></tr>)}</tbody></table></div><details><summary>단계별 집계</summary><pre>{JSON.stringify(usage.by_stage,null,2)}</pre></details></>}
      {evidence&&<details><summary>협상 · 판정 · 승인 · 체인 감사 이벤트 ({evidence.events.length})</summary><ol>{evidence.events.map(e=><li key={e.id}><strong>{e.event_type}</strong> · v{e.policy_version} · {e.created_at}<pre>{JSON.stringify(e.details,null,2)}</pre></li>)}</ol></details>}
    </section></>}
    <footer>DealBattle · 모든 데모 매물은 simulated입니다. 감사 해시 기록은 상품 결제·인도를 증명하지 않습니다.</footer>
  </main>
}
