import asyncio
import secrets
from collections import deque

from starlette.types import ASGIApp, Receive, Scope, Send

from app.errors import error_response


def api_key_matches(key: str | None, expected: str) -> bool:
    return not expected or (
        key is not None and secrets.compare_digest(key.encode(), expected.encode())
    )


def is_vision_upload(scope: Scope) -> bool:
    # Starlette redirects trailing slashes; they must not bypass upload limits.
    return (
        scope["type"] == "http"
        and scope.get("method") == "POST"
        and scope.get("path", "").rstrip("/") == "/vision/describe"
    )


class APIKeyPreflightMiddleware:
    """Reject unauthorized API requests before receiving or parsing their bodies."""

    protected_paths = {"/places", "/routes", "/noise", "/vision/describe", "/speech/transcribe"}

    def __init__(self, app: ASGIApp, expected_key: str):
        self.app = app
        self.expected_key = expected_key

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if (
            scope["type"] == "http"
            and self.expected_key
            and scope.get("method") != "OPTIONS"
            and scope.get("path", "").rstrip("/") in self.protected_paths
        ):
            keys = [v for k, v in scope.get("headers", []) if k.lower() == b"x-api-key"]
            key = keys[0].decode("latin-1") if len(keys) == 1 else None
            if not api_key_matches(key, self.expected_key):
                response = error_response(401, "unauthorized", "API 인증이 필요합니다.")
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


class BodySizeLimitMiddleware:
    """Bound size and total receive time before parsing; release consumed chunks."""

    def __init__(
        self,
        app: ASGIApp,
        max_bytes: int,
        max_other_bytes: int = 64 * 1024,
        read_timeout_seconds: float = 15,
    ):
        self.app = app
        self.max_bytes = max_bytes
        self.max_other_bytes = max_other_bytes
        self.read_timeout_seconds = read_timeout_seconds

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limit = self.max_bytes if is_vision_upload(scope) else self.max_other_bytes
        lengths = [v.strip() for k, v in scope.get("headers", []) if k.lower() == b"content-length"]
        if lengths:
            if len(lengths) != 1 or not lengths[0].isdigit():
                response = error_response(
                    400, "invalid_content_length", "요청 크기 정보를 확인해 주세요."
                )
                await response(scope, receive, send)
                return
            # Compare decimal strings before int conversion, even for enormous headers.
            declared = lengths[0].lstrip(b"0") or b"0"
            maximum = str(limit).encode("ascii")
            if len(declared) > len(maximum) or (
                len(declared) == len(maximum) and declared > maximum
            ):
                response = error_response(
                    413, "payload_too_large", "업로드 크기 제한을 초과했습니다."
                )
                await response(scope, receive, send)
                return

        chunks = deque()
        size = 0
        try:
            try:
                # One deadline for the entire body, not a new allowance per chunk.
                async with asyncio.timeout(self.read_timeout_seconds):
                    while True:
                        message = await receive()
                        if message["type"] == "http.disconnect":
                            return
                        chunk = message.get("body", b"")
                        size += len(chunk)
                        if size > limit:
                            break
                        if chunk:
                            chunks.append(chunk)
                        if not message.get("more_body", False):
                            break
            except TimeoutError:
                response = error_response(
                    408,
                    "request_body_timeout",
                    "사진 또는 요청 전송 시간이 초과되었습니다. 다시 시도해 주세요.",
                )
                await response(scope, receive, send)
                return

            if size > limit:
                response = error_response(
                    413, "payload_too_large", "업로드 크기 제한을 초과했습니다."
                )
                await response(scope, receive, send)
                return

            del message, chunk
            delivered = False

            async def replay():
                nonlocal delivered
                if not delivered:
                    chunk = chunks.popleft() if chunks else b""
                    delivered = not chunks
                    return {"type": "http.request", "body": chunk, "more_body": not delivered}
                return await receive()

            # No joined copy is retained during multipart parsing or AI processing.
            await self.app(scope, replay, send)
        finally:
            chunks.clear()


class UploadCapacityMiddleware:
    """Reject excess camera uploads without queuing bodies in memory."""

    def __init__(self, app: ASGIApp, limit: int):
        self.app = app
        self.limit = limit
        self.active = 0

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if not is_vision_upload(scope):
            await self.app(scope, receive, send)
            return
        # ASGI calls share the event loop; no await between the check and increment.
        if self.active >= self.limit:
            response = error_response(
                429, "upload_busy", "사진 분석 중입니다. 잠시 후 다시 시도해 주세요."
            )
            response.headers["Retry-After"] = "2"
            await response(scope, receive, send)
            return
        self.active += 1
        try:
            await self.app(scope, receive, send)
        finally:
            self.active -= 1


class PrivacyHeadersMiddleware:
    """Do not cache places, routes, photo descriptions or their error responses."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        async def private_send(message):
            if message["type"] == "http.response.start":
                protected = {
                    b"cache-control",
                    b"pragma",
                    b"referrer-policy",
                    b"x-content-type-options",
                }
                headers = [
                    (k, v) for k, v in message.get("headers", []) if k.lower() not in protected
                ]
                message = {
                    **message,
                    "headers": headers
                    + [
                        (b"cache-control", b"no-store"),
                        (b"pragma", b"no-cache"),
                        (b"referrer-policy", b"no-referrer"),
                        (b"x-content-type-options", b"nosniff"),
                    ],
                }
            await send(message)

        await self.app(scope, receive, private_send)
