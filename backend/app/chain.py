import json
from typing import Protocol
from web3 import Web3
from web3.exceptions import TransactionNotFound
from eth_account import Account


ABI = [
    {"type": "function", "name": "record", "inputs": [{"name": "recordId", "type": "bytes32"}, {"name": "auditHash", "type": "bytes32"}], "outputs": [], "stateMutability": "nonpayable"},
    {"type": "function", "name": "records", "inputs": [{"name": "", "type": "bytes32"}], "outputs": [{"name": "", "type": "bytes32"}], "stateMutability": "view"},
    {"type": "function", "name": "relayer", "inputs": [], "outputs": [{"name": "", "type": "address"}], "stateMutability": "view"},
    {"type": "event", "name": "AuditRecorded", "anonymous": False, "inputs": [{"name": "recordId", "type": "bytes32", "indexed": True}, {"name": "auditHash", "type": "bytes32", "indexed": False}]},
]


class ChainPort(Protocol):
    def pending_nonce(self) -> int | None: ...
    def prepare(self, record_id: str, audit_hash: str, nonce: int | None) -> dict: ...
    def broadcast(self, prepared: dict) -> None: ...
    def reconcile(self, record_id: str, audit_hash: str, data: dict) -> dict: ...


class MockChain:
    def pending_nonce(self): return None

    def prepare(self, record_id, audit_hash, nonce):
        return {"chain_id": None, "contract": None, "tx_hash": None, "nonce": None, "raw_tx": None}

    def broadcast(self, prepared): pass

    def reconcile(self, record_id, audit_hash, data):
        return data | {"status": "MOCK_RECORDED", "receipt": {"simulated": True, "record_id": record_id},
                       "event": {"simulated": True, "audit_hash": audit_hash}}


class EvmChain:
    def __init__(self, settings, web3=None):
        self.settings = settings
        self.w3 = web3 or Web3(Web3.HTTPProvider(settings.chain_rpc, request_kwargs={"timeout": 15}))
        self.account = Account.from_key(settings.relayer_key)
        self.contract = self.w3.eth.contract(address=Web3.to_checksum_address(settings.chain_contract), abi=ABI)

    def check_network(self):
        if self.w3.eth.chain_id != self.settings.chain_id:
            raise ValueError("CHAIN_ID_MISMATCH")
        if not self.w3.eth.get_code(self.contract.address): raise ValueError("CONTRACT_MISSING")
        if self.contract.functions.relayer().call().lower() != self.account.address.lower():
            raise ValueError("RELAYER_MISMATCH")

    def pending_nonce(self):
        self.check_network()
        return self.w3.eth.get_transaction_count(self.account.address, "pending")

    def prepare(self, record_id, audit_hash, nonce):
        self.check_network()
        function = self.contract.functions.record(bytes.fromhex(record_id), bytes.fromhex(audit_hash))
        tx = function.build_transaction({"from": self.account.address, "chainId": self.settings.chain_id,
                                        "nonce": nonce, "value": 0})
        signed = self.account.sign_transaction(tx)
        return {"chain_id": self.settings.chain_id, "contract": self.contract.address,
                "tx_hash": Web3.to_hex(signed.hash), "nonce": nonce,
                "raw_tx": Web3.to_hex(signed.raw_transaction)}

    def broadcast(self, prepared):
        self.check_network()
        tx = self.w3.eth.send_raw_transaction(prepared["raw_tx"])
        if Web3.to_hex(tx) != prepared["tx_hash"]: raise ValueError("TX_HASH_MISMATCH")

    def reconcile(self, record_id, audit_hash, data):
        self.check_network()
        if not data.get("tx_hash"):
            # An on-chain mapping alone is insufficient: require the original receipt/event.
            return data | {"status": "UNKNOWN"}
        try:
            receipt = self.w3.eth.get_transaction_receipt(data["tx_hash"])
        except TransactionNotFound:
            return data | {"status": "UNKNOWN"}
        safe = json.loads(self.w3.to_json(receipt))
        if Web3.to_hex(receipt["transactionHash"]) != data["tx_hash"]:
            return data | {"status": "FAILED", "receipt": safe}
        if receipt["status"] != 1:
            return data | {"status": "FAILED", "receipt": safe}
        if receipt["to"].lower() != self.contract.address.lower():
            return data | {"status": "FAILED", "receipt": safe}
        events = self.contract.events.AuditRecorded().process_receipt(receipt)
        matching = [ev for ev in events if ev["address"].lower() == self.contract.address.lower()
                    and ev["args"]["recordId"].hex() == record_id and ev["args"]["auditHash"].hex() == audit_hash]
        stored = self.contract.functions.records(bytes.fromhex(record_id)).call().hex()
        if len(matching) != 1 or stored != audit_hash:
            return data | {"status": "FAILED", "receipt": safe}
        event = {"record_id": record_id, "audit_hash": audit_hash, "log_index": matching[0]["logIndex"], "contract": self.contract.address}
        status = "CONFIRMED" if self.w3.eth.block_number - receipt["blockNumber"] + 1 >= self.settings.confirmations else "PENDING"
        return data | {"status": status, "receipt": safe, "event": event}
