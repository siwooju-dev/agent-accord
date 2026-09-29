"""Put the Kiln API key and a testnet relayer key into the git-ignored `.env.local`.

    .venv/bin/python scripts/setup_secrets.py            # asks for KILN_API_KEY (hidden input)
    .venv/bin/python scripts/setup_secrets.py --relayer  # only create the relayer wallet if missing
    .venv/bin/python scripts/setup_secrets.py --check    # shows which values are set, never the values

Nothing here prints a secret. The relayer wallet is a fresh Base Sepolia test wallet: fund it
from a faucet, then deploy with `python -m blockchain.deploy` (see README).
"""

from __future__ import annotations

import argparse
import getpass
import os
import stat
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env.local"
SECRET_KEYS = ("KILN_API_KEY", "RELAYER_PRIVATE_KEY")


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def write_env(path: Path, values: dict[str, str]) -> None:
    lines = ["# Local secrets for Agent Accord. Git-ignored. Never commit or paste this file."]
    lines += [f"{key}={value}" for key, value in values.items()]
    tmp = path.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, stat.S_IRUSR | stat.S_IWUSR)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    os.replace(tmp, path)
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)


def relayer_address(key: str) -> str:
    from eth_account import Account

    return Account.from_key(key).address


def ensure_relayer(values: dict[str, str]) -> tuple[str, bool]:
    key = values.get("RELAYER_PRIVATE_KEY", "")
    if key:
        return relayer_address(key), False
    from eth_account import Account

    account = Account.create()
    values["RELAYER_PRIVATE_KEY"] = account.key.hex() if account.key.hex().startswith("0x") else "0x" + account.key.hex()
    return account.address, True


def check_kiln(key: str, base_url: str) -> str:
    """Call GET /models once. Returns a short status, never the key or the response body."""
    import httpx

    try:
        response = httpx.get(f"{base_url.rstrip('/')}/models", headers={"Authorization": f"Bearer {key}"}, timeout=15)
    except httpx.HTTPError as exc:
        return f"연결 실패 ({type(exc).__name__})"
    if response.status_code == 200:
        try:
            ids = {item.get("id") for item in response.json().get("data", [])}
        except ValueError:
            ids = set()
        model = os.getenv("KILN_MODEL_ID", "qwen3-32b")
        return "정상 · " + (f"{model} 사용 가능" if model in ids else f"{model} 없음 (모델 {len(ids)}개)")
    return {401: "키가 올바르지 않음 (401)", 402: "크레딧 부족 (402)", 403: "권한 없음 (403)"}.get(
        response.status_code, f"HTTP {response.status_code}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--relayer", action="store_true", help="only create the relayer wallet if missing")
    parser.add_argument("--check", action="store_true", help="show which values are set")
    args = parser.parse_args()

    values = read_env(ENV_PATH)
    if args.check:
        for key in SECRET_KEYS:
            print(f"{key}: {'설정됨' if values.get(key) else '없음'}")
        if values.get("RELAYER_PRIVATE_KEY"):
            print(f"relayer 주소: {relayer_address(values['RELAYER_PRIVATE_KEY'])}")
        if values.get("KILN_API_KEY"):
            print("Kiln 확인:", check_kiln(values["KILN_API_KEY"], values.get("KILN_BASE_URL", "https://api.bricksum.com/v1")))
        return 0

    if not args.relayer:
        current = "있음 (Enter를 누르면 유지)" if values.get("KILN_API_KEY") else "없음"
        print(f"Kiln API 키를 붙여넣고 Enter를 누르세요. 입력한 글자는 화면에 보이지 않습니다. 현재: {current}")
        key = getpass.getpass("KILN_API_KEY: ").strip()
        if key:
            if any(ch.isspace() for ch in key) or len(key) < 20:
                print("키 형식이 이상합니다. 다시 실행해 주세요.", file=sys.stderr)
                return 1
            values["KILN_API_KEY"] = key
        if values.get("KILN_API_KEY"):
            print("Kiln 확인:", check_kiln(values["KILN_API_KEY"], values.get("KILN_BASE_URL", "https://api.bricksum.com/v1")))

    address, created = ensure_relayer(values)
    write_env(ENV_PATH, values)
    print(f"저장: {ENV_PATH.relative_to(ROOT)} (권한 600, git 제외)")
    print(f"relayer 주소: {address}" + (" · 새로 만듦 — Base Sepolia faucet으로 테스트 ETH를 받으세요" if created else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
