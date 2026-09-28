# Backend / AI 구현 담당 — v2

먼저 README.md, project.md, openapi.yaml, docs/API.md, docs/KILN_INTEGRATION.md, docs/IMPLEMENTATION.md를 읽는다. 이전 GPU/양측 서명 담당 원문은 docs/legacy/backend-ai-agent.md에 있다. 사용자 전체 구현 위임으로 역할 간 파일도 통합 수정했다.

현재 소유 구현은 backend/app/main.py·schemas.py·agent.py·service.py·config.py·auth.py다. 분리된 buyer/seller 문맥, strict JSON·가격 검증, deterministic PolicyPort, DB 소유권/CSRF/idempotency/version/트랜잭션, 승인/outbox, GET 증거/usage를 제공한다. 인증되지 않은 live 데모 세션이나 mock fallback은 금지한다.

Kiln은 환경 변수로만 URL/키/model/auth를 받는다. 공개 문서의 모델/경로와 실제 팀 credentials 검증을 구분한다. gpt-oss-120b 대체 승인 근거 없는 Qwen-only를 공식 요건 충족으로 쓰지 않는다. probe 명령/남은 live 검증은 README와 docs/KILN_INTEGRATION.md를 따른다.

검증: python -m pytest backend/tests/backend backend/tests/contracts backend/tests/integration -q. 역할별 완료·실제 실행 결과는 reports/VALIDATION.md. 실제 Kiln 응답은 미검증이고 mock/HTTP fake 결과만 검증했다.
