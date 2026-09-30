from __future__ import annotations

import hashlib
import json
import os
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
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        descriptor = os.open(
            self.path,
            os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        try:
            os.fchmod(descriptor, 0o600)
        finally:
            os.close(descriptor)
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
                    role TEXT,
                    wallet_address TEXT,
                    expires_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS auth_challenges (
                    challenge_id TEXT PRIMARY KEY,
                    wallet_address TEXT NOT NULL,
                    role TEXT NOT NULL,
                    origin TEXT NOT NULL,
                    message TEXT NOT NULL,
                    nonce TEXT NOT NULL,
                    issued_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    consumed_at TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_auth_challenges_expiry ON auth_challenges(expires_at);
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
            session_columns = {row["name"] for row in conn.execute("PRAGMA table_info(sessions)")}
            if "role" not in session_columns:
                conn.execute("ALTER TABLE sessions ADD COLUMN role TEXT")
            if "wallet_address" not in session_columns:
                conn.execute("ALTER TABLE sessions ADD COLUMN wallet_address TEXT")
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

    def count_recent_owned(
        self, kind: str, owner_id: str, since: str, conn: sqlite3.Connection,
    ) -> int:
        row = conn.execute(
            "SELECT COUNT(*) AS count FROM entities WHERE kind=? AND owner_id=? AND created_at>=?",
            (kind, owner_id, since),
        ).fetchone()
        return int(row["count"])

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

    def create_session(
        self, token_hash: str, actor_id: str, expires_at: str,
        role: str | None = None, wallet_address: str | None = None,
    ) -> None:
        with self.transaction() as conn:
            conn.execute(
                "INSERT INTO sessions(token_hash,actor_id,role,wallet_address,expires_at) VALUES(?,?,?,?,?)",
                (token_hash, actor_id, role, wallet_address.lower() if wallet_address else None, expires_at),
            )

    def get_session(self, token_hash: str) -> dict[str, str] | None:
        with self.read() as conn:
            row = conn.execute(
                "SELECT actor_id,role,wallet_address,expires_at FROM sessions WHERE token_hash=?", (token_hash,)
            ).fetchone()
            return None if row is None else {
                "actor_id": row["actor_id"], "role": row["role"],
                "wallet_address": row["wallet_address"], "expires_at": row["expires_at"],
            }

    def delete_session(self, token_hash: str) -> bool:
        with self.transaction() as conn:
            cursor = conn.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash,))
            return cursor.rowcount == 1

    def create_auth_challenge(
        self, challenge_id: str, wallet_address: str, role: str, origin: str,
        message: str, nonce: str, issued_at: str, expires_at: str,
    ) -> None:
        with self.transaction() as conn:
            conn.execute(
                "DELETE FROM auth_challenges WHERE expires_at<=? OR consumed_at IS NOT NULL",
                (issued_at,),
            )
            conn.execute(
                """INSERT INTO auth_challenges(
                    challenge_id,wallet_address,role,origin,message,nonce,issued_at,expires_at
                ) VALUES(?,?,?,?,?,?,?,?)""",
                (challenge_id, wallet_address.lower(), role, origin, message, nonce, issued_at, expires_at),
            )

    def get_auth_challenge(self, challenge_id: str) -> dict[str, str | None] | None:
        with self.read() as conn:
            row = conn.execute(
                """SELECT challenge_id,wallet_address,role,origin,message,nonce,issued_at,expires_at,consumed_at
                   FROM auth_challenges WHERE challenge_id=?""",
                (challenge_id,),
            ).fetchone()
            return None if row is None else dict(row)

    def consume_auth_challenge_and_create_session(
        self, *, challenge_id: str, now: str, token_hash: str, actor_id: str,
        role: str, wallet_address: str, session_expires_at: str,
    ) -> bool:
        with self.transaction() as conn:
            row = conn.execute(
                "SELECT expires_at,consumed_at,role,wallet_address FROM auth_challenges WHERE challenge_id=?",
                (challenge_id,),
            ).fetchone()
            if (row is None or row["consumed_at"] is not None or row["expires_at"] <= now
                    or row["role"] != role or row["wallet_address"].lower() != wallet_address.lower()):
                return False
            updated = conn.execute(
                "UPDATE auth_challenges SET consumed_at=? WHERE challenge_id=? AND consumed_at IS NULL AND expires_at>?",
                (now, challenge_id, now),
            )
            if updated.rowcount != 1:
                return False
            conn.execute(
                "INSERT INTO sessions(token_hash,actor_id,role,wallet_address,expires_at) VALUES(?,?,?,?,?)",
                (token_hash, actor_id, role, wallet_address.lower(), session_expires_at),
            )
            return True

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
        """Three demo RTX 4090 listings that mirror the frontend demo. All data is fictional."""
        with self.transaction() as conn:
            for fixture in DEMO_LISTINGS:
                if self.get("listing", fixture["listing_id"], conn) is not None:
                    continue
                actor = actors.get(fixture["seller_id"])
                if not actor or actor.get("role") != "seller":
                    continue
                evidence = [dict(item) for item in fixture["evidence"]]
                payload = {
                    "seller_id": fixture["seller_id"],
                    "seller_wallet": actor["wallet_address"].lower(),
                    "gpu_model": "RTX 4090",
                    "title": fixture["title"],
                    "asking_price_krw": fixture["ask"],
                    "shipping_fee_krw": fixture["shipping"],
                    "condition_text": fixture["condition"],
                    "warranty_end": fixture["warranty_end"],
                    "stock_status": "available",
                    "evidence_ids": [item["id"] for item in evidence],
                    "evidence": evidence,
                    "evidence_hashes": sorted({evidence_hash(item) for item in evidence}),
                    "private_policy": {
                        "min_item_price_krw": fixture["floor"],
                        "earliest_delivery_at": utc_stamp(utc_now() + timedelta(days=fixture["ships_in_days"])),
                    },
                    "source": "demo",
                }
                self.put("listing", fixture["listing_id"], fixture["seller_id"], payload, conn)


