# Frontend 구현 담당 — v2

현재 구현은 frontend/ React+TypeScript+Vite 및 OpenAPI generated client다. 원래 GPU/양측 지갑 서명 설계는 docs/legacy/frontend.md에 보존했다. 이번 사용자 지시에서는 노트북 조건·Buyer/Seller 협상·구매자 hash 승인·감사 기록 화면을 만든다. 실제 지갑 결제나 양측 지갑 서명 UI를 구현했다고 주장하지 않는다.

조건 입력/저장/확정, 협상 타임라인, 서버 정책 PASS/BLOCK, 총액·판매자·배송 확인 checkbox와 승인/거절, evidence/receipt/event/usage를 표시한다. 미저장 변경은 확정/협상/승인을 차단한다. cookie/CSRF 세션 및 딜 상태는 GET으로 복구하고 응답 유실 재시도에 같은 idempotency key를 유지한다.

floor 및 seller 원본 private reason은 서버 응답에 없다. APP_MODE와 simulated source를 표시하고 mock 기록은 실제 tx/link를 만들지 않는다. UNKNOWN/PENDING/FAILED/CONFIRMED 상태를 구분하고 결제 완료라고 표현하지 않는다. live UI는 로그인 credential을 저장하지 않으며 운영자 인증 세션을 요구한다.

검증: npm --prefix frontend run generate:api; npm --prefix frontend test; npm --prefix frontend run build; npm --prefix e2e test. 생성 타입을 수동 수정하지 않는다. 실제 수행 결과/화면 복구/변경/재시도 검증은 reports/VALIDATION.md 및 e2e/README.md를 참조한다.
