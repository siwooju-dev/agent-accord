from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path


BASE_SEPOLIA_CHAIN_ID = 84532
BASE_SEPOLIA_CONTRACT = "0x4e62343BB75a2D21E2E38850d49a680f62b9e6E4"
BASE_SEPOLIA_RPC = "https://sepolia.base.org"
BASE_SEPOLIA_EXPLORER = "https://sepolia.basescan.org"
_ADDRESS = re.compile(r"0x[0-9a-fA-F]{40}\Z")


@dataclass(frozen=True)
class Settings:
    database_path: Path = Path("data/demo.sqlite3")
    app_mode: str = "demo"
    chain_rpc_url: str = BASE_SEPOLIA_RPC
    chain_id: int = BASE_SEPOLIA_CHAIN_ID
    chain_explorer_url: str = BASE_SEPOLIA_EXPLORER
    contract_address: str = BASE_SEPOLIA_CONTRACT
    relayer_private_key: str | None = field(default=None, repr=False)
    session_ttl_seconds: int = 3600
    buyer_demo_wallet: str = "0x1111111111111111111111111111111111111111"
    seller_demo_wallet: str = "0x2222222222222222222222222222222222222222"

    @classmethod
    def from_env(cls) -> "Settings":
        try:
            chain_id = int(os.environ.get("CHAIN_ID", str(BASE_SEPOLIA_CHAIN_ID)))
        except ValueError:
            chain_id = 0
        try:
            session_ttl = int(os.environ.get("DEMO_SESSION_TTL_SECONDS", "3600"))
        except ValueError:
            session_ttl = 0
        return cls(
            database_path=Path(os.environ.get("DATABASE_PATH", "data/demo.sqlite3")),
            app_mode=os.environ.get("APP_MODE", "demo").strip().lower(),
            chain_rpc_url=os.environ.get("CHAIN_RPC_URL", BASE_SEPOLIA_RPC),
            chain_id=chain_id,
            chain_explorer_url=os.environ.get("CHAIN_EXPLORER_URL", BASE_SEPOLIA_EXPLORER),
            contract_address=os.environ.get("CONTRACT_ADDRESS", BASE_SEPOLIA_CONTRACT),
            relayer_private_key=os.environ.get("RELAYER_PRIVATE_KEY") or None,
            session_ttl_seconds=session_ttl,
            buyer_demo_wallet=os.environ.get("BUYER_DEMO_WALLET", "0x1111111111111111111111111111111111111111"),
            seller_demo_wallet=os.environ.get("SELLER_DEMO_WALLET", "0x2222222222222222222222222222222222222222"),
        )

    def validate_signing_chain(self) -> None:
        if (
            self.chain_id != BASE_SEPOLIA_CHAIN_ID
            or not _ADDRESS.fullmatch(self.contract_address)
            or self.contract_address.lower() != BASE_SEPOLIA_CONTRACT.lower()
        ):
            raise ValueError("CHAIN_CONFIG_UNAVAILABLE")

    @property
    def has_relayer(self) -> bool:
        return bool(self.relayer_private_key)
