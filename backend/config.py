from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from web3 import Web3


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ACTORS: dict[str, dict[str, str]] = {
    "buyer-demo": {"role": "buyer", "wallet_address": "0x1111111111111111111111111111111111111111"},
    "seller-demo-1": {"role": "seller", "wallet_address": "0x2222222222222222222222222222222222222222"},
    "seller-demo-2": {"role": "seller", "wallet_address": "0x3333333333333333333333333333333333333333"},
    "seller-demo-3": {"role": "seller", "wallet_address": "0x4444444444444444444444444444444444444444"},
}


def _deployed_contract() -> str:
    path = ROOT / "blockchain" / "deployments" / "base-sepolia.json"
    try:
        return str(json.loads(path.read_text(encoding="utf-8"))["contract_address"])
    except (OSError, KeyError, json.JSONDecodeError):
        return ""


def load_local_env(paths: tuple[Path, ...] = (ROOT / ".env.local", ROOT / ".env")) -> None:
    """Read git-ignored env files (written by scripts/setup_secrets.py). Real env vars win."""
    if os.getenv("ACCORD_ENV_FILE", "on").strip().lower() == "off":
        return
    for path in paths:
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key, value = key.strip(), value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be a boolean")


@dataclass(frozen=True)
class Settings:
    mode: str = "mock"
    chain_mode: str = "mock"
    database_path: str = str(ROOT / "data" / "demo.sqlite3")
    app_origin: str = "http://localhost:5173"
    kiln_base_url: str = "https://api.bricksum.com/v1"
    kiln_model_id: str = "qwen3-32b"
    kiln_api_key: str = ""
    kiln_timeout_seconds: float = 60.0
    kiln_max_tokens: int = 1200
    kiln_log_path: str = ""
    kiln_thinking: bool = False
    chain_rpc_url: str = "https://sepolia.base.org"
    chain_id: int = 84532
    chain_explorer_url: str = "https://sepolia.basescan.org"
    contract_address: str = field(default_factory=_deployed_contract)
    relayer_private_key: str = ""
    session_seconds: int = 3600
    allow_demo_sessions: bool = True
    actors: dict[str, dict[str, str]] = field(default_factory=lambda: dict(DEFAULT_ACTORS))

    @classmethod
    def from_env(cls) -> Settings:
        load_local_env()
        mode = os.getenv("APP_MODE", "mock").strip().lower()
        actors: dict[str, dict[str, str]] = dict(DEFAULT_ACTORS)
        raw_actors = os.getenv("DEMO_ACTORS_JSON", "").strip()
        buyer_wallet = os.getenv("DEMO_BUYER_WALLET", "").strip()
        seller_wallet = os.getenv("DEMO_SELLER_WALLET", "").strip()
        if not raw_actors and buyer_wallet and seller_wallet:
            # Two browser-wallet accounts: one buyer, and one seller account shared by the three demo sellers.
            raw_actors = json.dumps({
                "buyer-demo": {"role": "buyer", "wallet_address": buyer_wallet},
                **{f"seller-demo-{index}": {"role": "seller", "wallet_address": seller_wallet} for index in (1, 2, 3)},
            })
        if raw_actors:
            parsed = json.loads(raw_actors)
            if not isinstance(parsed, dict):
                raise ValueError("DEMO_ACTORS_JSON must be an object")
            actors = {}
            for actor_id, actor in parsed.items():
                if not isinstance(actor_id, str) or not isinstance(actor, dict):
                    raise ValueError("Invalid demo actor")
                role, wallet = actor.get("role"), actor.get("wallet_address")
                if role not in {"buyer", "seller"} or not isinstance(wallet, str) or not Web3.is_address(wallet):
                    raise ValueError(f"Invalid demo actor: {actor_id}")
                actors[actor_id] = {"role": role, "wallet_address": Web3.to_checksum_address(wallet).lower()}

        return cls(
            mode=mode,
            chain_mode=os.getenv("CHAIN_MODE", "mock").strip().lower(),
            database_path=os.getenv("DATABASE_PATH", str(ROOT / "data" / "demo.sqlite3")),
            app_origin=os.getenv("APP_ORIGIN", "http://localhost:5173").rstrip("/"),
            kiln_base_url=os.getenv("KILN_BASE_URL", "https://api.bricksum.com/v1").rstrip("/"),
            kiln_model_id=os.getenv("KILN_MODEL_ID", "qwen3-32b"),
            kiln_api_key=os.getenv("KILN_API_KEY", "").strip(),
            kiln_timeout_seconds=float(os.getenv("KILN_TIMEOUT_SECONDS", "60")),
            kiln_max_tokens=int(os.getenv("KILN_MAX_TOKENS", "1200")),
            kiln_log_path=os.getenv("KILN_LOG_PATH", str(ROOT / "data" / "kiln_calls.jsonl")),
            kiln_thinking=_env_bool("KILN_THINKING", False),
            chain_rpc_url=os.getenv("CHAIN_RPC_URL", "https://sepolia.base.org"),
            chain_id=int(os.getenv("CHAIN_ID", "84532")),
            chain_explorer_url=os.getenv("CHAIN_EXPLORER_URL", "https://sepolia.basescan.org").rstrip("/"),
            contract_address=os.getenv("CONTRACT_ADDRESS", _deployed_contract()),
            relayer_private_key=os.getenv("RELAYER_PRIVATE_KEY", "").strip(),
            session_seconds=int(os.getenv("SESSION_SECONDS", "3600")),
            allow_demo_sessions=_env_bool("ALLOW_DEMO_SESSIONS", mode == "mock"),
            actors=actors,
        )

    def validate(self) -> None:
        if self.mode not in {"mock", "live"}:
            raise ValueError("APP_MODE must be mock or live")
        if self.chain_mode not in {"mock", "live"}:
            raise ValueError("CHAIN_MODE must be mock or live")
        if self.mode == "live" and self.chain_mode != "live":
            raise ValueError("APP_MODE=live requires CHAIN_MODE=live")
        if self.chain_mode == "live":
            if self.mode != "live":
                raise ValueError("CHAIN_MODE=live requires APP_MODE=live")
            if self.chain_id != 84532:
                raise ValueError("CHAIN_MODE=live is restricted to Base Sepolia chain ID 84532")
        if self.mode == "live":
            if self.allow_demo_sessions:
                raise ValueError("APP_MODE=live does not allow demo sessions")
            if self.actors == DEFAULT_ACTORS:
                raise ValueError("APP_MODE=live requires explicitly configured demo wallets")
            buyer_wallets = {
                actor["wallet_address"].lower() for actor in self.actors.values()
                if actor["role"] == "buyer"
            }
            seller_wallets = {
                actor["wallet_address"].lower() for actor in self.actors.values()
                if actor["role"] == "seller"
            }
            if not buyer_wallets or not seller_wallets or buyer_wallets & seller_wallets:
                raise ValueError("APP_MODE=live requires distinct configured buyer and seller wallets")
        if self.chain_id <= 0 or self.session_seconds < 60 or self.session_seconds > 86400:
            raise ValueError("Invalid chain ID or session duration")
        if self.contract_address and not Web3.is_address(self.contract_address):
            raise ValueError("CONTRACT_ADDRESS is invalid")
        for actor_id, actor in self.actors.items():
            if not actor_id or actor["role"] not in {"buyer", "seller"} or not Web3.is_address(actor["wallet_address"]):
                raise ValueError("Invalid demo actor configuration")


def json_safe(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    return value
