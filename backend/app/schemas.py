from datetime import date, datetime, timezone
from enum import Enum
from typing import Annotated, Literal, Any
from pydantic import BaseModel, ConfigDict, Field, AwareDatetime, StrictInt, field_validator, field_serializer


Money = Annotated[StrictInt, Field(gt=0, le=100_000_000)]
Fee = Annotated[StrictInt, Field(ge=0, le=100_000_000)]
Version = Annotated[StrictInt, Field(ge=0)]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Reason(str, Enum):
    BUDGET_EXCEEDED = "BUDGET_EXCEEDED"
    SELLER_FLOOR_VIOLATED = "SELLER_FLOOR_VIOLATED"
    SELLER_NOT_ALLOWED = "SELLER_NOT_ALLOWED"
    SPEC_MISMATCH = "SPEC_MISMATCH"
    DELIVERY_TOO_LATE = "DELIVERY_TOO_LATE"
    OUT_OF_STOCK = "OUT_OF_STOCK"
    POLICY_EXPIRED = "POLICY_EXPIRED"
    PRODUCT_EXPIRED = "PRODUCT_EXPIRED"
    ROUND_LIMIT = "ROUND_LIMIT"
    INVALID_MODEL_OUTPUT = "INVALID_MODEL_OUTPUT"
    MODEL_UNAVAILABLE = "MODEL_UNAVAILABLE"
    USAGE_UNAVAILABLE = "USAGE_UNAVAILABLE"
    MODEL_REJECTED = "MODEL_REJECTED"
    ACCEPT_MISMATCH = "ACCEPT_MISMATCH"
    APPROVAL_STALE = "APPROVAL_STALE"
    INVALID_DATA = "INVALID_DATA"


class State(str, Enum):
    DRAFT = "DRAFT"
    POLICY_CONFIRMED = "POLICY_CONFIRMED"
    NEGOTIATING = "NEGOTIATING"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    BLOCKED = "BLOCKED"
    REJECTED = "REJECTED"
    RECORDING = "RECORDING"
    RECORDED = "RECORDED"
    MOCK_RECORDED = "MOCK_RECORDED"
    CHAIN_FAILED = "CHAIN_FAILED"


class BuyerPolicy(Model):
    max_total_krw: Money
    min_ram_gb: Annotated[StrictInt, Field(ge=1, le=256)]
    min_ssd_gb: Annotated[StrictInt, Field(ge=1, le=8192)]
    allowed_seller_ids: list[str] = Field(min_length=1, max_length=20)
    delivery_by: date
    expires_at: AwareDatetime
    max_rounds: Annotated[StrictInt, Field(ge=2, le=12)] = 6

    @field_validator("expires_at")
    @classmethod
    def utc(cls, value):
        return value.astimezone(timezone.utc)

    @field_serializer("expires_at")
    def serialize_expiry(self, value):
        return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    @field_validator("allowed_seller_ids")
    @classmethod
    def sellers(cls, value):
        if any(not x or len(x) > 80 for x in value):
            raise ValueError("Invalid seller ID")
        return sorted(set(value))


class ProductView(Model):
    product_id: str
    seller_id: str
    product_version: Annotated[StrictInt, Field(ge=1)]
    seller_version: Annotated[StrictInt, Field(ge=1)]
    name: str = Field(min_length=1, max_length=200)
    ram_gb: Annotated[StrictInt, Field(ge=1, le=256)]
    ssd_gb: Annotated[StrictInt, Field(ge=1, le=8192)]
    asking_price_krw: Money
    shipping_fee_krw: Fee
    fee_krw: Fee
    delivery_date: date
    stock: int
    expires_at: AwareDatetime
    source: Literal["simulated"]

    @field_serializer("expires_at")
    def serialize_expiry(self, value):
        return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class Proposal(Model):
    action: Literal["OFFER", "COUNTER", "ACCEPT", "REJECT"]
    item_price_krw: Money
    reason: str = Field(min_length=1, max_length=500)
    product_id: str = Field(min_length=1, max_length=80)


class Check(Model):
    rule: str
    passed: bool
    reason_code: Reason | None


class Decision(Model):
    allowed: bool
    checks: list[Check]
    reason_codes: list[Reason]
    policy_version: int


class RoundView(Model):
    id: str
    number: int
    actor: Literal["buyer", "seller"]
    proposal: Proposal | None
    decision: Decision
    valid: bool
    created_at: str


class Snapshot(Model):
    schema_version: Literal["2"] = "2"
    agreement_id: str
    product_id: str
    seller_id: str
    product_version: int
    seller_version: int
    name: str
    ram_gb: int
    ssd_gb: int
    item_price_krw: Money
    shipping_fee_krw: Fee
    fee_krw: Fee
    total_krw: Money
    delivery_date: date
    policy_version: int
    nonce: str
    expiry: AwareDatetime
    source: Literal["simulated"]

    @field_serializer("expiry")
    def serialize_expiry(self, value):
        return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class AgreementView(Model):
    id: str
    snapshot: Snapshot
    snapshot_hash: str
    valid: bool
    approval: dict[str, Any] | None


class ChainView(Model):
    record_id: str
    adapter_mode: Literal["mock", "evm"]
    status: Literal["QUEUED", "SUBMITTING", "PENDING", "CONFIRMED", "MOCK_RECORDED", "UNKNOWN", "FAILED"]
    audit_hash: str
    chain_id: int | None
    contract: str | None
    tx_hash: str | None
    nonce: int | None
    explorer_url: str | None
    receipt: dict[str, Any] | None
    event: dict[str, Any] | None


class DealView(Model):
    id: str
    mode: Literal["mock", "live"]
    status: State
    product: ProductView
    policy: BuyerPolicy
    policy_version: int
    policy_confirmed: bool
    reason_codes: list[Reason]
    agreement: AgreementView | None
    chain: ChainView | None
    created_at: str


class CreateDeal(Model):
    product_id: str
    policy: BuyerPolicy


class ChangePolicy(Model):
    expected_policy_version: Version
    policy: BuyerPolicy


class VersionInput(Model):
    expected_policy_version: Version


class ApprovalInput(VersionInput):
    snapshot_hash: str = Field(pattern="^[a-f0-9]{64}$")


class SessionInput(Model):
    credential: str | None = Field(default=None, max_length=2048)


class SessionView(Model):
    csrf_token: str
    expires_at: str
    mode: Literal["mock", "live"]


class UsageView(Model):
    id: str
    stage: str
    actor: Literal["buyer", "seller"]
    model_id: str
    prompt_tokens: int | None
    completion_tokens: int | None
    total_tokens: int | None
    latency_ms: int
    request_id: str | None
    usage_source: Literal["provider", "unavailable"]
    adapter_mode: Literal["mock", "live"]
    error_code: str | None
    created_at: str


class EventView(Model):
    id: str
    event_type: str
    policy_version: int
    details: dict[str, Any]
    created_at: str


class EvidenceView(Model):
    deal_id: str
    agreements: list[AgreementView]
    rounds: list[RoundView]
    events: list[EventView]
    chain: ChainView | None


class UsageSummary(Model):
    calls: list[UsageView]
    call_count: int
    provider_total_tokens: int | None
    unavailable_calls: int
    by_stage: dict[str, Any]
    energy: Literal["unmeasured"] = "unmeasured"


class ErrorDetail(Model):
    code: str
    message: str


class ErrorView(Model):
    error: ErrorDetail


class Health(Model):
    status: Literal["ok"] = "ok"
    mode: Literal["mock", "live"]
    contract_version: Literal["2"] = "2"
