"""Scan index and reachable Git history; report ONLY paths/commit IDs, never matches."""
import json
import re
import subprocess


def git(*args):
    return subprocess.check_output(["git", *args], stderr=subprocess.DEVNULL)


patterns = [re.compile(rb"sk-bk-[A-Za-z0-9_-]{16,}"), re.compile(rb"sk-(?:proj-)?[A-Za-z0-9_-]{32,}"),
            re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")]
findings = []
seen = set()
refs = [":"] + git("rev-list", "--all").decode().splitlines()
for ref in refs:
    files = git("ls-files", "-z").split(b"\0") if ref == ":" else git("ls-tree", "-rz", "--name-only", ref).split(b"\0")
    for raw_name in files:
        if not raw_name: continue
        name = raw_name.decode("utf-8")
        try:
            blob = git("show", (":" + name) if ref == ":" else (ref + ":" + name))
        except subprocess.CalledProcessError: continue
        flagged = (name.lower().endswith("api key.txt") or name.rsplit("/", 1)[-1] == ".env" or any(p.search(blob) for p in patterns))
        key = (ref, name)
        if flagged and key not in seen:
            findings.append({"commit": "INDEX" if ref == ":" else ref, "path": name, "action": "Review privately and rotate if real; do not print contents"})
            seen.add(key)
print(json.dumps({"status": "REVIEW_REQUIRED" if findings else "NO_MATCHES", "findings": findings,
                  "scope": "index and all fetched reachable commits; recognizable key patterns only"}))
raise SystemExit(1 if findings else 0)
