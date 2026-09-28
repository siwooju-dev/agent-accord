from pathlib import Path
from alembic.config import Config
from alembic import command
from sqlalchemy import inspect, select, func
from app import db as m
from app.seed import seed


def test_migration_matches_metadata_and_seed_is_idempotent(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[3]
    url = "sqlite:///" + str(tmp_path / "migration.db")
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.chdir(root)
    config = Config(str(root / "alembic.ini"))
    command.upgrade(config, "head")
    engine = m.engine_for(url)
    assert set(inspect(engine).get_table_names()) == set(m.Base.metadata.tables) | {"alembic_version"}
    for name, table in m.Base.metadata.tables.items():
        assert {c['name'] for c in inspect(engine).get_columns(name)} == set(table.columns.keys())
    seed(engine)
    seed(engine)
    with m.Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(m.Product)) == 4
        assert all(p.data["source"] == "simulated" for p in db.scalars(select(m.Product)))
    command.downgrade(config, "base")
    assert inspect(engine).get_table_names() == ["alembic_version"]
    engine.dispose()
