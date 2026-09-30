# Agent Accord API 명세 v0.2

> **상태: release 브랜치 구현 계약.** 이 문서는 `project.md`와 역할 문서를 기준으로 정한 서비스 HTTP API다. FastAPI 구현 및 OpenAPI와 대조한다. 지갑 인증과 공개 매물 조회를 추가해 v0.2로 올렸다. 이 체크아웃에는 `CONTRACTS.md`가 아직 없으므로 이 문서가 현재 공통 API 계약이다.

## 1. 범위와 공통 규칙

- Base path: `/api`. 요청·응답은 JSON UTF-8. 금액은 **정수 KRW**; 금액 계산은 서버가 다시 한다. 시간은 UTC ISO 8601(`2026-10-04T12:00:00Z`), EIP-712 `deadline`만 Unix 초다.
- ID는 서버가 만든 문자열이다. 요청에 소유자 ID를 넣어도 신뢰하지 않고 세션에서 결정한다. 구매자 최고예산·판매자 최저가는 상대 사용자/에이전트에게 반환하지 않는다.
- 사용자 세션은 지갑 주소·선택 역할에 묶인 일회용 서명 challenge로 만든다. `Authorization: Bearer <session_token>`을 쓴다. `POST /api/demo/sessions`는 격리된 mock 시나리오용이며 live에서는 기본 비활성이다. 앱은 테스트넷 데모이며 결제나 소유권 이전을 하지 않는다.
- `snapshot_hash`와 증빙 해시는 각각 SHA-256 32바이트를 `0x` + 64자리 **소문자** 16진수로 표시한다. 합의 스냅샷은 [RFC 8785 JCS](https://www.rfc-editor.org/rfc/rfc8785.html)로 정규화한 UTF-8 바이트를 해시한다. 스냅샷 필드와 타입은 아래 4절, 계약 ABI·nonce 규칙과 테스트 벡터는 `blockchain.md`에 고정한다.
- 체인은 Base Sepolia(chain ID `84532`)로 정한다. 계약 주소는 배포 후 환경 설정으로 넣는다. Kiln의 공개 API 경로와 모델 ID는 8절을 따른다. 아래 예시는 구조 설명용 가상 데이터이며 실제 요청 ID, 서명 또는 트랜잭션이 아니다.
- 성공 응답에는 `request_id`를 포함한다. 오류 형식은 7절을 따른다. 변경된 구매 조건은 기존 의도를 수정하지 않고 **새 `BuyerIntent`를 등록**해 별도 `flow_id`로 실행한다.

## 2. 경로 목록과 접근 권한

| 경로 | 호출자 | 목적 | 정상 응답 |
| --- | --- | --- | --- |
| `POST /api/auth/challenges` | 구매자/판매자 화면 | 지갑·역할·origin에 묶인 일회용 로그인 문구 발급 | `201` |
| `POST /api/auth/sessions` | 구매자/판매자 화면 | 서명 검증 후 지갑 세션 생성 | `200` |
| `POST /api/auth/logout` | 로그인한 구매자/판매자 | 현재 Bearer 세션을 서버에서 폐기 | `200` |
| `POST /api/demo/sessions` | 격리된 mock 데모 | 설정된 가상 계정 세션 선택 | `200`, live 기본 비활성 |
| `GET /api/listings` | 공개 화면 | 공개 매물·증빙 요약 조회 | `200` |
| `POST /api/buyer-intents` | 구매자 | 구매 조건 등록 | `201` |
| `POST /api/listings` | 판매자 | 매물과 비공개 판매 조건 등록 | `201` |
| `POST /api/negotiations` | 구매자 | 후보 검색·AI 협상 시작 | `202` |
| `GET /api/negotiations/{id}` | 해당 구매자 | 협상 상태·유효 제안·합의 ID 조회 | `200` |
| `GET /api/agreements?status=...` | 해당 구매자/판매자 | 본인 승인 대기 또는 완료 합의 목록 | `200` |
| `GET /api/agreements/{id}` | 해당 구매자/선택 판매자 | 합의 원문·서명/체인 상태 조회 | `200` |
| `GET /api/agreements/{id}/approval-payload` | 해당 구매자/선택 판매자 | 동일 스냅샷과 지갑 서명 자료 받기 | `200` |
| `POST /api/agreements/{id}/decisions` | 해당 구매자/선택 판매자 | 승인 서명 제출 또는 거절 | `200` |
| `GET /api/flows/{id}/audit` | 해당 흐름의 구매자/선택 판매자 | 조건 검사·Kiln 사용량·체인 기록 조회 | `200` |

판매자별 협상은 서버 내부에서 진행한다. 구매자는 후보 제안을 보고, 판매자 UI는 **자신이 선택된 합의**를 조회한다. 판매자 에이전트에는 자기 제안 문맥만 전달한다. 다른 판매자의 비공개 정책과 제안은 반환하지 않는다.

## 3. 입력·출력의 공통 형식

| 객체 | 필드와 형식 | 규칙 |
| --- | --- | --- |
| `BuyerIntent` | `id`, `gpu_model: string`, `max_total_krw: integer`, `delivery_deadline: datetime`, `must_have: string[]` | `max_total_krw > 0`; `must_have` MVP 값은 `warranty_active`, `evidence_present`만 허용 |
| `Listing` | `id`, `seller_id`, `gpu_model`, `asking_price_krw`, `shipping_fee_krw`, `condition_text`, `warranty_end: date|null`, `stock_status`, `evidence_ids` | `stock_status`는 `available/sold`; 구매자에게 판매자 최저가 미노출 |
| `SellerPolicy` | `listing_id`, `min_item_price_krw`, `earliest_delivery_at: datetime` | 최저 상품가는 0보다 크고 최초 호가 이하; 해당 판매자와 서버만 열람 |
| `Evidence` | `id`, `kind`, `source`, `ref`, `sha256`, `verification_status` | `seller_claimed/checked/conflicted/unknown`; 해시와 원본 참조를 유지 |
| `ListingAssessment` | `flow_id`, `listing_id`, `summary`, `findings[]`, `source` | `source=kiln/mock`; 각 finding은 `evidence_id: string|null`, `verdict: consistent/conflicted/unverified`, `note: string` |
| `Offer` | `id`, `negotiation_id`, `listing_id`, `round`, `proposer`, `item_price_krw`, `shipping_fee_krw`, `total_krw`, `delivery_by`, `warranty_terms`, `expires_at`, `evidence_ids`, `rationale`, `valid` | `rationale`은 공개 가능한 협상 이유; 서버가 총액과 조건을 재계산·검사한 후 `valid=true`만 승인 가능 |
| `ModelUsage` | `actor`, `step`, `model_id`, `request_id`, `input_tokens`, `output_tokens`, `latency_ms`, `source` | `request_id`는 Kiln의 `X-Neocloud-Generation-Id` 헤더 값; `source=api/estimated/unavailable`로 실제/추정/미수집 구분 |

MVP 수수료는 `0 KRW`다. 따라서 `total_krw = item_price_krw + shipping_fee_krw`이다. 수수료가 생기면 제안·스냅샷·정책 검사 필드를 함께 버전 변경한다. 서버 검사는 총액이 구매자 예산 이하, 상품가가 해당 판매자 최저가 이상, 제안 배송 시각이 판매자의 `earliest_delivery_at` 이상이면서 구매자 기한 이하, 재고와 필수 조건이 유효한지 확인한다. `warranty_active`는 입력된 보증 만료일 검사이며 보증의 진위를 뜻하지 않는다. AI의 계산값만 신뢰하지 않는다.

## 4. 요청·응답

### 4.1 `POST /api/auth/challenges` 및 `POST /api/auth/sessions`

역할을 고른 사용자가 Base Sepolia 계정을 연결한다. challenge 요청은 `{ "wallet_address": "0x...40 hex...", "role": "buyer" }`이고 응답은 `{ "request_id", "challenge_id", "message", "expires_at" }`다. 메시지는 요청의 HTTPS origin/domain, 지갑, 역할, chain ID, 128-bit nonce, 발급·만료 시각을 담는다. challenge는 5분 뒤 만료되고 한 번만 쓸 수 있다. `POST /api/auth/sessions`에 `{ "challenge_id": "...", "signature": "0x...130 hex..." }`를 보내면 서버가 EIP-191 서명을 복구·검증하고 Bearer 세션을 돌려준다. 요청 origin은 요청 host와 같아야 한다. 합의 승인 API는 세션의 역할·지갑과 합의 스냅샷을 다시 대조한다.

세션 토큰을 Git, 캡처, 로그에 남기지 않는다. 프론트는 토큰을 탭 메모리에만 보관한다. `POST /api/demo/sessions`의 가상 계정 인증은 mock에서만 기본 허용되고 live 시작 스크립트에서는 기본 거부한다. `ALLOW_DEMO_SESSIONS=true`는 격리된 시나리오 실행에서만 명시적으로 쓴다.

로그아웃은 `POST /api/auth/logout`에 현재 Bearer 토큰을 보내 서버 세션을 삭제한다. 클라이언트는 응답을 기다리는 동안에도 탭의 토큰을 폐기하고, 네트워크 오류가 나면 서버 세션은 만료 시각까지 유효할 수 있음을 표시한다.

### 4.2 `GET /api/listings`

로그인 없이 매물을 조회한다. 공개 항목에는 상품·가격·상태·배송 정보·증빙 요약과 `source=demo|seller_claimed`가 들어간다. `private_policy`, 판매 최저가, 판매자 지갑은 응답에 포함하지 않는다. 시드 매물은 가상 데모로 표시하고, 등록 매물은 판매자 제출 자료로 표시한다. 증빙 설명 및 AI 판정은 실물·진품·작동 검증이 아니다.

### 4.3 `POST /api/demo/sessions` (mock 전용)

통제된 mock 데모 계정만 허용한다. 예시 요청: `{ "actor_id": "buyer-demo" }`. 응답: `{ "request_id": "req-1", "access_token": "<demo-token>", "actor_id": "buyer-demo", "role": "buyer", "wallet_address": "0x1111111111111111111111111111111111111111" }`. live API에서는 기본 `403 DEMO_SESSIONS_DISABLED`를 반환한다. 토큰을 Git, 화면 캡처, 감사 로그에 남기지 않는다.

### 4.4 `POST /api/buyer-intents`

구매자만 호출한다. 예시 요청:

```json
{
  "gpu_model": "RTX 3070",
  "max_total_krw": 500000,
  "delivery_deadline": "2026-10-04T12:00:00Z",
  "must_have": ["evidence_present"]
}
```

응답 `201`: `{ "request_id": "req-2", "id": "intent-demo-1", "buyer_id": "buyer-demo", "gpu_model": "RTX 3070", "max_total_krw": 500000, "delivery_deadline": "2026-10-04T12:00:00Z", "must_have": ["evidence_present"] }`. 예산은 이 구매자에게만 반환한다. 조건 변경 시 새 의도를 만든다.

### 4.5 `POST /api/listings`

판매자만 호출한다. MVP의 증빙은 데이터 담당이 준비한 데모 자산의 `evidence_ids`를 참조한다. 파일 업로드 API는 범위에 넣지 않는다.

```json
{
  "gpu_model": "RTX 3070",
  "asking_price_krw": 470000,
  "min_item_price_krw": 430000,
  "shipping_fee_krw": 10000,
  "earliest_delivery_at": "2026-10-02T12:00:00Z",
  "condition_text": "게임용 사용, 보증서 사진 있음",
  "warranty_end": "2027-01-31",
  "stock_status": "available",
  "evidence_ids": ["evidence-demo-1"]
}
```

서버는 `seller_id`와 판매자 지갑을 세션에서 결정하고, 참조 증빙이 해당 판매자의 데모 자산인지 확인한 뒤 `SellerPolicy`를 비공개로 저장한다. 응답 `201`은 `{ "request_id": "req-3", "id": "listing-demo-1", "seller_id": "seller-demo-1", "gpu_model": "RTX 3070", "asking_price_krw": 470000, "shipping_fee_krw": 10000, "evidence_ids": ["evidence-demo-1"], "private_policy": { "min_item_price_krw": 430000, "earliest_delivery_at": "2026-10-02T12:00:00Z" } }` 형태다. `private_policy`는 생성 판매자에게만 반환한다.

### 4.6 `POST /api/negotiations`

구매자만 호출한다. 요청: `{ "buyer_intent_id": "intent-demo-1" }`. 서버가 해당 구매자의 의도인지 확인하고 매물을 최대 3개 검색한다. `Idempotency-Key` 헤더를 같은 클릭/재시도에 재사용하면 같은 협상 ID를 반환해 중복 Kiln 호출을 막는다.

응답 `202`: `{ "request_id": "req-4", "id": "neg-demo-1", "flow_id": "flow-demo-1", "status": "NEGOTIATING", "agreement_id": null }`. 비동기 구현 방식은 백엔드가 정하되 응답 직후 `GET`으로 진행 상태를 조회할 수 있어야 한다. 후보가 없으면 모델 호출 없이 `NO_MATCH`가 된다.

### 4.7 `GET /api/negotiations/{id}`

해당 구매자만 호출한다. `NEGOTIATING` 중에는 `offers=[]`, `agreement_id=null`일 수 있다. 완료 예시:

```json
{
  "request_id": "req-5",
  "id": "neg-demo-1",
  "flow_id": "flow-demo-1",
  "status": "AWAITING_APPROVALS",
  "assessments": [{
    "flow_id": "flow-demo-1",
    "listing_id": "listing-demo-1",
    "summary": "게임용 사용이라는 설명과 보증서 기록을 비교함. 작동 상태는 미확인.",
    "findings": [{
      "evidence_id": "evidence-demo-1", "verdict": "consistent",
      "note": "보증서의 모델명과 매물 모델명이 일치함. 진품 확인은 아님."
    }],
    "source": "kiln"
  }],
  "offers": [{
    "id": "offer-demo-1", "negotiation_id": "neg-demo-1",
    "listing_id": "listing-demo-1", "round": 1,
    "proposer": "seller", "item_price_krw": 450000,
    "shipping_fee_krw": 10000, "total_krw": 460000,
    "delivery_by": "2026-10-03T12:00:00Z",
    "warranty_terms": "판매자 제공 보증서 기준",
    "expires_at": "2026-10-01T12:00:00Z",
    "evidence_ids": ["evidence-demo-1"],
    "rationale": "배송 기한을 충족하고 제시된 보증 조건을 반영해 총액 46만 원을 제안함.",
    "valid": true
  }],
  "blocked_events": [{"reason_code": "DEADLINE_MISSED"}],
  "selected_offer_id": "offer-demo-1",
  "agreement_id": "agreement-demo-1"
}
```

`assessments`는 후보 매물의 AI 텍스트·메타데이터 평가이며 `consistent`는 진품이나 작동 확인이 아니다. `offers`에는 서버 검사를 통과한 제안만 넣는다. `rationale`은 서버가 공개 매물·유효 제안·평가 정보만으로 만든 설명이다. 비공개 한계값을 본 에이전트의 원문 설명을 그대로 공개하지 않는다. 차단된 제안은 비공개 금액 없이 `reason_code`만 반환한다. `NO_MATCH/BLOCKED`는 정상적인 종료 상태이며 `selected_offer_id=null`, `agreement_id=null`이다. Kiln 장애는 감사 로그에 남기고 가짜 제안을 만들지 않는다.

### 4.8 `GET /api/agreements?status=...`

본인이 구매자 또는 **선택된 판매자**인 합의만 반환한다. `status` 필터는 선택 사항이며 허용 값은 6절의 합의 상태다. 응답: `{ "request_id": "req-6", "items": [{ "id": "agreement-demo-1", "status": "AWAITING_APPROVALS", "listing_id": "listing-demo-1", "total_krw": 460000, "buyer_approved": false, "seller_approved": false }] }`. 판매자는 이 경로로 자기 승인 대기 합의를 찾는다.

### 4.9 `GET /api/agreements/{id}`

해당 구매자/선택 판매자만 호출한다. 응답은 `id`, `flow_id`, `offer_id`, `status`, **동일한 `snapshot`과 `snapshot_hash`**, `assessment`(선택 매물의 `ListingAssessment`), `rationale`(선택 제안의 공개 협상 이유), `buyer_approved`, `seller_approved`, `chain`을 포함한다. `assessment`와 `rationale`은 설명용이며 서명 대상은 불변 `snapshot`이다. `chain`은 다음 중 하나다.

| 상태 | `chain`의 필드 |
| --- | --- |
| 승인 대기 | `mode: null`, `tx_hash: null`, `receipt_status: null` |
| 제출/확정 대기 | `mode: testnet`, `chain_id`, `tx_hash`, `receipt_status: pending` |
| 확정 성공 | 위 필드와 `receipt_status: success`, `block_number`, `event_name: AgreementRecorded`, `recorded_hash`; 이벤트와 `getAgreement`의 해시·당사자·총액·nonce 일치 |
| 실패 | `receipt_status: failed`, `reason_code: CHAIN_FAILED`; `RECORDED`로 표시 금지 |
| 로컬 mock 완료 | `mode: mock`, `tx_hash: null`, `receipt_status: null`; 합의 상태는 `MOCK_RECORDED`이며 실제 트랜잭션은 제출하지 않음 |

mock 체인을 쓴 로컬 테스트는 양측 EIP-712 서명을 검증하더라도 `MOCK_RECORDED`로 표시한다. 실제 영수증·이벤트·계약 조회값이 합의 해시와 일치한 경우에만 상태를 `RECORDED`로 바꾼다.

### 4.10 `GET /api/agreements/{id}/approval-payload`

해당 구매자/선택 판매자만 호출한다. `AWAITING_APPROVALS`이고 만료 전일 때만 반환한다. 응답은 `snapshot`, `snapshot_hash`, `typed_data`, `expected_wallet`을 포함한다. 프론트는 표시한 `snapshot`과 지갑이 서명할 `typed_data`를 함께 확인한다.

`snapshot`의 고정 필드: `snapshot_version=1`, `agreement_id`, `offer_id`, `listing_id`, `seller_id`, `gpu_model`, `item_price_krw`, `shipping_fee_krw`, `total_krw`, `delivery_by`, `warranty_terms`, `evidence_hashes`, `buyer_wallet`, `seller_wallet`, `expires_at`, `nonce`. `evidence_hashes`는 소문자 16진수로 통일해 중복 없이 오름차순, 지갑 주소도 스냅샷에는 소문자 `0x` + 40자리 16진수로 저장한다. 두 시각은 UTC 초 정밀도 `YYYY-MM-DDTHH:MM:SSZ`, 금액과 nonce는 JSON 안전 정수다. nonce는 구매자 주소별로 새 합의마다 유일한 **양의 정수**다. 필드 추가·타입 변경은 스냅샷 버전 변경과 양측 재승인이 필요하다. 구매자 최고예산과 판매자 최저가는 넣지 않는다.

EVM에서 `typed_data`는 [EIP-712](https://eips.ethereum.org/EIPS/eip-712) 형식이다. `domain`은 `name=AgentAccord`, `version=1`, 설정된 `chainId`, `verifyingContract`를 포함한다. `primaryType=AgreementApproval`의 필드는 아래 순서다.

| 필드 | EIP-712 타입 | 값 |
| --- | --- | --- |
| `agreementHash` | `bytes32` | `snapshot_hash` |
| `buyer` | `address` | `snapshot.buyer_wallet` |
| `seller` | `address` | `snapshot.seller_wallet` |
| `totalKrw` | `uint256` | `snapshot.total_krw` |
| `nonce` | `uint256` | `snapshot.nonce` |
| `deadline` | `uint256` | `snapshot.expires_at`의 Unix 초 |

`typed_data`는 `domain`, `types.EIP712Domain`(도메인 네 필드), `types.AgreementApproval`(위 필드명·타입의 순서 있는 배열), `primaryType`, `message`를 반환한다. 프론트는 이 객체를 바꾸지 않고 지갑에 전달한다. MVP는 EOA 테스트 지갑을 사용한다. 체인/계약 주소가 미설정이면 서명 자료를 임의로 만들지 않고 `CHAIN_CONFIG_UNAVAILABLE`을 반환한다. 블록체인 담당은 계약의 타입 해시와 이 표가 일치하는 골든 벡터를 제공한다. `totalKrw`는 합의 금액을 나타내는 기록값이며 토큰 결제 금액이 아니다.

EIP-712 타입 문자열은 `AgreementApproval(bytes32 agreementHash,address buyer,address seller,uint256 totalKrw,uint256 nonce,uint256 deadline)`로 고정한다. 계약의 `recordAgreement` 인자·이벤트·조회 형식은 `blockchain.md`를 따른다. `agreementHash`는 JCS/SHA-256 스냅샷 해시이며 EIP-712 서명 digest와 다르다. 백엔드는 서명 전 두 값의 연결과 도메인의 실제 체인·계약 주소를 확인한다.

### 4.11 `POST /api/agreements/{id}/decisions`

승인 요청: `{ "decision": "approve", "snapshot_hash": "0x<64 hex>", "signature": "0x<wallet signature>" }`. 거절 요청: `{ "decision": "reject", "snapshot_hash": "0x<64 hex>" }`. `signature`는 승인 시에만 필수다. 서버는 세션 사용자·기대 지갑·EIP-712 서명·스냅샷 해시·만료를 확인한다.

응답 `200`: `{ "request_id": "req-9", "agreement_id": "agreement-demo-1", "status": "AWAITING_APPROVALS", "buyer_approved": true, "seller_approved": false, "chain": { "tx_hash": null } }`. 두 번째 유효 서명이 들어오면 `status=RECORDING`으로 바꾸고 **서버 relayer**가 기록 트랜잭션을 제출한다. 동일한 결정을 재전송해도 서명이나 체인 기록을 중복 생성하지 않는다. 거절·만료·다른 해시의 서명은 온체인 제출을 막는다.

### 4.12 `GET /api/flows/{id}/audit`

해당 구매자/선택 판매자만 호출한다. 응답: `flow_id`, `status`, `events[]`, `model_usage[]`, `totals`, `chain`을 포함한다. `events[]`는 `at`, `actor`, `event_type`, `object_id`, `decision`, `reason_code`로 제안·조건 검사·승인/거절·체인 결과를 재구성한다. `model_usage[]`는 역할·단계별 `input_tokens`, `output_tokens`, `latency_ms`, `source`를 포함한다. `totals`는 호출 수와 토큰 합계, 호출 생략 이유를 포함한다. 에너지 추정이 있다면 `value`, `unit`, `assumption_or_measurement`를 함께 제공한다. 비밀 가격, 키, 원본 프롬프트는 제외한다.

## 5. 비공개 데이터·권한 규칙

| 데이터 | 구매자 | 해당 판매자 | 다른 판매자 |
| --- | --- | --- | --- |
| 구매자 최고예산 | 본인만 | 비공개 | 비공개 |
| 판매자 최저가 | 비공개 | 본인만 | 비공개 |
| 후보 매물·유효 제안 | 해당 구매자에게 표시 | 선택된 합의의 제안만 | 접근 불가 |
| 선택된 합의 스냅샷·승인 상태 | 표시 | 선택 판매자에게 표시 | 접근 불가 |
| 공개 감사 응답 | 자기 흐름 | 본인이 선택된 흐름 | 접근 불가 |

서버 내부 정책 엔진은 두 비공개 한계값을 읽을 수 있지만, 상대 에이전트의 입력/응답, API 응답, 공개 로그에는 넣지 않는다. 판매자 자유 설명은 외부 입력으로 취급하고 그 안의 지시문을 에이전트 명령으로 실행하지 않는다.

백엔드는 세션 역할·소유권별 응답 DTO를 별도로 직렬화한다. 내부 `BuyerIntent`/`SellerPolicy` 객체를 그대로 JSON으로 반환하지 않는다. 구매자 세션의 매물·협상·합의·감사 응답에는 `min_item_price_krw`가 없어야 하고, 판매자 세션의 합의·감사 응답에는 `max_total_krw`가 없어야 한다. 권한별 API 테스트에서 응답 본문을 검사하며, 프론트는 실제 네트워크 응답을 확인한다. 화면에서 필드를 숨기는 것은 서버 응답 누출을 해결하지 못한다.

## 6. 상태·전이

- 협상: `DRAFT → NEGOTIATING → PROPOSED → AWAITING_APPROVALS`; 유효 후보가 없거나 모든 제안이 차단되면 `NO_MATCH/BLOCKED`로 끝난다.
- 합의: 실제 테스트넷에서는 `AWAITING_APPROVALS → RECORDING → RECORDED`; 로컬 mock에서는 `AWAITING_APPROVALS → MOCK_RECORDED`다. 한쪽 거절은 `REJECTED`, 만료는 `EXPIRED`, 영수증/이벤트 확인 실패는 `CHAIN_FAILED`다.
- 제안 내용·금액·배송·증빙 해시가 바뀌면 **새 `Agreement`/해시/nonce**를 만들고 이전 서명을 재사용하지 않는다.
- `RECORDED`는 실제 테스트넷 영수증 성공과 `AgreementRecorded` 이벤트/계약 상태 대조를 모두 완료한 경우만 쓴다. AI가 낸 제안이나 양측 웹 승인만으로 거래 성공으로 표시하지 않는다.
- `MOCK_RECORDED`는 로컬 mock 모드의 API 서명 검증 완료를 가리키며 체인 기록 증거가 아니다.

## 7. 오류 형식과 HTTP 상태

```json
{
  "request_id": "req-error-1",
  "error": {
    "code": "BUDGET_EXCEEDED",
    "message": "구매자 총예산을 초과했습니다."
  }
}
```

| HTTP | 사용 상황 |
| --- | --- |
| `400` | 형식 또는 지원하지 않는 `must_have` 값 |
| `401` | 세션 토큰 누락/만료 |
| `403` | 다른 사용자 데이터 접근 또는 역할 불일치 |
| `404` | 존재하지 않는 ID |
| `409` | 상태 충돌, 다른 스냅샷 서명, 중복/변경된 결정 |
| `422` | 금액·기한·필수 조건의 유효성 실패 |
| `503` | Kiln 또는 체인 설정/연결 불가; mock 성공으로 대체하지 않음 |

`reason_code`의 최소 집합: `BUDGET_EXCEEDED`, `SELLER_FLOOR_VIOLATED`, `DEADLINE_MISSED`, `OUT_OF_STOCK`, `MUST_HAVE_UNMET`, `OFFER_EXPIRED`, `SIGNATURE_INVALID`, `CHAIN_CONFIG_UNAVAILABLE`, `CHAIN_FAILED`, `KILN_UNAVAILABLE`. 협상 중 차단은 전체 HTTP 오류로 바꾸지 않고 `AuditEvent`와 `blocked_events`에 기록한다.

## 8. 내부 어댑터와 환경 설정

아래는 **우리 서비스의 HTTP 엔드포인트가 아니다.** 백엔드와 블록체인 담당이 같은 인터페이스로 연결할 내부 함수다.

| 내부 함수 | 책임 |
| --- | --- |
| `prepare_approval(agreement)` | 고정 스냅샷 해시와 EIP-712 typed data 생성 |
| `verify_signature(payload, signature, expected_wallet)` | 서명 주소·chain ID·계약·해시·만료 확인 |
| `record_agreement(agreement, signatures)` | 양측 서명 확인 후 tx 제출; `submitted`+tx hash 또는 `already_recorded`+기존 기록; 합의당 중복 기록 방지 |
| `get_record(tx_hash, agreement_hash)` | `pending/success/failed/not_found`, 영수증·이벤트·계약 상태 대조 |

Kiln 공개 설정값은 `KILN_BASE_URL=https://api.bricksum.com/v1`, `KILN_MODEL_ID=qwen3-32b`다. 백엔드는 `KILN_API_KEY`를 서버 환경 변수에서 읽고 `Authorization: Bearer <KILN_API_KEY>`로 인증한다. 이 키는 프론트엔드로 보내지 않는다. 발급받은 키로 `GET {KILN_BASE_URL}/models`를 호출해 `data[].id`에 `qwen3-32b`가 있는지 확인한다. 없으면 모델 호출을 중단하고 설정 오류를 보고한다. 이 확인을 통과한 뒤 `POST {KILN_BASE_URL}/chat/completions`에 `model`, 역할별 `messages`, `max_tokens`를 보내며, 응답의 `choices[0].message.content`를 검증해 사용한다.

현재 Kiln의 `qwen3-32b`는 구조화 출력과 강제 도구 호출을 지원하지 않는다. `response_format`에 의존하지 말고 JSON 응답을 프롬프트로 요청한 다음 파싱·스키마 검증한다. `finish_reason=length`, 빈 내용, 유효하지 않은 JSON은 정상 제안으로 취급하지 않는다. 응답의 `usage.prompt_tokens`, `usage.completion_tokens`, `usage.total_tokens`와 `X-Neocloud-Generation-Id` 헤더를 흐름별 사용량 로그에 저장한다. `request_id`는 이 공급자 생성 ID를 가리키며 우리 HTTP 응답의 `request_id`와 구별한다. Kiln 401/402/403/404/429 또는 연결 장애를 가짜 협상 성공으로 대체하지 않는다.

체인 설정 키는 `CHAIN_RPC_URL=https://sepolia.base.org`, `CHAIN_ID=84532`, `CHAIN_EXPLORER_URL=https://sepolia.basescan.org`, `CONTRACT_ADDRESS`, `RELAYER_PRIVATE_KEY`다. 공개 기본값과 빈 비밀값 예시는 `.env.example`에 둔다. 백엔드는 `web3.py`로 RPC·계약을 연결하고 체인 ID를 확인한다. 실제 키와 개인키의 값은 Git·문서·API 응답에 넣지 않는다. mock 연결과 실제 Kiln/체인 연결은 실행 모드와 로그에서 명확히 구별한다. Kiln의 동작이 바뀌면 [API 참조](https://kiln.bricksum.com/docs/en/api-reference), [모델 목록](https://kiln.bricksum.com/docs/en/models), [Chat Completions](https://kiln.bricksum.com/docs/en/api-reference/chat-completions)을 다시 확인한다.

## 9. 역할별 구현 인계

- **백엔드/AI:** 이 경로를 실제 구현하고 OpenAPI를 생성한다. 요청·응답/오류/권한 테스트, Kiln 호출·서버 조건 검사·상태 전이를 담당한다.
- **프론트:** 이 응답 타입과 상태를 사용한다. 구매자/판매자 화면을 분리하고 승인 전 스냅샷을 표시하며 `typed_data`를 변경 없이 지갑에 전달한다.
- **데이터:** ID·스냅샷·제안·감사·토큰 사용량을 저장하고 구매자/판매자별 조회를 제공한다. 비공개 필드가 공개 직렬화에 섞이지 않게 한다.
- **블록체인:** EIP-712 타입과 계약, 서명/tx/영수증 어댑터를 구현하고 백엔드와 해시 골든 벡터를 공유한다.

## 10. 계약 확인 시나리오

1. 기본 조건: 구매 의도 생성 → 판매자 매물 2~3개 → 협상 → 합의 ID → 양측 서명 → 실제 테스트넷 tx → 영수증/이벤트/해시 일치.
2. 예산 감소: 새 `BuyerIntent`로 실행해 총액 초과 제안을 차단하고 `reason_code`와 토큰 사용량을 확인.
3. 배송 기한 단축: 새 `BuyerIntent`로 실행해 불가능한 판매자를 제외하거나 `NO_MATCH` 종료.
4. 한쪽 거절·만료·다른 해시 서명: `record_agreement` 호출 없음. 모델 오류·체인 실패는 실제 성공으로 표시하지 않음.

이 계약에 변경이 필요하면 백엔드 담당이 `api-spec.md`와 OpenAPI·예시 응답을 함께 갱신하고 영향 받는 역할에 알린다. 공통 데이터 필드가 바뀌면 `project.md`도 함께 갱신한다.
