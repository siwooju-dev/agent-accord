# 에이전트 공통 작업 규칙

## 먼저 읽을 문서

1. [PROJECT.md](PROJECT.md): 목적과 사용자 흐름.
2. [CONTRACTS.md](CONTRACTS.md): 공유 계약 v1 및 파일 소유권.
3. 배정된 ROLE 문서: 현재 단계의 작업과 인수 기준.

현재 저장소는 **설계 문서 단계**다. 아래 경로와 명령은 구현 목표이며 이미 존재하거나 테스트를 통과했다는 뜻이 아니다. 파일을 먼저 확인하고 없는 구현은 담당 단계에서 만든다. 사람의 최신 명시적 지시를 우선하며, 문서끼리 충돌하면 공통 타입/API는 CONTRACTS를 기준으로 한다. 코드와 계약이 다르면 임의로 한쪽에 맞추지 말고 차이를 보고한다.

## 작업 단위와 소유권

- 역할과 단계가 지정되면 그 단계의 인수 기준까지 구현·검증한다. 전체 제품으로 범위를 확대하지 않는다.
- 단계가 없으면 자기 역할의 첫 미완료 단계를 선택한다. 다음 단계로 넘어가기 전에 결과와 의존성을 보고한다.
- 독립된 작업 브랜치/체크아웃을 사용한다. 팀원의 변경을 덮어쓰거나 전체 저장소를 재생성하지 않는다.
- CONTRACTS의 자기 소유 경로를 수정한다. 타 역할 파일은 읽을 수 있지만 변경은 해당 소유자에게 전달한다. 사람이 통합 수정 범위를 명시적으로 맡기면 그 범위는 수정 가능하다.
- 공유 계약 변경은 Backend가 관리한다. 필요한 변경·호환성 영향·영향받는 역할을 기록하고 계약 변경이 반영되기 전에는 자체 필드를 추가하지 않는다.
- 테스트를 통과시키기 위해 정책 검사를 생략하거나 예상 결과를 현재 버그에 맞춰 바꾸지 않는다.

## 구현 기본값

- Backend: Python 3.11, FastAPI, Pydantic v2, SQLAlchemy 2, SQLite, pytest.
- Frontend: React, TypeScript, Vite, npm, Vitest, Testing Library.
- E2E: 별도 `e2e/` npm 프로젝트와 Playwright. 프론트 package.json을 QA가 수정하지 않는다.
- 패키지의 정확한 버전은 각 설정 파일 소유자가 첫 설치 시 호환성을 확인하고 lockfile/고정 버전에 남긴다. 이미 고정된 의존성을 임의 갱신하지 않는다.
- 체인은 미확정이다. Policy 담당이 운영진 허용 범위를 확인한 뒤 하나를 결정해 CONTRACTS에 반영을 요청한다. 그전에는 mock adapter와 정책/해시 테스트를 진행한다.
- Qwen3-32B의 Kiln 모델 ID·API 형식은 운영진 가이드를 확인한다. 다른 모델로 조용히 대체하지 않는다.

## 공통 실행 및 검증 규약

아래 명령이 작동하도록 B0/F0/D0에서 설정한다. 각 명령은 저장소 루트에서 실행한다.

```text
python -m pip install -e "backend[dev]"
python -m uvicorn app.main:app --app-dir backend --reload
python -m pytest backend/tests/contracts -q
python -m pytest backend/tests/backend -q
python -m pytest backend/tests/policy backend/tests/blockchain -q
python -m pytest backend/tests/data backend/tests/integration -q
npm --prefix frontend ci
npm --prefix frontend run test -- --run
npm --prefix frontend run build
npm --prefix e2e ci
npm --prefix e2e test
```

최초 npm 프로젝트 생성자는 `npm install`로 lockfile을 만들고 커밋한다. 이후 팀원은 `npm ci`를 쓴다. 테스트 디렉터리가 아직 없거나 환경이 미설정이면 “미실행”으로 보고한다. 테스트가 0개인 결과는 완료 증거가 아니다. 테스트넷/Kiln 실호출은 별도 opt-in으로 하고 기본 테스트는 키 없이 실행 가능해야 한다.

## 반드시 유지할 조건

- LLM 출력은 검증 대상이며 정책/승인 권한이 아니다. 확인된 정책과 서버 상품 데이터만 실행에 사용한다.
- 승인 없이 구매하지 않는다. 승인 후 변경/만료는 재승인을 요구한다.
- 구매 중복 방지와 DB 갱신은 Backend가 원자적으로 수행한다. Data simulator는 DB나 외부 결제를 직접 호출하지 않는다.
- 모의 구매 성공과 실제 체인 기록 성공을 구분한다. mock TX를 실제 증거로 표시하지 않는다.
- 키·토큰·개인키는 환경 변수로만 받고 저장소·로그·브라우저에 노출하지 않는다.
- 키/운영진 정보가 없으면 관련 실연동만 보류하고 독립 개발을 계속한다. 사람이 처리해야 할 내용은 정확히 보고한다.

## 의존성이 없을 때

공유 계약이 아직 B0에서 코드로 만들어지지 않았다면 화면 설계, 정책 사례, fixture 초안을 준비하되 별도 공통 스키마를 만들지 않는다. B0 이후에는 공유 Protocol을 구현하는 자기 테스트 폴더의 fake를 주입한다. 서버의 개발용 fake 연결은 Backend가 담당하고 live 모드에서 자동 fallback하지 않게 한다.

## 완료 보고 형식

```text
역할 / 단계 / 기준 계약 버전:
변경 파일:
구현한 동작:
검증 명령 / 통과·실패·미실행 / 테스트 수:
mock 또는 실제 외부 연동 여부:
남은 오류·제약:
다른 역할에 필요한 작업 / 대상 파일 / 이유:
다음 단계 진입 조건:
```

실행하지 않은 테스트, 실제로 만들지 않은 TX, 확인하지 않은 토큰 사용량을 성공으로 보고하지 않는다. 체크박스는 연결된 테스트나 증거가 있을 때만 완료 처리한다.
