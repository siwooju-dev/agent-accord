# Implementation v2

사용자의 2026-09-29 전체 구현 지시를 기존 GPU/양측 지갑 서명 설계보다 우선 적용했다. 실행 가능한 대상은 노트북 Buyer/Seller 가격 협상, 결정적 서버 검사, 구매자의 hash 승인, relayer의 최소 감사 해시 기록이다. seller ACCEPT는 판매자 Agent의 판단이며 판매자 사람의 지갑 서명이 아니다. 컨트랙트는 양측 EIP-712 서명을 증명한다고 주장하지 않는다.

## 코드와 영속성

- FastAPI/Pydantic 계약: `backend/app/main.py`, `schemas.py`; SQLAlchemy 2 테이블: `db.py`; SQLite 기본, PostgreSQL psycopg 선택.
- `auth_sessions`, `products`, `seller_policies`, `deals`, `buyer_policies`, `negotiations`, `proposals`, `rounds`, `agreements`, `approvals`, `audit_events`, `model_usage`, `chain_records`(outbox), `chain_nonces`, `idempotency`.
- Alembic 0001은 정적 스키마다. 앱 시작 시 임의 create_all하지 않고 migrate를 요구한다. 테스트용 독립 DB에만 create_all을 쓴다. seed는 존재하는 상품을 덮어쓰지 않는다.
- SQLite BEGIN IMMEDIATE로 상태 변경을 직렬화한다. PostgreSQL은 DB 전역 advisory transaction lock을 사용한다. 소규모 데모에 적합한 단순 안전 우선 선택이며 높은 처리량에서는 딜/재고/relayer 단위 잠금으로 세분화해야 한다. PostgreSQL 실환경 검증은 미실행이다.
- unique(owner,scope,key), unique(deal,policy_version) 협상/합의, unique(agreement) 승인, unique(deal) 체인 기록을 적용한다. 기록 큐 생성과 승인/재고 예약은 같은 DB commit이다. 이 재고 예약은 결제나 주문이 아니다.

## 협상과 정책

한 딜에서 하나의 선택 상품을 buyer/seller가 번갈아 협상한다. 최대 라운드는 양측 제안 합계이며 2~12다. precheck는 seller floor+배송비+수수료가 예산 이하인지, 판매자/사양/배송/재고/만료를 검사한다. 불가능하면 호출 없이 BLOCKED. 제안마다 fresh 데이터를 다시 검사한다. ACCEPT는 직전 상대 가격과 같아야 한다. 모든 제안/차단에 policy_version과 reason_codes/checks가 저장된다. 사유문으로 통과 여부를 바꾸지 않는다.

mock buyer는 공개 asking price의 96%와 본인 총예산 한도를 고려한다. mock seller는 본인 정책으로 ACCEPT/COUNTER한다. 920000은 고정 기대값이 아니다. HTTP fake 테스트에서는 임의의 938765 응답을 합의에 반영해 가격 전달을 검증했다. 이것은 live Kiln 검증이 아니다.

start의 durable claim은 모델 호출 전에 commit되어 중복 start에 호출이 발생하지 않는다. 호출 동안 DB 잠금을 잡지 않는다. 정책 변경 시 이전 결과를 폐기하며 late result도 usage와 discarded 이벤트를 남긴다. NEGOTIATING 중 프로세스가 종료되면 자동으로 모델 호출을 재실행하지 않는다. 정책을 새 버전으로 저장/확정해 재시작한다. MODEL_CALL_STARTED가 남고 반환을 못 받은 호출의 정확한 provider 사용량은 복구할 수 없으므로 미측정으로 보고한다.

## 합의와 체인

Snapshot 필드: schema_version, agreement_id, product/seller ID 및 버전, 공개 상품명/RAM/SSD, 상품가/배송비/수수료/총액, 배송일, policy_version, nonce, expiry, source. 개인정보와 floor/최대예산은 제외한다. UTC 시각은 ISO 8601, 키 정렬·UTF-8·공백 없는 JSON에 SHA-256을 적용한다. 승인 직전 hash, 정책, 상품/seller 버전, 배송/금액, 재고, 만료를 재검사한다. 실패 승인도 이벤트로 보존한다. 정책 변경은 기존 라운드·합의·승인을 valid=false로 남긴다. 이미 승인/기록 큐가 있는 딜은 정책 변경을 막고 새 딜을 요구한다.

`AuditRegistry.sol`은 지정 relayer만 bytes32 record ID와 bytes32 audit hash를 저장할 수 있다. record_id=SHA256(canonical({agreement_id})), audit_hash=SHA256(snapshot)다. 중복/zero hash를 거절한다. 원문은 DB에 있으며 온체인 해시만으로 원문을 복원하거나 정책 판단의 정확성/결제/인도를 증명할 수 없다.

`ChainPort.prepare → durable signed hash/nonce 저장 → broadcast → reconcile` 순서다. 서명 raw tx는 DB 내부에만 있고 API에서는 제외한다. nonce는 DB에서 relayer별로 직렬 예약한다. 별도 프로젝트/DB/지갑 사용으로 외부 nonce 충돌을 피해야 한다. 브로드캐스트 불명, RPC 실패, 프로세스 중단은 UNKNOWN/SUBMITTING으로 남겨 기존 hash/nonce/record_id를 조회한다. UNKNOWN을 신규 nonce로 재전송하지 않는다. prepare 이전 실패로 hash가 없으면 자동 해결하지 못하며 운영자가 RPC·nonce·기록 상태를 조사해야 한다. 확정 실패/UNKNOWN에서 새 딜을 만들기 전 원본 체인 상태를 확인해야 한다.

CONFIRMED는 올바른 네트워크, 올바른 계약/relayer, 원본 tx receipt.status=1, 정확한 receipt tx hash/to, AuditRecorded record ID/hash, records 조회 hash, 설정 확인 수가 모두 일치할 때만 사용한다. mock은 tx_hash/chain_id/explorer=null 및 MOCK_RECORDED다. Worker는 FastAPI background task로 1회 처리하고 종료/재시작 후 `python scripts/manage.py worker`로 pending/unknown/queued를 재조회한다.

## 화면과 검증

React/Vite UI는 generated OpenAPI type과 openapi-fetch를 사용한다. cookie/CSRF를 GET 세션에서 복구하고 딜 ID만 localStorage에 저장한다. 상태/증거/usage는 모두 서버 GET에서 복구한다. 네트워크 재시도 key는 sessionStorage에 유지한다. 저장하지 않은 조건에서는 확정/협상/승인을 막고, 명시적 총액/판매자/배송 확인 checkbox가 있어야 승인한다. 실패/UNKNOWN/모의 기록을 분리한다.

자동 검증은 `backend/tests`의 A~E 및 정책 경계/보안/계약/마이그레이션/실행형 로컬 EVM, `frontend/src/App.test.tsx`, `e2e/tests/dealbattle.spec.ts`다. 로컬 EVM receipt는 메모리 테스트 체인의 실행 증거이며 운영진 허용 devnet/testnet 심사 증거가 아니다. 실제 테스트넷과 Kiln은 설정/권한 부재로 미실행이다. 실제 수행 결과는 `reports/VALIDATION.md`에 기록한다.
