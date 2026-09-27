const baseProduct = {
  product_id: 'mouse-001',
  product_version: 1,
  name: 'Pulse Mini 무선 마우스',
  category: 'mouse',
  merchant_id: 'coupang',
  merchant_name: '쿠팡 데모',
  currency: 'KRW',
  price: 42_900,
  shipping_fee: 0,
  delivery_date: '2026-10-01',
  in_stock: true,
  simulated: true,
};

const basePolicy = {
  policy_version: 1,
  query: '저소음 무선 마우스',
  currency: 'KRW',
  max_budget: 50_000,
  allowed_merchants: ['coupang'],
  allowed_categories: ['mouse'],
  delivery_by: '2026-10-02',
  expires_at: '2026-10-01T18:00:00+09:00',
  max_transactions: 1,
  confirmed_at: '2026-09-28T14:03:14+09:00',
  policy_hash: '72b9d70d6211a8fe2be09cbf672acef7',
};

const passedChecks = [
  {
    rule: 'total_amount',
    label: '배송비 포함 총액',
    passed: true,
    expected: '50,000원 이하',
    actual: '42,900원',
    reason_code: null,
  },
  {
    rule: 'merchant',
    label: '허용 판매처',
    passed: true,
    expected: '쿠팡',
    actual: '쿠팡 데모',
    reason_code: null,
  },
  {
    rule: 'delivery',
    label: '배송 기한',
    passed: true,
    expected: '10월 2일까지',
    actual: '10월 1일 도착',
    reason_code: null,
  },
  {
    rule: 'stock',
    label: '재고',
    passed: true,
    expected: '재고 있음',
    actual: '재고 있음',
    reason_code: null,
  },
];

const allowedCandidate = {
  recommendation: {
    recommendation_id: 'rec-demo-001',
    product_id: baseProduct.product_id,
    explanation:
      '요청한 저소음 조건을 충족하면서 예산보다 7,100원 저렴합니다. 허용한 판매처에서 배송 기한보다 하루 먼저 도착하는 후보입니다.',
    source_product_ids: ['mouse-001', 'mouse-004', 'mouse-009'],
  },
  product: baseProduct,
  total_amount: 42_900,
  decision: {
    decision_id: 'decision-demo-001',
    allowed: true,
    checks: passedChecks,
    reason_codes: [],
    evaluated_at: '2026-09-28T14:03:18+09:00',
    policy_version: 1,
  },
};

const blockedCandidate = {
  ...allowedCandidate,
  decision: {
    ...allowedCandidate.decision,
    decision_id: 'decision-demo-002',
    allowed: false,
    checks: [
      {
        rule: 'total_amount',
        label: '배송비 포함 총액',
        passed: false,
        expected: '30,000원 이하',
        actual: '42,900원',
        reason_code: 'BUDGET_EXCEEDED',
      },
      ...passedChecks.slice(1),
    ],
    reason_codes: ['BUDGET_EXCEEDED'],
  },
};

const usage = [
  {
    call_id: 'call-extract-01',
    stage: 'extract',
    stage_label: '조건 추출',
    model: 'Qwen3-32B',
    prompt_tokens: 612,
    completion_tokens: 164,
    total_tokens: 776,
    latency_ms: 1_820,
    attempt: 1,
    usage_source: 'provider',
  },
  {
    call_id: 'call-recommend-01',
    stage: 'recommend',
    stage_label: '후보 추천',
    model: 'Qwen3-32B',
    prompt_tokens: 935,
    completion_tokens: 212,
    total_tokens: 1_147,
    latency_ms: 2_140,
    attempt: 1,
    usage_source: 'provider',
  },
];

const baseView = {
  contract_version: '1',
  policy_draft: null,
  clarification_questions: [],
  selected_recommendation_id: null,
  approval: null,
  purchase: null,
  chain: null,
  created_at: '2026-09-28T14:03:11+09:00',
  updated_at: '2026-09-28T14:03:18+09:00',
};

