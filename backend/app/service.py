from datetime import timedelta
from pydantic import ValidationError
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from . import db as m
from .schemas import BuyerPolicy, ProductView, Snapshot, Decision, Check, Reason
from .policy import digest
from .agent import ModelFailure


class BusinessError(Exception):
    def __init__(self, code, status=409):
        self.code, self.status = code, status


def owned(db, deal_id, owner):
    deal = db.get(m.Deal, deal_id)
    if not deal or deal.owner != owner: raise BusinessError("DEAL_NOT_FOUND", 404)
    return deal


def product_view(db, product_id):
    p = db.get(m.Product, product_id)
    if not p: raise BusinessError("PRODUCT_NOT_FOUND", 404)
    seller = db.get(m.SellerPolicy, product_id)
    try:
        return ProductView(**(p.data | {"stock": p.stock, "seller_version": seller.version}))
    except (ValidationError, AttributeError):
        raise BusinessError("INVALID_DATA") from None


def policy_for(db, deal):
    row = db.scalar(select(m.PolicyRow).where(m.PolicyRow.deal_id == deal.id, m.PolicyRow.version == deal.policy_version))
    return BuyerPolicy.model_validate(row.data)


def event(db, deal, kind, details):
    db.add(m.AuditEvent(deal_id=deal.id, policy_version=deal.policy_version, event_type=kind, details=details))


def current_agreement(db, deal):
    return db.scalar(select(m.Agreement).where(m.Agreement.deal_id == deal.id, m.Agreement.policy_version == deal.policy_version))


def agreement_view(db, agreement):
    approval = db.scalar(select(m.Approval).where(m.Approval.agreement_id == agreement.id))
    return {"id": agreement.id, "snapshot": agreement.snapshot, "snapshot_hash": agreement.snapshot_hash,
            "valid": agreement.valid, "approval": None if not approval else {"id": approval.id, "snapshot_hash": approval.snapshot_hash, "valid": approval.valid, "created_at": approval.created_at}}


def chain_view(db, deal_id, settings):
    row = db.scalar(select(m.ChainRecord).where(m.ChainRecord.deal_id == deal_id))
    if not row: return None
    tx = row.data.get("tx_hash")
    return {"record_id": row.id, "adapter_mode": settings.chain_mode, "status": row.status,
            "audit_hash": row.audit_hash, "chain_id": row.data.get("chain_id"), "contract": row.data.get("contract"),
            "tx_hash": tx, "nonce": row.data.get("nonce"), "receipt": row.data.get("receipt"), "event": row.data.get("event"),
            "explorer_url": (settings.chain_explorer.rstrip("/") + "/tx/" + tx) if tx and settings.chain_explorer else None}


def deal_view(db, deal, settings):
    agreement = current_agreement(db, deal)
    return {"id": deal.id, "mode": settings.mode, "status": deal.status,
            "product": product_view(db, deal.product_id).model_dump(mode="json"),
            "policy": policy_for(db, deal).model_dump(mode="json"), "policy_version": deal.policy_version,
            "policy_confirmed": deal.confirmed, "reason_codes": deal.reasons,
            "agreement": agreement_view(db, agreement) if agreement else None,
            "chain": chain_view(db, deal.id, settings), "created_at": deal.created_at}


def rounds_view(db, deal_id):
    rows = db.scalars(select(m.Round).where(m.Round.deal_id == deal_id).order_by(m.Round.created_at, m.Round.number)).all()
    return [{"id": r.id, "number": r.number, "actor": r.actor,
             "proposal": db.get(m.ProposalRow, r.proposal_id).data if r.proposal_id else None,
             "decision": r.decision, "valid": r.valid, "created_at": r.created_at} for r in rows]


def idempotency(db, owner, scope, key, body):
    if not key or len(key) > 128: raise BusinessError("IDEMPOTENCY_REQUIRED", 400)
    hashed = digest(body)
    row = db.scalar(select(m.Idempotency).where(m.Idempotency.owner == owner, m.Idempotency.scope == scope, m.Idempotency.key == key))
    if row and row.digest != hashed: raise BusinessError("IDEMPOTENCY_CONFLICT")
    return row, hashed


