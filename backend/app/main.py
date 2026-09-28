import secrets
from datetime import timedelta, datetime
from fastapi import FastAPI, Request, Response, Depends, BackgroundTasks, Header
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import APIKeyCookie
from sqlalchemy import select
from sqlalchemy.orm import Session
from .config import Settings
from . import db as m
from .schemas import *
from . import service as s
from .policy import PolicyEngine, digest
from .agent import MockAgent, KilnAgent
from .chain import MockChain, EvmChain
from .auth import token_hash, verify_credential
from .worker import process_record


def create_app(settings=None, engine=None, agent=None, chain=None):
    settings = settings or Settings.env()
    settings.validate()
    app = FastAPI(title="DealBattle", version="2.0.0", responses={
        status: {"model": ErrorView, "description": text} for status, text in [
            (400, "IDEMPOTENCY_REQUIRED"), (401, "SESSION_REQUIRED / CREDENTIAL_INVALID"),
            (403, "CSRF_INVALID / ORIGIN_INVALID"), (404, "DEAL_NOT_FOUND / PRODUCT_NOT_FOUND"),
            (409, "VERSION_CONFLICT / STATE_CONFLICT / APPROVAL_STALE / IDEMPOTENCY_CONFLICT"),
            (422, "VALIDATION_ERROR"), (503, "DATABASE_UNAVAILABLE")]
        })
    app.state.settings = settings
    app.state.engine = engine or m.engine_for(settings.database_url)
    app.state.agent = agent or (MockAgent() if settings.mode == "mock" else KilnAgent(settings))
    app.state.chain = chain or (MockChain() if settings.chain_mode == "mock" else EvmChain(settings))
    app.state.policy = PolicyEngine()
    cookie = APIKeyCookie(name="dealbattle_session", auto_error=False)

    @app.exception_handler(s.BusinessError)
    async def business_error(request, exc):
        return JSONResponse(status_code=exc.status, content={"error": {"code": exc.code, "message": exc.code}})

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse(status_code=422, content={"error": {"code": "VALIDATION_ERROR", "message": "Request does not match OpenAPI schema"}})

    def auth(request: Request, session_token: str | None = Depends(cookie)):
        if not session_token: raise s.BusinessError("SESSION_REQUIRED", 401)
        with Session(app.state.engine) as db:
            row = db.get(m.AuthSession, token_hash(session_token))
            if not row or datetime.fromisoformat(row.expires_at) <= m.now(): raise s.BusinessError("SESSION_REQUIRED", 401)
            return row

    def mutate(request: Request, session=Depends(auth), x_csrf_token: str = Header(default=""),
               idempotency_key: str = Header(default="")):
        csrf = x_csrf_token
        if not secrets.compare_digest(session.csrf, csrf): raise s.BusinessError("CSRF_INVALID", 403)
        if not idempotency_key or len(idempotency_key) > 128:
            raise s.BusinessError("IDEMPOTENCY_REQUIRED", 400)
        origin = request.headers.get("Origin")
        if origin and origin != settings.allowed_origin: raise s.BusinessError("ORIGIN_INVALID", 403)
        if request.headers.get("Sec-Fetch-Site") == "cross-site": raise s.BusinessError("ORIGIN_INVALID", 403)
        return session

    @app.get("/health", response_model=Health)
    def health():
        with Session(app.state.engine) as db: db.execute(select(1))
        return Health(mode=settings.mode)

    @app.post("/api/v1/session", response_model=SessionView, status_code=201)
    def create_session(body: SessionInput, response: Response, request: Request):
        if request.headers.get("Origin") and request.headers["Origin"] != settings.allowed_origin:
            raise s.BusinessError("ORIGIN_INVALID", 403)
        owner = m.uid() if settings.mode == "mock" else verify_credential(settings.auth_secret, body.credential or "")
        if not owner: raise s.BusinessError("CREDENTIAL_INVALID", 401)
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        expiry = (m.now() + timedelta(seconds=settings.session_seconds)).isoformat()
        with m.write(app.state.engine) as db:
            db.add(m.AuthSession(token_hash=token_hash(token), owner=owner, csrf=csrf, expires_at=expiry))
        response.set_cookie("dealbattle_session", token, httponly=True, secure=settings.mode == "live", samesite="strict", max_age=settings.session_seconds, path="/")
        return SessionView(csrf_token=csrf, expires_at=expiry, mode=settings.mode)

    @app.get("/api/v1/session", response_model=SessionView)
    def get_session(session=Depends(auth)):
        return SessionView(csrf_token=session.csrf, expires_at=session.expires_at, mode=settings.mode)

    @app.delete("/api/v1/session", status_code=204)
    def expire_session(response: Response, session=Depends(mutate)):
        with m.write(app.state.engine) as db:
            db.delete(db.get(m.AuthSession, session.token_hash))
        response.delete_cookie("dealbattle_session", path="/")

    @app.get("/api/v1/products", response_model=list[ProductView])
    def products(session=Depends(auth)):
        with Session(app.state.engine) as db:
            return [s.product_view(db, id) for id in db.scalars(select(m.Product.id).order_by(m.Product.id))]

    @app.post("/api/v1/deals", response_model=DealView, status_code=201)
    def create_deal(body: CreateDeal, request: Request, session=Depends(mutate)):
        key = request.headers.get("Idempotency-Key")
        with m.write(app.state.engine) as db:
            prior, hashed = s.idempotency(db, session.owner, "create", key, body.model_dump(mode="json"))
            if prior: return s.deal_view(db, s.owned(db, prior.result_id, session.owner), settings)
            s.product_view(db, body.product_id)
            deal = m.Deal(owner=session.owner, product_id=body.product_id)
            db.add(deal)
            db.flush()
            db.add(m.PolicyRow(deal_id=deal.id, version=1, data=body.policy.model_dump(mode="json")))
            s.event(db, deal, "DEAL_CREATED", {"product_id": body.product_id})
            s.save_idempotency(db, session.owner, "create", key, hashed, deal.id)
            db.flush()
            return s.deal_view(db, deal, settings)

    @app.get("/api/v1/deals/{deal_id}", response_model=DealView)
    @app.get("/api/v1/deals/{deal_id}/policy", response_model=DealView)
    @app.get("/api/v1/deals/{deal_id}/negotiation", response_model=DealView)
    def get_deal(deal_id: str, session=Depends(auth)):
        with Session(app.state.engine) as db: return s.deal_view(db, s.owned(db, deal_id, session.owner), settings)

    @app.put("/api/v1/deals/{deal_id}/policy", response_model=DealView)
    def change_policy(deal_id: str, body: ChangePolicy, request: Request, session=Depends(mutate)):
        key, scope = request.headers.get("Idempotency-Key"), deal_id + ":policy"
        with m.write(app.state.engine) as db:
            deal = s.owned(db, deal_id, session.owner)
            prior, hashed = s.idempotency(db, session.owner, scope, key, body.model_dump(mode="json"))
            if prior: return s.deal_view(db, deal, settings)
            s.version_check(deal, body.expected_policy_version)
            if s.frozen(db, deal): raise s.BusinessError("STATE_CONFLICT")
            s.invalidate(db, deal)
            deal.policy_version += 1
            deal.confirmed, deal.status, deal.reasons = False, "DRAFT", []
            db.add(m.PolicyRow(deal_id=deal.id, version=deal.policy_version, data=body.policy.model_dump(mode="json")))
            s.event(db, deal, "POLICY_CHANGED", {"invalidated_previous_results": True})
            s.save_idempotency(db, session.owner, scope, key, hashed, deal.id)
            db.flush()
            return s.deal_view(db, deal, settings)

    @app.post("/api/v1/deals/{deal_id}/policy/confirm", response_model=DealView)
    def confirm_policy(deal_id: str, body: VersionInput, request: Request, session=Depends(mutate)):
        key, scope = request.headers.get("Idempotency-Key"), deal_id + ":confirm"
        with m.write(app.state.engine) as db:
            deal = s.owned(db, deal_id, session.owner)
            prior, hashed = s.idempotency(db, session.owner, scope, key, body.model_dump(mode="json"))
            if prior: return s.deal_view(db, deal, settings)
            s.version_check(deal, body.expected_policy_version)
            if deal.status not in {"DRAFT", "POLICY_CONFIRMED"}: raise s.BusinessError("STATE_CONFLICT")
            deal.confirmed, deal.status = True, "POLICY_CONFIRMED"
            s.event(db, deal, "POLICY_CONFIRMED", {})
            s.save_idempotency(db, session.owner, scope, key, hashed, deal.id)
            return s.deal_view(db, deal, settings)

    @app.post("/api/v1/deals/{deal_id}/negotiation/start", response_model=DealView)
    def start(deal_id: str, body: VersionInput, request: Request, session=Depends(mutate)):
        key, scope = request.headers.get("Idempotency-Key"), deal_id + ":start"
        should_run = False
        with m.write(app.state.engine) as db:
            deal = s.owned(db, deal_id, session.owner)
            prior, hashed = s.idempotency(db, session.owner, scope, key, body.model_dump(mode="json"))
            if prior: return s.deal_view(db, deal, settings)
            s.version_check(deal, body.expected_policy_version)
            exists = db.scalar(select(m.Negotiation).where(m.Negotiation.deal_id == deal.id, m.Negotiation.policy_version == deal.policy_version))
            if exists:
                s.save_idempotency(db, session.owner, scope, key, hashed, deal.id)
                return s.deal_view(db, deal, settings)
            if not deal.confirmed or deal.status != "POLICY_CONFIRMED": raise s.BusinessError("STATE_CONFLICT")
            db.add(m.Negotiation(deal_id=deal.id, policy_version=deal.policy_version))
            p = s.product_view(db, deal.product_id)
            floor = db.get(m.SellerPolicy, deal.product_id).floor
            check = app.state.policy.evaluate(s.policy_for(db, deal), p, floor, floor, m.now(), 0, deal.policy_version)
            if not check.allowed:
                s.block(db, deal, check.model_dump(mode="json")["reason_codes"], "PRECHECK_BLOCK")
                s.event(db, deal, "MODEL_CALLS_SKIPPED", {"reason_codes": deal.reasons})
            else:
                deal.status, should_run = "NEGOTIATING", True
                s.event(db, deal, "NEGOTIATION_STARTED", {})
            s.save_idempotency(db, session.owner, scope, key, hashed, deal.id)
        if should_run: s.negotiate(app, deal_id, body.expected_policy_version)
        with Session(app.state.engine) as db: return s.deal_view(db, db.get(m.Deal, deal_id), settings)

    @app.get("/api/v1/deals/{deal_id}/rounds", response_model=list[RoundView])
    def rounds(deal_id: str, session=Depends(auth)):
        with Session(app.state.engine) as db:
            s.owned(db, deal_id, session.owner)
            return s.rounds_view(db, deal_id)

    @app.post("/api/v1/deals/{deal_id}/agreement/approve", response_model=DealView, status_code=202)
    def approve(deal_id: str, body: ApprovalInput, request: Request, background: BackgroundTasks, session=Depends(mutate)):
        key, scope = request.headers.get("Idempotency-Key"), deal_id + ":approve"
        failure = None
        with m.write(app.state.engine) as db:
            deal = s.owned(db, deal_id, session.owner)
            prior, hashed = s.idempotency(db, session.owner, scope, key, body.model_dump(mode="json"))
            if prior: return s.deal_view(db, deal, settings)
            s.version_check(deal, body.expected_policy_version)
            a = s.current_agreement(db, deal)
            existing = db.scalar(select(m.ChainRecord).where(m.ChainRecord.deal_id == deal.id))
            if existing:
                if not a or a.snapshot_hash != body.snapshot_hash: raise s.BusinessError("APPROVAL_STALE")
                s.save_idempotency(db, session.owner, scope, key, hashed, deal.id)
                return s.deal_view(db, deal, settings)
            if deal.status != "AWAITING_APPROVAL": raise s.BusinessError("STATE_CONFLICT")
            codes = s.approval_validation(db, deal, a, body.snapshot_hash, app.state.policy)
            if codes:
                # Persist the failed approval check; raising inside tx would erase evidence.
                s.block(db, deal, codes, "APPROVAL_BLOCK")
                failure = "APPROVAL_STALE"
            else:
                approval = m.Approval(agreement_id=a.id, owner=session.owner, snapshot_hash=a.snapshot_hash)
                db.add(approval)
                product = db.get(m.Product, deal.product_id)
                product.stock -= 1
                record_id = digest({"agreement_id": a.id})
                db.add(m.ChainRecord(id=record_id, deal_id=deal.id, agreement_id=a.id, audit_hash=a.snapshot_hash))
                deal.status = "RECORDING"
                s.event(db, deal, "BUYER_APPROVED", {"snapshot_hash": a.snapshot_hash})
                s.save_idempotency(db, session.owner, scope, key, hashed, deal.id)
                background.add_task(process_record, app, record_id)
            db.flush()
            view = s.deal_view(db, deal, settings)
        if failure: raise s.BusinessError(failure)
        return view

    @app.post("/api/v1/deals/{deal_id}/agreement/reject", response_model=DealView)
    def reject(deal_id: str, body: VersionInput, request: Request, session=Depends(mutate)):
        key, scope = request.headers.get("Idempotency-Key"), deal_id + ":reject"
        with m.write(app.state.engine) as db:
            deal = s.owned(db, deal_id, session.owner)
            prior, hashed = s.idempotency(db, session.owner, scope, key, body.model_dump(mode="json"))
            if prior: return s.deal_view(db, deal, settings)
            s.version_check(deal, body.expected_policy_version)
            if s.frozen(db, deal) or deal.status not in {"AWAITING_APPROVAL", "POLICY_CONFIRMED", "DRAFT", "BLOCKED", "REJECTED"}:
                raise s.BusinessError("STATE_CONFLICT")
            s.invalidate(db, deal)
            deal.status = "REJECTED"
            s.event(db, deal, "BUYER_REJECTED", {})
            s.save_idempotency(db, session.owner, scope, key, hashed, deal.id)
            db.flush()
            return s.deal_view(db, deal, settings)

    @app.post("/api/v1/deals/{deal_id}/chain/reconcile", response_model=DealView, status_code=202)
    def reconcile(deal_id: str, body: VersionInput, request: Request, background: BackgroundTasks, session=Depends(mutate)):
        key, scope = request.headers.get("Idempotency-Key"), deal_id + ":reconcile"
        with m.write(app.state.engine) as db:
            deal = s.owned(db, deal_id, session.owner)
            prior, hashed = s.idempotency(db, session.owner, scope, key, body.model_dump(mode="json"))
            if prior: return s.deal_view(db, deal, settings)
            s.version_check(deal, body.expected_policy_version)
            row = db.scalar(select(m.ChainRecord).where(m.ChainRecord.deal_id == deal.id))
            if not row: raise s.BusinessError("STATE_CONFLICT")
            s.save_idempotency(db, session.owner, scope, key, hashed, deal.id)
            background.add_task(process_record, app, row.id)
            return s.deal_view(db, deal, settings)

    @app.get("/api/v1/deals/{deal_id}/evidence", response_model=EvidenceView)
    def evidence(deal_id: str, session=Depends(auth)):
        with Session(app.state.engine) as db:
            s.owned(db, deal_id, session.owner)
            return {"deal_id": deal_id, "agreements": [s.agreement_view(db, a) for a in db.scalars(select(m.Agreement).where(m.Agreement.deal_id == deal_id))],
                    "rounds": s.rounds_view(db, deal_id), "events": [
                        {"id": e.id, "event_type": e.event_type, "policy_version": e.policy_version, "details": e.details, "created_at": e.created_at}
                        for e in db.scalars(select(m.AuditEvent).where(m.AuditEvent.deal_id == deal_id).order_by(m.AuditEvent.created_at))],
                    "chain": s.chain_view(db, deal_id, settings)}

    @app.get("/api/v1/deals/{deal_id}/usage", response_model=UsageSummary)
    def usage(deal_id: str, session=Depends(auth)):
        with Session(app.state.engine) as db:
            s.owned(db, deal_id, session.owner)
            calls = [{"id": r.id, "created_at": r.created_at, **r.data} for r in db.scalars(select(m.ModelUsage).where(m.ModelUsage.deal_id == deal_id).order_by(m.ModelUsage.created_at))]
            measured = [r for r in calls if r["usage_source"] == "provider"]
            grouped = {}
            for r in calls:
                key = r["stage"] + ":" + r["actor"]
                group = grouped.setdefault(key, {"calls": 0, "provider_total_tokens": None, "unavailable_calls": 0})
                group["calls"] += 1
                if r["usage_source"] == "provider": group["provider_total_tokens"] = (group["provider_total_tokens"] or 0) + r["total_tokens"]
                else: group["unavailable_calls"] += 1
            return {"calls": calls, "call_count": len(calls), "provider_total_tokens": sum(r["total_tokens"] for r in measured) if measured else None,
                    "unavailable_calls": len(calls) - len(measured), "by_stage": grouped, "energy": "unmeasured"}
    return app


app = create_app()
