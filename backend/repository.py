from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from blockchain.signing import snapshot_hash as blockchain_snapshot_hash


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


@dataclass(frozen=True)
class AgreementRecord:
    id: str
    flow_id: str
    offer_id: str
    snapshot: dict[str, Any]
    snapshot_hash: str
    status: str
    buyer_signature: str | None
    seller_signature: str | None
    tx_hash: str | None
    receipt_status: str | None
    block_number: int | None
    event_name: str | None
    recorded_hash: str | None
    reason_code: str | None
    submission_state: str
    submission_claimed_at: float | None

    @property
    def buyer_approved(self) -> bool:
        return self.buyer_signature is not None

    @property
    def seller_approved(self) -> bool:
        return self.seller_signature is not None

    def as_chain_agreement(self) -> dict[str, Any]:
        return {"id": self.id, "snapshot": self.snapshot, "snapshot_hash": self.snapshot_hash,
                "tx_hash": self.tx_hash}


@dataclass(frozen=True)
class DemoSession:
    actor_id: str
    role: str
    wallet_address: str
    expires_at: str


def _agreement_from_row(row: sqlite3.Row) -> AgreementRecord:
    return AgreementRecord(
        id=row["agreement_id"], flow_id=row["flow_id"], offer_id=row["offer_id"],
        snapshot=json.loads(row["snapshot_json"]), snapshot_hash=row["snapshot_hash"],
        status=row["status"], buyer_signature=row["buyer_signature"],
        seller_signature=row["seller_signature"], tx_hash=row["tx_hash"],
        receipt_status=row["receipt_status"], block_number=row["block_number"],
        event_name=row["event_name"], recorded_hash=row["recorded_hash"],
        reason_code=row["reason_code"], submission_state=row["submission_state"],
        submission_claimed_at=row["submission_claimed_at"],
    )


class AgreementTransaction:
    def __init__(self, connection: sqlite3.Connection, agreement_id: str) -> None:
        self.connection = connection
        self.agreement_id = agreement_id

    def agreement(self) -> AgreementRecord | None:
        row = self.connection.execute(
            "SELECT * FROM agreements WHERE agreement_id = ?", (self.agreement_id,)
        ).fetchone()
        return _agreement_from_row(row) if row else None

    def approval(self, role: str) -> sqlite3.Row | None:
        return self.connection.execute(
            "SELECT * FROM approvals WHERE agreement_id = ? AND actor_role = ?",
            (self.agreement_id, role),
        ).fetchone()

    def save_approval(self, role: str, snapshot_hash: str, signature: str) -> None:
        now = _utc_now()
        self.connection.execute(
            "INSERT INTO approvals(agreement_id, actor_role, snapshot_hash, signature, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (self.agreement_id, role, snapshot_hash, signature, now),
        )
        column = "buyer_signature" if role == "buyer" else "seller_signature"
        self.connection.execute(
            f"UPDATE agreements SET {column} = ?, updated_at = ? WHERE agreement_id = ?",
            (signature, now, self.agreement_id),
        )

    def set_status(self, status: str, *, reason_code: str | None = None) -> None:
        self.connection.execute(
            "UPDATE agreements SET status = ?, reason_code = ?, updated_at = ? WHERE agreement_id = ?",
            (status, reason_code, _utc_now(), self.agreement_id),
        )

    def set_submission_state(self, state: str, *, reason_code: str | None = None) -> None:
        self.connection.execute(
            "UPDATE agreements SET submission_state = ?, reason_code = ?, updated_at = ? "
            "WHERE agreement_id = ?",
            (state, reason_code, _utc_now(), self.agreement_id),
        )

    def add_audit(
        self, *, actor: str, event_type: str, decision: str,
        reason_code: str | None = None, idempotency_key: str,
    ) -> None:
        record = self.agreement()
        if record is None:
            raise KeyError(self.agreement_id)
        self.connection.execute(
            "INSERT OR IGNORE INTO audit_events "
            "(flow_id, agreement_id, actor, event_type, object_id, decision, reason_code, "
            "snapshot_hash, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (record.flow_id, record.id, actor, event_type, record.id, decision, reason_code,
             record.snapshot_hash, idempotency_key, _utc_now()),
        )


