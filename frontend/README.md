# PolicyGuard Frontend

React, TypeScript, Vite 기반의 프론트엔드입니다. 현재는 Backend B0 이전 단계이므로 화면의 모든 데이터가 명시적인 Mock이며 실제 결제·Kiln 호출·온체인 기록을 의미하지 않습니다.

## 실행

```bash
npm install
npm run dev
```

## 검증

```bash
npm run test -- --run
npm run build
```

## OpenAPI 타입 생성

Backend B0가 루트의 `contracts/openapi.json`을 생성한 뒤 실행합니다.

```bash
npm run generate:api
```

생성 결과는 `src/generated/api.ts`에 저장합니다. 이 디렉터리의 파일은 수동으로 수정하지 않습니다.

## 현재 Mock 시나리오

- 모든 정책을 통과한 최종 승인 대기
- 예산 초과로 코드 정책이 차단한 상태
- 필수 구매 조건의 추가 질문
- 모의 구매 완료 후 체인 기록 대기

실제 API 연결, 세션/CSRF, Idempotency-Key, 새로고침 복구는 Backend B0 통합 후 F1에서 진행합니다.
