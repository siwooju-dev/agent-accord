# 데이터 저장소

`data.md`와 `project.md`의 데이터 계약을 Python 표준 `sqlite3`로 구현한다. 저장소 루트에서 Python 3.12 이상으로 실행한다.

```powershell
python -m data.init_db
python -m data.seed
python -m unittest discover -s data/tests -v
```

기본 DB는 `data/demo.sqlite3`이며 Git에 포함되지 않는다. 두 명령 모두 `--db <경로>`를 받는다. `seed`는 빈 DB도 초기화하고, 같은 데이터셋을 다시 실행해도 기존 매물·설명 수정·실행 기록을 덮어쓰지 않는다.

`gpu-demo-v1.json`은 2026-09-29 기준의 가상 데이터 템플릿이다. 새 DB를 만들 때 배송 가능일, 구매 마감일, 매물 보증 만료일을 실행 UTC 날짜만큼 함께 이동한다. 예를 들어 2026-10-07에 처음 시드하면 모든 관련 날짜를 8일 이동한다. `python -m data.seed --as-of 2027-02-01`처럼 기준일을 지정할 수도 있다. 이동 일수는 `seed_runs`에 저장되므로 같은 DB에 재시드해도 날짜가 다시 변하지 않는다. 이미 시드한 DB의 일정은 자동 갱신되지 않는다. 과거 날짜로 생성한 DB에서 나중에 시연하려면 **새 빈 DB에 시드**한다. JSON 템플릿을 직접 화면에 사용하면 날짜 이동이 적용되지 않으므로, 화면은 DB 조회값을 사용한다.

시드 ID:

- 구매 조건: `intent-base`, `intent-budget-low`, `intent-deadline-short`
- 매물: `listing-01`, `listing-02`, `listing-03`
- 판매자 정책: `policy-seller-01`, `policy-seller-02`, `policy-seller-03`
- 증빙: `evidence-01a`, `evidence-02a`, `evidence-02b`, `evidence-03a`

`synthetic://...`는 파일 경로가 아니라 데모 증빙의 참조 ID다. 실제 비교할 원문은 각 증빙의 `content_text`와 `metadata`에 있다. `sha256`은 `content_text`의 UTF-8 바이트를 SHA-256으로 해시한 값이다. `listing-02`의 판매자 설명과 가상 보증 카드는 서로 충돌한다. 이 텍스트는 실물 확인이나 제조사 보증 검증 자료가 아니다.

백엔드는 `data.repository`의 다음 함수를 호출한다.

| 목적 | 함수 |
| --- | --- |
| 등록 | `save_buyer_intent`, `save_listing`, `save_seller_policy`, `save_evidence` |
| 후보·증빙 조회 | `search_listings`, `get_listing`, `get_evidences_for_listing`, `get_listing_description_history` |
| 소유자/서버 전용 조회 | `get_private_buyer_intent`, `get_private_seller_policy` |
| 설명 수정·흐름 | `update_listing_description`, `create_flow`, `set_flow_status` |
| 평가·협상 | `save_assessment`, `save_offer` |
| 합의·승인·체인 | `next_nonce`, `save_agreement`, `save_approval`, `save_chain_result` |
| 감사·사용량 | `add_audit_event`, `add_model_usage`, `get_flow_history` |

`search_listings`는 모델·재고·판매자 배송 가능일을 SQL에서 필터링하며 판매자 최저가나 구매자 예산을 반환하지 않는다. `warranty_active`는 입력된 보증 만료일이 배송 마감일까지 남아 있는지만 본다. `get_private_*`는 백엔드가 소유권을 확인한 뒤에만 호출한다. 공개 API DTO와 인가 검사는 백엔드 책임이다.

`save_agreement`는 백엔드가 확정한 v1 스냅샷과 해시를 저장한다. 스냅샷·해시는 DB 트리거로 수정할 수 없고 `(buyer_wallet, nonce)`와 `snapshot_hash`는 각각 유일하다. `next_nonce`는 후보를 제시하며 최종 재사용 방지는 유일성 제약이 담당한다. 합의 해시 계산, 지갑 서명 검증, 체인 영수증·이벤트 대조는 백엔드/블록체인 담당이 수행한 후 저장 함수를 호출한다. `RECORDED` 합의 행은 수정·삭제할 수 없다. `get_flow_history`는 평가·제안·합의·감사 이벤트·Kiln 사용량과 정렬된 `timeline`을 `flow_id`로 조회한다. 감사 이벤트에 조건 검사, 승인/거절, 체인 결과를 기록해야 실행 순서를 재구성할 수 있다.
