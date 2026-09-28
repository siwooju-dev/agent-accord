import os
from dataclasses import dataclass
from urllib.parse import urlparse


@dataclass
class Settings:
    mode: str = "mock"
    database_url: str = "sqlite:///./dealbattle.db"
    kiln_base_url: str = ""
    kiln_api_key: str = ""
    kiln_model: str = ""
    kiln_auth: str = "bearer"
    auth_secret: str = ""
    allowed_origin: str = "http://localhost:5173"
    session_seconds: int = 3600
    chain_mode: str = "mock"
    chain_network: str = ""
    chain_id: int = 0
    chain_rpc: str = ""
    chain_explorer: str = ""
    chain_contract: str = ""
    chain_allowed_ids: str = ""
    chain_evidence: str = ""
    relayer_key: str = ""
    confirmations: int = 1

    @classmethod
    def env(cls):
        return cls(mode=os.getenv("APP_MODE", ""), database_url=os.getenv("DATABASE_URL", "sqlite:///./dealbattle.db"),
            kiln_base_url=os.getenv("KILN_BASE_URL", ""), kiln_api_key=os.getenv("KILN_API_KEY", ""),
            kiln_model=os.getenv("KILN_MODEL", ""), kiln_auth=os.getenv("KILN_AUTH_MODE", "bearer"),
            auth_secret=os.getenv("AUTH_SIGNING_SECRET", ""), allowed_origin=os.getenv("APP_ORIGIN", "http://localhost:5173"),
            session_seconds=int(os.getenv("SESSION_SECONDS", "3600")), chain_mode=os.getenv("CHAIN_MODE", "mock"),
            chain_network=os.getenv("CHAIN_NETWORK", ""), chain_id=int(os.getenv("CHAIN_ID", "0")),
            chain_rpc=os.getenv("CHAIN_RPC_URL", ""), chain_explorer=os.getenv("CHAIN_EXPLORER_URL", ""),
            chain_contract=os.getenv("CHAIN_CONTRACT_ADDRESS", ""), chain_allowed_ids=os.getenv("CHAIN_ALLOWED_IDS", ""),
            chain_evidence=os.getenv("CHAIN_ALLOWED_EVIDENCE", ""), relayer_key=os.getenv("RELAYER_PRIVATE_KEY", ""),
            confirmations=int(os.getenv("CHAIN_CONFIRMATIONS", "1")))

    def validate(self):
        if self.mode not in {"mock", "live"} or self.chain_mode not in {"mock", "evm"}:
            raise ValueError("Invalid application/chain mode")
        if self.mode == "live":
            if not all([self.kiln_base_url, self.kiln_api_key, self.kiln_model]) or len(self.auth_secret) < 32:
                raise ValueError("Live requires Kiln settings and a >=32-character AUTH_SIGNING_SECRET")
            if urlparse(self.kiln_base_url).scheme != "https" or not self.allowed_origin.startswith("https://"):
                raise ValueError("Live requires HTTPS")
            if self.chain_mode != "evm":
                raise ValueError("Live cannot use mock chain")
        if self.kiln_auth not in {"bearer", "x-api-key"}:
            raise ValueError("Unsupported KILN_AUTH_MODE")
        if not 60 <= self.session_seconds <= 86400 or self.confirmations < 1:
            raise ValueError("Invalid session/confirmation limit")
        if self.chain_mode == "evm":
            if not all([self.chain_rpc, self.chain_network, self.chain_evidence, self.relayer_key, self.chain_contract]):
                raise ValueError("EVM requires approved network evidence, RPC, contract and relayer")
            if self.chain_id not in {int(x) for x in self.chain_allowed_ids.split(",") if x}:
                raise ValueError("Chain ID is not explicitly allowed")
            if self.chain_network not in {"devnet", "testnet"}:
                raise ValueError("Only devnet/testnet supported")