def save_idempotency(db, owner, scope, key, hashed, result_id):
    db.add(m.Idempotency(owner=owner, scope=scope, key=key, digest=hashed, result_id=result_id))


def version_check(deal, expected):
    if deal.policy_version != expected: raise BusinessError("VERSION_CONFLICT")


def frozen(db, deal):
    return bool(db.scalar(select(m.ChainRecord).where(m.ChainRecord.deal_id == deal.id)))


def invalidate(db, deal):
    db.execute(update(m.Round).where(m.Round.deal_id == deal.id).values(valid=False))
    agreements = db.scalars(select(m.Agreement).where(m.Agreement.deal_id == deal.id)).all()
    for a in agreements:
        a.valid = False
        db.execute(update(m.Approval).where(m.Approval.agreement_id == a.id).values(valid=False))


def block(db, deal, codes, kind="POLICY_BLOCK"):
    deal.status, deal.reasons = "BLOCKED", list(codes)
    event(db, deal, kind, {"reason_codes": list(codes)})


def negotiate(app, deal_id, version):
    engine, agent, policy_engine = app.state.engine, app.state.agent, app.state.policy
    previous = None
    for number in range(1, 13):
        with m.write(engine) as db:
            deal = db.get(m.Deal, deal_id)
            if deal.policy_version != version or deal.status != "NEGOTIATING": return
            policy = policy_for(db, deal)
            if number > policy.max_rounds:
                block(db, deal, ["ROUND_LIMIT"])
                return
            p = product_view(db, deal.product_id)
            floor = db.get(m.SellerPolicy, p.product_id).floor
            pre = policy_engine.evaluate(policy, p, floor, floor, m.now(), number, version)
            if not pre.allowed:
                block(db, deal, pre.model_dump(mode="json")["reason_codes"])
                return
            actor = "buyer" if number % 2 else "seller"
            private = policy.model_dump(mode="json") if actor == "buyer" else {"min_item_price_krw": floor}
            public = p.model_dump(mode="json")
            # Durable call-start evidence survives an abrupt provider/process failure.
            event(db, deal, "MODEL_CALL_STARTED", {"actor": actor, "round": number})
        try:
            proposal, usage = agent.propose(actor, public, private, previous)
            error = None
        except ModelFailure as exc:
            proposal, usage, error = None, exc.usage, exc.code
        with m.write(engine) as db:
            deal = db.get(m.Deal, deal_id)
            db.add(m.ModelUsage(deal_id=deal_id, data=usage))
            if deal.policy_version != version or deal.status != "NEGOTIATING":
                event(db, deal, "MODEL_RESULT_DISCARDED", {"call_policy_version": version, "actor": actor})
                return
            # Fresh server data checked after the external call, too.
            p = product_view(db, deal.product_id)
            policy = policy_for(db, deal)
            seller = db.get(m.SellerPolicy, p.product_id)
            if error:
                decision = Decision(allowed=False, checks=[Check(rule="model_output", passed=False, reason_code=error)], reason_codes=[error], policy_version=version)
            else:
                decision = policy_engine.evaluate(policy, p, seller.floor, proposal.item_price_krw, m.now(), number, version)
                codes = list(decision.reason_codes)
                if proposal.product_id != p.product_id: codes.append(Reason.INVALID_MODEL_OUTPUT)
                if proposal.action == "ACCEPT" and (not previous or previous["item_price_krw"] != proposal.item_price_krw): codes.append(Reason.ACCEPT_MISMATCH)
                if proposal.action == "REJECT": codes.append(Reason.MODEL_REJECTED)
                if number == 1 and proposal.action != "OFFER": codes.append(Reason.INVALID_MODEL_OUTPUT)
                decision.reason_codes = list(dict.fromkeys(codes))
                decision.allowed = not codes
                for code in codes:
                    if code not in [c.reason_code for c in decision.checks]:
                        decision.checks.append(Check(rule="model_protocol", passed=False, reason_code=code))
                private_reason = proposal.reason if actor == "seller" else None
                # Seller-generated free text can encode its private floor in arbitrary
                # formats. Preserve it privately and expose a safe public explanation.
                if actor == "seller":
                    proposal.reason = f"판매자 에이전트가 공개 가격에 {proposal.action}을 제안했습니다."
                elif any(value in proposal.reason for value in [str(seller.floor), f"{seller.floor:,}"]):
                    proposal.reason = "비공개 가격 조건을 제외한 제안입니다."
            proposal_id = None
            if proposal:
                row = m.ProposalRow(data=proposal.model_dump(mode="json"), private_reason=private_reason)
                db.add(row)
                db.flush()
                proposal_id = row.id
            db.add(m.Round(deal_id=deal.id, policy_version=version, number=number, actor=actor,
                           proposal_id=proposal_id, decision=decision.model_dump(mode="json"), valid=decision.allowed))
            event(db, deal, "PROPOSAL_PASS" if decision.allowed else "PROPOSAL_BLOCK", {"actor": actor, "round": number, "reason_codes": decision.model_dump(mode="json")["reason_codes"]})
            if not decision.allowed:
                block(db, deal, decision.model_dump(mode="json")["reason_codes"])
                return
            if proposal.action == "ACCEPT":
                aid = m.uid()
                snapshot = Snapshot(agreement_id=aid, product_id=p.product_id, seller_id=p.seller_id,
                    product_version=p.product_version, seller_version=p.seller_version, name=p.name,
                    ram_gb=p.ram_gb, ssd_gb=p.ssd_gb, item_price_krw=proposal.item_price_krw,
                    shipping_fee_krw=p.shipping_fee_krw, fee_krw=p.fee_krw,
                    total_krw=proposal.item_price_krw + p.shipping_fee_krw + p.fee_krw,
                    delivery_date=p.delivery_date, policy_version=version, nonce=m.uid(),
                    expiry=min(policy.expires_at, p.expires_at, m.now() + timedelta(minutes=15)), source=p.source)
                data = snapshot.model_dump(mode="json")
                db.add(m.Agreement(id=aid, deal_id=deal.id, policy_version=version, snapshot=data, snapshot_hash=digest(data)))
                deal.status = "AWAITING_APPROVAL"
                event(db, deal, "AGREEMENT_CREATED", {"snapshot_hash": digest(data)})
                negotiation = db.scalar(select(m.Negotiation).where(m.Negotiation.deal_id == deal.id, m.Negotiation.policy_version == version))
                negotiation.status = "COMPLETE"
                return
            if number == policy.max_rounds:
                block(db, deal, ["ROUND_LIMIT"])
                return
            previous = proposal.model_dump(mode="json")


def approval_validation(db, deal, agreement, expected_hash, policy_engine):
    if not agreement or not agreement.valid or agreement.snapshot_hash != expected_hash or digest(agreement.snapshot) != expected_hash:
        return ["APPROVAL_STALE"]
    snap = Snapshot.model_validate(agreement.snapshot)
    p = product_view(db, deal.product_id)
    seller = db.get(m.SellerPolicy, p.product_id)
    policy = policy_for(db, deal)
    decision = policy_engine.evaluate(policy, p, seller.floor, snap.item_price_krw, m.now(), 0, deal.policy_version)
    codes = decision.model_dump(mode="json")["reason_codes"]
    fields = ["product_id", "seller_id", "product_version", "seller_version", "shipping_fee_krw", "fee_krw", "delivery_date", "ram_gb", "ssd_gb", "name", "source"]
    public = p.model_dump(mode="json")
    if any(agreement.snapshot[k] != public[k] for k in fields) or snap.policy_version != deal.policy_version or m.now() >= snap.expiry:
        codes.append("APPROVAL_STALE")
    if snap.total_krw != snap.item_price_krw + p.shipping_fee_krw + p.fee_krw:
        codes.append("APPROVAL_STALE")
    return list(dict.fromkeys(codes))
