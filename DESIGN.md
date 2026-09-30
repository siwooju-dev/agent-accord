# Accord 디자인 시안

`my-front` 브랜치의 UI 시안이다. 화면 맨 위 **디자인 시안** 바(키보드 `1` `2`)로 두 스타일을 바꿔 볼 수 있다. 선택은 브라우저에 기억되고 `#clear`, `#studio` 해시로 바로 열 수 있다.

| 시안 | 방향 | 서체 |
|---|---|---|
| A · Clear | 밝은 회색 바탕, 흰 카드, 파란 포인트, 둥근 모서리. 한국 핀테크 앱의 친절한 톤 | Pretendard |
| D · Studio | 무광 그레이, 점 격자, 검은 테두리와 오프셋 그림자, 오렌지 포인트. 하드웨어 제품 사이트 톤 | Bricolage Grotesque + Pretendard + JetBrains Mono |

## 실제 자료

코드로 그린 GPU 대신 **실제 사진과 영상**을 쓴다. 모두 Wikimedia Commons의 자유 라이선스 자료이고, 출처는 화면 하단 "사진 · 영상 출처"와 각 증빙 화면 아래에 표시한다(`src/data/media.ts`의 `ALL_CREDITS`).

| 매물 | 사진 | 증빙 |
|---|---|---|
| 셀러 01 · RTX 4090 Founders Edition | ZMASLO (CC BY 3.0) | 구매 영수증(판매자 주장) · 보증 조회(일치) |
| 셀러 02 · RTX 4090 Gaming OC | BornInGame 영상 캡처 (CC BY 3.0) | 작동 영상(센서 로그 61°C) · 시리얼 라벨 사진 · 보증 조회(모델 불일치) |
| 셀러 03 · ROG Strix RTX 4090 | Benlisquare (CC BY-SA 4.0) | 작동 영상(INVADER PC, CC BY 3.0) · 카드 영수증 스캔(날짜 판독 불가) |

- 시리얼 라벨 사진(Solomon203, CC BY-SA 4.0)은 **파일 자체에서** 시리얼 앞자리와 바코드를 가렸다. 브라우저로 원본 시리얼을 보내지 않는다.
- 영수증과 보증 조회는 실제 자료가 있을 수 없어서 **"견본 · SAMPLE" 도장을 찍은 가상 문서**로 만든다. 상점·주문 정보는 모두 가상이다. 영수증 종이 질감은 ambientCG Paper004(CC0).
- 영상은 원본에서 10~12초만 발췌했고 소리는 없다. `mp4(H.264)`와 `webm(VP9)`을 같이 넣었다.

## 화면 구성

- **개요**: 제목 두 줄 + 실제 사진·영상 3칸 벤토 + 받은 제안 3장(높이 통일) + 요약 바. 제안 카드에는 증빙 칩(종류·상태 아이콘·영상 길이)이 붙는다.
- **매물 시트**(`components/ListingSheet.tsx`): 사진이나 증빙 칩을 누르면 열리는 대화상자. 왼쪽은 미디어(영상 플레이어·라벨 판독·영수증·보증 조회 표), 아래는 썸네일 레일, 오른쪽은 AI 검토 메모(영상 시점으로 이동), 올린 사람·시각·파일·해시, 출처. `←` `→` 이동, `Esc` 닫기, `?item=evidence-05`처럼 주소로 바로 열 수 있다.
- 협상 화면의 증빙 카드는 "서버 규칙 통과 ≠ 증빙 일치"를 따로 경고한다. 합의서에는 첨부 증빙과 각 해시가 나온다.

## 참고한 디테일 원칙

Vercel Web Interface Guidelines, Rauno Freiberg "Invisible Details", Emil Kowalski "Great Animations", Linear UI 리디자인 글, Apple 제품 페이지, StockX 검증 페이지에서 공통으로 보이는 것을 적용했다.

- 실제 사진 · 일관된 비율(16:10) · 이미지 자리 먼저 확보(로딩 중 반짝임, 레이아웃 흔들림 없음).
- 상태는 색만으로 말하지 않는다: 아이콘 + 글자 라벨을 항상 같이 쓴다.
- 숫자는 `tabular-nums`, 한국어는 `keep-all`, 문단은 `text-wrap: pretty`.
- 겹겹 그림자 + 반투명 1px 테두리, 안쪽 모서리 반경은 바깥보다 작게.
- 애니메이션은 300ms 이하 · `transform`/`opacity`만 · `prefers-reduced-motion`이면 영상 자동재생도 끈다. `transition: all`은 쓰지 않는다.
- 키보드: 모든 조작에 `:focus-visible` 링, 대화상자는 네이티브 `<dialog>`(포커스 가두기·Esc), 단축키는 화면에 표시한다.
- 출처·주의 문구는 각주처럼 작게 붙인다(데모·mock·견본 표시는 유지).

## 구조

- `src/looks.ts`, `src/looks.css` — 시안 목록과 시안별 토큰. `src/App.css`는 토큰만 쓰는 공통 레이아웃.
- `src/data/demo.ts` — 매물·증빙·제안 데모 데이터. `src/data/media.ts` — 사진·영상·증빙 화면 데이터와 출처.
- `src/components/` — `ListingSheet`(매물 시트·증빙 칩), `Img`(자리 확보 이미지), `HashDie`, `PriceRuler`, `Icon`(Lucide).

## 백엔드 연결

`vite dev`/`vite preview`는 `/api`와 `/__backend/health`를 백엔드로 프록시한다. `frontend/.env.local`(git 제외)에 적는다. 예시는 `frontend/.env.example`.

```text
ACCORD_API_TARGET=https://<이름>.trycloudflare.com
VITE_API_PREFIX=/api/v1
```

- 백엔드가 응답하면 상단에 `백엔드 mock · v2` 칩이 뜬다.
- 로컬 백엔드(`localhost`)일 때만 터널로 들어온 `/api` 요청을 막는다. 원격 백엔드로는 보는 사람의 IP 헤더를 넘기지 않는다.
- 현재 `?mode=live` 화면은 `api-spec.md` v0.1 경로(`/demo/sessions`, `/negotiations` …)를 쓴다. DealBattle v2 서버(`/api/v1/session`, `/deals/…`)와는 경로가 달라서, 백엔드 계약이 정해지면 `src/live/api.ts`를 맞춘다.

## 친구에게 보여주기 (ngrok)

```bash
cd frontend
npm run build
npx vite preview --host 127.0.0.1 --port 4173 --strictPort
ngrok http 4173   # 다른 터미널
```

## 공통 원칙

- 데모 데이터와 검증 로직(`lib/mockApi.ts`, 승인 단계, 시나리오 A/B/C)은 그대로다.
- 구매자·판매자 색은 역할 표시에만 쓴다. 통과·차단·주의 색과 섞지 않는다.
- 비공개 값(구매자 예산, 판매자 최저가)은 본인 화면에만 "나만 보기" 표시와 함께 보여준다.
- 에이전트 문구는 "예시·서명 대상 아님", 체인 기록은 mock임을 계속 표시한다. 양측 서명 후에도 `기록 대기`이며 기록 완료로 표시하지 않는다.
