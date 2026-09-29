# 블록체인 구현 및 인계

기준 문서: 루트의 `project.md`, `api-spec.md` 4.8~4.9절, `blockchain.md`. 이 구현은 중고 GPU 합의의 **양측 EOA 서명과 기록**만 다룬다. 결제·배송·GPU 상태 진위를 증명하지 않는다.

## 로컬 준비

```bash
cd contracts
npm ci
npm run compile          # Solidity 0.8.28 컴파일, blockchain/abi 갱신
forge build
forge test
cd ..
python3 -m venv .venv
.venv/bin/python -m pip install -r blockchain/requirements.txt
.venv/bin/python -m pytest blockchain/tests -q
```

`contracts/package-lock.json`은 OpenZeppelin을 고정한다. `contracts/foundry.toml`의 remapping은 `npm ci`로 설치한 같은 소스를 사용한다. 백엔드는 Foundry 산출물을 직접 읽지 않고 버전 관리한 `blockchain/abi/AgreementRegistry.json`을 읽는다. 배포 bytecode는 `npm run compile`이 `contracts/build/`에 생성한다.

문서의 고정 스냅샷을 `verifyingContract=0x3333333333333333333333333333333333333333`, `chainId=84532`로 인코딩한 EIP-712 digest는 `0x20517f730396299e6b81037818241ee1c2c442406b3d77c047821c8d3aa3554b`다. Python/Foundry 테스트가 같은 값을 검사한다.

## 백엔드 연동

- `approval_payload(snapshot, chain_id, contract_address, expected_hash)`가 JCS/SHA-256 해시와 EIP-712 typed data를 만든다. API의 `/approval-payload` 응답에 같은 스냅샷과 해시를 넣는다.
- `verify_approval_signature(payload, signature, expected_wallet, chain_id, contract_address)`는 **스냅샷으로 typed data를 다시 만들어** 사용자가 제출한 객체·서명·지갑을 검사한다. 브라우저가 보낸 typed data를 그대로 신뢰하지 않는다.
- `AgreementChain(ChainConfig.from_env())`는 실제 RPC, chain ID, 배포 코드, relayer 키를 검사한다. `prepare_approval`, `verify_signature`, `record_agreement`, `get_record`를 제공한다.
- `record_agreement` 호출 전 **백엔드가 합의 ID의 DB 잠금을 잡고 양측 승인 상태를 재검사**한다. `persist_tx_hash` 콜백은 서명된 tx의 해시를 DB에 **커밋**해야 한다. 그 후 어댑터가 브로드캐스트한다. 네트워크 응답이 불명확하면 `SubmissionUnknown.tx_hash`로 조회만 하고 새 tx를 만들지 않는다. 이미 저장된 해시는 `previous_tx_hash`로 재진입한다.
- `get_record`는 성공 영수증, `AgreementRecorded` 이벤트, `getAgreement` 결과를 대조한다. 백엔드는 반환된 당사자·총액·nonce도 DB 스냅샷과 대조한 뒤에만 `RECORDED`로 바꾼다.

`record_agreement` 예시:

```python
chain = AgreementChain(ChainConfig.from_env())
result = chain.record_agreement(
    agreement, buyer_signature, seller_signature,
    persist_tx_hash=lambda tx_hash: repository.save_and_commit_tx_hash(agreement["id"], tx_hash),
    previous_tx_hash=agreement.get("tx_hash"),
)
```

## 테스트넷 배포

테스트 ETH가 있는 **별도 relayer 지갑**을 준비하고 환경 변수 `CHAIN_RPC_URL`, `CHAIN_ID`, `RELAYER_PRIVATE_KEY`를 설정한다. 저장소에 키나 실제 `.env`를 올리지 않는다. 운영진 허용 네트워크를 재확인한 뒤 아래를 실행한다.

```bash
cd contracts && npm ci && npm run compile && cd ..
.venv/bin/python -m blockchain.deploy
```

