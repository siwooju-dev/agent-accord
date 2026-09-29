from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:16]}"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_stamp(value: datetime | None = None) -> str:
    current = value or utc_now()
    return current.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


class Store:
    def __init__(self, database_path: str):
        self.path = Path(database_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=30000")
        return conn

    def initialize(self) -> None:
        conn = self.connect()
        try:
            conn.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS entities (
                    kind TEXT NOT NULL,
                    id TEXT NOT NULL,
                    owner_id TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (kind, id)
                );
                CREATE INDEX IF NOT EXISTS idx_entities_owner ON entities(kind, owner_id);
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    actor_id TEXT NOT NULL,
                    expires_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS idempotency (
                    actor_id TEXT NOT NULL,
                    operation TEXT NOT NULL,
                    key TEXT NOT NULL,
                    body_hash TEXT NOT NULL,
                    result_id TEXT NOT NULL,
                    PRIMARY KEY (actor_id, operation, key)
                );
                CREATE TABLE IF NOT EXISTS audit_events (
                    id TEXT PRIMARY KEY,
                    flow_id TEXT NOT NULL,
                    actor TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    object_id TEXT,
                    decision TEXT,
                    reason_code TEXT,
                    details TEXT NOT NULL,
                    at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_audit_flow ON audit_events(flow_id, at);
                CREATE TABLE IF NOT EXISTS model_usage (
                    id TEXT PRIMARY KEY,
                    flow_id TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_usage_flow ON model_usage(flow_id, created_at);
                CREATE TABLE IF NOT EXISTS buyer_nonces (
                    wallet TEXT NOT NULL,
                    nonce INTEGER NOT NULL,
                    agreement_id TEXT NOT NULL UNIQUE,
                    PRIMARY KEY (wallet, nonce)
                );
                """
            )
        finally:
            conn.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        conn = self.connect()
        begun = False
        try:
            conn.execute("BEGIN IMMEDIATE")
            begun = True
            yield conn
            conn.commit()
        except Exception:
            if begun:
                conn.rollback()
            raise
        finally:
            conn.close()

    @contextmanager
    def read(self) -> Iterator[sqlite3.Connection]:
        conn = self.connect()
        try:
            yield conn
        finally:
            conn.close()

    @staticmethod
    def encode(value: Any) -> str:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)

    @staticmethod
    def decode(value: str) -> Any:
        return json.loads(value)

    def get(self, kind: str, entity_id: str, conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
        if conn is not None:
            row = conn.execute(
                "SELECT owner_id, payload FROM entities WHERE kind=? AND id=?", (kind, entity_id)
            ).fetchone()
            return None if row is None else {"id": entity_id, "owner_id": row["owner_id"], **self.decode(row["payload"])}
        with self.read() as db:
            return self.get(kind, entity_id, db)

    def list(self, kind: str, conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
        if conn is not None:
            rows = conn.execute(
                "SELECT id, owner_id, payload FROM entities WHERE kind=? ORDER BY created_at, id", (kind,)
            ).fetchall()
            return [{"id": row["id"], "owner_id": row["owner_id"], **self.decode(row["payload"])} for row in rows]
        with self.read() as db:
            return self.list(kind, db)

    def put(
        self,
        kind: str,
        entity_id: str,
        owner_id: str,
        payload: dict[str, Any],
        conn: sqlite3.Connection,
    ) -> None:
        now = utc_stamp()
        conn.execute(
            """
            INSERT INTO entities(kind,id,owner_id,payload,created_at,updated_at)
            VALUES(?,?,?,?,?,?)
            ON CONFLICT(kind,id) DO UPDATE SET
                owner_id=excluded.owner_id,
                payload=excluded.payload,
                updated_at=excluded.updated_at
            """,
            (kind, entity_id, owner_id, self.encode(payload), now, now),
        )

    def create_session(self, token_hash: str, actor_id: str, expires_at: str) -> None:
        with self.transaction() as conn:
            conn.execute(
                "INSERT INTO sessions(token_hash,actor_id,expires_at) VALUES(?,?,?)",
                (token_hash, actor_id, expires_at),
            )

    def get_session(self, token_hash: str) -> dict[str, str] | None:
        with self.read() as conn:
            row = conn.execute(
                "SELECT actor_id,expires_at FROM sessions WHERE token_hash=?", (token_hash,)
            ).fetchone()
            return None if row is None else {"actor_id": row["actor_id"], "expires_at": row["expires_at"]}

    def idempotency(
        self, actor_id: str, operation: str, key: str, body_hash: str, conn: sqlite3.Connection
    ) -> str | None:
        row = conn.execute(
            "SELECT body_hash,result_id FROM idempotency WHERE actor_id=? AND operation=? AND key=?",
            (actor_id, operation, key),
        ).fetchone()
        if row is None:
            return None
        if row["body_hash"] != body_hash:
            raise ValueError("IDEMPOTENCY_CONFLICT")
        return str(row["result_id"])

    def save_idempotency(
        self, actor_id: str, operation: str, key: str, body_hash: str, result_id: str,
        conn: sqlite3.Connection,
    ) -> None:
        conn.execute(
            "INSERT INTO idempotency(actor_id,operation,key,body_hash,result_id) VALUES(?,?,?,?,?)",
            (actor_id, operation, key, body_hash, result_id),
        )

    def add_event(
        self, flow_id: str, actor: str, event_type: str, *, object_id: str | None = None,
        decision: str | None = None, reason_code: str | None = None, details: dict[str, Any] | None = None,
        conn: sqlite3.Connection | None = None,
    ) -> None:
        values = (new_id("event"), flow_id, actor, event_type, object_id, decision, reason_code,
                  self.encode(details or {}), utc_stamp())
        if conn is not None:
            conn.execute(
                "INSERT INTO audit_events(id,flow_id,actor,event_type,object_id,decision,reason_code,details,at) VALUES(?,?,?,?,?,?,?,?,?)",
                values,
            )
            return
        with self.transaction() as db:
            self.add_event(flow_id, actor, event_type, object_id=object_id, decision=decision,
                           reason_code=reason_code, details=details, conn=db)

    def add_usage(self, flow_id: str, payload: dict[str, Any], conn: sqlite3.Connection | None = None) -> None:
        values = (new_id("usage"), flow_id, self.encode(payload), utc_stamp())
        if conn is not None:
            conn.execute("INSERT INTO model_usage(id,flow_id,payload,created_at) VALUES(?,?,?,?)", values)
            return
        with self.transaction() as db:
            self.add_usage(flow_id, payload, db)

    def events(self, flow_id: str) -> list[dict[str, Any]]:
        with self.read() as conn:
            rows = conn.execute(
                "SELECT actor,event_type,object_id,decision,reason_code,details,at FROM audit_events WHERE flow_id=? ORDER BY at,rowid",
                (flow_id,),
            ).fetchall()
        return [{
            "at": row["at"], "actor": row["actor"], "event_type": row["event_type"],
            "object_id": row["object_id"], "decision": row["decision"],
            "reason_code": row["reason_code"], "details": self.decode(row["details"]),
        } for row in rows]

    def usages(self, flow_id: str) -> list[dict[str, Any]]:
        with self.read() as conn:
            rows = conn.execute(
                "SELECT payload FROM model_usage WHERE flow_id=? ORDER BY created_at,rowid", (flow_id,)
            ).fetchall()
        return [self.decode(row["payload"]) for row in rows]

    def allocate_nonce(self, wallet: str, agreement_id: str, conn: sqlite3.Connection) -> int:
        row = conn.execute(
            "SELECT COALESCE(MAX(nonce),0) AS current FROM buyer_nonces WHERE wallet=?", (wallet.lower(),)
        ).fetchone()
        nonce = int(row["current"]) + 1
        conn.execute(
            "INSERT INTO buyer_nonces(wallet,nonce,agreement_id) VALUES(?,?,?)",
            (wallet.lower(), nonce, agreement_id),
        )
        return nonce

    def seed_demo_listings(self, actors: dict[str, dict[str, str]]) -> None:
        with self.transaction() as conn:
            row = conn.execute("SELECT COUNT(*) AS count FROM entities WHERE kind='listing'").fetchone()
            if int(row["count"]) != 0:
                return
            fixtures = [
                ("seller-demo-1", "listing-demo-1", 470000, 430000, 10000, ["evidence-demo-1"]),
                ("seller-demo-2", "listing-demo-2", 455000, 440000, 15000, ["evidence-demo-2"]),
                ("seller-demo-3", "listing-demo-3", 488000, 460000, 0, ["evidence-demo-3"]),
            ]
            earliest = utc_stamp(utc_now() + timedelta(days=2))
            for seller_id, listing_id, ask, floor, shipping, evidence_ids in fixtures:
                actor = actors.get(seller_id)
                if not actor or actor.get("role") != "seller":
                    continue
                payload = {
                    "seller_id": seller_id,
                    "seller_wallet": actor["wallet_address"].lower(),
                    "gpu_model": "RTX 3070",
                    "asking_price_krw": ask,
                    "shipping_fee_krw": shipping,
                    "condition_text": "로컬 데모 매물. 상태와 증빙 원본은 실제 검증되지 않았습니다.",
                    "warranty_end": "2027-01-31",
                    "stock_status": "available",
                    "evidence_ids": evidence_ids,
                    "private_policy": {
                        "min_item_price_krw": floor,
                        "earliest_delivery_at": earliest,
                    },
                    "source": "demo/mock",
                }
                self.put("listing", listing_id, seller_id, payload, conn)
