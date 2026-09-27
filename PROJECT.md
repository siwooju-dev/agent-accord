# PolicyGuard AI Agent

> 사용자가 정한 조건 안에서 상품을 추천하고, 승인받은 모의 구매와 그 증거를 테스트넷에 기록하는 AI 구매 에이전트.

## 개발 에이전트가 읽을 순서

[README.md](README.md) → [AGENTS.md](AGENTS.md) → [CONTRACTS.md](CONTRACTS.md) → 자기 역할 문서 순서로 읽는다. 이 문서는 전체 설명이며 타입·API·소유권·기술 기본값은 CONTRACTS와 AGENTS가 구체화한다. 아직 앱 코드는 없고, Backend B0에서 공유 코드 기반을 먼저 만든다. 역할별 첫 단계는 B0/F0/P0/D0다.

## 1. 프로젝트 목적과 문서 기준

FuriosaAI Challenge A 해커톤을 위한 4인 팀 MVP 설계 문서다. AI에게 구매 업무를 맡겼을 때 의도를 잘못 이해하거나 허용 범위를 벗어나는 문제를 다룬다. Qwen3-32B는 자연어 해석과 추천을 담당하고, 일반 코드로 만든 Policy Engine이 실행 조건을 강제한다. 사용자는 조건과 최종 구매를 각각 확인한다.

- 모델: **Qwen3-32B**, Kiln API를 통해 호출. 사용자가 전달한 최신 모델 변경사항을 반영했다.
- 작성 근거: 기존 프로젝트 대화와 이번 사용자 요청. 공식 PDF 원문과 최신 운영진 공지를 직접 재검증한 문서는 아니다.
- 아래 API, 데이터 형식, 일정, 테스트넷 방식은 **팀 구현 제안**이다. 이미 구현되었다는 뜻이 아니다.
- 착수 시 운영진의 실제 API 주소, 인증 방식, 모델 식별자, 토큰 사용량 제공 방식, 허용 테스트넷과 제출 규정을 확인한다. 모의 구매·온체인 기록 방식의 과제 인정 여부도 확인한다.

## 2. 무엇을 만드는가

사용자가 “5만원 이하 무선 마우스를 쿠팡에서 찾아줘. 10월 2일까지 도착해야 해”라고 입력한다. AI가 구조화된 조건을 만들고, 사용자가 확인하면 가상 상품 데이터에서 후보를 검색한다. AI 추천을 받은 뒤에도 서버가 예산·판매처·카테고리·기한을 검사한다. 통과한 후보만 사용자가 승인할 수 있고, 승인 후 서버가 다시 검사해 모의 구매를 실행한다. 마지막으로 실제 테스트넷 트랜잭션에 감사 기록의 해시를 남긴다.

**가치:** 추천 이유뿐 아니라 “어떤 조건에서 허용됐고 실제로 무엇이 실행됐는가”를 추적할 수 있다.

### MVP 범위

| 포함 | 설명 |
|---|---|
| 자연어 조건 추출 | 누락·모호한 조건은 추가 질문하고 사용자 확인을 받는다 |
| 상품 검색·추천 | 20~50개 simulated product data에서 검색하고 근거를 설명한다 |
| 결정적 정책 검사 | 같은 데이터와 조건에 같은 결과를 내는 코드로 허용·차단한다 |
| 명시적 사용자 승인 | 상품·최종 금액·정책 버전에 연결된 승인만 인정한다 |
| 모의 구매 | 실제 쇼핑몰 주문·카드 결제 없이 모의 영수증을 생성한다 |
| 실제 테스트넷 기록 | 모의 구매 결과의 해시를 기록하고 receipt와 TX hash를 확인한다 |
| 관측·검증 | 요청별 로그, 정책 사유, 호출별 토큰·지연시간을 표시한다 |

실제 돈, 실제 쇼핑몰 주문, 크롤링, 모델 학습, 복잡한 자산운용은 MVP에서 제외한다. 쇼핑몰 이름과 가격은 데모 데이터이며 실제 판매·제휴를 의미하지 않는다.

## 3. 시스템 구조

```text
Frontend → FastAPI → Kiln API → Qwen3-32B
              │          자연어 해석 / 후보 추천 / 설명
              ├→ Product Repository: 가상 상품 조회
              ├→ Policy Engine: 조건 검사 및 실행 차단
              ├→ 사용자 최종 승인 + 실행 직전 재검사
              ├→ Purchase Simulator: 모의 구매, 중복 방지
              ├→ Audit Store: 조건·승인·결과 원문 저장
              └→ Blockchain Adapter → Testnet: 감사 기록 해시
```

