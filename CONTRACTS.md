# 공유 계약 v1 — 구현의 공통 기준

이 문서는 기존 PROJECT의 제안을 구체화한 팀 기본 계약이다. 아직 실행 가능한 스키마/API가 구현된 것은 아니다. **B0가 공통 타입·Protocol·OpenAPI fixture를 먼저 코드로 확정하고, 나머지 역할은 그 코드를 재사용한다.**

## 1. 소유 경로

| 소유자 | 생성·수정할 경로 |
|---|---|
| Backend | `backend/pyproject.toml`, `backend/app/__init__.py`, `backend/app/main.py`, `backend/app/contracts/`, `backend/app/api/`, `backend/app/agent/`, `backend/app/orchestration/`, `backend/app/persistence/`, `backend/app/config.py`, `backend/tests/contracts/`, `backend/tests/backend/`, `contracts/`, 루트 `.gitignore`, `.env.example`, 공통 문서 |
| Frontend | `frontend/` 전체. 단 `frontend/src/generated/`는 계약으로부터 생성하며 수동 변경 금지 |
| Policy / Blockchain | `backend/app/policy/`, `backend/app/blockchain/`, `backend/tests/policy/`, `backend/tests/blockchain/`, `chain/` |
| Data / QA | `backend/app/catalog/`, `backend/app/simulator/`, `backend/tests/data/`, `backend/tests/integration/`, `data/`, `e2e/`, `reports/`, `scripts/qa/` |

각 역할은 자기 ROLE 문서의 진행 상태도 갱신할 수 있다. 위 표에 없는 공통 설정은 Backend에 요청한다. Python 의존성 추가도 Backend가 반영한다. 별도 DB 모델·API 서버·공통 enum을 역할별로 만들지 않는다.

## 2. 타입의 단일 원본과 B0 산출물

- `backend/app/contracts/models.py`: Pydantic 데이터 모델, enum, JSON validation.
- `backend/app/contracts/ports.py`: 아래 내부 인터페이스의 Protocol.
- `contracts/openapi.json`: FastAPI 모델로 생성한 HTTP 계약. 수동 수정 금지.
- `contracts/examples/`: 각 API/상태의 유효한 JSON 예시. 정상, 추가 질문, 차단, stale 승인, chain pending/confirmed/failed/unknown 포함.
- `frontend/src/generated/`: OpenAPI에서 생성한 TS 타입. F0에서 생성 명령을 package.json에 고정한다.
- B0 완료 조건: 모든 예시가 모델 검증을 통과하고 mock endpoint가 OpenAPI와 일치하며 공통 타입 테스트가 1개 이상 실행된다. 미구현 기능은 명시적 501/개발용 fake로 표현하고 성공으로 위장하지 않는다.

## 3. 공통 모델

PROJECT의 필드를 아래 규칙으로 확정한다. 모든 객체 ID는 서버 발급 불투명 문자열이다. 금액은 JSON 정수(KRW), 버전은 1 이상 정수, bool은 JSON boolean이다. 시각은 offset이 있는 ISO 8601, 날짜는 YYYY-MM-DD, 문자열 enum은 대소문자를 구분한다. 요청 스키마는 알 수 없는 필드를 거절한다.

- PolicyDraft: `query`, `max_budget`, `allowed_merchants`, `allowed_categories`, `delivery_by`, `expires_at`은 미확정 시 null 가능. `currency=KRW`, `max_transactions=1`.
- PolicyInput: 위 draft 필드 모두 확정·필수. 예산 > 0, 목록은 비어 있지 않음. 문자열 ID 목록을 정렬·중복 제거한다.
- Policy: PolicyInput + `policy_version`, `confirmed_at`, `policy_hash` (서버 생성).
- Product: PROJECT 예시와 동일. `product_version>=1`, `price>0`, `shipping_fee>=0`, `currency=KRW`, `simulated=true`. 총액은 서버 계산.
- PolicyCheck: `rule:string`, `passed:bool`, `expected:JSON value`, `actual:JSON value`, `reason_code:ReasonCode|null`.
- PolicyDecision: `decision_id`, `allowed`, `checks:PolicyCheck[]`, `reason_codes:ReasonCode[]`, `evaluated_at`, `policy_version`. 전체 checks가 통과해야 allowed=true.
- Recommendation: `recommendation_id`, `product_id`, `explanation`, `source_product_ids:string[]`.
- CandidateView: `recommendation:Recommendation`, `product:Product`, `total_amount:int`, `decision:PolicyDecision`.
- Approval: PROJECT 필드 + `product_id`, `product_version`. 이 객체는 서버가 발급하며 클라이언트가 보내는 approved 플래그는 사용하지 않는다.
- SimulatedReceipt: PROJECT 필드와 동일. `simulated`는 항상 true.
- ChainRecord: PROJECT 필드와 동일. `network`, `chain_id`, `tx_hash`, `block_number`는 미제출 시 null 허용. `chain_id`는 체인별 식별자를 담는 문자열. `adapter_mode:mock|live` 필수.
- UsageLog: PROJECT 필드. `stage=extract|recommend`, `usage_source=provider|estimate|unavailable`; 토큰 값은 nonnegative int 또는 null. 미제공 usage를 0으로 대체하지 않는다.
- AuditEvent: `event_id`, `request_id`, `event_type`, `occurred_at`, `details:object` (비밀값 제외).

