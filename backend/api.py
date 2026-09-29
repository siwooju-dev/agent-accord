from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .approval_service import ApprovalService
from .auth import DemoSessionService
from .errors import APIError
from .models import (
    AgreementDecisionRequest,
    AgreementDecisionView,
    AgreementView,
    ApprovalPayloadView,
    DemoSessionRequest,
    DemoSessionView,
)
from .repository import DemoSession


router = APIRouter(prefix="/api")


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", str(uuid4()))


def _current_session(request: Request, authorization: str | None = Header(default=None)) -> DemoSession:
    sessions: DemoSessionService = request.app.state.session_service
    return sessions.authenticate(authorization)


@router.post("/demo/sessions", response_model=DemoSessionView, status_code=200)
def create_demo_session(
    body: DemoSessionRequest, request: Request,
) -> DemoSessionView:
    service: DemoSessionService = request.app.state.session_service
    raw_token, session = service.create(body)
    return DemoSessionView(
        request_id=_request_id(request), access_token=raw_token, actor_id=session.actor_id,
        role=session.role, wallet_address=session.wallet_address,
        expires_at=session.expires_at,
    )


@router.get(
    "/agreements/{agreement_id}/approval-payload",
    response_model=ApprovalPayloadView,
)
def approval_payload(
    agreement_id: str, request: Request,
    session: DemoSession = Depends(_current_session),
) -> dict:
    service: ApprovalService = request.app.state.approval_service
    return service.approval_payload(
        agreement_id=agreement_id, session=session, request_id=_request_id(request),
    )


@router.post(
    "/agreements/{agreement_id}/decisions",
    response_model=AgreementDecisionView,
)
def agreement_decision(
    agreement_id: str, body: AgreementDecisionRequest, request: Request,
    session: DemoSession = Depends(_current_session),
) -> dict:
    service: ApprovalService = request.app.state.approval_service
    return service.decide(
        agreement_id=agreement_id, session=session, request=body,
        request_id=_request_id(request),
    )


@router.get("/agreements/{agreement_id}", response_model=AgreementView)
def get_agreement(
    agreement_id: str, request: Request,
    session: DemoSession = Depends(_current_session),
) -> dict:
    service: ApprovalService = request.app.state.approval_service
    return service.get_agreement(
        agreement_id=agreement_id, session=session, request_id=_request_id(request),
    )


def configure_api(app: FastAPI) -> None:
    @app.middleware("http")
    async def assign_request_id(request: Request, call_next):
        request.state.request_id = str(uuid4())
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response

    @app.exception_handler(APIError)
    async def api_error_handler(request: Request, exc: APIError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"request_id": _request_id(request), "error": {"code": exc.code, "message": exc.message}},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={"request_id": _request_id(request),
                     "error": {"code": "VALIDATION_ERROR", "message": "Request validation failed"}},
        )

    @app.exception_handler(KeyError)
    async def missing_agreement_handler(request: Request, exc: KeyError) -> JSONResponse:
        return JSONResponse(
            status_code=404,
            content={"request_id": _request_id(request),
                     "error": {"code": "AGREEMENT_NOT_FOUND", "message": "Agreement not found"}},
        )

    app.include_router(router)