4명은 하나의 저장소에서 모듈별로 개발한다. MVP에서는 별도 마이크로서비스로 나누지 않고 FastAPI 내부 인터페이스로 통합해 배포 부담을 줄인다. 프론트엔드는 HTTP API로 연결한다.

| 구성 | 역할 | 하지 않는 일 |
|---|---|---|
| Qwen3-32B / Kiln | 조건 초안 추출, 제공된 후보 비교, 근거 작성 | 승인 여부 확정, 가격 창작, 지갑 키 접근 |
| FastAPI | 세션·상태·DB·모듈 호출·승인 검증 | 클라이언트의 가격·통과 여부 신뢰 |
| Policy Engine | 서버 데이터로 모든 제한 검사 | LLM의 “구매 가능” 문장을 승인으로 사용 |
| Purchase Simulator | 정확히 한 번의 논리적 모의 주문 생성 | 실제 결제 |
| Blockchain Adapter | 기록 제출, receipt 조회, 해시 대조 | 오프체인 판단의 진실성을 자동 보증 |

온체인 해시는 보관된 기록의 변경 여부를 검증하는 수단이다. 잘못된 원본 데이터의 정확성이나 정책 실행 자체를 자동으로 증명하지는 않는다. 원본 감사 기록도 함께 보존해야 한다.

## 4. 사용자 흐름과 상태

1. 구매 요청 입력 → 부족한 정보 추가 질문.
2. 추출된 조건 확인·수정 → 확인된 정책 버전 저장.
3. 상품 후보 조회 → AI 추천 → 모든 후보 정책 검사.
4. 통과 후보와 검사 결과 표시 → 사용자 최종 승인 또는 거절.
5. 승인 대상의 정책·상품·총액 스냅샷 일치 확인 → 최신 정보 재검사.
6. 모의 구매 실행 → 영수증·감사 기록 저장.
7. 테스트넷 제출 → receipt 확인 → TX 링크 및 사용량 표시.

요청 상태: `DRAFT → NEEDS_CLARIFICATION 또는 AWAITING_POLICY_CONFIRMATION → EVALUATING → AWAITING_APPROVAL 또는 BLOCKED → EXECUTING → PURCHASE_SIMULATED`.
사용자 거절은 `REJECTED`, 실행 전 만료는 `EXPIRED`, 복구 불가 오류는 `FAILED`로 기록한다. 재질문 응답은 다시 추출·확인 단계로 간다.

체인 상태는 별도 필드로 `NOT_SUBMITTED / PENDING / CONFIRMED / FAILED / UNKNOWN`을 사용한다. 모의 구매 완료 후 체인 기록이 실패해도 구매를 다시 실행하지 않는다. `UNKNOWN`이면 먼저 기존 트랜잭션을 조회한다. 전체 완료 표시는 모의 구매 성공과 체인 확인이 모두 끝난 경우에만 한다.

## 5. 공유 데이터 계약 v1

금액은 KRW 정수이며 수량은 MVP에서 1개다. 총액은 상품 금액 + 배송비이며 예산에 모두 포함한다. 배송 기한과 구매 승인 유효기간은 서로 다른 필드다. 날짜만 있는 배송 기한은 Asia/Seoul 현지 날짜로 비교하고, 시각은 UTC offset을 포함한 ISO 8601로 저장한다. 상대 날짜는 요청 시각을 기준으로 변환한 뒤 사용자에게 표시한다.

```json
{
  "request_id": "req-demo-001",
  "policy": {
    "policy_version": 1,
    "query": "무선 마우스",
    "currency": "KRW",
    "max_budget": 50000,
    "allowed_merchants": ["coupang"],
    "allowed_categories": ["mouse"],
    "delivery_by": "2026-10-02",
    "expires_at": "2026-10-01T18:00:00+09:00",
    "max_transactions": 1
  },
  "product": {
    "product_id": "mouse-001",
    "product_version": 1,
    "name": "Demo Wireless Mouse A",
    "category": "mouse",
    "merchant_id": "coupang",
    "currency": "KRW",
    "price": 42900,
    "shipping_fee": 0,
    "delivery_date": "2026-10-01",
    "in_stock": true,
    "simulated": true
  }
}
```

