"""web3.py relayer adapter for the immutable AgreementRegistry v1 contract."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping

from eth_account import Account
from web3 import Web3
from web3.exceptions import TransactionNotFound

from .signing import ApprovalError, approval_payload, verify_approval_signature


ABI_PATH = Path(__file__).parent / "abi" / "AgreementRegistry.json"


class ChainError(RuntimeError):
    """Unsafe configuration, invalid agreement, or failed chain verification."""


class SubmissionUnknown(ChainError):
    """A signed transaction may have reached the RPC; keep its hash and reconcile."""

    def __init__(self, tx_hash: str):
        super().__init__("transaction submission uncertain; reconcile the saved hash")
        self.tx_hash = tx_hash


@dataclass(frozen=True)
class ChainConfig:
    rpc_url: str
    chain_id: int
    contract_address: str
    relayer_private_key: str

    @classmethod
    def from_env(cls) -> "ChainConfig":
        try:
            return cls(
                rpc_url=os.environ["CHAIN_RPC_URL"],
                chain_id=int(os.environ["CHAIN_ID"]),
                contract_address=os.environ["CONTRACT_ADDRESS"],
                relayer_private_key=os.environ["RELAYER_PRIVATE_KEY"],
            )
        except (KeyError, ValueError) as exc:
            raise ChainError("CHAIN_CONFIG_UNAVAILABLE") from exc


class AgreementChain:
    def __init__(self, config: ChainConfig, web3: Web3 | None = None):
        if config.chain_id <= 0 or not Web3.is_address(config.contract_address):
            raise ChainError("CHAIN_CONFIG_UNAVAILABLE")
        if not config.rpc_url and web3 is None:
            raise ChainError("CHAIN_CONFIG_UNAVAILABLE")
        self.config = config
        self.web3 = web3 or Web3(Web3.HTTPProvider(config.rpc_url, request_kwargs={"timeout": 15}))
        if not self.web3.is_connected():
            raise ChainError("chain RPC unavailable")
        if self.web3.eth.chain_id != config.chain_id:
            raise ChainError("chain ID mismatch")
        try:
            self.relayer = Account.from_key(config.relayer_private_key)
        except (TypeError, ValueError) as exc:
            raise ChainError("invalid relayer key") from exc
        with ABI_PATH.open(encoding="utf-8") as handle:
            abi = json.load(handle)
        self.contract = self.web3.eth.contract(
            address=Web3.to_checksum_address(config.contract_address), abi=abi
        )
        if not self.web3.eth.get_code(self.contract.address):
            raise ChainError("contract not deployed at configured address")
        if self.contract.functions.relayer().call().lower() != self.relayer.address.lower():
            raise ChainError("configured relayer is not authorized by contract")

    def prepare_approval(self, agreement: Mapping[str, Any]) -> dict[str, Any]:
        if not agreement.get("snapshot_hash"):
            raise ChainError("stored snapshot hash required")
        return approval_payload(
            agreement["snapshot"], chain_id=self.config.chain_id,
            contract_address=self.config.contract_address,
            expected_hash=agreement.get("snapshot_hash"),
        )

    def verify_signature(self, payload: Mapping[str, Any], signature: str, expected_wallet: str) -> str:
        chain_time = int(self.web3.eth.get_block("latest")["timestamp"])
        return verify_approval_signature(
            payload, signature, expected_wallet, chain_id=self.config.chain_id,
            contract_address=self.config.contract_address, now=chain_time,
        )

    def _stored(self, agreement_hash: str) -> tuple[Any, ...]:
        return self.contract.functions.getAgreement(agreement_hash).call()

    def record_agreement(
        self,
        agreement: Mapping[str, Any],
        buyer_signature: str,
        seller_signature: str,
        *,
        persist_tx_hash: Callable[[str], None],
        previous_tx_hash: str | None = None,
    ) -> dict[str, Any]:
        """Persist the signed tx hash before broadcasting. Caller locks agreement ID in DB."""
        if previous_tx_hash:
            try:
                payload = self.prepare_approval(agreement)
            except (KeyError, ApprovalError) as exc:
                raise ChainError("invalid agreement") from exc
            record = self.get_record(previous_tx_hash, payload["snapshot_hash"])
            snapshot = payload["snapshot"]
            if record["status"] == "success" and (
                record["buyer"].lower() != snapshot["buyer_wallet"]
                or record["seller"].lower() != snapshot["seller_wallet"]
                or record["total_krw"] != snapshot["total_krw"]
                or record["nonce"] != snapshot["nonce"]
            ):
                raise ChainError("record differs from agreement")
            return {"status": "previous_submission", "tx_hash": previous_tx_hash, "record": record}
        if not callable(persist_tx_hash):
            raise ChainError("durable tx-hash callback required")
        try:
            payload = self.prepare_approval(agreement)
            snapshot = payload["snapshot"]
            self.verify_signature(payload, buyer_signature, snapshot["buyer_wallet"])
            self.verify_signature(payload, seller_signature, snapshot["seller_wallet"])
        except (KeyError, ApprovalError) as exc:
            raise ChainError("invalid agreement or signatures") from exc

        agreement_hash = payload["snapshot_hash"]
        try:
            stored = self._stored(agreement_hash)
        except Exception as exc:
            raise ChainError("cannot check prior on-chain record") from exc
        if stored[0]:
            if (
                stored[1].lower() != snapshot["buyer_wallet"]
                or stored[2].lower() != snapshot["seller_wallet"]
                or stored[3] != snapshot["total_krw"]
                or stored[4] != snapshot["nonce"]
            ):
                raise ChainError("existing record differs from agreement")
            return {"status": "already_recorded", "agreement_hash": agreement_hash,
                    "recorded_at": stored[5]}

        message = payload["typed_data"]["message"]
        function = self.contract.functions.recordAgreement(
            agreement_hash, message["buyer"], message["seller"], message["totalKrw"],
            message["nonce"], message["deadline"], buyer_signature, seller_signature,
        )
        try:
            nonce = self.web3.eth.get_transaction_count(self.relayer.address, "pending")
            gas_estimate = function.estimate_gas({"from": self.relayer.address})
            latest_block = self.web3.eth.get_block("latest")
            base_fee = latest_block.get("baseFeePerGas")
            if base_fee is None:
                raise ChainError("EIP-1559 base fee unavailable")
            priority_fee = self.web3.eth.max_priority_fee
            transaction = function.build_transaction({
                "from": self.relayer.address,
                "chainId": self.config.chain_id,
                "nonce": nonce,
                "gas": gas_estimate * 12 // 10,
                "type": 2,
                "maxPriorityFeePerGas": priority_fee,
                "maxFeePerGas": base_fee * 2 + priority_fee,
            })
            signed = self.relayer.sign_transaction(transaction)
        except Exception as exc:
            raise ChainError("cannot prepare recording transaction") from exc
        tx_hash = Web3.to_hex(signed.hash)
        # This callback must commit the hash durably. A failed callback prevents broadcast.
        persist_tx_hash(tx_hash)
        try:
            returned_hash = Web3.to_hex(self.web3.eth.send_raw_transaction(signed.raw_transaction))
        except Exception as exc:
            raise SubmissionUnknown(tx_hash) from exc
        if returned_hash.lower() != tx_hash.lower():
            raise SubmissionUnknown(tx_hash)
        return {"status": "submitted", "tx_hash": tx_hash, "agreement_hash": agreement_hash}

    def get_record(self, tx_hash: str, agreement_hash: str) -> dict[str, Any]:
        if not isinstance(tx_hash, str) or not re.fullmatch(r"0x[0-9a-fA-F]{64}", tx_hash):
            raise ChainError("invalid transaction hash")
        try:
            receipt = self.web3.eth.get_transaction_receipt(tx_hash)
        except TransactionNotFound:
            try:
                self.web3.eth.get_transaction(tx_hash)
            except TransactionNotFound:
                return {"status": "not_found", "tx_hash": tx_hash}
            except Exception as exc:
                raise ChainError("cannot reconcile transaction") from exc
            return {"status": "pending", "tx_hash": tx_hash}
        except Exception as exc:
            raise ChainError("cannot reconcile transaction") from exc
        if receipt["status"] != 1:
            return {"status": "failed", "tx_hash": tx_hash, "block_number": receipt["blockNumber"]}
        try:
            transaction = self.web3.eth.get_transaction(tx_hash)
            if transaction["to"].lower() != self.contract.address.lower():
                raise ChainError("transaction target mismatch")
            events = self.contract.events.AgreementRecorded().process_receipt(receipt)
            if len(events) != 1 or Web3.to_hex(events[0]["args"]["agreementHash"]).lower() != agreement_hash.lower():
                raise ChainError("agreement event mismatch")
            event = events[0]["args"]
            stored = self._stored(agreement_hash)
            if not stored[0] or (
                stored[1].lower() != event["buyer"].lower()
                or stored[2].lower() != event["seller"].lower()
                or stored[3] != event["totalKrw"]
                or stored[4] != event["nonce"]
                or stored[5] != event["recordedAt"]
            ):
                raise ChainError("contract record mismatch")
        except ChainError:
            raise
        except Exception as exc:
            raise ChainError("cannot verify receipt, event and contract") from exc
        return {
            "status": "success", "tx_hash": tx_hash, "chain_id": self.config.chain_id,
            "block_number": receipt["blockNumber"], "agreement_hash": agreement_hash,
            "buyer": event["buyer"], "seller": event["seller"],
            "total_krw": event["totalKrw"], "nonce": event["nonce"],
            "recorded_at": event["recordedAt"],
        }
