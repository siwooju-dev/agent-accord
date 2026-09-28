# 블록체인 담당 개발 명세

> 개발 에이전트는 `project.md`, `api-spec.md`의 승인 페이로드, 이 문서를 읽는다. `contracts/`의 Solidity + Foundry 계약과 `blockchain/`의 Python web3.py 어댑터가 소유 영역이다. 계약의 서명 검증에는 OpenZeppelin EIP712/ECDSA를 사용한다.

## 목표

**구매자와 판매자가 동일한 합의안에 서명했음을 검증하고, 합의를 실제 devnet/testnet 트랜잭션으로 기록**한다. 이 기록은 결제·실물 인도 완료를 뜻하지 않는다.

## 네트워크·키

- 배포 대상은 Base Sepolia(chain ID `84532`), 기본 RPC는 `https://sepolia.base.org`, 탐색기는 `https://sepolia.basescan.org`다. 로컬 테스트에는 Foundry Anvil을 사용한다. 운영진이 다른 체인을 지정하면 공통 설정과 서명 도메인을 갱신한다. chain ID, RPC, 탐색기, 계약 주소, 배포 tx를 환경별 설정으로 제공한다.
- relayer 개인키·RPC 비밀값은 환경 변수/비밀 저장소에 두고 저장소/공개 로그에 남기지 않는다. 테스트 자산만 사용한다.
- 실제 동작의 증거는 **합의 기록 tx hash + 성공 영수증 + 이벤트 + 계약 조회값**이다. 로컬 mock hash는 온체인 증거가 아니다.

## 합의 해시·서명 규격 v1

`api-spec.md` 4.8절의 **정확한 스냅샷 필드**를 RFC 8785 JCS로 정규화한 UTF-8 바이트에 SHA-256을 적용해 `snapshot_hash`(`bytes32`)를 만든다. `evidence_hashes`는 소문자 `0x` 해시 문자열의 오름차순으로 고정하고 중복을 제거한다. 스냅샷의 지갑 주소도 소문자 16진수로 고정한다. `delivery_by`·`expires_at`은 UTC `YYYY-MM-DDTHH:MM:SSZ` 문자열, 금액과 `nonce`는 JSON 안전 정수(0 이상 `2^53-1` 이하)다. 스냅샷의 필드·값·증빙 순서가 달라지면 새 해시와 새 양측 서명이 필요하다. 계약은 원문을 받지 않으므로 이 SHA-256 해시를 **불투명한 32바이트 값**으로 취급한다.

양측이 서명할 EIP-712 도메인은 `name="AgentAccord"`, `version="1"`, `chainId=84532`, `verifyingContract=<배포된 계약 주소>`다. `primaryType`은 `AgreementApproval`이며 타입 문자열은 아래와 같이 고정한다.

```text
AgreementApproval(bytes32 agreementHash,address buyer,address seller,uint256 totalKrw,uint256 nonce,uint256 deadline)
```

필드 순서도 위 문자열 그대로다. `agreementHash=snapshot_hash`, `buyer/seller=스냅샷의 지갑 주소`, `totalKrw=snapshot.total_krw`, `nonce=snapshot.nonce`, `deadline=snapshot.expires_at`의 Unix 초다. 프론트는 구매자와 판매자에게 **같은 typed data**를 전달해 각자의 EOA 지갑으로 서명하게 한다. Solidity는 이 타입의 `structHash`를 만들고 OpenZeppelin `EIP712._hashTypedDataV4`로 최종 서명 digest를 만든 뒤 `ECDSA.recover`로 두 주소를 확인한다. SHA-256 스냅샷 해시와 EIP-712 서명 digest는 서로 다른 값이다.

nonce는 **구매자 주소별로 유일한 양의 정수**다. 백엔드가 새 합의마다 발급하고, 합의가 변경되면 새 nonce를 사용한다. 계약은 `(buyer, nonce)`와 `agreementHash`의 재사용을 각각 막는다. 만료 시각이 지났거나 도메인의 chain ID·계약 주소가 다른 서명은 유효하지 않다.

## 계약 ABI·저장·이벤트 v1

`constructor(address relayer)`에서 제출자 주소를 고정하고 `address public immutable relayer`로 조회 가능하게 한다. 테스트넷 가스는 이 relayer가 부담한다. 외부 인터페이스는 다음과 같다.

```solidity
function recordAgreement(
    bytes32 agreementHash,
    address buyer,
    address seller,
    uint256 totalKrw,
    uint256 nonce,
    uint256 deadline,
    bytes calldata buyerSignature,
    bytes calldata sellerSignature
) external;

function relayer() external view returns (address);

function getAgreement(bytes32 agreementHash) external view returns (
    bool exists,
    address buyer,
    address seller,
    uint256 totalKrw,
    uint256 nonce,
    uint256 recordedAt
);

event AgreementRecorded(
    bytes32 indexed agreementHash,
    address indexed buyer,
    address indexed seller,
    uint256 totalKrw,
    uint256 nonce,
    uint256 recordedAt
);
```

`recordAgreement`는 `msg.sender == relayer`, 0이 아닌 해시·주소·총액·nonce, 서로 다른 두 주소, `block.timestamp <= deadline`, 미사용 `agreementHash`와 미사용 `(buyer, nonce)`를 확인한다. 이어 위 EIP-712 메시지에 대한 두 서명을 복구해 `buyer`·`seller`와 각각 일치하는지 검사한다. 모두 통과할 때만 재사용 상태를 기록하고 합의 데이터와 `block.timestamp`를 저장한 뒤 이벤트를 발행한다. `getAgreement`의 `exists=false`는 기록 없음이며 나머지 값으로 성공을 추정하지 않는다. 계약은 ETH·토큰을 받거나 이전하지 않는다.