class SQLiteAgreementRepository:
    """SQLite persistence with BEGIN IMMEDIATE for per-agreement state transitions."""

    def __init__(self, database_path: str | Path) -> None:
        self.database_path = Path(database_path)
        self.initialize()

    def _connect(self) -> sqlite3.Connection:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.database_path, timeout=20, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 20000")
        return connection

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        connection = self._connect()
        try:
            yield connection
        finally:
            connection.close()

    def initialize(self) -> None:
        with self._connection() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS agreements (
                    agreement_id TEXT PRIMARY KEY,
                    flow_id TEXT NOT NULL,
                    offer_id TEXT NOT NULL,
                    snapshot_json TEXT NOT NULL,
                    snapshot_hash TEXT NOT NULL UNIQUE,
                    buyer_wallet TEXT NOT NULL,
                    nonce INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    buyer_signature TEXT,
                    seller_signature TEXT,
                    tx_hash TEXT,
                    receipt_status TEXT,
                    block_number INTEGER,
                    event_name TEXT,
                    recorded_hash TEXT,
                    reason_code TEXT,
                    submission_state TEXT NOT NULL DEFAULT 'idle',
                    submission_claimed_at REAL,
                    submission_attempts INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(buyer_wallet, nonce)
                );
                CREATE TABLE IF NOT EXISTS approvals (
                    agreement_id TEXT NOT NULL REFERENCES agreements(agreement_id),
                    actor_role TEXT NOT NULL CHECK(actor_role IN ('buyer', 'seller')),
                    snapshot_hash TEXT NOT NULL,
                    signature TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY(agreement_id, actor_role)
                );
                CREATE TABLE IF NOT EXISTS demo_sessions (
                    token_hash TEXT PRIMARY KEY,
                    actor_id TEXT NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('buyer', 'seller')),
                    wallet_address TEXT NOT NULL,
                    expires_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS audit_events (
                    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    flow_id TEXT NOT NULL,
                    agreement_id TEXT NOT NULL REFERENCES agreements(agreement_id),
                    actor TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    object_id TEXT NOT NULL,
                    decision TEXT NOT NULL,
                    reason_code TEXT,
                    snapshot_hash TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL
                );
                """
            )

    def create_agreement(
        self, *, agreement_id: str, flow_id: str, offer_id: str,
        snapshot: dict[str, Any], expected_hash: str | None = None,
    ) -> AgreementRecord:
        computed_hash = blockchain_snapshot_hash(snapshot)
        if agreement_id != snapshot["agreement_id"] or offer_id != snapshot["offer_id"]:
            raise ValueError("agreement identifiers differ from immutable snapshot")
        if expected_hash is not None and expected_hash != computed_hash:
            raise ValueError("snapshot hash mismatch")
        now = _utc_now()
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                "INSERT INTO agreements(agreement_id, flow_id, offer_id, snapshot_json, snapshot_hash, "
                "buyer_wallet, nonce, status, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, 'AWAITING_APPROVALS', ?, ?)",
                (agreement_id, flow_id, offer_id,
                 json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")),
                 computed_hash, snapshot["buyer_wallet"], snapshot["nonce"], now, now),
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
        record = self.get_agreement(agreement_id)
        if record is None:
            raise RuntimeError("agreement insert did not persist")
        return record

    def get_agreement(self, agreement_id: str) -> AgreementRecord | None:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM agreements WHERE agreement_id = ?", (agreement_id,)
            ).fetchone()
        return _agreement_from_row(row) if row else None

    @contextmanager
    def locked_agreement(self, agreement_id: str) -> Iterator[AgreementTransaction]:
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            exists = connection.execute(
                "SELECT 1 FROM agreements WHERE agreement_id = ?", (agreement_id,)
            ).fetchone()
            if exists is None:
                raise KeyError(agreement_id)
            yield AgreementTransaction(connection, agreement_id)
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def save_session(self, *, token_hash: str, actor_id: str, role: str,
                     wallet_address: str, expires_at: str) -> None:
        with self._connection() as connection:
            connection.execute(
                "INSERT INTO demo_sessions(token_hash, actor_id, role, wallet_address, expires_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (token_hash, actor_id, role, wallet_address, expires_at),
            )

    def get_session(self, token_hash: str) -> DemoSession | None:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT actor_id, role, wallet_address, expires_at FROM demo_sessions WHERE token_hash = ?",
                (token_hash,),
            ).fetchone()
        return DemoSession(**dict(row)) if row else None

    def save_and_commit_tx_hash(self, agreement_id: str, tx_hash: str) -> None:
        """Durably persist the signed tx hash before the adapter broadcasts it."""
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT tx_hash, status FROM agreements WHERE agreement_id = ?", (agreement_id,)
            ).fetchone()
            if row is None or row["status"] != "RECORDING":
                raise RuntimeError("agreement is not recording")
            if row["tx_hash"] and row["tx_hash"].lower() != tx_hash.lower():
                raise RuntimeError("a different transaction hash is already persisted")
            connection.execute(
                "UPDATE agreements SET tx_hash = ?, receipt_status = 'pending', "
                "submission_state = 'pending', reason_code = NULL, updated_at = ? "
                "WHERE agreement_id = ?",
                (tx_hash, _utc_now(), agreement_id),
            )
            agreement = connection.execute(
                "SELECT flow_id, snapshot_hash FROM agreements WHERE agreement_id = ?", (agreement_id,)
            ).fetchone()
            connection.execute(
                "INSERT OR IGNORE INTO audit_events "
                "(flow_id, agreement_id, actor, event_type, object_id, decision, reason_code, "
                "snapshot_hash, idempotency_key, created_at) VALUES (?, ?, 'system', 'CHAIN_TX_HASH_PERSISTED', ?, "
                "'saved', NULL, ?, ?, ?)",
                (agreement["flow_id"], agreement_id, agreement_id, agreement["snapshot_hash"],
                 f"tx-hash:{agreement_id}:{tx_hash.lower()}", _utc_now()),
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def mark_relayer_missing(self, agreement_id: str) -> None:
        with self.locked_agreement(agreement_id) as tx:
            tx.set_submission_state("relayer_missing", reason_code="RELAYER_NOT_CONFIGURED_FOR_LIVE_SUBMISSION")
            tx.add_audit(
                actor="system", event_type="CHAIN_RECORDING_READY", decision="waiting_for_relayer",
                reason_code="RELAYER_NOT_CONFIGURED_FOR_LIVE_SUBMISSION",
                idempotency_key=f"relayer-missing:{agreement_id}",
            )

    def claim_submission(self, agreement_id: str, *, stale_after_seconds: int = 300) -> bool:
        now = datetime.now(timezone.utc).timestamp()
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT status, submission_state, submission_claimed_at, submission_attempts "
                "FROM agreements WHERE agreement_id = ?", (agreement_id,)
            ).fetchone()
            if row is None or row["status"] != "RECORDING":
                connection.commit()
                return False
            state = row["submission_state"]
            if state == "submitting" and row["submission_claimed_at"] is not None:
                if now - row["submission_claimed_at"] < stale_after_seconds:
                    connection.commit()
                    return False
            elif state not in {"ready", "relayer_missing", "pending", "unknown"}:
                connection.commit()
                return False
            attempt = row["submission_attempts"] + 1
            connection.execute(
                "UPDATE agreements SET submission_state = 'submitting', submission_claimed_at = ?, "
                "submission_attempts = ?, updated_at = ? WHERE agreement_id = ?",
                (now, attempt, _utc_now(), agreement_id),
            )
            event = connection.execute(
                "SELECT flow_id, snapshot_hash FROM agreements WHERE agreement_id = ?", (agreement_id,)
            ).fetchone()
            connection.execute(
                "INSERT OR IGNORE INTO audit_events "
                "(flow_id, agreement_id, actor, event_type, object_id, decision, reason_code, "
                "snapshot_hash, idempotency_key, created_at) VALUES (?, ?, 'system', 'CHAIN_SUBMISSION_STARTED', ?, "
                "'started', NULL, ?, ?, ?)",
                (event["flow_id"], agreement_id, agreement_id, event["snapshot_hash"],
                 f"submission-start:{agreement_id}:{attempt}", _utc_now()),
            )
            connection.commit()
            return True
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def update_chain_state(
        self, agreement_id: str, *, submission_state: str, event_type: str,
        idempotency_key: str, status: str | None = None, receipt_status: str | None = None,
        block_number: int | None = None, event_name: str | None = None,
        recorded_hash: str | None = None, reason_code: str | None = None,
    ) -> None:
        with self.locked_agreement(agreement_id) as tx:
            fields = ["submission_state = ?", "reason_code = ?", "updated_at = ?"]
            values: list[Any] = [submission_state, reason_code, _utc_now()]
            if status is not None:
                fields.append("status = ?")
                values.append(status)
            if receipt_status is not None:
                fields.append("receipt_status = ?")
                values.append(receipt_status)
            if block_number is not None:
                fields.append("block_number = ?")
                values.append(block_number)
            if event_name is not None:
                fields.append("event_name = ?")
                values.append(event_name)
            if recorded_hash is not None:
                fields.append("recorded_hash = ?")
                values.append(recorded_hash)
            values.append(agreement_id)
            tx.connection.execute(
                f"UPDATE agreements SET {', '.join(fields)} WHERE agreement_id = ?", values
            )
            tx.add_audit(
                actor="system", event_type=event_type, decision=submission_state,
                reason_code=reason_code, idempotency_key=idempotency_key,
            )

    def audit_events(self, agreement_id: str) -> list[dict[str, Any]]:
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT actor, event_type, object_id, decision, reason_code, created_at "
                "FROM audit_events WHERE agreement_id = ? ORDER BY event_id", (agreement_id,)
            ).fetchall()
        return [dict(row) for row in rows]

    def record_audit_event(
        self, agreement_id: str, *, actor: str, event_type: str,
        decision: str, reason_code: str | None, idempotency_key: str,
    ) -> None:
        with self.locked_agreement(agreement_id) as tx:
            tx.add_audit(actor=actor, event_type=event_type, decision=decision,
                         reason_code=reason_code, idempotency_key=idempotency_key)