### RequestView (로그 API 외 모든 업무 API의 성공 응답)

`contract_version="1"`, `request_id`, `status`, `policy_draft:PolicyDraft|null`, `clarification_questions:string[]`, `policy:Policy|null`, `candidates:CandidateView[]`, `selected_recommendation_id:string|null`, `approval:Approval|null`, `purchase:SimulatedReceipt|null`, `chain:ChainRecord|null`, `created_at`, `updated_at`.

배열은 없을 때 `[]`, 선택 객체는 `null`로 반환한다. candidate/approval/purchase/chain이 없는 초기 상태도 같은 envelope를 사용한다.

상태와 ReasonCode는 PROJECT 4·5절을 그대로 사용한다. `INVALID_DATA`는 서버의 불완전한 상품 데이터 등 정책 판단 사유이고, 잘못된 HTTP 입력은 별도 `VALIDATION_ERROR`다.

## 4. HTTP 계약

접두사는 `/api/v1`이다. PROJECT의 경로 앞에 붙인다. `GET /health`만 인증 없이 `{ "status": "ok", "contract_version": "1" }`을 반환한다.

MVP는 동일 출처 reverse proxy 배포를 기본으로 한다. `POST /api/v1/session`이 서버 생성 세션을 HttpOnly 쿠키로 발급하고 응답에 csrf_token을 반환한다. 세션 ID를 본문에서 신뢰하지 않는다. 변경 API는 쿠키와 `X-CSRF-Token`을 요구하며 로그/조회도 소유권을 검사한다. 로컬 개발 origin은 명시적으로 허용하고 live 배포에서는 Secure 쿠키를 사용한다. 이는 데모 세션이며 정식 계정 인증은 범위 밖이다.

| Endpoint | 요청 본문 | 성공 상태 |
|---|---|---|
| POST /requests | `{user_text:string}` | 201 RequestView |
| POST /requests/{id}/clarifications | `{answer:string}` | 200 RequestView |
| PUT /requests/{id}/policy | `{expected_policy_version:int, policy:PolicyInput}` | 200 RequestView |
| POST /requests/{id}/recommendations | `{expected_policy_version:int}` | 200 RequestView |
| POST /requests/{id}/approve | `{recommendation_id:string, expected_policy_version:int}` | 202 RequestView |
| POST /requests/{id}/reject | `{expected_policy_version:int}` | 200 RequestView |
| GET /requests/{id} | 없음 | 200 RequestView |
| GET /requests/{id}/logs | 없음 | 200 `{contract_version, request_id, events:AuditEvent[], usage:UsageLog[]}` |

최초 정책 확인은 expected_policy_version=0, 저장 후 version=1이다. 갱신 시 현재 버전 일치를 요구하고 1 증가시킨다. 정책 갱신은 후보·승인을 지우고 EVALUATING으로 되돌린다. EXECUTING/구매 완료 상태의 변경은 409로 거절한다. 추천 결과에 통과 후보가 있으면 AWAITING_APPROVAL, 없으면 BLOCKED다.

approve는 Idempotency-Key가 필수다. DB에 실행 작업과 승인을 저장한 뒤 202를 반환하고 GET으로 결과를 조회한다. 같은 키·본문은 기존 작업의 현재 RequestView를 반환한다. 같은 키에 다른 본문, 또는 종료 상태의 새 실행은 409다. REJECTED/EXPIRED/FAILED는 요청 종료 상태로 새 요청을 만들어 다시 시작한다. BLOCKED는 정책 변경 또는 재추천이 가능하다.

