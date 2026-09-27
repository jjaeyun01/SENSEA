import asyncio
import json
from collections import deque

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.foundation import create_app
from app.middleware import BodySizeLimitMiddleware, UploadCapacityMiddleware
from app.models import VisionScene


def scope(path="/vision/describe", headers=(), method="POST"):
    return {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "scheme": "http",
        "method": method,
        "path": path,
        "raw_path": path.encode(),
        "root_path": "",
        "query_string": b"",
        "headers": [(name.lower(), value) for name, value in headers],
        "client": ("127.0.0.1", 1234),
        "server": ("testserver", 80),
    }


async def forbidden_receive():
    pytest.fail("Rejected request must not read any body bytes")


async def forbidden_app(scope, receive, send):
    pytest.fail("Rejected request must not reach the application")


def receiver(chunks):
    pending = deque(chunks)

    async def receive():
        if not pending:
            return {"type": "http.disconnect"}
        return {"type": "http.request", "body": pending.popleft(), "more_body": bool(pending)}

    return receive


async def call(app, request_scope, receive):
    replies = []

    async def send(message):
        replies.append(message)

    await app(request_scope, receive, send)
    return replies


def error_code(replies):
    body = b"".join(m.get("body", b"") for m in replies if m["type"] == "http.response.body")
    return json.loads(body)["error"]["code"]


@pytest.mark.parametrize(
    "path,keys",
    [
        ("/vision/describe", []),
        ("/vision/describe/", [b"wrong"]),
        ("/routes", [b"test-token", b"wrong"]),
        ("/noise", [b"\xff"]),
        ("/places", []),
        ("/speech/transcribe", []),
    ],
)
def test_auth_rejects_before_reading_with_privacy_and_cors(settings, path, keys):
    settings.sensea_api_key = SecretStr("test-token")
    settings.cors_origins = ["https://demo.example"]
    headers = [(b"origin", b"https://demo.example"), *((b"x-api-key", key) for key in keys)]
    replies = asyncio.run(call(create_app(settings), scope(path, headers), forbidden_receive))
    assert replies[0]["status"] == 401
    assert error_code(replies) == "unauthorized"
    response_headers = dict(replies[0]["headers"])
    assert response_headers[b"cache-control"] == b"no-store"
    assert response_headers[b"access-control-allow-origin"] == b"https://demo.example"


