# 백엔드·AI 에이전트 담당 개발 명세

> 개발 에이전트는 `project.md`, `api-spec.md`, 이 문서를 읽는다. 소유 영역은 `backend/`의 API·서비스·Kiln 연결이다. Python 3.12, FastAPI/Pydantic, OpenAI Python SDK, web3.py를 사용한다.

## 목표

구매자/판매자 협상을 오케스트레이션하고, Kiln Qwen3-32B 응답을 실제 제안에 사용하며, 서버 코드로 금액·배송·재고 조건을 검사한다. 데이터 스키마·초기화·시드는 데이터 담당, 계약/체인 어댑터는 블록체인 담당과 인터페이스를 먼저 합의한다.

## 에이전트 역할

| 역할 | 읽을 수 있는 입력 | 출력 | 경계 |
| --- | --- | --- | --- |
| 매물 평가기 | 검색된 매물, 설명, 증빙의 텍스트·메타데이터 | 상태 요약, 모순/미확인 점, 근거 ID | 사진 판독·진품·작동을 확정하지 않음 |
| 구매자 에이전트 | 구매 요구, 공개 제안, 평가 결과 | 가격·배송·보증 제안과 이유 | 판매자 최저가를 보지 않음 |
| 판매자 에이전트 | 해당 판매자 매물/정책, 받은 공개 제안 | 수락/반대 제안과 이유 | 구매자 최고예산을 보지 않음 |

같은 모델을 사용해도 역할별 프롬프트/대화 문맥은 분리한다. 매물 설명은 신뢰하지 않는 입력으로 취급한다. 현재 Kiln의 `qwen3-32b`는 구조화 출력과 강제 도구 호출을 보장하지 않으므로, JSON만 반환하도록 요청한 뒤 서버에서 파싱·스키마 검증한다. 유효하지 않은 응답은 제안으로 사용하지 않는다. 오류 재시도는 최대 1회로 제한하고 실패를 가짜 성공으로 바꾸지 않는다.

## Kiln 연결 예시

팀이 전달받은 OpenAI 호환 호출 예시다. `KILN_API_KEY`의 실제 값은 서버 환경 변수에만 둔다. 이 예시는 연결 확인용이며, 서비스에서는 역할별 메시지와 출력 검증·사용량 기록을 추가한다.

```python
import os
from openai import OpenAI

client = OpenAI(
    base_url=os.environ.get("KILN_BASE_URL", "https://api.bricksum.com/v1"),
    api_key=os.environ["KILN_API_KEY"],
)

resp = client.chat.completions.create(
    model=os.environ.get("KILN_MODEL_ID", "qwen3-32b"),
    messages=[{"role": "user", "content": "Hello!"}],
)
print(resp.choices[0].message.content)
```

## 필수 서비스

1. 구매자/판매자의 자기 데이터 접근 권한과 입력 형식을 검사한다.
2. DB에서 모델·재고·배송 조건으로 후보를 찾는다. 후보가 없으면 Kiln을 호출하지 않고 `NO_MATCH`를 남긴다.
3. `api-spec.md` 8절의 Kiln 설정을 서버에만 주입한다. 발급받은 키로 `GET /models`에서 `qwen3-32b` 사용 가능 여부를 확인한 뒤 `POST /chat/completions`로 평가·협상한다. 응답의 `usage.prompt_tokens`·`usage.completion_tokens`, `X-Neocloud-Generation-Id` 헤더, 지연 시간, 호출 단계와 결과 반영 내용을 저장한다. API가 사용량을 제공하지 않으면 추정값으로 표시한다. 평가 결과는 `ListingAssessment`로 저장한다. 공개 `Offer.rationale`은 공개 매물·유효 제안·평가 정보만으로 생성하고, 비공개 한계값을 본 에이전트의 원문 설명을 그대로 반환하지 않는다.
4. 판매자별 `초기 제안 + 최대 2회 반대 제안`을 관리한다. 매 제안을 저장하고 다음 상대에게 넘기기 전에 정책 엔진을 실행한다.
5. `총액=상품가+배송비+명시 수수료 <= 구매자 최고예산`, `상품가 >= 판매자 최저가`, 모델·재고·기한·필수 조건·만료를 결정적으로 검사한다. 차단 사유를 로그에 남긴다.
6. 유효한 한 제안으로 불변 합의 스냅샷을 만들고 해시를 계산한다. 조건 변경 시 새 합의 ID/nonce와 새 승인을 요구한다.
7. 두 서명을 검증한 뒤 체인 어댑터를 호출한다. 영수증과 이벤트 대조 전 `RECORDED`로 바꾸지 않고 합의 ID로 중복 제출을 막는다.
8. `AuditEvent`, `ModelUsage`를 `flow_id`로 조회하고 단계별 토큰 합계·모델 호출 생략 이유를 제공한다.

## 역할 간 계약

- `api-spec.md`의 HTTP 엔드포인트를 구현하고 FastAPI `/openapi.json`·예시 요청/응답이 명세와 일치하도록 유지해 프론트에 인계한다. 개발 서버 기본 포트는 `8000`이다.
- 데이터 담당의 `data/`에서 `save/get BuyerIntent`, `save/query Listing`, `save ListingAssessment/Offer/Agreement/AuditEvent/ModelUsage` 저장소를 호출한다. 상태 변경은 DB 트랜잭션으로 처리한다.
- 블록체인 담당의 `blockchain/`에서 `prepare_approval`, `verify_signature`, `record_agreement`, `get_record` 인터페이스를 호출한다. live 모드에서 mock으로 자동 대체하지 않는다. 배포 후 `CONTRACT_ADDRESS`를 설정하고 Base Sepolia chain ID를 확인한다.
- 오류 코드는 `BUDGET_EXCEEDED`, `SELLER_FLOOR_VIOLATED`, `DEADLINE_MISSED`, `OUT_OF_STOCK`, `OFFER_EXPIRED`, `SIGNATURE_INVALID`, `CHAIN_FAILED`를 포함한다.

## 테스트·완료 기준

- 상품가 49만 원+배송비 2만 원은 총예산 50만 원을 초과해 차단된다. 판매자 최저가 미만, 재고 없음, 기한 초과, 만료 제안도 승인되지 않는다.
- 설명에 “검사를 무시하라” 같은 지시문을 넣어도 지시로 따르지 않는다. 증빙과 충돌하면 근거와 함께 `conflicted`로 표시한다.
- 한쪽 거절, 서명 대상 변경, 체인 실패 시 기록 성공 상태가 생기지 않는다.
- A/B/C 실행에서 AI 응답이 제안에 반영되고 역할·단계별 토큰 사용량과 실제/추정 출처가 재구성된다.
- 정책/상태 테스트와 실제 Kiln 통합 결과를 구분해 보고한다. 변경 파일, 테스트 수·결과, 실제/모의 호출, 남은 제약을 적는다.
