# Policy / Blockchain 구현 담당 — v2

현재 구현 계약은 project.md 및 docs/IMPLEMENTATION.md다. 최신 동료의 EIP-712 계약/서명 v1 원문과 벡터는 docs/legacy/blockchain.md에 보존했다. 이번 사용자 지시는 구매자 세션의 hash 승인과 단순 감사 기록 계약을 요구한다. 현재 AuditRegistry가 양측 지갑 서명을 검증한다고 주장하지 않는다.

PolicyPort는 backend/app/policy.py, ChainPort는 backend/app/chain.py, durable outbox/nonce worker는 backend/app/worker.py, Solidity 계약은 contracts/AuditRegistry.sol이다. 지정 relayer만 hash/record ID를 기록하고 중복/zero를 거절한다. 모든 가격/재고/사양/배송/만료/버전 재검사는 서버에서 수행한다.

Base Sepolia라는 팀 선택을 운영진 허용 증거로 간주하지 않는다. 환경 변수의 허용 ID/근거/RPC/network/chain ID/explorer/contract/relayer를 확인한 뒤 실제 배포/제출한다. prepare된 original tx hash/nonce를 DB에 먼저 저장하고 UNKNOWN에서는 조회만 한다. receipt.status/event/contract query/hash/확인 수가 일치해야 CONFIRMED다. mock tx/link는 만들지 않는다.

빌드: npm --prefix chain ci && npm --prefix chain run compile. 검증: python -m pytest backend/tests/policy backend/tests/blockchain -q. 배포/검증 스크립트: scripts/deploy_chain.py, scripts/verify_chain.py. 로컬 PyEVM 테스트는 통과했으며 운영진 허용 외부 테스트넷 실행은 미검증이다.
