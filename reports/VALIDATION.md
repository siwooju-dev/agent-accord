# Validation — 2026-09-29 KST

## 실행 환경과 범위

Windows PowerShell, Python 3.12 전용 `.venv`, Node.js 24.16.0. 실제 저장소는 상위 작업 폴더가 아닌 `policy-guard-ai-agent/`의 Git 저장소다. 개발 시작 시 최신 main을 fetch/fast-forward한 뒤 `codex/dealbattle`에서 구현했다. 시작 main은 설계 문서만 있었고 README/OpenAPI/docs/코드가 없었다. 이후 동료가 원격 main에 설계/환경 예시 변경을 추가했으므로 통합 시 그 변경을 먼저 반영한다. 모델/체인 실사용 설정은 없다.

## 실제 실행 결과

| 실행 | 실제 결과 |
|---|---|
| Python 전용 venv 생성, `pip install -e 'backend[dev]'` | 성공; FastAPI/Pydantic/SQLAlchemy/Alembic/web3 설치 |
| `python scripts/manage.py migrate` | 0001 → 0002 적용 성공 |
| `python scripts/manage.py seed` | simulated 노트북 4개 생성; 재시드 중복 없음 테스트 통과 |
| `npm --prefix chain ci/install`, `npm --prefix chain run compile` | solc 0.8.28 컴파일 성공 |
| `python -m pytest backend/tests -q --basetemp=.test-temp-final -p no:cacheprovider --tb=short` | **52 passed**, 2 upstream deprecation warnings |
| `npm --prefix frontend run generate:api` | OpenAPI TypeScript 생성 성공 |
| `npm --prefix frontend test` | **2 passed** |
| `npm --prefix frontend run build` | tsc + Vite 6.4.3 build 성공 |
| `$env:E2E_BROWSER_CHANNEL='msedge'; npm --prefix e2e test` | **6 passed**, 실제 headless Edge, 독립 mock DB |
| `python scripts/manage.py openapi --check` | YAML == JSON == 실제 서버 /openapi.json |
| `python -m pip check` | No broken requirements found |
| npm dependency audits (frontend/chain/e2e) | 수정 후 각각 0 vulnerabilities |
| `python scripts/demo.py` | A MOCK_RECORDED; B/C BLOCKED |
| `python scripts/probe_kiln.py` | NOT_RUN: KILN_BASE_URL/KILN_API_KEY/KILN_MODEL 누락, exit 2 |

PowerShell의 python 표기는 실제로 `& ./.venv/Scripts/python.exe`를 사용했다. OS sandbox가 esbuild의 상위 디렉터리 탐색을 막아 빌드/E2E는 승인된 실행 권한에서 검증했다. 기존 임시 pytest 폴더의 ACL 문제는 저장소 내부 전용 basetemp로 해소했다. eth-tester[py-evm] extra는 Windows에서 safe-pysha3 C++ 빌드가 필요해 실패했다. eth-tester + py-evm 직접 고정 조합은 기존 pycryptodome backend를 사용해 설치/실행 성공했다. Chromium 설치 대기 때문에 실제 E2E는 설치되어 있던 Edge로 완료했다. 이런 준비 실패를 테스트 통과로 보고하지 않았으며 최종 결과는 위 표의 실제 재실행 결과다.

## A~E와 증거

- A: max_total=1,000,000원, RAM=16, SSD=512, seller-a, 배송/만료 충족 → mock buyer OFFER 931,200원, seller ACCEPT 같은 가격, shipping 10,000 + fee 5,000 = total 946,200원. hash 확인 승인 1건, outbox/체인 논리 기록 1건. mock tx hash/chain ID/explorer는 null.
- B: 예산만 900,000원 → floor 910,000원 + 배송/수수료가 예산을 초과. BUDGET_EXCEEDED, calls=0, approvals=0, chain records=0.
- C: allowlist에서 seller-a 제외 → SELLER_NOT_ALLOWED, calls=0, approvals=0, records=0.
- D: 음수/float/통화 필드/상한/중복 JSON key/JSON 오류/timeout/빈 usage/가격 범위 위반/지시문 이유에서 BLOCKED. 허용되지 않은 ACCEPT 가격은 ACCEPT_MISMATCH.
- E: 동시 approve 4회와 중복 start에도 승인/기록/재고예약 1회; policy 변경 시 이전 라운드/합의/승인 무효; 호출 도중 정책 변경 late result 폐기; UNKNOWN에서 기존 tx 조회만 수행.

HTTP MockTransport가 전달한 `938765` 가격이 합의에 그대로 반영되는 어댑터 테스트를 실행했다. 응답 fixture의 호출당 prompt=100, completion=30, total=130, 두 호출 합계=260은 **HTTP fake 데이터**이며 live token 측정이 아니다. A의 mock 호출별 buyer/seller prompt/completion/total은 모두 null/unavailable, latency=0ms이며 실제 모델 성능 측정이 아니다. B/C는 호출을 아예 생략했다. 에너지 실측/추정 수치는 없다.

로컬 PyEVM에서 AuditRegistry 배포·서명된 record tx·receipt.status=1·AuditRecorded 이벤트·records 조회 해시 대조, 최소 확인 수, 권한 없는 relayer/zero hash/중복 거절을 실행했다. 방송 후 timeout을 주입한 경우 저장된 original tx hash/nonce로 CONFIRMED까지 복구했고 broadcast=1을 검사했다. **이 메모리 체인은 운영진이 허용한 외부 테스트넷 실행이 아니다.** 외부 chain ID/계약 주소/tx hash/receipt는 제출 가능한 실제 값이 없으므로 기재하지 않는다.

E2E는 실제 UI에서 A/B/C, 거절, policy 변경 후 재확정, 응답 유실 시 동일 idempotency key 재시도, 새로고침 GET 복구를 검증했다. desktop/mobile 스크린샷을 생성해 시각 확인했다. 출력은 `e2e/test-results/dealbattle-desktop.png`와 `dealbattle-mobile.png`이며 테스트 결과 폴더는 gitignore한다.

## 남은 외부 의존성

운영진 지급 KILN_BASE_URL/API_KEY/MODEL, gpt-oss-120b 대체 시 명시 허용 증거, 팀 계정의 모델/요금/응답 확인, 허용 chain/RPC/ID/explorer 근거, 테스트 자산 relayer, 실제 배포/tx receipt가 필요하다. PostgreSQL 및 HTTPS live 배포/실제 IdP 통합은 미검증이다. 재실행 명령은 README와 docs/KILN_INTEGRATION.md에 있다. 실제 결제·송금·판매자 사람 지갑 서명·실물 인도는 구현했다고 주장하지 않는다.
