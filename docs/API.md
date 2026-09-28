# DealBattle API v2

이전 main에는 OpenAPI가 없었다. 이번 구현은 사용자 전체 구현 지시에 따라 노트북 협상 API v2를 확정했다. GPU·양측 지갑 서명 초안의 `/api/buyer-intents`와 호환되지 않는다. 현재 계약은 `backend/app/schemas.py`와 FastAPI에서 생성한 루트 `openapi.yaml`, `contracts/openapi.json`이다. 생성 타입은 `frontend/src/generated/api.ts`이며 수동 수정하지 않는다.

| 메서드 / 경로 | 요청 / 응답 | 성공 |
|---|---|---|
| GET /health | Health (mode, contract_version=2) | 200 |
| POST /api/v1/session | SessionInput → HttpOnly cookie, CSRF, expiry | 201 |
| GET /api/v1/session | 현재 세션/CSRF/만료 복구 | 200 |
| DELETE /api/v1/session | CSRF + Idempotency-Key, 세션 폐기 | 204 |
| GET /api/v1/products | 공개 ProductView[]; floor 제외 | 200 |
| POST /api/v1/deals | product_id + BuyerPolicy → DealView | 201 |
| GET /api/v1/deals/{id} | DealView, 새로고침 복구 | 200 |
| GET /api/v1/deals/{id}/policy | DealView | 200 |
| PUT /api/v1/deals/{id}/policy | expected_policy_version + policy | 200 |
| POST /api/v1/deals/{id}/policy/confirm | expected_policy_version | 200 |
| POST /api/v1/deals/{id}/negotiation/start | expected_policy_version → DealView | 200 |
| GET /api/v1/deals/{id}/negotiation | DealView | 200 |
| GET /api/v1/deals/{id}/rounds | RoundView[]; 이전 정책의 무효 라운드도 보존 | 200 |
| POST /api/v1/deals/{id}/agreement/approve | expected_policy_version + snapshot_hash | 202 |
| POST /api/v1/deals/{id}/agreement/reject | expected_policy_version | 200 |
| POST /api/v1/deals/{id}/chain/reconcile | expected_policy_version; 기존 tx 조회 | 202 |
| GET /api/v1/deals/{id}/evidence | 합의 이력, 라운드, 판정/승인/체인 이벤트, receipt | 200 |
| GET /api/v1/deals/{id}/usage | 호출별 provider tokens/request ID/latency, 역할별 집계 | 200 |

모든 업무 API는 cookie `dealbattle_session`을 요구한다. POST 세션 발급은 세션 이전 부트스트랩 예외다. mock에만 익명 로컬 데모 발급을 허용한다. live는 서버 운영자가 인증한 주체에 발급한 HMAC 자격 증명(`sub`, `aud`, `exp`)을 `credential`로 받는다. 세션은 DB에 토큰 해시만 저장하며 한 시간 기본 만료, HttpOnly, SameSite=Strict, live Secure다. 로그인 자격 증명/서명 키를 브라우저 저장소에 저장하지 않는다. 가입/비밀번호 관리/외부 IdP는 후속 통합 영역이다.

세션 발급 외 상태 변경은 `X-CSRF-Token`, `Idempotency-Key`가 필수다. 소유자 외 딜 조회/변경은 404로 동일하게 감춘다. 업무 변경의 같은 scope/key/본문은 현재 DealView를 재조회하고 외부 호출을 반복하지 않는다. 동일 key에 다른 본문은 409다. 별도 key 승인도 agreement별 Approval 및 deal별 ChainRecord 고유 제약으로 한 번만 처리한다. 로그아웃은 인증 세션 제거이며 재호출은 401이다. 세션 발급은 새 자격 증명 인증 교환이며 업무 idempotency에 포함되지 않는다.

정책은 생성 시 version=1이며 미확정이다. PUT은 version을 1 증가시키고 라운드·합의·승인을 무효화하며 조건 재확정을 요구한다. start는 정책 버전당 논리적으로 1회다. 실패/차단 후 재협상은 조건을 저장해 새 버전을 만든다. approve는 표시된 snapshot_hash를 요구한다. 기록 작업이 이미 생성된 딜은 변경할 수 없고 새 딜을 만든다. 모든 가격은 strict 정수 KRW; 총액은 상품가+배송비+수수료다. 시각은 UTC, 배송일은 날짜다.

상태는 `DRAFT → POLICY_CONFIRMED → NEGOTIATING → AWAITING_APPROVAL → RECORDING → RECORDED`이며 mock 완료는 `MOCK_RECORDED`다. 종료/차단은 `BLOCKED`, `REJECTED`, `CHAIN_FAILED`다. 체인 상태는 `QUEUED/SUBMITTING/PENDING/UNKNOWN/FAILED/CONFIRMED/MOCK_RECORDED`로 분리한다. 202는 승인 및 outbox 저장을 의미한다. receipt/event/조회가 확인되기 전에는 기록 성공이 아니다.

오류는 `{ "error": { "code": "VERSION_CONFLICT", "message": "VERSION_CONFLICT" } }`다. 400 IDEMPOTENCY_REQUIRED, 401 SESSION_REQUIRED/CREDENTIAL_INVALID, 403 CSRF_INVALID/ORIGIN_INVALID, 404 DEAL_NOT_FOUND/PRODUCT_NOT_FOUND, 409 VERSION_CONFLICT/STATE_CONFLICT/APPROVAL_STALE/IDEMPOTENCY_CONFLICT, 422 VALIDATION_ERROR다. 모델 오류는 실패한 Round/usage를 보존하고 200 BLOCKED를 반환한다. 정책 사유는 OpenAPI Reason enum 참조: BUDGET_EXCEEDED, SELLER_FLOOR_VIOLATED, SELLER_NOT_ALLOWED, SPEC_MISMATCH, DELIVERY_TOO_LATE, OUT_OF_STOCK, POLICY_EXPIRED, PRODUCT_EXPIRED, ROUND_LIMIT, INVALID_DATA, INVALID_MODEL_OUTPUT, ACCEPT_MISMATCH, MODEL_REJECTED, MODEL_UNAVAILABLE, USAGE_UNAVAILABLE, APPROVAL_STALE.

```bash
python scripts/manage.py openapi
python scripts/manage.py openapi --check
npm --prefix frontend run generate:api
```