스크립트는 브로드캐스트 **전** 배포 tx hash를 출력한다. 응답이 끊기면 그 hash를 먼저 조회한다. 성공 영수증의 `contract_address`를 `CONTRACT_ADDRESS`로 설정해야 이후 EIP-712 도메인이 고정된다. 배포 뒤 프론트·백엔드 담당에게 `CHAIN_ID`, `CONTRACT_ADDRESS`, ABI, 해시 테스트 벡터를 전달한다. 테스트넷 기록을 제출 증거로 사용할 때는 tx hash, 성공 영수증, 이벤트, `getAgreement` 조회값을 함께 남긴다.

## 직접 실행: Anvil → Base Sepolia

1. 로컬 devnet에서는 별도 터미널에 `anvil --chain-id 31337`을 실행한다. Anvil 화면에 표시되는 **개발 전용** 계정 중 하나를 relayer로 사용한다. 그 키를 공개 테스트넷이나 실제 자산 지갑에 재사용하지 않는다.
2. 저장소 루트에서 `cp .env.example .env` 후 `.env`에 `CHAIN_RPC_URL=http://127.0.0.1:8545`, `CHAIN_ID=31337`, `RELAYER_PRIVATE_KEY=<Anvil 개발 계정 키>`를 설정한다. `CONTRACT_ADDRESS`는 배포 전에는 빈 값이다. `.env`는 Git에서 제외되며 `chmod 600 .env`로 권한을 제한한다.
3. `set -a; source .env; set +a`로 환경을 읽고 `cd contracts && npm ci && npm run compile && cd ..`를 실행한다. 이어 `.venv/bin/python -m blockchain.deploy`로 배포한다. 출력된 `contract_address`를 `.env`의 `CONTRACT_ADDRESS`에 적고 환경을 다시 읽는다.
4. `.venv/bin/python -m blockchain.smoke`를 실행한다. 출력된 `status=success`, `tx_hash`, `block_number`, `agreement_hash`를 확인한다. `tx_recovery_file`은 브로드캐스트 전에 tx hash를 저장한 로컬 파일이며 `.local/`에 남는다. 응답이 끊기면 이 파일의 해시를 조회하고 동일 작업을 무작정 재전송하지 않는다.
5. Base Sepolia에서는 **별도 테스트 전용 relayer 지갑**에 [테스트 ETH](https://docs.base.org/get-started/get-funds)를 받은 뒤 `.env`를 `CHAIN_RPC_URL=https://sepolia.base.org`, `CHAIN_ID=84532`, `CHAIN_EXPLORER_URL=https://sepolia.basescan.org`, 해당 테스트 지갑의 `RELAYER_PRIVATE_KEY`로 바꾼다. [공식 네트워크 값](https://docs.base.org/get-started/connect-to-base)을 확인하고 로컬 계약 주소를 재사용하지 말고 새로 배포한 주소를 `CONTRACT_ADDRESS`에 넣어 3~4단계를 반복한다. 배포 전 `cast chain-id --rpc-url "$CHAIN_RPC_URL"` 결과가 `84532`인지 확인한다. 공개 RPC가 느리거나 제한되면 같은 Base Sepolia의 다른 RPC를 설정한다.

`blockchain.smoke`는 매번 **임시 구매자·판매자 테스트 지갑**을 생성해 둘 다 코드로 서명한다. 따라서 계약·RPC·어댑터의 전체 경로를 확인할 수 있지만, 실제 구매자·판매자가 화면에서 승인했다는 증거는 아니다. 이 사용자 흐름은 프론트와 백엔드 연동 후 따로 검증한다. 테스트 ETH는 relayer의 배포·기록 가스에만 필요하다. 실제 물품이나 원화 결제는 일어나지 않는다.

## Base Sepolia 배포 증거

실제 배포 주소, 배포 및 기록 tx hash, 블록 번호, 합의 해시, 검증 범위는 [`deployments/base-sepolia.json`](deployments/base-sepolia.json)에 남겼다. 두 tx 모두 성공 영수증을 받았고, 기록 tx는 `AgreementRecorded` 이벤트와 `getAgreement` 조회값을 대조했다. 기록에 사용한 구매자·판매자 서명은 smoke 명령이 생성한 임시 테스트 지갑의 서명이며, 두 실제 사용자의 UI 승인을 검증한 결과는 아니다.
