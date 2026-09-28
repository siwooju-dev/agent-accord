"""Trusted operator only. Prints a short-lived login credential, never the signing key."""
import argparse
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.auth import issue_credential

parser = argparse.ArgumentParser()
parser.add_argument("--subject", required=True)
args = parser.parse_args()
secret = os.environ["AUTH_SIGNING_SECRET"]
if len(secret) < 32: raise SystemExit("AUTH_SIGNING_SECRET must have >=32 characters")
print(issue_credential(secret, args.subject))
