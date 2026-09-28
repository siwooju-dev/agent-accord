# Kiln integration and evidence boundary

2026-09-29 KST 확인한 Bricksum 공식 문서:

- [Authentication](https://kiln.bricksum.com/docs/en/authentication): Authorization Bearer; x-api-key는 Authorization 부재 시 대안이다.
- [API reference](https://kiln.bricksum.com/docs/en/api-reference): OpenAI 호환 `/models`, `/chat/completions` 및 generation ID 헤더를 설명한다.
- [Chat completions](https://kiln.bricksum.com/docs/en/api-reference/chat-completions): `response_format`을 지원하지 않는다. JSON-only 프롬프트 후 로컬 검증이 필요하다.
- [Models](https://kiln.bricksum.com/docs/en/models): 실제 서비스 가능 ID는 인증 GET /models로 확인해야 한다. 문서의 이전 staging 예제와 현재 catalog 상태가 다를 수 있다.

[GWDC 공식 Challenge 안내](https://wap.gwdc.net/hackathon.html)에서도 FuriosaAI × Bricksum의 Challenge A가 AI Agent·블록체인 금융 서비스임을 확인했다. 이 공개 요약은 팀별 지급 endpoint, Qwen 대체 승인, 허용 chain을 확정하는 증거가 아니다. 해당 운영진 증거는 별도로 필요하다.

공식 안내의 base URL 예시는 `https://api.bricksum.com/v1`이다. 이는 운영진이 지급한 이 팀의 endpoint를 검증한 증거가 아니다. 코드에는 이 주소나 모델 ID를 기본값으로 넣지 않는다. 운영진의 `KILN_BASE_URL`(API prefix 포함), `KILN_API_KEY`, `KILN_MODEL`, `KILN_AUTH_MODE=bearer|x-api-key`를 환경 변수로 설정한다. redirect를 따라가지 않아 인증값이 다른 host로 전달되지 않는다.

사용자 제공 요건의 PDF 모델은 gpt-oss-120b다. 이 checkout에서 첨부 PDF 원문은 발견되지 않았다. 기존 팀 문서의 Qwen3-32B 선호는 대체 승인 증거가 아니다. qwen3-32b가 /models에 있어도 공식 요건 충족을 주장하려면 운영진의 명시적 대체 허용 근거가 필요하다. 실제 제공 모델이 다르면 probe 결과와 승인 근거를 함께 보관한다.

```bash
# Only after organizer-supplied environment settings are present:
python scripts/probe_kiln.py
# Explicitly authorized single billable inference, no retry:
python scripts/probe_kiln.py --call-once
```

현재 환경에는 필요한 Kiln 변수 3개가 없다. probe는 NOT_RUN/exit 2를 반환했다. 모델 목록, 실제 인증 응답, 실제 요금/토큰, live 가격은 미검증이다. 공개 문서 검색 성공을 실호출 성공으로 대체하지 않는다.

어댑터는 httpx를 사용한 OpenAI 호환 POST, 45초 timeout, max_tokens=2048, non-streaming이다. response_format/tool forcing을 사용하지 않는다. 응답 모델 ID, finish_reason=stop, JSON 중복 키, extra fields, 음수/float/상한/통화, product ID, ACCEPT 동일 가격, provider usage를 검사한다. 빈/불완전/모순 usage는 fail-closed이며 받은 수치는 보존하고 누락 값은 null이다. 실패 원문/키/인증 헤더/RPC URL은 공개 로그에 저장하지 않는다. 자동 재시도는 없으며 live 오류를 mock으로 바꾸지 않는다.

buyer는 본인 예산·조건과 공개 필드만, seller는 본인 최저가와 공개 필드만 받는다. 상대의 reason, 상품 설명, 비공개 가격 한계, 서버 정책 판단은 상대 프롬프트에 넣지 않는다. 매번 독립 문맥을 만들고 상대의 검증된 action/price/product ID만 전달한다. 모델 이유는 서버 판정의 근거가 아니다. seller 모델의 이유에 비공개 가격이 포함될 수 있어 공개용 설명을 사용한다. 정책 검사에는 모두 서버 데이터를 쓴다.

호출별 stage=negotiation, actor, model ID, prompt/completion/total tokens, latency, provider request ID(`X-Neocloud-Generation-Id` 우선), error code를 딜에 저장한다. mock-rule-agent에는 실측 tokens가 없으므로 null/unavailable다. HTTP fake 응답의 100/30/130 tokens는 테스트용 응답 데이터이며 실제 비용 증거가 아니다. 에너지는 미측정이며 수치를 제공하지 않는다. 추후 추정 시 `assumed watts × measured inference seconds / 3600 = Wh` 등의 가정·산식을 실측과 별도로 제시해야 한다.
