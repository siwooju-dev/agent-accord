import { FormEvent, useMemo, useState } from 'react';
import { mockClient } from './api/mockClient';
import {
  demoScenarios,
  type DemoScenario,
  type DemoScenarioKey,
} from './mocks/scenarios';

const formatWon = (value: number) => `${new Intl.NumberFormat('ko-KR').format(value)}원`;

const statusLabels: Record<string, string> = {
  AWAITING_APPROVAL: '최종 승인 대기',
  BLOCKED: '정책 차단',
  NEEDS_CLARIFICATION: '추가 정보 필요',
  PURCHASE_SIMULATED: '모의 구매 완료',
};

const reasonLabels: Record<string, string> = {
  BUDGET_EXCEEDED: '예산 초과',
  MERCHANT_NOT_ALLOWED: '허용되지 않은 판매처',
  DELIVERY_TOO_LATE: '배송 기한 초과',
  OUT_OF_STOCK: '재고 없음',
};

const scenarioOptions: Array<{
  key: DemoScenarioKey;
  label: string;
  hint: string;
}> = [
  { key: 'ready', label: '정상 승인', hint: '모든 규칙 통과' },
  { key: 'blocked', label: '예산 차단', hint: '코드 정책 차단' },
  { key: 'clarification', label: '추가 질문', hint: '조건 보완 필요' },
  { key: 'pending', label: '체인 대기', hint: '구매와 기록 분리' },
];

