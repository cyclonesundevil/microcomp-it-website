"""Authentication, anonymous session tokens, and in-memory rate limiting."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from threading import Lock

from fastapi import HTTPException, Request, status


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_opaque_token(byte_count: int = 32) -> str:
    return secrets.token_urlsafe(byte_count)


def require_api_key(request: Request, supplied: str | None = None) -> None:
    supplied = supplied if supplied is not None else request.headers.get("x-api-key", "")
    expected = request.app.state.settings.api_key
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A valid API key is required.",
            headers={"WWW-Authenticate": "ApiKey"},
        )


def bearer_token(request: Request) -> str:
    value = request.headers.get("authorization", "")
    scheme, _, token = value.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A valid anonymous session token is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return token


@dataclass(frozen=True)
class RateDecision:
    allowed: bool
    retry_after: int
    remaining: int


class SlidingWindowRateLimiter:
    def __init__(self, maximum: int, window_seconds: int) -> None:
        self.maximum = maximum
        self.window_seconds = window_seconds
        self._entries: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def check(self, key: str, now: float | None = None) -> RateDecision:
        current = time.monotonic() if now is None else now
        cutoff = current - self.window_seconds
        with self._lock:
            entries = self._entries[key]
            while entries and entries[0] <= cutoff:
                entries.popleft()
            if len(entries) >= self.maximum:
                retry = max(1, int(self.window_seconds - (current - entries[0])) + 1)
                return RateDecision(False, retry, 0)
            entries.append(current)
            return RateDecision(True, 0, self.maximum - len(entries))

    def prune(self, now: float | None = None) -> None:
        current = time.monotonic() if now is None else now
        cutoff = current - self.window_seconds
        with self._lock:
            for key in list(self._entries):
                entries = self._entries[key]
                while entries and entries[0] <= cutoff:
                    entries.popleft()
                if not entries:
                    del self._entries[key]
