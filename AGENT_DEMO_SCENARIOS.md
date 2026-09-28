# GWDC FuriosaAI × Bricksum Challenge A — Agent Demo Scenarios

> 문서 상태: 테스트·발표를 위한 계획이다. 이번 작업에서 시나리오를 실행하거나 Kiln/testnet 성공 증거를 만든 것은 아니다.

AI 구현 기준은 **Kiln API / `gpt-oss-120b`**다. 공통 모델·상태·API·Protocol은 [CONTRACTS.md](CONTRACTS.md) v1을 따르고, 역할 구조는 [AGENT_ARCHITECTURE.md](AGENT_ARCHITECTURE.md), 팀 실행 순서는 [TEAM_PLAN.md](TEAM_PLAN.md)를 따른다.

## 공통 준비와 증거

- 가상 상품 `P001`: `price=42000`, `shipping_fee=3000`, `currency=KRW`, `merchant_id=MerchantA`, 허용 카테고리, `in_stock=true`, `simulated=true`. 상품 버전과 배송일도 유효하게 설정한다. 별도 구매 수수료는 v1에 없다.
- 고정 테스트 시각과 실시간 데모 시각을 구분한다. `allowed_categories`, `delivery_by`, `expires_at`, `max_transactions=1` 등 필수 PolicyInput을 확정하고 사용자 정책 확인을 받는다. 날짜는 데모 시각에 유효하도록 준비한다.
- 정상 경로와 예산 초과 경로는 같은 상품·기준 시각으로 서로 다른 request_id를 만들고 예산만 50,000원/30,000원으로 바꾼다.
- 승인 API는 `POST /api/v1/requests/{id}/approve`, 본문은 `recommendation_id`와 `expected_policy_version`, 헤더는 `Idempotency-Key`다. 세션 쿠키·X-CSRF-Token이 필요하다. 202 이후 GET으로 RequestView를 조회한다.
- 모든 후보는 서버 PolicyPort로 검사한다. 금지 후보가 검색에서 제거되는 경우 QA fake/fixture로 직접 PolicyPort에 주입하여 실제 차단을 검증한다.
- 시나리오별 request_id, policy_version, 입력·최신 스냅샷, policy checks/reason_codes, 호출별 usage/latency/attempt, 구매 건수·영수증, chain 상태·record_id·TX·receipt를 보존한다. 비밀값은 제거한다.
- 기본 테스트는 mock/fake로 재현한다. 실제 데모 완료는 실제 Kiln 호출과 운영진 허용 testnet의 TX hash·성공 receipt·감사 해시 일치 증거가 필요하다. mock 증거와 live 증거를 구분한다.
- 화면의 정책 PASS는 `decision.allowed=true` 및 전체 checks 통과에 대응하고, 승인 대기는 `AWAITING_APPROVAL`이다. 체인은 구매 전 `null`/`NOT_SUBMITTED`, 제출 후 `PENDING`, receipt 확인 후 `CONFIRMED`로 표시한다.
- 실행 보고에는 실제 명령, 통과/실패/미실행, 테스트 수와 남은 문제를 기록한다. 이 문서의 Expected는 통과 결과를 의미하지 않는다.

## Scenario 1 — 정상 구매

```text
예산: 50,000원
허용 판매자: MerchantA
상품: 42,000원
배송비: 3,000원

Total: 45,000원
```

Expected:

```text
Kiln request parsing 성공
상품 후보 조회 성공
AI 추천 생성
Policy PASS
사용자 승인
실행 직전 Policy PASS
모의 구매 성공
Audit 생성
Testnet TX 생성
TX Hash 표시
Kiln usage 표시
```

## Scenario 2 — 예산 초과

```text
예산: 30,000원
동일 상품 Total: 45,000원
```

Expected:

```text
Policy BLOCKED
BUDGET_EXCEEDED
purchase_id 생성 안 됨
Blockchain 실행 안 됨
차단 기록은 history/log에 저장
```

