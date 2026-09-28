import base64
import hashlib
import hmac
import json
import secrets
import time


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def issue_credential(secret, subject, seconds=300):
    payload = base64.urlsafe_b64encode(json.dumps({"sub": subject, "exp": int(time.time()) + seconds, "aud": "dealbattle-session", "nonce": secrets.token_hex(16)}, separators=(",", ":")).encode()).decode().rstrip("=")
    signature = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return payload + "." + signature


def verify_credential(secret, token):
    try:
        payload, signature = token.split(".")
        expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected): return None
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if claims["aud"] != "dealbattle-session" or type(claims["exp"]) is not int or claims["exp"] <= time.time(): return None
        subject = claims["sub"]
        return subject if isinstance(subject, str) and 1 <= len(subject) <= 80 else None
    except (ValueError, KeyError, TypeError):
        return None
