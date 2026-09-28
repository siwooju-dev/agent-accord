from contextlib import contextmanager
from datetime import datetime, timezone
import uuid
from sqlalchemy import create_engine, event, String, Integer, Text, JSON, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, Session


def uid():
    return uuid.uuid4().hex


def now():
    return datetime.now(timezone.utc)


def stamp():
    return now().isoformat(timespec="milliseconds").replace("+00:00", "Z")


class Base(DeclarativeBase):
    pass


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner: Mapped[str] = mapped_column(String(80))
    csrf: Mapped[str] = mapped_column(String(80))
    expires_at: Mapped[str] = mapped_column(String(40))


class Product(Base):
    __tablename__ = "products"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    data: Mapped[dict] = mapped_column(JSON)
    stock: Mapped[int] = mapped_column(Integer)


class SellerPolicy(Base):
    __tablename__ = "seller_policies"
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), primary_key=True)
    seller_id: Mapped[str] = mapped_column(String(80))
    version: Mapped[int] = mapped_column(Integer)
    floor: Mapped[int] = mapped_column(Integer)


class Deal(Base):
    __tablename__ = "deals"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(String(80), index=True)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"))
    policy_version: Mapped[int] = mapped_column(Integer, default=1)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(40), default="DRAFT")
    reasons: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[str] = mapped_column(String(40), default=stamp)


class PolicyRow(Base):
    __tablename__ = "buyer_policies"
    __table_args__ = (UniqueConstraint("deal_id", "version"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    deal_id: Mapped[str] = mapped_column(ForeignKey("deals.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    data: Mapped[dict] = mapped_column(JSON)


class Negotiation(Base):
    __tablename__ = "negotiations"
    __table_args__ = (UniqueConstraint("deal_id", "policy_version"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    deal_id: Mapped[str] = mapped_column(ForeignKey("deals.id"))
    policy_version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(30), default="RUNNING")


class ProposalRow(Base):
    __tablename__ = "proposals"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    data: Mapped[dict] = mapped_column(JSON)
    private_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class Round(Base):
    __tablename__ = "rounds"
    __table_args__ = (UniqueConstraint("deal_id", "policy_version", "number"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    deal_id: Mapped[str] = mapped_column(ForeignKey("deals.id"), index=True)
    proposal_id: Mapped[str | None] = mapped_column(ForeignKey("proposals.id"), nullable=True)
    policy_version: Mapped[int] = mapped_column(Integer)
    number: Mapped[int] = mapped_column(Integer)
    actor: Mapped[str] = mapped_column(String(10))
    decision: Mapped[dict] = mapped_column(JSON)
    valid: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[str] = mapped_column(String(40), default=stamp)


class Agreement(Base):
    __tablename__ = "agreements"
    __table_args__ = (UniqueConstraint("deal_id", "policy_version"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    deal_id: Mapped[str] = mapped_column(ForeignKey("deals.id"), index=True)
    policy_version: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict] = mapped_column(JSON)
    snapshot_hash: Mapped[str] = mapped_column(String(64))
    valid: Mapped[bool] = mapped_column(Boolean, default=True)


class Approval(Base):
    __tablename__ = "approvals"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    agreement_id: Mapped[str] = mapped_column(ForeignKey("agreements.id"), unique=True)
    owner: Mapped[str] = mapped_column(String(80))
    snapshot_hash: Mapped[str] = mapped_column(String(64))
    valid: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[str] = mapped_column(String(40), default=stamp)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    deal_id: Mapped[str] = mapped_column(ForeignKey("deals.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(40))
    policy_version: Mapped[int] = mapped_column(Integer)
    details: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[str] = mapped_column(String(40), default=stamp)


class ModelUsage(Base):
    __tablename__ = "model_usage"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    deal_id: Mapped[str] = mapped_column(ForeignKey("deals.id"), index=True)
    data: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[str] = mapped_column(String(40), default=stamp)


class ChainRecord(Base):
    __tablename__ = "chain_records"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    deal_id: Mapped[str] = mapped_column(ForeignKey("deals.id"), unique=True)
    agreement_id: Mapped[str] = mapped_column(ForeignKey("agreements.id"), unique=True)
    audit_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(30), default="QUEUED")
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    raw_tx: Mapped[str | None] = mapped_column(Text, nullable=True)


class ChainNonce(Base):
    __tablename__ = "chain_nonces"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    next_nonce: Mapped[int] = mapped_column(Integer)


class Idempotency(Base):
    __tablename__ = "idempotency"
    __table_args__ = (UniqueConstraint("owner", "scope", "key"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(String(80))
    scope: Mapped[str] = mapped_column(String(150))
    key: Mapped[str] = mapped_column(String(128))
    digest: Mapped[str] = mapped_column(String(64))
    result_id: Mapped[str] = mapped_column(String(32))


def engine_for(url):
    engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30} if url.startswith("sqlite") else {})
    if url.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def setup(dbapi, _):
            dbapi.execute("PRAGMA foreign_keys=ON")
            dbapi.execute("PRAGMA busy_timeout=30000")
    return engine


@contextmanager
def write(engine):
    with Session(engine, expire_on_commit=False) as db:
        if engine.dialect.name == "sqlite":
            db.connection().exec_driver_sql("BEGIN IMMEDIATE")
        elif engine.dialect.name == "postgresql":
            # Serialize mutation transactions, including idempotency and shared stock.
            db.connection().exec_driver_sql("SELECT pg_advisory_xact_lock(48276103)")
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