위 날짜는 고정 예시다. 실시간 데모에서는 미래 날짜로 fixture를 갱신하고 기준 시각을 기록한다.

| 객체 | 핵심 필드 |
|---|---|
| PurchaseRequest | request_id, session_id, user_text, created_at, status |
| Policy | 위 예시 필드, confirmed_at, policy_hash |
| Recommendation | recommendation_id, product_id, explanation, source_product_ids |
| PolicyDecision | decision_id, allowed, checks[], reason_codes[], evaluated_at, policy_version |
| Approval | approval_id, request_id, policy_hash, product_snapshot_hash, total_amount, approved_at, expires_at |
| SimulatedReceipt | purchase_id, request_id, idempotency_key, total_amount, simulated=true, executed_at |
| ChainRecord | record_id, audit_hash, network, chain_id, tx_hash, status, block_number |
| UsageLog | request_id, call_id, stage, model, prompt_tokens, completion_tokens, total_tokens, latency_ms, attempt, usage_source |

`checks[]`에는 `rule`, `passed`, `expected`, `actual`, `reason_code`를 넣는다. 사용자 화면은 구조화된 검사 결과를 기준으로 표시한다. 토큰 수가 제공되지 않으면 null과 사유를 기록하고, 추정값은 실측과 별도 표기한다.

### 정책 규칙

- 총액 ≤ max_budget, 허용 판매처·카테고리, 배송일 ≤ delivery_by, 현재 시각 < expires_at.
- 재고 존재, KRW 일치, 양의 상품 가격·음수가 아닌 배송비, 필수 필드 유효성을 검사한다.
- max_transactions=1은 요청별 성공 모의 구매 횟수 제한이다. 동시 실행에는 DB 잠금/고유 제약으로 중복을 막는다.
- 누락·파싱 실패·검사 오류는 허용하지 않는다. 정책 수정이나 가격·상품 변경 시 기존 승인을 무효화한다.
- 사유 코드: `BUDGET_EXCEEDED`, `MERCHANT_NOT_ALLOWED`, `CATEGORY_NOT_ALLOWED`, `DELIVERY_TOO_LATE`, `POLICY_EXPIRED`, `OUT_OF_STOCK`, `TRANSACTION_LIMIT`, `INVALID_DATA`, `APPROVAL_STALE`.

## 6. API 및 모듈 연결 제안

아래 경로는 우리 FastAPI의 제안이며 Kiln 공식 엔드포인트가 아니다.

| Method / Path | 동작 |
|---|---|
| POST /requests | 자연어 요청 등록, 조건 추출 또는 추가 질문 반환 |
| POST /requests/{id}/clarifications | 추가 답변 반영, 재추출 |
| PUT /requests/{id}/policy | 사용자가 수정·확인한 정책 저장, 버전 증가 |
| POST /requests/{id}/recommendations | 후보 조회·추천·정책 검사 |
| POST /requests/{id}/approve | recommendation_id와 기대 정책 버전 검증, 승인 저장 후 재검사·모의 구매 시작 |
| POST /requests/{id}/reject | 사용자 거절 처리 |
| GET /requests/{id} | 상태·후보·검사·영수증·체인 상태 조회 |
| GET /requests/{id}/logs | 요청 로그와 호출별 usage 조회 |

approve는 `Idempotency-Key`를 받는다. 같은 키와 같은 본문은 같은 결과를 반환하고, 같은 키에 다른 본문은 409로 거절한다. 다른 키로 재호출해도 요청별 구매 고유 제약을 적용한다. 서버가 세션 소유권과 상태 전이를 확인하며 버튼 비활성화만으로 보안을 대신하지 않는다.

오류 응답 공통 형태: `{ "error": { "code": "APPROVAL_STALE", "message": "조건이 변경되었습니다. 다시 확인해주세요." }, "request_id": "req-demo-001" }`.
정책 차단은 정상적인 업무 결과로 반환하고, 인증/소유권 오류·상태 충돌·입력 오류·외부 서비스 장애와 구분한다.

내부 인터페이스의 정확한 인수·반환형은 [CONTRACTS.md](CONTRACTS.md) 5절을 따른다. HTTP API에는 `/api/v1` 접두사를 붙이며 공통 응답은 RequestView다.

## 7. 역할과 개발 순서

