"""Isolated mock E2E DB; never reset a user's application DB."""
import os
import sys
import tempfile
from pathlib import Path
os.environ["APP_MODE"] = "mock"
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.main import create_app
from app.config import Settings
from app.db import Base, engine_for
from app.seed import seed
import uvicorn

with tempfile.TemporaryDirectory() as folder:
    engine = engine_for("sqlite:///" + str(Path(folder) / "e2e.db"))
    Base.metadata.create_all(engine)
    seed(engine)
    app = create_app(Settings(), engine=engine)
    try: uvicorn.run(app, host="127.0.0.1", port=8000)
    finally: engine.dispose()
