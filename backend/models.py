from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class DemoSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    actor_id: Literal["buyer-demo", "seller-demo"]


class DemoSessionView(BaseModel):
    request_id: str
    access_token: str
    actor_id: str
    role: Literal["buyer", "seller"]
    wallet_address: str
    expires_at: datetime


class ApprovalPayloadView(BaseModel):
    request_id: str
    agreement_id: str
    snapshot: dict[str, Any]
    snapshot_hash: str
    typed_data: dict[str, Any]
    expected_wallet: str


class AgreementDecisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["approve", "reject"]
    snapshot_hash: str = Field(pattern=r"^0x[0-9a-f]{64}$")
    signature: str | None = None

    @model_validator(mode="after")
    def check_signature_presence(self) -> "AgreementDecisionRequest":
        if self.decision == "approve" and self.signature is None:
            raise ValueError("signature is required for approve")
        if self.decision == "reject" and self.signature is not None:
            raise ValueError("signature is not accepted for reject")
        return self


class ChainView(BaseModel):
    mode: Literal["testnet"] | None = None
    chain_id: int | None = None
    tx_hash: str | None = None
    receipt_status: Literal["pending", "success", "failed"] | None = None
    block_number: int | None = None
    event_name: str | None = None
    recorded_hash: str | None = None
    reason_code: str | None = None
    submission_state: str | None = None


class AgreementView(BaseModel):
    request_id: str
    id: str
    flow_id: str
    offer_id: str
    status: str
    snapshot: dict[str, Any]
    snapshot_hash: str
    assessment: dict[str, Any] | None = None
    rationale: str | None = None
    buyer_approved: bool
    seller_approved: bool
    chain: ChainView


class AgreementDecisionView(BaseModel):
    request_id: str
    agreement_id: str
    status: str
    buyer_approved: bool
    seller_approved: bool
    chain: ChainView


class APIErrorBody(BaseModel):
    request_id: str
    error: dict[str, str]
