from starlette.types import ASGIApp, Receive, Scope, Send

from app.errors import error_response


class BodySizeLimitMiddleware:
    """Bound bytes before multipart parsing, including uploads without Content-Length."""

    def __init__(self, app: ASGIApp, max_bytes: int):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        chunks = []
        size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > self.max_bytes:
                response = error_response(
                    413, "payload_too_large", "업로드 크기 제한을 초과했습니다."
                )
                await response(scope, receive, send)
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break
        body = b"".join(chunks)
        del chunks
        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


class UploadCapacityMiddleware:
    """Reject excess camera uploads without queuing bodies in memory."""

    def __init__(self, app: ASGIApp, limit: int):
        self.app = app
        self.limit = limit
        self.active = 0

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http" or scope.get("path") != "/vision/describe":
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
