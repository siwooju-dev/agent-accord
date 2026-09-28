"""Run from repository root: python scripts/manage.py migrate|seed|worker|openapi."""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["migrate", "seed", "worker", "openapi"])
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.command == "migrate":
        from alembic.config import Config
        from alembic import command
        command.upgrade(Config(str(ROOT / "alembic.ini")), "head")
        print("Migration head applied")
    elif args.command == "seed":
        from app.seed import seed
        from app.config import Settings
        from app.db import engine_for
        seed(engine_for(Settings.env().database_url))
        print("4 simulated products seeded (idempotent; existing data preserved)")
    elif args.command == "worker":
        from app.main import app
        from app.worker import process_all
        process_all(app)
        print("One worker pass complete; UNKNOWN records queried without resubmission")
    else:
        import yaml
        from app.main import app
        document = app.openapi()
        targets = {ROOT / "openapi.yaml": yaml.safe_dump(document, allow_unicode=True, sort_keys=False),
                   ROOT / "contracts" / "openapi.json": json.dumps(document, ensure_ascii=False, indent=2) + "\n"}
        if args.check:
            assert yaml.safe_load((ROOT / "openapi.yaml").read_text(encoding="utf-8")) == document
            assert json.loads((ROOT / "contracts" / "openapi.json").read_text(encoding="utf-8")) == document
            print("openapi.yaml == contracts/openapi.json == server /openapi.json")
        else:
            for path, data in targets.items():
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(data, encoding="utf-8")
            print("OpenAPI contracts exported")


if __name__ == "__main__": main()
