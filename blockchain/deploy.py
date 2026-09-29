"""Deploy AgreementRegistry to the explicitly configured EVM testnet.

Run only with a test-funded relayer key in the environment. Never logs the key.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

from eth_account import Account
from web3 import Web3
from web3.exceptions import BadFunctionCallOutput

from .adapter import ChainError


def _verify_relayer(contract, expected_address: str, *, attempts: int = 15) -> None:
    """Public RPCs may return a receipt before their contract-call backend catches up."""
    for attempt in range(attempts):
        try:
            actual = contract.functions.relayer().call()
        except BadFunctionCallOutput as exc:
            if attempt == attempts - 1:
                raise ChainError(
                    "deployment confirmed but contract verification unavailable; "
                    "reconcile the printed tx hash before retrying"
                ) from exc
            time.sleep(2)
            continue
        if actual.lower() != expected_address.lower():
            raise ChainError("deployed relayer mismatch")
        return


def deploy_contract(web3: Web3, chain_id: int, key: str) -> dict[str, int | str]:
    if not web3.is_connected() or web3.eth.chain_id != chain_id:
        raise ChainError("RPC unavailable or chain ID mismatch")
    relayer = Account.from_key(key)
    root = Path(__file__).resolve().parent.parent
    with (root / "blockchain/abi/AgreementRegistry.json").open(encoding="utf-8") as handle:
        abi = json.load(handle)
    with (root / "contracts/build/AgreementRegistry.bytecode.json").open(encoding="utf-8") as handle:
        bytecode = json.load(handle)["bytecode"]
    factory = web3.eth.contract(abi=abi, bytecode=bytecode)
    deploy = factory.constructor(relayer.address)
    latest_block = web3.eth.get_block("latest")
    base_fee = latest_block.get("baseFeePerGas")
    if base_fee is None:
        raise ChainError("EIP-1559 base fee unavailable")
    priority_fee = web3.eth.max_priority_fee
    tx = deploy.build_transaction({
        "from": relayer.address,
        "chainId": chain_id,
        "nonce": web3.eth.get_transaction_count(relayer.address, "pending"),
        "gas": deploy.estimate_gas({"from": relayer.address}) * 12 // 10,
        "type": 2,
        "maxPriorityFeePerGas": priority_fee,
        "maxFeePerGas": base_fee * 2 + priority_fee,
    })
    signed = relayer.sign_transaction(tx)
    tx_hash = Web3.to_hex(signed.hash)
    # Print before broadcast so a timeout can be reconciled without blind redeployment.
    print(f"deployment_tx_hash={tx_hash}", flush=True)
    returned = Web3.to_hex(web3.eth.send_raw_transaction(signed.raw_transaction))
    if returned.lower() != tx_hash.lower():
        raise ChainError("RPC returned an unexpected transaction hash")
    receipt = web3.eth.wait_for_transaction_receipt(tx_hash, timeout=180)
    if receipt["status"] != 1 or not receipt["contractAddress"]:
        raise ChainError("deployment failed")
    contract = web3.eth.contract(address=receipt["contractAddress"], abi=abi)
    _verify_relayer(contract, relayer.address)
    return {
        "chain_id": chain_id,
        "contract_address": receipt["contractAddress"],
        "block_number": receipt["blockNumber"],
        "deployment_tx_hash": tx_hash,
    }


def main() -> None:
    rpc_url = os.environ.get("CHAIN_RPC_URL", "")
    chain_id_text = os.environ.get("CHAIN_ID", "")
    key = os.environ.get("RELAYER_PRIVATE_KEY", "")
    if not rpc_url or not chain_id_text or not key:
        raise ChainError("CHAIN_RPC_URL, CHAIN_ID and RELAYER_PRIVATE_KEY are required")
    chain_id = int(chain_id_text)
    web3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 15}))
    result = deploy_contract(web3, chain_id, key)
    print(f"chain_id={result['chain_id']}")
    print(f"contract_address={result['contract_address']}")
    print(f"block_number={result['block_number']}")


if __name__ == "__main__":
    main()
