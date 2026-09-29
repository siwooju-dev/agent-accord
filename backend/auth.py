from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from blockchain.adapter import Web3

from .config import Settings
from .errors import APIError
from .models import DemoSessionRequest
from .repository import DemoSession, SQLiteAgreementRepository


class DemoSessionService:
    def __init__(self, *, repository: SQLiteAgreementRepository, settings: Settings) -> None:
        self.repository = repository
        self.settings = settings

    def create(self, request: DemoSessionRequest) -> tuple[str, DemoSession]:
        if self.settings.app_mode != "demo":
            raise APIError("SESSION_PROVIDER_NOT_CONFIGURED", "Demo sessions are disabled outside demo mode", 503)
        if request.actor_id == "buyer-demo":
            role, wallet = "buyer", self.settings.buyer_demo_wallet
        else:
            role, wallet = "seller", self.settings.seller_demo_wallet
        if (
            not Web3.is_address(wallet)
            or not Web3.is_address(self.settings.buyer_demo_wallet)
            or not Web3.is_address(self.settings.seller_demo_wallet)
            or self.settings.buyer_demo_wallet.lower() == self.settings.seller_demo_wallet.lower()
        ):
            raise APIError("CHAIN_CONFIG_UNAVAILABLE", "Demo wallet configuration is invalid", 503)
        if self.settings.session_ttl_seconds <= 0:
            raise APIError("SESSION_PROVIDER_NOT_CONFIGURED", "Demo session TTL is invalid", 503)
        token = secrets.token_urlsafe(40)
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        expires_at = (datetime.now(timezone.utc) + timedelta(seconds=self.settings.session_ttl_seconds))
        expires_text = expires_at.replace(microsecond=0).isoformat().replace("+00:00", "Z")
        self.repository.save_session(
            token_hash=token_hash, actor_id=request.actor_id, role=role,
            wallet_address=wallet.lower(), expires_at=expires_text,
        )
        return token, DemoSession(request.actor_id, role, wallet.lower(), expires_text)

    def authenticate(self, authorization: str | None) -> DemoSession:
        if self.settings.app_mode != "demo":
            raise APIError("SESSION_PROVIDER_NOT_CONFIGURED", "A production session provider is not configured", 503)
        if not authorization or not authorization.startswith("Bearer "):
            raise APIError("SESSION_REQUIRED", "An authenticated demo session is required", 401)
        raw_token = authorization[7:]
        if not raw_token:
            raise APIError("SESSION_REQUIRED", "An authenticated demo session is required", 401)
        token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
        session = self.repository.get_session(token_hash)
        if session is None:
            raise APIError("SESSION_REQUIRED", "An authenticated demo session is required", 401)
        try:
            expiry = datetime.fromisoformat(session.expires_at.replace("Z", "+00:00"))
        except ValueError as exc:
            raise APIError("SESSION_REQUIRED", "Demo session is invalid", 401) from exc
        if expiry <= datetime.now(timezone.utc):
            raise APIError("SESSION_REQUIRED", "Demo session is missing or expired", 401)
        return session
