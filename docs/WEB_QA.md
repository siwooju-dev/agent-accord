# Accord 웹 QA 및 임시 공유

## 현재 동작 범위

- `/`는 백엔드 API를 호출한다. 화면의 상태 칩은 `/health` 응답을 읽으며, API·Kiln·체인 설정을 구분해 표시한다.
- 공개 매물은 API에서 가져온다. 가상 시드 매물은 카드마다 `데모 매물`, 계정이 등록한 데이터는 `판매자 등록`으로 표시한다. 증빙 설명은 판매자 제출 요약이며 실물·진품·작동 검증이 아니다.
- 지갑 로그인은 구매자/판매자 역할, origin, Base Sepolia 주소에 묶인 5분짜리 서명을 사용한다. 로그인은 트랜잭션을 보내지 않는다. 토큰은 탭 메모리에만 저장된다.
- 라이브 지갑 로그인은 `.env.local`에서 설정한 구매자/판매자 주소만 허용한다. 각 역할은 서로 다른 주소여야 하며 구매 지갑은 한 시간에 새 협상을 3회까지 시작할 수 있다. 같은 idempotency key 재요청은 기존 결과를 반환한다.
- 협상은 Kiln live 설정일 때에만 Kiln에 요청한다. mock 설정이나 API 오류가 live 결과로 가장하지 않는다. 두 지갑의 별도 EIP-712 승인이 있어야 relayer가 Base Sepolia에 합의 **기록**을 보낸다. 이 앱은 결제·배송·소유권 이전을 처리하지 않는다.
- 매물 등록은 증빙 없이 가능하다. 현재 파일 업로드 API가 없고, 기존 증빙 ID는 같은 판매 지갑이 소유한 기록만 재사용할 수 있다.

## 로컬 브라우저 점검

저장소 루트에서 두 터미널을 연다. `.env.local`에는 백엔드 전용 Kiln 및 테스트 relayer 설정을 둔다. 프론트 환경변수에는 비밀값을 넣지 않는다.

터미널 1 — live API와 분리된 QA 데이터베이스:

```sh
DATABASE_PATH=.local/web-qa.sqlite3 PORT=8001 bash scripts/run_backend.sh live
```

터미널 2 — 프론트엔드:

```sh
cd frontend
ACCORD_API_TARGET=http://127.0.0.1:8001 npm run dev -- --host 127.0.0.1 --port 5180
```

브라우저에서 `http://127.0.0.1:5180/`을 연다. `/health`가 `mode=live`, `chain_mode=live`, Kiln 키 설정 및 컨트랙트 설정을 보여야 한다. 이 구성 표시는 연결 성공이나 모델 호출 성공의 증거가 아니다. 실제 협상 요청의 결과와 감사 기록에서 Kiln 사용량을 확인한다.

## 지갑으로 기능 확인

메인 화면(`/`) 기준 버튼: 오른쪽 위 **구매자로 로그인 / 판매자로 로그인** → **조건 · 매물**에서 예시 조건(기본 · 예산 ₩200만 · 기한 3일) 선택 후 **이 조건으로 협상 시작** → **협상** 탭에서 Kiln 진행과 결과 확인 → **합의서로 가기** → **지갑 확인 · 서명 자료 불러오기** → 확인 체크 → **MetaMask로 서명**. 판매자는 로그아웃 후 MetaMask 계정을 바꾸고 **판매자로 로그인** → 개요의 **서명할 합의서** → 같은 순서로 서명. **기록** 탭에 이벤트, Kiln generation id·토큰·비용, BaseScan 링크가 나온다. 아래 번호 순서는 `?mode=console` 콘솔에서도 같다.

