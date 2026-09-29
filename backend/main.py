from __future__ import annotations

from collections.abc import Callable

from fastapi import FastAPI

from .api import configure_api
from .approval_service import ApprovalService
from .auth import DemoSessionService
from .chain_submission import ChainFactory
from .config import Settings
from .repository import SQLiteAgreementRepository


def create_app(
    *, settings: Settings | None = None,
    repository: SQLiteAgreementRepository | None = None,
    chain_factory: ChainFactory | None = None,
) -> FastAPI:
    resolved_settings = settings or Settings.from_env()
    resolved_repository = repository or SQLiteAgreementRepository(resolved_settings.database_path)
    app = FastAPI(title="Agent Accord API", version="0.1.0")
    app.state.settings = resolved_settings
    app.state.repository = resolved_repository
    app.state.session_service = DemoSessionService(
        repository=resolved_repository, settings=resolved_settings,
    )
    app.state.approval_service = ApprovalService(
        repository=resolved_repository, settings=resolved_settings,
        chain_factory=chain_factory,
    )
    configure_api(app)
    return app


app = create_app()