## Scenario 3 — 허용되지 않은 판매자

```text
Allowed:
MerchantA

Selected:
MerchantB
```

Expected:

```text
MERCHANT_NOT_ALLOWED
```

## Scenario 4 — 승인 후 가격 변경

승인 저장 후 실행 워커의 최신 조회 전에 fixture의 가격과 product_version을 변경한다. 서버가 저장한 승인 스냅샷과 최신 상품을 비교하는지 확인한다.

```text
승인 당시:
45,000원

실행 직전:
52,000원
```

Expected:

```text
APPROVAL_STALE
재승인 필요
구매 실행 안 됨
```

## Scenario 5 — 중복 승인

동일 Idempotency-Key와 동일 본문으로 동시에 approve API를 두 번 호출한다. 같은 키·다른 본문의 409 IDEMPOTENCY_CONFLICT와 다른 키의 중복 호출도 추가 확인한다.

Expected:

```text
논리 purchase 최대 1개
동일 본문 재시도는 기존 실행 결과 반환
DB request_id unique constraint와 purchase_id/영수증/횟수로 확인
```

## Scenario 6 — Kiln 장애

조건 추출 및 후보 추천 단계별로 Kiln timeout / invalid JSON 상황을 재현한다. 존재하지 않는 product_id 응답도 주입한다. 서버 validation과 제한 재시도 후 오류 또는 추가 질문으로 끝내고 live 장애를 mock 성공으로 바꾸지 않는다.

Expected:

```text
구매 실행 안 됨
오류 상태 기록
```

## Scenario 7 — Blockchain timeout

모의 구매·영수증·감사 outbox가 저장된 뒤 체인 제출 또는 receipt 조회의 타임아웃을 주입한다. 같은 record_id/기존 tx_hash로 먼저 상태를 조회한다.

Expected:

```text
purchase 재실행 안 함
기존 audit record / TX 상태 조회
UNKNOWN 또는 PENDING 상태 유지
```

## 계약 표현 및 인수 시 확인할 차이

- 요청 자료의 Scenario 3 표기 `BLOCKED_MERCHANT`는 설명용 별칭이다. 실제 응답·테스트 기대값은 CONTRACTS가 참조하는 PROJECT 5절의 `MERCHANT_NOT_ALLOWED`이며 요청 상태는 `BLOCKED`다. 기존 계약에는 새 reason code를 추가하지 않는다.
- Scenario 4의 `APPROVAL_STALE`는 409 오류 코드다. 기존 승인으로 구매하지 않고 정책/상품을 다시 확인한다. 가격·재고·정책·배송 조건·만료 변경을 각각 확인한다.
- Scenario 2의 “Blockchain 실행 안 됨”은 이 MVP의 승인된 구매 감사 제출이 없다는 뜻이다. 차단은 로컬 AuditEvent/history/log에 남긴다. 실제 상품 결제는 모든 시나리오에서 하지 않는다.
- Scenario 7에서 체인 장애는 확정 구매를 되돌리거나 다시 실행하는 사유가 아니다. 체인 실패/불명 상태와 모의 구매 성공 상태를 별도로 유지하고, 확인되지 않은 TX를 CONFIRMED로 표시하지 않는다.
- usage는 로그 API의 `UsageLog.stage=extract|recommend`로 표시하고 재시도도 집계한다. 미제공 값은 null/unavailable이며 0으로 대체하지 않는다. 에너지 실측이 없으면 Unavailable, 추정이면 산식·가정을 함께 표시한다.
- 기존 PROJECT/ROLE_DATA_INTEGRATION_QA의 42,900원 상품 데모와 이 문서의 42,000원+3,000원 데모는 서로 다른 fixture 예시다. 이번 두 경로 비교에는 같은 45,000원 fixture를 일관되게 사용하고 기존 문서는 수정하지 않는다.
