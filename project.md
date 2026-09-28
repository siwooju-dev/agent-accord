# DealBattle — 노트북 에이전트 협상

2026-09-29 사용자의 전체 구현 지시를 적용한 실행 계약 v2다. 이전 main의 GPU·양측 EIP-712 설계는 [docs/legacy/project.md](docs/legacy/project.md)에 원문을 보존했다. 이번 구현은 노트북, 구매자 hash 승인, relayer 감사 해시 기록이다. 판매자 사람 지갑 서명이나 결제는 구현했다고 주장하지 않는다.

Buyer/Seller Agent는 분리된 문맥으로 OFFER/COUNTER/ACCEPT/REJECT와 정수 KRW 가격을 제안한다. 서버가 상품가+배송비+수수료 총예산, seller floor, allowlist, RAM/SSD, 배송, 재고, 만료, 라운드 한도를 결정적으로 검사한다. 불가능한 딜은 모델 호출을 생략한다. seller ACCEPT도 fresh 정책 검사와 직전 제안 가격 일치를 요구한다.

구매자가 조건을 확정한 뒤 협상하고, 표시된 상품·판매자·총액·배송·만료를 확인해 snapshot hash를 승인한다. Snapshot에는 상품/판매자/정책 버전, 가격 구성, nonce/expiry를 포함하고 비공개 가격과 개인정보는 제외한다. SHA-256(canonical JSON)을 오프체인 원문과 함께 보관한다. 원문 불변, policy 변경은 이전 라운드/합의/승인 무효화, 기록 작업 생성 후 변경은 새 딜을 요구한다.

스택은 FastAPI/Pydantic/SQLAlchemy/Alembic/SQLite, React/TypeScript/Vite, web3.py + Solidity AuditRegistry다. PostgreSQL 전환 구조가 있으나 실제 Postgres 실행은 미검증이다. 코드·OpenAPI·generated 프론트 타입은 v2로 일치 검증한다. 최신 remote의 v1 api-spec은 원문을 legacy에 보존하며 현재 API로 사용하지 않는다.

APP_MODE=mock은 명시해야 하며 mock 모델·mock 기록을 사용한다. live는 Kiln 변수·인증된 세션·허용 EVM 네트워크 설정이 필요하고 오류 시 mock fallback하지 않는다. 운영진이 지급한 KILN_BASE_URL/API_KEY/MODEL을 환경 변수로 받고 URL/모델을 기본값으로 넣지 않는다. 공식 인증은 Bearer, 경로는 /models와 /chat/completions다. PDF의 gpt-oss-120b 요건을 Qwen 선호만으로 충족한다고 쓰지 않는다.

이전 팀 문서에서 선택한 Base Sepolia는 팀 선택 기록이며 운영진 허용 증거로 자동 취급하지 않는다. CHAIN_ALLOWED_IDS/EVIDENCE와 실제 RPC/ID/contract/relayer를 받아서 동작한다. UNKNOWN에서는 기존 tx/hash/nonce/record_id를 조회하고 자동 재전송하지 않는다. receipt.status=1, 원본 tx/계약, 이벤트/조회 hash, 확인 수가 맞을 때만 RECORDED다. mock은 MOCK_RECORDED 및 tx/explorer=null이다.

모든 simulated 상품은 source=simulated이며 floor는 공개 상품/API와 Buyer Agent에서 숨긴다. seller 모델 이유 원문도 private DB에 두고 공개 설명을 쓴다. 딜별 라운드/판정/승인/감사/usage/receipt를 GET으로 조회한다. mock usage는 null/unavailable이며 에너지는 미측정이다.

실행·환경·시드·마이그레이션·서버·프론트·테스트·live 다음 명령은 [README](README.md), 계약은 [docs/API.md](docs/API.md), 구조/복구는 [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md), Kiln 근거는 [docs/KILN_INTEGRATION.md](docs/KILN_INTEGRATION.md), 실제 결과는 [reports/VALIDATION.md](reports/VALIDATION.md)를 따른다.

현재 mock 앱·로컬 EVM 테스트는 검증했으며 실제 Kiln/운영진 허용 테스트넷은 자격 증명 부재로 미실행이다. 공식 제출 요건 전체 완료 상태가 아니다.