1. Chrome/Brave에 MetaMask를 설치하고 Base Sepolia 네트워크를 선택한다. `.env.local`에 설정된 공개 구매자 지갑과 판매자 지갑 두 계정을 사용한다. 브라우저 프로필을 분리하면 한쪽에서 계정을 바꿀 때 다른 쪽 세션이 로그아웃되는 일을 피할 수 있다.
2. 구매자 프로필에서 `/`에 접속해 **구매자로 지갑 연결**을 누른다. Base Sepolia 전환을 승인하고 로그인 문구를 서명한다. 이 단계는 가스비나 트랜잭션이 없어야 한다.
3. 매물 3개가 API에서 읽히고 각각 `데모 매물`로 표시되는지 확인한다. GPU 모델 `RTX 4090`, 기본 총예산 `2,400,000원`, 기본 배송 기한으로 구매 의도를 만들고 **협상 시작**을 누른다.
4. 협상 상태가 완료될 때까지 기다린다. 정상 live 흐름은 감사에서 `source=api`, Kiln generation ID와 실제 수집 사용량을 보여준다. `BLOCKED`, `NO_MATCH`, `KILN_*`는 성공이 아니며, AI가 틀린 조건을 제시해도 서버가 승인 후보로 넘기면 안 된다.
5. 합의 스냅샷의 금액·배송·보증·만료·두 지갑·해시를 확인하고 구매자 지갑으로 EIP-712 서명한다.
6. 판매자 프로필에서 판매자 지갑으로 **판매자로 지갑 연결**한다. 내 합의 목록을 새로고침하고 같은 ID·해시인지 확인한 다음 판매자 지갑으로 승인한다. 같은 지갑이 buyer와 seller 두 역할을 동시에 승인하지 않도록 두 공개 주소를 달리 사용한다.
7. 두 승인 뒤 `RECORDED`만으로 끝내지 않는다. 응답의 chain ID가 `84532`, 영수증이 `success`, 이벤트가 `AgreementRecorded`, 기록 해시가 화면의 snapshot hash와 같은지 확인하고 BaseScan 링크를 연다. `MOCK_RECORDED`는 체인 전송이 아니다.
8. 로그아웃 버튼을 눌러 서버 세션이 폐기되는지 확인한 뒤 같은 토큰이 `401`을 받는지 확인한다. 지갑 계정을 바꾸면 기존 세션도 로그아웃되어야 한다. 네트워크가 끊긴 상태에서 로그아웃하면 서버 폐기를 확인하지 못했다는 안내가 보여야 한다. 잘못된 계정은 합의 목록/승인에 접근할 수 없어야 하고, 지갑 서명을 거절해도 세션이 만들어지지 않아야 한다.

이 기능 확인은 테스트넷 relayer가 가스비를 쓰는 실제 외부 트랜잭션을 보낸다. 각 브라우저 승인 버튼은 사용자가 확인한 합의안에 대해서만 누른다. 공개 매물 확인과 로그인에는 트랜잭션이 없다.

## API 오류·보안 점검

- 매물 목록의 JSON에 `private_policy`, `min_item_price_krw`, `seller_wallet`이 없어야 한다.
- 라이브 로그인은 설정하지 않은 지갑이나 반대 역할 지갑을 거부해야 한다. 한 지갑의 로그인 요청 제한에 도달해도 다른 지갑은 로그인할 수 있어야 한다.
- 로그인 전 `POST /api/buyer-intents`, `POST /api/listings`, 협상·합의 API는 `401`이어야 한다. 구매자가 매물을 등록하거나 판매자가 구매 의도를 만들면 `403`이어야 한다.
- 로그인 문구를 두 번 교환하거나 5분 뒤 교환하면 `401`; 서명자·역할·원본 origin이 다르면 거부되어야 한다.
- 같은 `Idempotency-Key`로 입력을 바꾸면 `IDEMPOTENCY_CONFLICT`; 매물의 증빙 소유자가 다르면 `EVIDENCE_NOT_OWNED`여야 한다.
- 예산, 판매자 최저가, 재고, 보증, 배송기한이 맞지 않는 제안은 협상 감사에 차단 사유가 남고 승인 가능 합의로 나타나지 않아야 한다.
- 예산 사전 검사로 차단된 구매자 응답은 `CANDIDATE_UNAVAILABLE`만 보여야 하며, 판매자 매물 ID와 구체적인 최저가 차단 코드를 노출하면 안 된다.
- `APP_MODE=live`의 `CHAIN_ID`가 `84532`가 아니면 서버 시작이 실패해야 한다. `scripts/deploy_registry.py`도 전송 전에 다른 체인 ID를 거부해야 한다.
- `.env.local`, 세션 토큰, 로그인 서명, relayer 개인키, Kiln 키가 브라우저 번들·응답·로그·커밋에 없는지 확인한다.
- DB와 Kiln 호출 로그 파일은 권한 `0600`이어야 한다.
- Vite dev/preview의 HTML 응답에는 `Content-Security-Policy: frame-ancestors 'none'` 및 `X-Frame-Options: DENY`가 있어야 한다.