| 담당 | 책임 | 체크리스트 |
|---|---|---|
| 1. Backend / Agent | FastAPI, Kiln/Qwen, 상태·승인·실행 조정 | [ROLE_BACKEND_AGENT.md](ROLE_BACKEND_AGENT.md) |
| 2. Frontend | 요청·조건 확인·추천·승인·이력 화면 | [ROLE_FRONTEND.md](ROLE_FRONTEND.md) |
| 3. Policy / Blockchain | 정책 검사, 테스트넷 감사 기록, receipt | [ROLE_POLICY_BLOCKCHAIN.md](ROLE_POLICY_BLOCKCHAIN.md) |
| 4. Data / Integration / QA | 상품·모의 구매 모듈, E2E, 계측·데모 검증 | [ROLE_DATA_INTEGRATION_QA.md](ROLE_DATA_INTEGRATION_QA.md) |

Day 1: 전원이 데이터 계약·상태·사유 코드를 합의한다. Backend는 API와 Kiln 호출, Frontend는 mock 화면, Policy 담당은 검사 함수와 testnet 연결, Data 담당은 fixture와 simulator를 만든다.

Day 2: 조건 확인부터 모의 구매까지 한 흐름을 연결하고 실제 테스트넷 기록을 붙인다. 정상·차단 시나리오, 동시 승인, 외부 장애를 검증한다.

Day 3 또는 마지막 반나절: 새 기능을 멈추고 실측 로그·TX 증거·재현 절차를 정리하고 발표를 반복한다. 2일 일정이면 Day 3 작업을 Day 2 후반에 배치한다.

## 8. 데모 및 완료 기준

같은 42,900원 상품과 동일 기준 시각으로 두 요청을 실행한다. A는 예산 50,000원으로 통과·사용자 승인·모의 구매·테스트넷 기록을 보여준다. B는 예산 30,000원으로 바꿔 `BUDGET_EXCEEDED`와 구매 미실행을 보여준다. 두 요청 ID와 정책 차이를 함께 보존한다.

- [ ] 실제 Kiln/Qwen3-32B 호출이 조건 추출과 추천에 사용된다.
- [ ] 누락된 조건은 질문하고 사용자 확인 전에 실행하지 않는다.
- [ ] 예산·판매처·카테고리·배송·유효기간 위반을 각각 차단한다.
- [ ] 최종 승인 없이 실행되지 않으며 반복·동시 승인에도 구매는 1회다.
- [ ] 정상 모의 구매에 대응하는 실제 testnet TX hash와 성공 receipt가 있다.
- [ ] 온체인 해시와 로컬 감사 원문의 해시가 일치한다.
- [ ] UI에 simulated product/purchase와 실제 testnet 기록을 구분해서 표시한다.
- [ ] 요청 ID로 AI 호출·정책 판단·승인·영수증·TX를 연결할 수 있다.
- [ ] 호출별 토큰·지연시간·재시도와 전체 합계를 제시한다.
- [ ] 새 팀원이 설정 예시와 실행 절차로 데모를 재현한다.

토큰 감소나 지연시간 개선은 같은 입력·조건에서 전후를 측정한다. 에너지 계측이 없다면 전력 절감 수치를 만들어내지 않고 측정 불가를 명시한다. 반복 호출 줄이기, 후보 수 제한, 짧은 구조화 응답 등의 추론 효율 개선을 근거와 함께 설명한다.

## 9. 실행 환경과 제출물

권장 구성은 Python/FastAPI, 프론트엔드 React 계열, SQLite 또는 PostgreSQL, JSON fixture다. 버전은 구현 시작 시 팀이 고정한다. 체인은 운영진 허용 범위를 확인한 뒤 선택하며 `network`, `chain_id`, RPC, explorer, 확인 기준을 명시한다.

설정 항목: `KILN_BASE_URL`, `KILN_API_KEY`, `KILN_MODEL`, `DATABASE_URL`, `CHAIN_RPC_URL`, `CHAIN_ID`, `AUDIT_CONTRACT_ADDRESS`, `TESTNET_PRIVATE_KEY`. 모델의 표시명은 Qwen3-32B이며 `KILN_MODEL`에는 운영진이 제공한 정확한 식별자를 사용한다. 실제 비밀값은 저장소에 올리지 않고 `.env.example`에는 빈 값이나 설명만 둔다.

제출 시 준비할 자료: 실행 안내, 환경 설정 예시, 데모 영상, 정상/차단 로그, testnet·contract 주소와 TX 링크, 호출별 usage 표, AI와 일반 코드 역할 설명, 알려진 한계. 이 문서의 체크박스는 구현 완료 후 증거와 함께 체크한다.
