# PolicyGuard AI Agent

Qwen3-32B / Kiln API로 구매 조건을 이해하고, Policy Engine으로 제한하며, 승인된 모의 구매의 증거를 테스트넷에 기록하는 FuriosaAI Challenge A 프로젝트.

**현재 상태: 설계·에이전트 작업 지시 문서만 있습니다. 앱과 공통 코드 구현은 다음 작업입니다.**

## 팀 시작 순서

1. [PROJECT.md](PROJECT.md)로 전체 흐름을 이해한다.
2. [AGENTS.md](AGENTS.md)와 [CONTRACTS.md](CONTRACTS.md)를 각 GPT에 읽힌다.
3. Backend 담당이 **B0: 공통 코드 기반**을 먼저 만든다. 나머지 담당은 독립적인 설계·테스트 사례를 준비한다.
4. B0가 통합되면 각 담당이 최신 코드를 받고 자기 역할의 첫 단계를 구현한다.
5. 각 단계는 테스트 결과와 의존성을 보고하며 마무리한다.

| 역할 | 문서 | 첫 단계 |
|---|---|---|
| Backend / Agent | [ROLE_BACKEND_AGENT.md](ROLE_BACKEND_AGENT.md) | B0: 공통 모델·API 계약·서버 기반 |
| Frontend | [ROLE_FRONTEND.md](ROLE_FRONTEND.md) | F0: 타입 생성·mock·화면 기반 |
| Policy / Blockchain | [ROLE_POLICY_BLOCKCHAIN.md](ROLE_POLICY_BLOCKCHAIN.md) | P0: 정책 검사·해시 |
| Data / Integration / QA | [ROLE_DATA_INTEGRATION_QA.md](ROLE_DATA_INTEGRATION_QA.md) | D0: fixture·검색·순수 simulator |

각 ROLE 문서의 ‘GPT에게 줄 시작 지시’를 복사해 사용한다. 역할 문서뿐 아니라 공통 문서와 현재 코드도 참조할 수 있게 한다. 파일 접근이 없는 채팅에서는 문서를 첨부하고 읽지 못한 파일을 읽었다고 가정하지 않도록 한다.

모델명은 사용자 제공 변경사항에 따라 Qwen3-32B다. 운영진 API 연결 정보와 허용 테스트넷은 실제 연동 전에 확인한다.

## Project Documents

- [Team Plan](TEAM_PLAN.md)
- [AI Agent Architecture](AGENT_ARCHITECTURE.md)
- [Agent Demo Scenarios](AGENT_DEMO_SCENARIOS.md)
