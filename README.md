# DealBattle

노트북 Buyer/Seller Agent가 가격을 협상하고, 서버가 구매 조건을 검사한 뒤 구매자가 승인한 합의 해시를 허용된 devnet/testnet에 기록하는 서비스.

**상태: 실행 가능한 mock 앱과 로컬 EVM 검증 코드 구현. 실제 Kiln 및 운영진 허용 테스트넷 연동은 환경 설정 부재로 미검증. 결제·송금·실물 배송을 수행하지 않는다.** seller ACCEPT는 에이전트 응답이며 판매자 사람의 지갑 서명이 아니다. 테스트넷 기록은 감사 해시 기록이고 결제 영수증이 아니다. 공식 요건 전체를 충족했다고 주장하지 않는다.

## 실행 (저장소 루트)

Python 3.11 이상(검증 환경 3.12), Node.js 22.12 이상(검증 환경 24). `.env.example`은 변수 이름 안내이며 자동 로드하지 않는다. `APP_MODE=mock`을 명시해야 로컬 데모를 시작할 수 있다. 비밀값은 환경 변수로만 설정한다. `api key.txt`, .env, DB, 지갑 키는 gitignore 대상이다.

Windows PowerShell:

```powershell
python -m venv .venv
# python이 PATH에 없으면 설치된 Python 실행 파일의 절대 경로를 사용한다.
& ./.venv/Scripts/python.exe -m pip install -r backend/requirements.lock
& ./.venv/Scripts/python.exe -m pip install -e 'backend[dev]'
$env:APP_MODE = 'mock'
$env:CHAIN_MODE = 'mock'
& ./.venv/Scripts/python.exe scripts/manage.py migrate
& ./.venv/Scripts/python.exe scripts/manage.py seed
npm --prefix frontend ci
npm --prefix chain ci
npm --prefix chain run compile
# 터미널 1
& ./.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
# 터미널 2 (같은 저장소 루트)
npm --prefix frontend run dev
```

Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.lock
python -m pip install -e 'backend[dev]'
export APP_MODE=mock CHAIN_MODE=mock
python scripts/manage.py migrate
python scripts/manage.py seed
npm --prefix frontend ci
npm --prefix chain ci
npm --prefix chain run compile
# Terminal 1
python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
# Terminal 2
npm --prefix frontend run dev
```

[로컬 화면](http://localhost:5173) → 모의 데모 시작 → 조건 입력·딜 생성 → 조건 확정 → 협상 시작 → 총액·판매자·배송 확인 → 합의 승인 및 감사 기록. Vite가 `/api`와 `/health`를 서버로 proxy한다. Swagger는 [서버 API](http://127.0.0.1:8000/docs). 기본 DB `dealbattle.db`는 루트에 생성된다. seed는 4개의 simulated 노트북을 넣으며 기존 데이터를 수정하지 않는다. 재시드해도 기존 날짜/재고는 보존되므로 장기간 사용 후 만료된 fixture는 새 DATABASE_URL로 migrate/seed한다.

## 검증과 데모

Windows에서는 아래 `python` 대신 `& ./.venv/Scripts/python.exe`를 사용하거나 가상환경을 활성화한다. Linux에서는 위 가상환경을 유지한다. contract 비교는 항상 APP_MODE=mock으로 수행한다.

```text
python scripts/manage.py openapi --check
npm --prefix frontend run generate:api
python -m pytest backend/tests -q --basetemp=.test-temp
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix e2e ci
npm --prefix e2e exec -- playwright install chromium
npm --prefix e2e test
python scripts/demo.py
python scripts/manage.py worker
python scripts/probe_kiln.py
```

`npm --prefix chain run compile`은 EVM 테스트 전 필수다. Windows에서 설치된 Edge를 쓰려면 `$env:E2E_BROWSER_CHANNEL='msedge'` 후 E2E를 실행한다. Linux Chromium의 시스템 의존성은 `npm --prefix e2e exec -- playwright install --with-deps chromium`으로 준비한다. E2E는 8000/5173 포트를 사용해 별도 임시 mock DB를 만들므로 실행 중인 데모 서버를 먼저 종료한다. [E2E 안내](e2e/README.md).

현재 실행 결과/테스트 수/제약은 [검증 보고서](reports/VALIDATION.md). A 기본: 1,000,000원 예산, 16GB/512GB → mock 상품가 931,200원 + 배송 10,000원 + 수수료 5,000원 = 946,200원으로 합의·승인·모의 기록. B 예산만 900,000원 → 최저 가능 총액과 충돌해 BLOCKED, 모델 호출/승인/기록 0건. C seller-a 제외 → BLOCKED, 호출 0건. 920,000원은 요구 예시이며 고정 정답이 아니다. 실제 모델 응답은 다른 가격을 제안하거나 합의하지 않을 수 있다.

mock 사용량은 provider 측정이 없으므로 호출당 prompt/completion/total=null, source=unavailable. 실측 없이 0 token 또는 에너지 절감량을 만들지 않는다. live adapter의 HTTP fake 검증과 로컬 EVM 테스트는 실제 외부 호출/대회 테스트넷 증거와 구분한다.

## 환경 변수

| 변수 | 의미 |
|---|---|
| APP_MODE | 명시적 mock 또는 live; live 실패 시 mock fallback 없음 |
| DATABASE_URL | SQLite 기본; Postgres는 postgresql+psycopg://... 및 backend[postgres] 설치 |
| APP_ORIGIN | 기본 http://localhost:5173; live는 HTTPS 동일 출처 origin |
| SESSION_SECONDS | 기본 3600, 60~86400초 |
| AUTH_SIGNING_SECRET | live 인증된 세션용 HMAC 서명 키, 최소 32자; 환경 변수만 사용 |
| KILN_BASE_URL | 운영진 지급 API prefix 포함 base URL; 기본값 없음 |
| KILN_API_KEY | 서버 전용 API key; 파일·브라우저·로그에 넣지 않음 |
| KILN_MODEL | 운영진이 승인한 실제 model ID; 기본값 없음 |
| KILN_AUTH_MODE | bearer(공식 인증) 또는 x-api-key(공식 대안) |
| CHAIN_MODE | mock 또는 evm; live 앱은 evm 필수 |
| CHAIN_NETWORK | devnet 또는 testnet |
| CHAIN_ID / CHAIN_ALLOWED_IDS | 실제 chain ID / 명시적 허용 ID 쉼표 목록 |
| CHAIN_ALLOWED_EVIDENCE | 운영진 허용 근거 문서/공지 참조; 임의 문자열은 실제 허용 증거가 아님 |
| CHAIN_RPC_URL / CHAIN_EXPLORER_URL | 지급/허용 RPC 및 explorer base URL |
| CHAIN_CONTRACT_ADDRESS | 배포한 AuditRegistry 주소 |
| CHAIN_CONFIRMATIONS | receipt 최소 확인 수, 기본 1 |
| RELAYER_PRIVATE_KEY | 테스트 자산만 든 전용 relayer 개인키; 다른 DB/서비스와 공유하지 않음 |
| DEALBATTLE_PYTHON / E2E_BROWSER_CHANNEL | E2E 전용 Python 경로 / 선택 browser channel |

## 실연동에서 남은 단계

PDF 모델 요건은 사용자 지시에 따라 **gpt-oss-120b**로 다룬다. 기존 Qwen3-32B 선호만으로 대체를 인정하지 않는다. 현재 checkout에 PDF/키 파일은 없고 운영진이 지급한 URL/키/모델/체인 값도 없다. [Bricksum 공식 인증](https://kiln.bricksum.com/docs/en/authentication)과 [API 경로](https://kiln.bricksum.com/docs/en/api-reference)는 확인했으나 이 팀의 credentials/model 가용성은 미검증이다. [연동 근거](docs/KILN_INTEGRATION.md)에 공개 문서와 실제 검증의 차이를 기록했다.

1. 지급된 KILN 변수 4개를 환경 변수로 설정하고 `python scripts/probe_kiln.py`로 모델 목록을 확인한다. 모델이 다르면 운영진 대체 허용 근거를 받는다. 승인된 유료 1회 호출은 `python scripts/probe_kiln.py --call-once`로 실행해 provider usage를 보관한다. 자동 재시도하지 않는다.
2. 허용 chain/RPC/ID/explorer/근거, 테스트 자산 relayer를 환경 변수에 설정한다. `npm --prefix chain ci` 및 `npm --prefix chain run compile`, `python scripts/deploy_chain.py --deploy-approved-network`를 실행한다. deployment tx hash는 broadcast 이전 출력된다. 응답 불명 시 기존 hash를 조회하고 무조건 다시 배포하지 않는다.
3. CHAIN_CONTRACT_ADDRESS, APP_MODE=live, APP_ORIGIN=HTTPS origin, AUTH_SIGNING_SECRET을 설정한다. 동일 출처 HTTPS reverse proxy 뒤에서 서버/UI를 실행한다. 운영자가 인증한 사용자만 `python scripts/issue_credential.py --subject <authenticated-user-id>`로 짧은 로그인 credential을 받아 live 세션을 생성한다. 정식 IdP 연동은 후속이다.
4. UI로 협상/승인한다. `python scripts/manage.py worker`는 한 번의 outbox 처리/조회다. QUEUED를 처리하고 UNKNOWN/PENDING/SUBMITTING은 원본 tx만 조회한다. `/evidence`에서 snapshot/record ID/tx/receipt/event를 저장해 `python scripts/verify_chain.py --record-id <id> --tx-hash <hash> --snapshot <snapshot.json>`으로 독립 대조한다.

UNKNOWN의 원본 tx/nonce/record_id 확인 전 재전송하지 않는다. signer 준비 전 실패나 nonce 공백은 운영자의 체인 상태 조사가 필요하다. 실제 tx가 없으므로 이 저장소에는 외부 chain ID·계약·tx hash·receipt 심사 증거를 기재하지 않았다. 토큰 결제는 별도 사용자 서명·송금 안전성·결제 영수증을 갖춘 후속 기능이다.

## 문서와 구현 위치

[project.md](project.md), [API 계약](docs/API.md), [Kiln 연동](docs/KILN_INTEGRATION.md), [구현 구조/복구 제약](docs/IMPLEMENTATION.md), [OpenAPI](openapi.yaml). 역할 문서는 backend-ai-agent.md, blockchain.md, data.md, frontend.md다. backend/app에는 서버·정책·Kiln·DB·체인 adapter, contracts에는 최소 감사 계약, frontend에는 실제 API UI, scripts에는 migration/seed/probe/demo/deploy/verify/worker 명령이 있다.
