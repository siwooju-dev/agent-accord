from sqlalchemy import select
from . import db as m
from .service import event


def process_record(app, record_id):
    engine, chain, settings = app.state.engine, app.state.chain, app.state.settings
    with m.write(engine) as db:
        row = db.get(m.ChainRecord, record_id)
        if not row or row.status in {"CONFIRMED", "MOCK_RECORDED", "FAILED"}: return
        if row.status != "QUEUED":
            # UNKNOWN/SUBMITTING recovery is read-only. Never generate a replacement tx.
            reconcile_only = True
        else:
            reconcile_only = False
            row.status = "SUBMITTING"
            event(db, db.get(m.Deal, row.deal_id), "CHAIN_CLAIMED", {"record_id": record_id})
        data, audit_hash = dict(row.data), row.audit_hash
    if not reconcile_only:
        try:
            pending = chain.pending_nonce()
            nonce = None
            if pending is not None:
                with m.write(engine) as db:
                    key = f"{settings.chain_id}:{chain.account.address.lower()}"
                    counter = db.get(m.ChainNonce, key)
                    nonce = max(pending, counter.next_nonce if counter else pending)
                    if counter: counter.next_nonce = nonce + 1
                    else: db.add(m.ChainNonce(key=key, next_nonce=nonce + 1))
                    row = db.get(m.ChainRecord, record_id)
                    row.data = data | {"nonce": nonce, "chain_id": settings.chain_id, "contract": settings.chain_contract}
            prepared = chain.prepare(record_id, audit_hash, nonce)
            with m.write(engine) as db:
                row = db.get(m.ChainRecord, record_id)
                row.raw_tx = prepared.get("raw_tx")
                row.data = {k: v for k, v in prepared.items() if k != "raw_tx"}
                data = dict(row.data)
                # Save signed hash/nonce BEFORE any network broadcast.
                event(db, db.get(m.Deal, row.deal_id), "CHAIN_PREPARED", data)
            chain.broadcast(prepared)
        except Exception:
            # Provider exception text may contain a credential/RPC URL; never save it.
            with m.write(engine) as db:
                row = db.get(m.ChainRecord, record_id)
                row.status = "UNKNOWN"
                event(db, db.get(m.Deal, row.deal_id), "CHAIN_UNKNOWN", {"record_id": record_id})
            return
    try:
        result = chain.reconcile(record_id, audit_hash, data)
    except Exception:
        result = data | {"status": "UNKNOWN"}
    with m.write(engine) as db:
        row = db.get(m.ChainRecord, record_id)
        # Another worker might have confirmed while this read-only reconcile ran.
        if row.status in {"CONFIRMED", "MOCK_RECORDED", "FAILED"}: return
        row.status = result.pop("status")
        row.data = result
        deal = db.get(m.Deal, row.deal_id)
        deal.status = {"CONFIRMED": "RECORDED", "MOCK_RECORDED": "MOCK_RECORDED", "FAILED": "CHAIN_FAILED"}.get(row.status, "RECORDING")
        event(db, deal, "CHAIN_" + row.status, {"record_id": record_id, "tx_hash": result.get("tx_hash")})


def process_all(app):
    with m.Session(app.state.engine) as db:
        ids = list(db.scalars(select(m.ChainRecord.id).where(m.ChainRecord.status.in_(["QUEUED", "PENDING", "UNKNOWN", "SUBMITTING"]))))
    for record_id in ids: process_record(app, record_id)
