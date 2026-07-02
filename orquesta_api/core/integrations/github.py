"""GitHub webhook signature verification (X-Hub-Signature-256)."""

import hashlib
import hmac


def verify_signature(secret: str, body: bytes, signature_header: str | None) -> bool:
    """Verify a GitHub webhook's HMAC-SHA256 signature.

    When *secret* is empty (dev/test default, matching the bearer-auth
    empty-token-disables-auth convention), verification is a no-op and every
    request passes — production deploys must set github_webhook_secret.
    """
    if not secret:
        return True
    if not signature_header or not signature_header.startswith("sha256="):
        return False

    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    provided = signature_header.removeprefix("sha256=")
    return hmac.compare_digest(expected, provided)