def evidence_hash(item: dict[str, Any]) -> str:
    """0x-sha256 of the evidence record as registered (id, kind, label, summary)."""
    raw = json.dumps({key: item.get(key) for key in ("id", "kind", "label", "summary")},
                     sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return "0x" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


# Fictional demo data. Evidence summaries describe what each attached file would show; the files
# themselves are not verified by the backend, and the assessor is told so.
DEMO_LISTINGS: list[dict[str, Any]] = [
    {
        "seller_id": "seller-demo-1", "listing_id": "listing-demo-1", "title": "RTX 4090 Founders Edition",
        "ask": 1_950_000, "floor": 1_880_000, "shipping": 20_000, "ships_in_days": 2,
        "warranty_end": "2027-02-14",
        "condition": "데모 매물 · 사용 19개월 · 채굴 이력 없음 · 박스 포함 (판매자 주장)",
        "evidence": [
            {"id": "evidence-01", "kind": "receipt", "label": "구매 영수증",
             "summary": "주문 내역 캡처: 2024-02 구매, 상품명 RTX 4090 Founders Edition. 판매자 제출본이며 원본 대조 안 됨."},
            {"id": "evidence-02", "kind": "warranty", "label": "보증 조회",
             "summary": "시리얼 보증 조회(데모 응답): 모델 RTX 4090 Founders Edition, 보증 2027-02-14까지. 매물 정보와 일치."},
        ],
    },
    {
        "seller_id": "seller-demo-2", "listing_id": "listing-demo-2", "title": "RTX 4090 Gaming OC",
        "ask": 2_060_000, "floor": 1_990_000, "shipping": 30_000, "ships_in_days": 8,
        "warranty_end": "2027-09-02",
        "condition": "데모 매물 · 사용 11개월 · 박스 및 구성품 포함 (판매자 주장)",
        "evidence": [
            {"id": "evidence-03", "kind": "video", "label": "GPU 작동 영상",
             "summary": "11초 작동 영상: 부하 중 GPU 61°C, 팬 정상 회전, 화면 깨짐 없음 (데모 요약)."},
            {"id": "evidence-04", "kind": "serial", "label": "제품 시리얼 사진",
             "summary": "박스 라벨 시리얼 사진: 일부가 가려져 전체 판독 불가."},
            {"id": "evidence-05", "kind": "warranty", "label": "보증 조회",
             "summary": "라벨 시리얼 보증 조회(데모 응답): 조회된 모델명이 RTX 4080 Gaming OC. 매물 모델(RTX 4090)과 불일치."},
        ],
    },
    {
        "seller_id": "seller-demo-3", "listing_id": "listing-demo-3", "title": "ROG Strix RTX 4090",
        "ask": 2_150_000, "floor": 2_080_000, "shipping": 25_000, "ships_in_days": 4,
        "warranty_end": "2027-11-21",
        "condition": "데모 매물 · 사용 9개월 · 작동 영상 첨부 · 12VHPWR 케이블 포함 (판매자 주장)",
        "evidence": [
            {"id": "evidence-06", "kind": "video", "label": "GPU 작동 영상",
             "summary": "10초 작동 영상: RGB 점등, 벤치마크 실행 화면 (데모 요약)."},
            {"id": "evidence-07", "kind": "receipt", "label": "구매 영수증",
             "summary": "카드 영수증 스캔: 상호는 보이나 구매 날짜 판독 불가."},
        ],
    },
]