## 임시 ngrok 공유

먼저 의존성을 설치하고 검증된 프론트 빌드를 만든다. 백엔드는 loopback `127.0.0.1:8001`에만 바인딩한다.

```sh
cd frontend
npm ci
npm run build
ACCORD_API_TARGET=http://127.0.0.1:8001 ACCORD_PUBLIC_TUNNEL_API=true npm run preview -- --host 127.0.0.1 --port 5180 --strictPort
```

다른 터미널에서 프론트 포트만 공개한다.

```sh
ngrok http 5180
```

ngrok이 출력하는 `https://…ngrok-free.app` 주소를 공유한다. API는 Vite preview의 same-origin 프록시를 통해서만 도달하며 백엔드 포트는 터널에 넘기지 않는다. 공개 프록시는 HTTPS ngrok host/proxy 정보가 일치할 때만 요청을 전달하고, 상태를 바꾸는 요청에는 같은 origin을 요구한다. 주소는 임시이며 새 ngrok 세션을 시작하면 달라질 수 있다. 테스트 뒤 ngrok 터미널에서 `Ctrl-C`를 눌러 끊는다. 무료 ngrok은 브라우저에서 최초 한 번 안내 화면을 보여줄 수 있다. `Visit Site`를 누르면 앱으로 이동한다.

현재 실행 중인 QA 주소(2026-09-30 10:20 확인): [https://fc33-58-224-72-206.ngrok-free.app](https://fc33-58-224-72-206.ngrok-free.app). ngrok 프로세스가 종료되거나 주소가 바뀌면 이 링크는 만료된다.

공개 URL 확인은 다음처럼 한다. `<NGROK_URL>`에는 ngrok이 보여준 HTTPS 주소를 넣는다.

```sh
curl -sS -D - "https://YOUR-NGROK-HOST.ngrok-free.app/" -o /dev/null
curl -sS "https://YOUR-NGROK-HOST.ngrok-free.app/__backend/health"
curl -sS "https://YOUR-NGROK-HOST.ngrok-free.app/api/listings"
```

HTML 응답에서 위 frame 정책 헤더를 확인한다. health는 `mode=live`, `chain_mode=live`, `chain.chain_id=84532`여야 한다. 매물 목록에는 데모 매물들이 보여야 하지만 private floor와 seller wallet은 없어야 한다. 설정된 지갑 두 개로만 서명 로그인을 확인한다.

Proof export는 기본적으로 `.local/proof-export/`에 owner-only 권한으로 저장한다. 버전 관리 대상 문서와 README를 갱신하는 경우에만 명시적으로 `scripts/export_proof.py --publish`를 사용한다.

## 자동 확인

저장소 루트에서 실행:

```sh
.venv/bin/python -m pytest -q backend/tests
cd frontend && npm test -- --run && npm run lint && npm run build
```

Base Sepolia/RPC, Kiln `/models`, 과거 트랜잭션 확인은 별도 읽기 전용 점검으로 기록한다. 자동 테스트와 mock 체인 결과는 실 Kiln 또는 온체인 성공을 증명하지 않는다.