계약은 오프체인 합의 원문의 진위나 서버의 가격 정책을 검사할 수 없다. 백엔드는 제출 전에 스냅샷 해시를 재계산하고 `totalKrw`·당사자·nonce·deadline이 스냅샷과 일치하는지 확인한다. 개인 연락처/배송지/사진 원본/비공개 최고예산·최저가를 체인에 올리지 않는다.

## 스냅샷 해시 테스트 벡터

다음은 **실제 거래가 아닌** 정규화 교차 검증용 예시다. 키는 ASCII, 금액·nonce는 정수다. RFC 8785 JCS를 적용한 후 SHA-256 결과가 아래 값이어야 한다. 구현은 Python과 프론트에서 동일하게 재현하고, 배포 계약 주소를 넣은 EIP-712 digest도 Foundry·viem·Python 사이에서 비교한다.

```json
{
  "snapshot_version": 1,
  "agreement_id": "agreement-vector-1",
  "offer_id": "offer-vector-1",
  "listing_id": "listing-vector-1",
  "seller_id": "seller-vector-1",
  "gpu_model": "RTX 3070",
  "item_price_krw": 450000,
  "shipping_fee_krw": 10000,
  "total_krw": 460000,
  "delivery_by": "2030-01-03T12:00:00Z",
  "warranty_terms": "seller warranty until 2031-01-31",
  "evidence_hashes": ["0x1111111111111111111111111111111111111111111111111111111111111111"],
  "buyer_wallet": "0x1111111111111111111111111111111111111111",
  "seller_wallet": "0x2222222222222222222222222222222222222222",
  "expires_at": "2030-01-01T12:00:00Z",
  "nonce": 1
}
```

`snapshot_hash = 0x10c8bc9492fea93859ecb238acd53f1b86c4c34895187be9116f35811e5556cc`; EIP-712의 `deadline = 1893499200`. 이 해시는 위 **스냅샷 JSON만** 포함하고 EIP-712 도메인·계약 주소는 포함하지 않는다.

## 역할 간 어댑터 계약

| 함수 | 입력 | 결과 |
| --- | --- | --- |
| `prepare_approval` | 불변 합의 스냅샷 | JCS/SHA-256 재계산 후 `snapshot_hash`, `typed_data`; 체인·계약 미설정 또는 해시 불일치는 오류 |
| `verify_signature` | typed data, 서명, 기대 주소 | 도메인·만료·해시 확인 뒤 복구한 주소; 불일치는 `SIGNATURE_INVALID` |
| `record_agreement` | 합의, 양측 서명 | `submitted`와 tx hash 또는 `already_recorded`와 기존 온체인 기록; 재시도마다 새 tx를 만들지 않음 |
| `get_record` | tx hash와 합의 해시 | `pending/success/failed/not_found`, 영수증·이벤트·`getAgreement` 조회값; 모두 일치할 때만 `success` |

서명 규격과 테스트 벡터를 프론트·백엔드·데이터 담당에게 먼저 전달한다. 서버 relayer 지갑은 제출 비용만 부담한다. **서버가 만든 단일 서명은 양측 승인 증거가 아니다.**

백엔드는 합의 ID를 기준으로 제출 작업을 잠그고 tx hash를 저장한다. 어댑터는 제출 전 `getAgreement`를 조회하며 기존 기록이 있으면 새 tx를 만들지 않는다. 응답 지연·연결 오류 때는 기존 tx hash의 영수증과 온체인 기록을 먼저 재조회하고, 상태가 불명확하면 임의로 새 트랜잭션을 제출하지 않는다. 계약의 해시·nonce 검사도 중복 기록을 최종적으로 막는다.

`contracts/`에서 `forge build`·`forge test`를 실행할 수 있게 하고, 백엔드가 쓰는 계약 ABI는 `blockchain/abi/`에 버전 관리한다. Foundry 빌드 산출물 경로를 백엔드가 직접 읽게 하지 않는다.

## 구현 순서·테스트

1. Base Sepolia 설정과 메시지·스냅샷 규격 확정, 해시 골든 벡터 공유.
2. 로컬 체인에서 정상 양측 서명, 잘못된 주소/체인/계약/해시/총액, 만료, 구매자 nonce 재사용, 같은 합의 해시 중복 제출, 권한 없는 relayer 테스트.
3. 실제 devnet/testnet 배포, 백엔드 어댑터로 기록 tx 전송.
4. 성공 영수증, `AgreementRecorded` 이벤트, 계약 조회와 DB 합의 ID/해시 대조.
5. 한쪽 거절·조건 변경·체인 실패에서 성공 기록이 생성되지 않는지 확인.

완료 보고에는 chain ID, 계약 주소, 검증한 **실제** tx hash, 로컬/테스트넷 테스트 결과, 실제/mock 구분과 남은 제약을 적는다. 이 계약이 증명하는 것은 서명된 합의 해시의 기록이다. GPU 상태의 진실, 실물 인도, 원화 결제, 모든 입찰의 공정성은 별도 문제이며 입찰 비밀성 증명이 필요하면 커밋-공개를 후속 범위로 설계한다.
