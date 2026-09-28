# Data / Integration / QA 구현 담당 — v2

현재 모델은 backend/app/db.py와 schemas.py다. 기존 sqlite3/GPU 담당 문서는 docs/legacy/data.md에 보존했다. 이번 사용자 지시에 따라 SQLAlchemy+Alembic, SQLite 로컬 및 Postgres 전환 구조를 구현했다.

테이블은 buyer policy/product/seller policy/proposal/round/agreement/approval/audit/usage/chain record/outbox/nonce/session/idempotency다. 금액은 정수 KRW, 시각은 UTC. 합의 snapshot은 API에서 수정하지 않는다. 공개 상품/Buyer Agent에 floor를 넣지 않고 seller 원본 이유는 서버 내부에만 보존한다.

마이그레이션: python scripts/manage.py migrate. 4개의 simulated 노트북 seed: python scripts/manage.py seed. 기존 시드/재고/날짜를 덮어쓰지 않는다. 새 데모 DB는 다른 DATABASE_URL로 migrate/seed한다. 정상·예산 차단·판매자 차단 데모: python scripts/demo.py.

검증: python -m pytest backend/tests/data backend/tests/integration -q; npm --prefix e2e test. A~E, 동시 승인/정책 변경/UNKNOWN/보안/실제 UI 복구 증거는 reports/VALIDATION.md에 있다. 실제 모델 호출 및 허용 테스트넷 증거는 자격 증명/설정 부재로 미실행이다.