오류 형식은 `{error:{code:string,message:string},request_id:string|null}`이다. 422 VALIDATION_ERROR, 401 SESSION_REQUIRED, 403 CSRF_INVALID, 404 REQUEST_NOT_FOUND(다른 세션 소유도 동일), 409 STATE_CONFLICT / VERSION_CONFLICT / APPROVAL_STALE / IDEMPOTENCY_CONFLICT, 503 UPSTREAM_UNAVAILABLE. 정책 위반은 정상적인 BLOCKED 결과다.

## 5. 내부 인터페이스

B0가 아래 Protocol과 반환 모델을 만든다. 각 역할은 타입을 가져다 쓰고 이름이나 인수를 바꾸지 않는다.

```text
AgentPort.extract_policy(text: str, now: datetime, previous: PolicyDraft|null)
    async -> ExtractionResult(draft: PolicyDraft, questions: list[str], usage: list[UsageLog])
AgentPort.recommend(policy: Policy, products: list[Product])
    async -> RecommendationResult(items: list[Recommendation], usage: list[UsageLog])
CatalogPort.search_products(policy: Policy) -> list[Product]
CatalogPort.get_product(product_id: str) -> Product|null
PolicyPort.evaluate(policy: Policy, product: Product, now: datetime, purchase_count: int)
    -> PolicyDecision
SimulatorPort.execute_simulated_purchase(approval: Approval, purchase_id: str,
    idempotency_key: str, now: datetime) -> SimulatedReceipt
ChainPort.submit_audit(record: AuditRecord) async -> ChainRecord
ChainPort.get_receipt(record: ChainRecord) async -> ChainRecord
```

Simulator는 전달받은 ID와 시각으로 모의 영수증을 만드는 순수 모듈이다. DB 연결, ID 발급, 실행 횟수 관리를 하지 않는다. Backend가 DB 트랜잭션 안에서 요청 확보 → 재검사 → simulator 호출 → 영수증 저장 → 횟수 갱신을 수행한다. 구매 테이블의 request_id에 고유 제약을 둔다. rollback 시 확정 구매는 없으며 재처리에도 논리적 구매는 최대 1건이다.

체인 호출은 DB 트랜잭션 밖에서 한다. 구매와 같은 커밋으로 outbox를 저장하고 Backend 워커가 ChainPort를 호출한다. 제출 결과가 불명이면 UNKNOWN으로 두고 기존 record/tx를 먼저 조회한다. 무조건 새 nonce로 재전송하지 않는다.

## 6. 감사 해시 공통 규칙

AuditRecord 필드: `schema_version="1"`, `record_id`, `request_id`, `policy:Policy`, `product:Product`, `decision:PolicyDecision`, `approval:Approval`, `purchase:SimulatedReceipt`, `executed_at`. record_id는 Backend가 한 번만 발급한다. audit_hash와 tx_hash는 해시 입력에서 제외한다.

JSON은 키 사전순, 배열 순서 유지, UTF-8, BOM/공백 없음, ensure_ascii=false, 부동소수점/NaN 금지로 직렬화한다. 시각은 UTC `YYYY-MM-DDTHH:mm:ss.SSSZ`로 정규화한다. SHA-256은 소문자 64자리 hex다. policy_hash는 PolicyInput + policy_version + confirmed_at을 대상으로 하며 자기 자신은 제외한다. product_snapshot_hash는 Product 전체를 대상으로 한다.

Policy 담당이 정규화 구현과 고정 테스트 벡터를 제공하고 Backend가 이를 호출한다. 프론트에서 해시를 독자 계산하지 않는다. bytes32 변환은 체인 Adapter 내부에서 한다.

## 7. 통합 순서

1. B0: 공통 모델·Protocol·API 예시·개발 설정을 먼저 통합한다.
2. F0 / P0 / D0: 공통 코드를 받은 뒤 역할별 기초를 구현한다.
3. B1 / F1 / P1 / D1: 모의 서비스 전체 흐름과 경계·동시 실행을 검증한다.
4. B2 / F2 / P2 / D2: 실제 Kiln/testnet, E2E, 제출 증거를 완성한다.

계약 변경 시 Backend가 models → OpenAPI → 예시를 갱신하고 Frontend가 생성 타입을 갱신한다. 영향받는 역할의 계약 테스트가 통과한 뒤 통합한다.
