"""Small ASGI middleware for request-size and request-rate boundaries."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from .security import SlidingWindowRateLimiter


class RequestBodyLimitMiddleware:
    def __init__(self, app: Any, maximum_bytes: int) -> None:
        self.app = app
        self.maximum_bytes = maximum_bytes

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        length = headers.get(b"content-length")
        if length:
            try:
                if int(length) > self.maximum_bytes:
                    await self._reject(send)
                    return
            except ValueError:
                await self._reject(send)
                return
        consumed = 0

        async def limited_receive() -> dict:
            nonlocal consumed
            message = await receive()
            if message["type"] == "http.request":
                consumed += len(message.get("body", b""))
                if consumed > self.maximum_bytes:
                    raise RequestTooLarge
            return message

        try:
            await self.app(scope, limited_receive, send)
        except RequestTooLarge:
            await self._reject(send)

    @staticmethod
    async def _reject(send: Any) -> None:
        body = json.dumps({"detail": "Request body exceeds the service limit."}).encode()
        await send({
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        })
        await send({"type": "http.response.body", "body": body})


class RequestTooLarge(Exception):
    pass


class RateLimitMiddleware:
    def __init__(self, app: Any, limiter: SlidingWindowRateLimiter) -> None:
        self.app = app
        self.limiter = limiter

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] != "http" or scope.get("path") in {"/healthz", "/readyz"}:
            await self.app(scope, receive, send)
            return
        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        authorization = headers.get(b"authorization", b"")
        client = scope.get("client")
        address = client[0] if client else "unknown"
        identity = hashlib.sha256(authorization).hexdigest()[:24] if authorization else address
        decision = self.limiter.check(identity)
        if decision.allowed:
            await self.app(scope, receive, send)
            return
        body = json.dumps({"detail": "Rate limit exceeded."}).encode()
        await send({
            "type": "http.response.start",
            "status": 429,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
                (b"retry-after", str(decision.retry_after).encode()),
            ],
        })
        await send({"type": "http.response.body", "body": body})