export const demoScenarios = {
  ready: {
    label: '정상 승인',
    shortLabel: '승인 가능',
    description: '모든 정책을 통과해 사용자의 최종 승인을 기다립니다.',
    requestText:
      '5만원 이하 저소음 무선 마우스를 쿠팡에서 찾아줘. 10월 2일까지 도착해야 해.',
    requestView: {
      ...baseView,
      request_id: 'req-demo-001',
      status: 'AWAITING_APPROVAL',
      policy: basePolicy,
      candidates: [allowedCandidate],
      updated_at: '2026-09-28T14:03:18+09:00',
    },
    usage,
    events: [
      { time: '14:03:11', label: '요청 접수', detail: '자연어 구매 요청을 받았습니다.' },
      { time: '14:03:14', label: '조건 확인', detail: '정책 v1을 사용자가 확인했습니다.' },
      { time: '14:03:18', label: '정책 통과', detail: '4개 검사 항목을 모두 통과했습니다.' },
    ],
  },
  blocked: {
    label: '예산 차단',
    shortLabel: '정책 차단',
    description: 'AI 추천과 별개로 코드 정책이 예산 초과를 차단했습니다.',
    requestText:
      '3만원 이하 저소음 무선 마우스를 쿠팡에서 찾아줘. 10월 2일까지 도착해야 해.',
    requestView: {
      ...baseView,
      request_id: 'req-demo-002',
      status: 'BLOCKED',
      policy: { ...basePolicy, max_budget: 30_000, policy_hash: 'cb1184982311b22ae809be18a86b738e' },
      candidates: [blockedCandidate],
      updated_at: '2026-09-28T14:05:24+09:00',
    },
    usage,
    events: [
      { time: '14:05:18', label: '요청 접수', detail: '예산 30,000원 요청을 받았습니다.' },
      { time: '14:05:21', label: 'AI 추천', detail: 'Qwen3-32B가 후보를 비교했습니다.' },
      { time: '14:05:24', label: '구매 차단', detail: 'BUDGET_EXCEEDED 규칙이 실행을 중단했습니다.' },
    ],
  },
  clarification: {
    label: '추가 질문',
    shortLabel: '정보 필요',
    description: '구매 조건이 부족해 AI가 실행 전에 확인을 요청했습니다.',
    requestText: '업무용 무선 마우스 하나 찾아줘.',
    requestView: {
      ...baseView,
      request_id: 'req-demo-003',
      status: 'NEEDS_CLARIFICATION',
      policy_draft: {
        query: '업무용 무선 마우스',
        max_budget: null,
        allowed_merchants: null,
        allowed_categories: ['mouse'],
        delivery_by: null,
        expires_at: null,
        currency: 'KRW',
        max_transactions: 1,
      },
      clarification_questions: [
        '배송비를 포함한 최대 예산은 얼마인가요?',
        '허용할 판매처와 원하는 배송 기한을 알려주세요.',
      ],
      policy: null,
      candidates: [],
      updated_at: '2026-09-28T14:07:12+09:00',
    },
    usage: [usage[0]],
    events: [
      { time: '14:07:10', label: '요청 접수', detail: '자연어 구매 요청을 받았습니다.' },
      { time: '14:07:12', label: '추가 확인', detail: '필수 조건 3개가 아직 확정되지 않았습니다.' },
    ],
  },
  pending: {
    label: '체인 대기',
    shortLabel: '기록 대기',
    description: '모의 구매는 완료됐고 테스트넷 감사 기록을 기다립니다.',
    requestText:
      '5만원 이하 저소음 무선 마우스를 쿠팡에서 찾아줘. 10월 2일까지 도착해야 해.',
    requestView: {
      ...baseView,
      request_id: 'req-demo-001',
      status: 'PURCHASE_SIMULATED',
      policy: basePolicy,
      candidates: [allowedCandidate],
      selected_recommendation_id: 'rec-demo-001',
      approval: {
        approval_id: 'approval-demo-001',
        total_amount: 42_900,
        expires_at: '2026-10-01T18:00:00+09:00',
      },
      purchase: {
        purchase_id: 'purchase-demo-001',
        total_amount: 42_900,
        simulated: true,
        executed_at: '2026-09-28T14:09:32+09:00',
      },
      chain: {
        record_id: 'chain-demo-001',
        audit_hash: 'b78b1f24f9163b5d6d579ce7724d93e0',
        network: 'Testnet 미정',
        chain_id: null,
        tx_hash: null,
        status: 'PENDING',
        block_number: null,
        adapter_mode: 'mock',
      },
      updated_at: '2026-09-28T14:09:33+09:00',
    },
    usage,
    events: [
      { time: '14:03:18', label: '정책 통과', detail: '4개 검사 항목을 모두 통과했습니다.' },
      { time: '14:09:32', label: '모의 구매 완료', detail: '실제 결제 없이 모의 영수증을 생성했습니다.' },
      { time: '14:09:33', label: '체인 기록 대기', detail: '감사 해시 제출 작업이 대기 중입니다.' },
    ],
  },
} as const;

export type DemoScenarioKey = keyof typeof demoScenarios;
export type DemoScenario = (typeof demoScenarios)[DemoScenarioKey];
