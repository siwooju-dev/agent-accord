# Accord 디자인 시안

`codex/frontend` 브랜치의 UI 시안이다. 화면 맨 위 **디자인 시안** 바(또는 키보드 1–4)로 네 가지 스타일을 바꿔 볼 수 있다. 선택한 시안은 브라우저에 기억되고 `?mode=live` 화면에도 같이 적용된다. `#clear` `#aurora` `#graphite` `#studio` 해시로 특정 시안을 바로 열 수 있다.

| 시안 | 방향 | 참고한 흐름 | 서체 |
|---|---|---|---|
| A · Clear | 밝은 회색 바탕, 흰 카드, 파란 포인트, 둥근 모서리 | 한국 핀테크 앱(토스 계열)의 친절한 톤 | Pretendard |
| B · Aurora | 그라데이션 오로라 배경, 유리 카드, 세리프 이탤릭 포인트, 중앙 정렬 히어로 | Stripe·Framer 계열 프리미엄 SaaS | Pretendard + Instrument Serif |
| C · Graphite | 절제된 다크, 얇은 테두리 유리 패널, 보라 글로우 | Linear·Vercel 계열 다크 제품 사이트 | Geist + Pretendard |
| D · Studio | 무광 그레이, 점 격자, 검은 테두리와 오프셋 그림자, 오렌지 포인트 | 하드웨어 제품 사이트(Teenage Engineering 계열) | Bricolage Grotesque + Pretendard + JetBrains Mono |

## 구조

- `src/looks.ts` — 시안 목록과 3D GPU 재질 팔레트, 선택 저장.
- `src/looks.css` — 시안별 디자인 토큰(색·서체·반경·그림자)과 시안 전용 레이아웃 조정.
- `src/App.css` — 토큰만 쓰는 공통 레이아웃. 색을 직접 쓰지 않는다.
- `src/components/GpuScene.tsx` — Three.js로 코드로 만든 3팬 GPU. 드래그 회전, 자동 회전, 분해 보기, 증빙 핫스팟(선택한 매물의 증빙 상태를 표시). 시안을 바꾸면 재질이 바뀐다.
- `src/components/GpuArt.tsx`, `HashDie.tsx`, `PriceRuler.tsx` — 매물 일러스트, 스냅샷 해시 지문, 호가→제안 눈금자.
- 폰트: Pretendard(OFL 1.1)는 `src/assets/fonts`에 번들, 나머지는 Google Fonts.

## 공통 원칙

- 데모 데이터와 검증 로직(`lib/mockApi.ts`, 승인 단계, 시나리오 A/B/C)은 그대로다. 문구만 해요체로 쉽게 바꿨다.
- 구매자·판매자 색은 역할 표시에만 쓴다. 통과·차단·주의 색과 섞지 않는다.
- 비공개 값(구매자 예산, 판매자 최저가)은 본인 화면에만, "나만 보기" 표시와 함께 보여준다.
- 에이전트 문구는 "예시·서명 대상 아님", 체인 기록은 mock임을 계속 표시한다. 양측 서명 후에도 `기록 대기`이며 기록 완료로 표시하지 않는다.
