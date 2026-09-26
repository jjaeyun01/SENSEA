import assert from "node:assert/strict";
import test from "node:test";
import { createVisionTransport } from "../createVisionTransport.mjs";

test("multipart transport echoes request identity and shares the abort signal", async () => {
  const fields = new Map();
  const abort = new AbortController();
  let observed;
  const describe = createVisionTransport({
    baseUrl: "https://example.test/",
    apiKey: "test-demo-token",
    formDataFactory: () => ({ append: (key, value) => fields.set(key, value) }),
    fetchImpl: async (url, options) => {
      observed = { url, ...options };
      return { ok: true, json: async () => ({ request_id: fields.get("request_id") }) };
    },
  });
  const result = await describe({
    photo: { uri: "file:///photo.jpg" }, requestId: "id-1",
    expectedPlace: "도서관", signal: abort.signal,
  });
  assert.equal(observed.url, "https://example.test/vision/describe");
  assert.deepEqual(observed.headers, { "X-API-Key": "test-demo-token" });
  assert.equal(observed.signal, abort.signal);
  assert.equal(fields.get("stationary"), "true");
  assert.equal(fields.get("expected_place"), "도서관");
  assert.equal(fields.get("image").uri, "file:///photo.jpg");
  assert.equal(result.request_id, "id-1");
});

test("HTTP failures produce a message without exposing server content", async () => {
  const describe = createVisionTransport({
    baseUrl: "https://example.test",
    formDataFactory: () => ({ append() {} }),
    fetchImpl: async () => ({ ok: false, status: 429 }),
  });
  await assert.rejects(
    describe({ photo: { uri: "file:///photo.jpg" }, requestId: "id" }),
    { code: "http_429" },
  );
});
