from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


MustHave = Literal["warranty_active", "evidence_present"]


class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class DemoSessionInput(InputModel):
    actor_id: str = Field(min_length=1, max_length=80)


class BuyerIntentInput(InputModel):
    gpu_model: str = Field(min_length=1, max_length=100)
    max_total_krw: int = Field(gt=0, le=100_000_000)
    delivery_deadline: datetime
    must_have: list[MustHave] = Field(default_factory=list, max_length=2)

    @field_validator("gpu_model")
    @classmethod
    def normalize_model(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("gpu_model must not be blank")
        return value

    @field_validator("delivery_deadline")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("delivery_deadline must include a timezone")
        return value

    @field_validator("delivery_deadline", mode="before")
    @classmethod
    def parse_delivery_deadline(cls, value: Any) -> Any:
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                return value
        return value

    @field_validator("must_have")
    @classmethod
    def unique_requirements(cls, value: list[MustHave]) -> list[MustHave]:
        if len(value) != len(set(value)):
            raise ValueError("must_have values must be unique")
        return value


class ListingInput(InputModel):
    gpu_model: str = Field(min_length=1, max_length=100)
    asking_price_krw: int = Field(gt=0, le=100_000_000)
    min_item_price_krw: int = Field(gt=0, le=100_000_000)
    shipping_fee_krw: int = Field(ge=0, le=10_000_000)
    earliest_delivery_at: datetime
    condition_text: str = Field(min_length=1, max_length=4000)
    warranty_end: date | None
    stock_status: Literal["available", "sold"]
    evidence_ids: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("gpu_model")
    @classmethod
    def normalize_model(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("gpu_model must not be blank")
        return value

    @field_validator("earliest_delivery_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("earliest_delivery_at must include a timezone")
        return value

    @field_validator("earliest_delivery_at", mode="before")
    @classmethod
    def parse_earliest_delivery_at(cls, value: Any) -> Any:
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                return value
        return value

    @field_validator("warranty_end", mode="before")
    @classmethod
    def parse_warranty_end(cls, value: Any) -> Any:
        if isinstance(value, str):
            try:
                return date.fromisoformat(value)
            except ValueError:
                return value
        return value

    @field_validator("condition_text")
    @classmethod
    def normalize_condition(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("condition_text must not be blank")
        return value

    @field_validator("evidence_ids")
    @classmethod
    def normalize_evidence_ids(cls, value: list[str]) -> list[str]:
        cleaned = [item.strip() for item in value]
        if any(not item or len(item) > 100 for item in cleaned):
            raise ValueError("evidence_ids must contain nonblank IDs up to 100 characters")
        if len(cleaned) != len(set(cleaned)):
            raise ValueError("evidence_ids must be unique")
        return cleaned

    @model_validator(mode="after")
    def seller_floor_cannot_exceed_ask(self) -> ListingInput:
        if self.min_item_price_krw > self.asking_price_krw:
            raise ValueError("min_item_price_krw must not exceed asking_price_krw")
        return self


class NegotiationInput(InputModel):
    buyer_intent_id: str = Field(min_length=1, max_length=80)


class DecisionInput(InputModel):
    decision: Literal["approve", "reject"]
    snapshot_hash: str = Field(pattern=r"^0x[0-9a-f]{64}$")
    signature: str | None = Field(default=None, pattern=r"^0x[0-9a-fA-F]{130}$")

    @model_validator(mode="after")
    def signature_required_for_approval(self) -> DecisionInput:
        if self.decision == "approve" and self.signature is None:
            raise ValueError("signature is required for approval")
        if self.decision == "reject" and self.signature is not None:
            raise ValueError("signature is only accepted for approval")
        return self


class DemoSessionView(BaseModel):
    request_id: str
    access_token: str
    actor_id: str
    role: Literal["buyer", "seller"]
    wallet_address: str


class BuyerIntentView(BaseModel):
    request_id: str
    id: str
    buyer_id: str
    gpu_model: str
    max_total_krw: int
    delivery_deadline: str
    must_have: list[str]


class ListingView(BaseModel):
    request_id: str
    id: str
    seller_id: str
    gpu_model: str
    asking_price_krw: int
    shipping_fee_krw: int
    evidence_ids: list[str]
    private_policy: dict[str, Any] | None = None


class NegotiationStartView(BaseModel):
    request_id: str
    id: str
    flow_id: str
    status: str
    agreement_id: str | None


class NegotiationView(NegotiationStartView):
    assessments: list[dict[str, Any]] = Field(default_factory=list)
    offers: list[dict[str, Any]] = Field(default_factory=list)
    blocked_events: list[dict[str, Any]] = Field(default_factory=list)
    selected_offer_id: str | None = None


class ChainView(BaseModel):
    mode: Literal["testnet", "mock"] | None = None
    chain_id: int | None = None
    tx_hash: str | None = None
    receipt_status: Literal["pending", "success", "failed"] | None = None
    block_number: int | None = None
    event_name: str | None = None
    recorded_hash: str | None = None
    reason_code: str | None = None


class AgreementSummaryView(BaseModel):
    id: str
    status: str
    listing_id: str
    total_krw: int
    buyer_approved: bool
    seller_approved: bool


class AgreementView(BaseModel):
    request_id: str
    id: str
    flow_id: str
    offer_id: str
    status: str
    snapshot: dict[str, Any]
    snapshot_hash: str
    assessment: dict[str, Any] | None
    rationale: str | None
    buyer_approved: bool
    seller_approved: bool
    chain: ChainView


class ApprovalPayloadView(BaseModel):
    request_id: str
    snapshot: dict[str, Any]
    snapshot_hash: str
    typed_data: dict[str, Any]
    expected_wallet: str


class DecisionView(BaseModel):
    request_id: str
    agreement_id: str
    status: str
    buyer_approved: bool
    seller_approved: bool
    chain: ChainView


class AuditView(BaseModel):
    request_id: str
    flow_id: str
    status: str
    events: list[dict[str, Any]]
    model_usage: list[dict[str, Any]]
    totals: dict[str, Any]
    chain: ChainView


class HealthView(BaseModel):
    status: Literal["ok"] = "ok"
    contract_version: Literal["0.1"] = "0.1"
    mode: Literal["mock", "live"]


class ErrorBody(BaseModel):
    code: str
    message: str


class ErrorView(BaseModel):
    request_id: str | None
    error: ErrorBody