function App() {
  const [scenarioKey, setScenarioKey] = useState<DemoScenarioKey>('ready');
  const [scenario, setScenario] = useState<DemoScenario>(demoScenarios.ready);
  const [requestText, setRequestText] = useState<string>(demoScenarios.ready.requestText);
  const [budget, setBudget] = useState('50000');
  const [clarification, setClarification] = useState('예산 5만원, 쿠팡, 10월 2일까지');
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const view = scenario.requestView;
  const candidate = view.candidates[0];
  const policy = view.policy;
  const totalTokens = useMemo(
    () =>
      Array.from(scenario.usage)
        .map((item) => item.total_tokens ?? 0)
        .reduce((total, tokens) => total + tokens, 0),
    [scenario.usage],
  );

  async function activateScenario(nextKey: DemoScenarioKey) {
    setIsLoading(true);
    setNotice(null);
    const next = await mockClient.loadScenario(nextKey);
    setScenarioKey(nextKey);
    setScenario(next);
    setRequestText(next.requestText);
    setBudget(String(next.requestView.policy?.max_budget ?? 50_000));
    setIsLoading(false);
  }

  async function handleRequestSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requestText.trim()) {
      setNotice('구매 요청을 입력해 주세요.');
      return;
    }
    await activateScenario('ready');
    setNotice('Mock 응답을 불러왔습니다. 실제 API는 Backend B0 이후 연결됩니다.');
  }

  async function handlePolicySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedBudget = Number(budget);
    if (!Number.isFinite(parsedBudget) || parsedBudget <= 0) {
      setNotice('예산은 0보다 큰 숫자로 입력해 주세요.');
      return;
    }
    await activateScenario(parsedBudget < 42_900 ? 'blocked' : 'ready');
    setNotice(
      parsedBudget < 42_900
        ? '변경된 예산으로 정책을 다시 검사했습니다.'
        : '조건을 확인하고 추천 후보를 다시 평가했습니다.',
    );
  }

  async function handleClarificationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clarification.trim()) return;
    await activateScenario('ready');
    setNotice('추가 답변을 반영한 Mock 조건을 만들었습니다.');
  }

  async function handleApproval() {
    await activateScenario('pending');
    setNotice('모의 구매를 승인했습니다. 실제 결제는 발생하지 않았습니다.');
  }

  const currentStep =
    view.status === 'NEEDS_CLARIFICATION'
      ? 1
      : view.status === 'AWAITING_APPROVAL' || view.status === 'BLOCKED'
        ? 3
        : 5;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#main" aria-label="PolicyGuard 홈">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span>
            <strong>PolicyGuard</strong>
            <small>controlled AI commerce</small>
          </span>
        </a>
        <div className="topbar-meta">
          <span className="model-pill"><i /> Qwen3-32B · Kiln</span>
          <span className="mock-pill">Mock 환경</span>
        </div>
      </header>

      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div>
            <p className="eyebrow">AI가 추천하고, 정책이 지킵니다</p>
            <h1 id="hero-title">
              맡겨도 되는 구매,
              <br />증명할 수 있는 결정.
            </h1>
            <p className="hero-copy">
              자연어 요청부터 정책 검사, 사용자 승인, 온체인 감사 기록까지
              하나의 흐름으로 확인하세요.
            </p>
          </div>
          <div className="hero-proof" aria-label="서비스 핵심 지표">
            <div>
              <strong>2-layer</strong>
              <span>AI 판단 + 코드 정책</span>
            </div>
            <div>
              <strong>1 trace</strong>
              <span>요청부터 TX까지</span>
            </div>
            <div>
              <strong>0 blind</strong>
              <span>모든 결정 근거 표시</span>
            </div>
          </div>
        </section>

        <section className="demo-switcher" aria-label="데모 상태 선택">
          <div className="switcher-heading">
            <span className="live-dot" />
            <div>
              <strong>심사 데모 콘솔</strong>
              <span>상태를 전환해 핵심 흐름을 비교하세요</span>
            </div>
          </div>
          <div className="scenario-tabs" role="group" aria-label="데모 시나리오">
            {scenarioOptions.map((option) => (
              <button
                className={scenarioKey === option.key ? 'scenario-tab active' : 'scenario-tab'}
                disabled={isLoading}
                key={option.key}
                onClick={() => void activateScenario(option.key)}
                type="button"
              >
                <span>{option.label}</span>
                <small>{option.hint}</small>
              </button>
            ))}
          </div>
        </section>

        {notice && (
          <div className="notice" role="status">
            <span aria-hidden="true">i</span>
            {notice}
            <button onClick={() => setNotice(null)} type="button" aria-label="알림 닫기">×</button>
          </div>
        )}

        <div className="workspace">
          <aside className="flow-panel" aria-label="구매 진행 단계">
            <div className="flow-title">
              <span>FLOW</span>
              <strong>구매 진행 상황</strong>
            </div>
            <ol className="steps">
              {[
                ['요청 이해', '자연어 조건 추출'],
                ['조건 확인', '사용자 정책 확정'],
                ['후보 검증', 'AI 추천 · 코드 검사'],
                ['최종 승인', '사용자 명시적 승인'],
                ['증거 기록', '영수증 · 테스트넷'],
              ].map(([title, description], index) => {
                const number = index + 1;
                const state = number < currentStep ? 'done' : number === currentStep ? 'active' : '';
                return (
                  <li className={state} key={title}>
                    <span className="step-number">{number < currentStep ? '✓' : number}</span>
                    <div>
                      <strong>{title}</strong>
                      <small>{description}</small>
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="flow-footnote">
              <span className="mini-shield" aria-hidden="true">✓</span>
              <p><strong>안전 원칙</strong>AI는 지갑 키와 승인 권한에 접근하지 않습니다.</p>
            </div>
          </aside>

          <div className={isLoading ? 'content-stack is-loading' : 'content-stack'} aria-busy={isLoading}>
            <section className="card request-card" aria-labelledby="request-title">
              <div className="card-heading">
                <div>
                  <span className="section-index">01</span>
                  <div>
                    <h2 id="request-title">무엇을 찾아드릴까요?</h2>
                    <p>예산, 판매처, 배송 조건을 자연스럽게 적어주세요.</p>
                  </div>
                </div>
                <span className="data-tag">SIMULATED PRODUCTS</span>
              </div>
              <form onSubmit={handleRequestSubmit}>
                <label className="sr-only" htmlFor="purchase-request">구매 요청</label>
                <div className="request-input-wrap">
                  <textarea
                    id="purchase-request"
                    value={requestText}
                    onChange={(event) => setRequestText(event.target.value)}
                    rows={3}
                  />
                  <button className="send-button" disabled={isLoading} type="submit">
                    {isLoading ? '분석 중…' : '조건 분석'} <span aria-hidden="true">→</span>
                  </button>
                </div>
              </form>
              <div className="request-meta">
                <span><b>요청 ID</b>{view.request_id}</span>
                <span><b>현재 상태</b>{statusLabels[view.status]}</span>
                <span><b>데이터</b>가상 상품 · 실제 결제 없음</span>
              </div>
            </section>

            {view.status === 'NEEDS_CLARIFICATION' ? (
              <section className="card clarification-card" aria-labelledby="clarification-title">
                <div className="clarification-icon" aria-hidden="true">?</div>
                <div>
                  <p className="eyebrow">실행 전 확인</p>
                  <h2 id="clarification-title">추가 정보가 필요해요</h2>
                  <ul>
                    {view.clarification_questions.map((question) => <li key={question}>{question}</li>)}
                  </ul>
                  <form className="inline-form" onSubmit={handleClarificationSubmit}>
                    <label htmlFor="clarification-answer">추가 답변</label>
                    <div>
                      <input
                        id="clarification-answer"
                        value={clarification}
                        onChange={(event) => setClarification(event.target.value)}
                      />
                      <button className="primary-button" type="submit">답변 반영</button>
                    </div>
                  </form>
                </div>
              </section>
            ) : (
              <>
                {policy && (
                  <section className="card" aria-labelledby="policy-title">
                    <div className="card-heading compact">
                      <div>
                        <span className="section-index">02</span>
                        <div>
                          <h2 id="policy-title">구매 조건 확인</h2>
                          <p>AI가 해석한 조건을 확인한 뒤 정책으로 확정합니다.</p>
                        </div>
                      </div>
                      <span className="version-badge">Policy v{policy.policy_version}</span>
                    </div>
                    <form className="policy-form" onSubmit={handlePolicySubmit}>
                      <label>
                        <span>찾는 상품</span>
                        <input defaultValue={policy.query} />
                      </label>
                      <label>
                        <span>최대 예산 <small>배송비 포함</small></span>
                        <div className="amount-input">
                          <input
                            inputMode="numeric"
                            value={budget}
                            onChange={(event) => setBudget(event.target.value)}
                          />
                          <i>원</i>
                        </div>
                      </label>
                      <label>
                        <span>허용 판매처</span>
                        <input defaultValue="쿠팡" />
                      </label>
                      <label>
                        <span>배송 기한 <small>Asia/Seoul</small></span>
                        <input defaultValue="2026-10-02" type="date" />
                      </label>
                      <div className="policy-summary">
                        <span>수량 <strong>1개</strong></span>
                        <span>승인 만료 <strong>10월 1일 18:00</strong></span>
                        <span>카테고리 <strong>마우스</strong></span>
                      </div>
                      <button className="secondary-button" type="submit">조건 확인 · 다시 검사</button>
                    </form>
                  </section>
                )}

                {candidate && (
                  <section className="card" aria-labelledby="candidate-title">
                    <div className="card-heading compact">
                      <div>
                        <span className="section-index">03</span>
                        <div>
                          <h2 id="candidate-title">추천 후보와 정책 검사</h2>
                          <p>AI의 추천과 코드의 허용 판단을 분리해 보여줍니다.</p>
                        </div>
                      </div>
                      <span className={candidate.decision.allowed ? 'decision-badge pass' : 'decision-badge blocked'}>
                        {candidate.decision.allowed ? '✓ 정책 검사 통과' : '× 정책에 의해 차단'}
                      </span>
                    </div>

                    <div className="candidate-grid">
                      <article className="product-card">
                        <div className="product-visual" aria-label="상품 이미지 자리">
                          <span className="mouse-shape" aria-hidden="true"><i /></span>
                          <em>DEMO PRODUCT</em>
                        </div>
                        <div className="product-copy">
                          <span className="merchant">{candidate.product.merchant_name}</span>
                          <h3>{candidate.product.name}</h3>
                          <p>저소음 클릭 · Bluetooth 5.2 · 68g</p>
                          <div className="price-row">
                            <strong>{formatWon(candidate.total_amount)}</strong>
                            <span>배송비 무료</span>
                          </div>
                          <dl>
                            <div><dt>도착 예정</dt><dd>10월 1일</dd></div>
                            <div><dt>재고</dt><dd className="positive">있음</dd></div>
                          </dl>
                        </div>
                      </article>

                      <div className="evaluation">
                        <div className="ai-note">
                          <div className="note-label"><span>AI</span> Qwen3-32B 추천 근거</div>
                          <p>{candidate.recommendation.explanation}</p>
                        </div>
                        <div className="checks">
                          <div className="note-label"><span className="code-label">&lt;/&gt;</span> 코드 정책 검사</div>
                          {candidate.decision.checks.map((check) => (
                            <div className={check.passed ? 'check-row' : 'check-row failed'} key={check.rule}>
                              <span className="check-icon" aria-hidden="true">{check.passed ? '✓' : '!'}</span>
                              <div>
                                <strong>{check.label}</strong>
                                <small>{check.actual} <i>/ 기준 {check.expected}</i></small>
                              </div>
                              <b>{check.passed ? '통과' : reasonLabels[check.reason_code ?? '']}</b>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {!candidate.decision.allowed && (
                      <div className="blocked-message" role="alert">
                        <span aria-hidden="true">!</span>
                        <div>
                          <strong>구매를 실행하지 않았습니다</strong>
                          <p>총액이 설정한 예산을 12,900원 초과했습니다. 예산이나 상품 조건을 수정해 주세요.</p>
                        </div>
                      </div>
                    )}

                    {candidate.decision.allowed && view.status === 'AWAITING_APPROVAL' && (
                      <div className="approval-bar">
                        <div>
                          <span>최종 승인 금액</span>
                          <strong>{formatWon(candidate.total_amount)}</strong>
                          <small>Policy v{policy?.policy_version} · 승인 전 서버에서 다시 검사</small>
                        </div>
                        <div className="approval-actions">
                          <button
                            className="ghost-button"
                            onClick={() => setNotice('요청을 거절했습니다. Mock 상태는 저장되지 않습니다.')}
                            type="button"
                          >
                            거절
                          </button>
                          <button className="primary-button" onClick={() => void handleApproval()} type="button">
                            모의 구매 승인 <span aria-hidden="true">→</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </section>
                )}

                {view.purchase && (
                  <section className="card result-card" aria-labelledby="result-title">
                    <div className="card-heading compact">
                      <div>
                        <span className="section-index">04</span>
                        <div>
                          <h2 id="result-title">실행 결과와 감사 기록</h2>
                          <p>모의 구매 결과와 블록체인 기록 상태는 별도로 관리됩니다.</p>
                        </div>
                      </div>
                    </div>
                    <div className="result-grid">
                      <article className="receipt-panel">
                        <span className="result-kicker success">✓ SIMULATED PURCHASE</span>
                        <h3>모의 구매 완료</h3>
                        <strong>{formatWon(view.purchase.total_amount)}</strong>
                        <p>실제 카드 결제나 쇼핑몰 주문은 발생하지 않았습니다.</p>
                        <small>{view.purchase.purchase_id}</small>
                      </article>
                      <article className="chain-panel">
                        <span className="result-kicker pending">● ON-CHAIN AUDIT</span>
                        <h3>체인 기록 대기</h3>
                        <p>구매는 완료됐지만 감사 기록은 아직 확인되지 않았습니다.</p>
                        <dl>
                          <div><dt>네트워크</dt><dd>{view.chain?.network}</dd></div>
                          <div><dt>Adapter</dt><dd>{view.chain?.adapter_mode.toUpperCase()}</dd></div>
                          <div><dt>TX Hash</dt><dd>아직 발급되지 않음</dd></div>
                        </dl>
                      </article>
                    </div>
                  </section>
                )}
              </>
            )}
          </div>

          <aside className="evidence-panel" aria-label="검증 정보">
            <section>
              <div className="evidence-heading">
                <span>TRACE</span>
                <strong>검증 가능한 기록</strong>
              </div>
              <div className="trace-id">
                <span>REQUEST ID</span>
                <code>{view.request_id}</code>
              </div>
              <div className="status-card">
                <span className={`status-orb ${scenarioKey}`} />
                <div>
                  <small>CURRENT STATUS</small>
                  <strong>{scenario.shortLabel}</strong>
                </div>
              </div>
              <p className="status-description">{scenario.description}</p>
            </section>

            <section className="usage-section">
              <div className="evidence-heading inline">
                <strong>AI 사용량</strong>
                <span>PROVIDER</span>
              </div>
              <div className="token-total">
                <span>Flow 총 토큰</span>
                <strong>{new Intl.NumberFormat('ko-KR').format(totalTokens)}</strong>
              </div>
              {scenario.usage.map((item) => (
                <div className="usage-row" key={item.call_id}>
                  <div>
                    <strong>{item.stage_label}</strong>
                    <small>{item.model} · 시도 {item.attempt}회</small>
                  </div>
                  <div>
                    <strong>{item.total_tokens?.toLocaleString('ko-KR') ?? '미제공'}</strong>
                    <small>{(item.latency_ms / 1000).toFixed(2)}s</small>
                  </div>
                </div>
              ))}
              <p className="efficiency-note"><span>↘</span>후보 수 제한과 구조화 응답으로 불필요한 추론을 줄입니다.</p>
            </section>

            <section>
              <div className="evidence-heading inline">
                <strong>결정 타임라인</strong>
                <span>{scenario.events.length} EVENTS</span>
              </div>
              <ol className="timeline">
                {scenario.events.map((event, index) => (
                  <li key={`${event.time}-${event.label}`}>
                    <i className={index === scenario.events.length - 1 ? 'current' : ''} />
                    <div>
                      <time>{event.time}</time>
                      <strong>{event.label}</strong>
                      <p>{event.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </aside>
        </div>
      </main>

      <footer>
        <span>PolicyGuard AI · GWDC 2026</span>
        <p>이 화면은 개발용 Mock입니다. 상품·구매는 가상이며 실제 온체인 증거가 아닙니다.</p>
      </footer>
    </div>
  );
}

export default App;