def test_public_endpoints_and_cors_preflight_do_not_require_a_key(settings):
    settings.sensea_api_key = SecretStr("test-token")
    settings.cors_origins = ["https://demo.example"]
    with TestClient(create_app(settings)) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/docs").status_code == 200
        response = client.options(
            "/vision/describe",
            headers={
                "Origin": "https://demo.example",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "X-API-Key, Content-Type",
            },
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "https://demo.example"


@pytest.mark.parametrize(
    "values,status,code",
    [
        ([b"-1"], 400, "invalid_content_length"),
        ([b"1.5"], 400, "invalid_content_length"),
        ([b""], 400, "invalid_content_length"),
        ([b"1", b"1"], 400, "invalid_content_length"),
        ([b"9"], 413, "payload_too_large"),
        ([b"9" * 5000], 413, "payload_too_large"),
    ],
)
def test_content_length_rejected_before_receiving(values, status, code):
    app = BodySizeLimitMiddleware(forbidden_app, max_bytes=8)
    headers = [(b"content-length", value) for value in values]
    replies = asyncio.run(call(app, scope(headers=headers), forbidden_receive))
    assert replies[0]["status"] == status
    assert error_code(replies) == code


@pytest.mark.parametrize("headers", [[], [(b"content-length", b"1")]])
def test_actual_stream_size_is_bounded_even_without_an_honest_length(headers):
    app = BodySizeLimitMiddleware(forbidden_app, max_bytes=8)
    replies = asyncio.run(call(app, scope(headers=headers), receiver([b"1234", b"56789"])))
    assert replies[0]["status"] == 413


@pytest.mark.parametrize("chunks", [[b"123", b"", b"45678"], [b""]])
def test_exact_boundary_and_empty_body_replay_then_forward_disconnect(chunks):
    observed = []

    async def downstream(scope, receive, send):
        while True:
            message = await receive()
            observed.append(message["body"])
            if not message["more_body"]:
                break
        assert await receive() == {"type": "http.disconnect"}

    app = BodySizeLimitMiddleware(downstream, max_bytes=8)
    declared = b"000000000" + str(len(b"".join(chunks))).encode()
    asyncio.run(call(app, scope(headers=[(b"content-length", declared)]), receiver(chunks)))
    assert b"".join(observed) == b"".join(chunks)


@pytest.mark.parametrize("path,method", [("/health", "GET"), ("/missing", "POST")])
def test_unrelated_endpoints_cannot_buffer_photo_sized_bodies(path, method):
    app = BodySizeLimitMiddleware(forbidden_app, max_bytes=1024, max_other_bytes=4)
    request_scope = scope(path, [(b"content-length", b"5")], method)
    replies = asyncio.run(call(app, request_scope, forbidden_receive))
    assert replies[0]["status"] == 413


@pytest.mark.parametrize("path", ["/vision/describe", "/vision/describe/"])
def test_slow_upload_times_out_and_next_upload_gets_capacity(path):
    async def run():
        reached = []

        async def downstream(scope, receive, send):
            reached.append(await receive())

        async def stalled():
            await asyncio.Event().wait()

        app = UploadCapacityMiddleware(
            BodySizeLimitMiddleware(
                downstream, max_bytes=8, max_other_bytes=1, read_timeout_seconds=0.01
            ),
            limit=1,
        )
        replies = await call(app, scope(path), stalled)
        assert replies[0]["status"] == 408
        assert error_code(replies) == "request_body_timeout"
        assert app.active == 0
        assert not reached
        await call(app, scope(path), receiver([b"12345678"]))
        assert reached[0]["body"] == b"12345678"
        assert app.active == 0

    asyncio.run(run())


def test_deadline_is_for_entire_body_not_reset_for_each_chunk():
    async def slowly_dripping():
        await asyncio.sleep(0.01)
        return {"type": "http.request", "body": b"x", "more_body": True}

    app = BodySizeLimitMiddleware(forbidden_app, max_bytes=100, read_timeout_seconds=0.04)
    replies = asyncio.run(call(app, scope(), slowly_dripping))
    assert replies[0]["status"] == 408


def test_disconnect_and_external_cancellation_release_capacity():
    async def run():
        app = UploadCapacityMiddleware(BodySizeLimitMiddleware(forbidden_app, max_bytes=8), limit=1)
        messages = deque(
            [
                {"type": "http.request", "body": b"partial", "more_body": True},
                {"type": "http.disconnect"},
            ]
        )

        async def partial_then_disconnect():
            return messages.popleft()

        assert await call(app, scope(), partial_then_disconnect) == []
        assert app.active == 0

        entered = asyncio.Event()

        async def stalled():
            entered.set()
            await asyncio.Event().wait()

        task = asyncio.create_task(call(app, scope(), stalled))
        await entered.wait()
        assert app.active == 1
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert app.active == 0

    asyncio.run(run())


def test_chunked_multipart_reaches_vision_with_the_same_image(settings, jpeg):
    observed = []

    class Provider:
        async def describe(self, image, expected_place):
            observed.append((image, expected_place))
            return VisionScene(
                description="건물 표지판이 보입니다.",
                recognized_text=[],
                uncertainty="high",
                roadway="uncertain",
                sidewalk="uncertain",
            )

    request = httpx.Request(
        "POST",
        "http://testserver/vision/describe",
        data={
            "stationary": "true",
            "external_processing_consent": "true",
            "request_id": "00000000-0000-4000-8000-000000000001",
            "expected_place": "도서관",
        },
        files={"image": ("frame.jpg", jpeg, "image/jpeg")},
    )
    body = request.read()

    async def run():
        app = create_app(settings, provider=Provider())
        async with app.router.lifespan_context(app):
            return await call(
                app,
                scope(headers=request.headers.raw),
                receiver([body[i : i + 97] for i in range(0, len(body), 97)]),
            )

    replies = asyncio.run(run())
    assert replies[0]["status"] == 200
    assert len(observed) == 1
    assert observed[0][0].startswith(b"\xff\xd8")
    assert observed[0][1] == "도서관"


def test_provider_timeout_is_not_reported_as_an_upload_timeout():
    async def downstream(scope, receive, send):
        raise TimeoutError("provider timeout")

    app = BodySizeLimitMiddleware(downstream, max_bytes=8)
    with pytest.raises(TimeoutError, match="provider timeout"):
        asyncio.run(call(app, scope(), receiver([b""])))


def test_auth_and_cors_preflight_work_while_photo_capacity_is_full(settings):
    settings.sensea_api_key = SecretStr("test-token")
    settings.cors_origins = ["https://demo.example"]
    settings.max_concurrent_uploads = 1

    async def run():
        app = create_app(settings)
        entered = asyncio.Event()
        headers = [(b"x-api-key", b"test-token")]

        async def stalled():
            entered.set()
            await asyncio.Event().wait()

        first = asyncio.create_task(call(app, scope(headers=headers), stalled))
        try:
            await entered.wait()
            rejected = await call(app, scope(), forbidden_receive)
            assert rejected[0]["status"] == 401
            busy = await call(app, scope(headers=headers), forbidden_receive)
            assert busy[0]["status"] == 429
            preflight = await call(
                app,
                scope(
                    headers=[
                        (b"origin", b"https://demo.example"),
                        (b"access-control-request-method", b"POST"),
                        (b"access-control-request-headers", b"X-API-Key"),
                    ],
                    method="OPTIONS",
                ),
                forbidden_receive,
            )
            assert preflight[0]["status"] == 200
        finally:
            first.cancel()
            with pytest.raises(asyncio.CancelledError):
                await first

    asyncio.run(run())
