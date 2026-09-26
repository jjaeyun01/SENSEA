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
    expectedPlace: "도서관", signal: abort.signal, externalProcessingConsent: true,
  });
  assert.equal(observed.url, "https://example.test/vision/describe");
  assert.deepEqual(observed.headers, { "X-API-Key": "test-demo-token" });
  assert.equal(observed.signal, abort.signal);
  assert.equal(fields.get("stationary"), "true");
  assert.equal(fields.get("external_processing_consent"), "true");
  assert.equal(observed.redirect, "error");
  assert.equal(observed.cache, "no-store");
  assert.equal(observed.credentials, "omit");
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
    describe({ photo: { uri: "file:///photo.jpg" }, requestId: "id", externalProcessingConsent: true }),
    { code: "http_429" },
  );
});


test("no network or file body is created without explicit consent", async () => {
  const describe = createVisionTransport({
    baseUrl: "https://example.test",
    formDataFactory: () => assert.fail("Must not open the photo"),
    fetchImpl: () => assert.fail("Must not contact the server"),
  });
  for (const consent of [undefined, false, "true"]) {
    await assert.rejects(describe({
      photo: { uri: "private.jpg" }, externalProcessingConsent: consent,
    }), { code: "external_consent_required" });
  }
});

for (const baseUrl of ["http://example.test", "http://10.example.test", "ftp://localhost", "https://user:secret@example.test", "https://example.test/?secret=1", "https://example.test/#secret"]) {
  test("untrusted upload configuration rejected: " + baseUrl, () => {
    assert.throws(() => createVisionTransport({ baseUrl, allowInsecureLocalHttp: true }), /HTTPS/);
  });
}

test("local HTTP requires a separate explicit development setting", () => {
  assert.throws(() => createVisionTransport({ baseUrl: "http://192.168.1.10:8000" }), /HTTPS/);
  assert.equal(typeof createVisionTransport({
    baseUrl: "http://192.168.1.10:8000", allowInsecureLocalHttp: true, fetchImpl: async () => {},
  }), "function");
});


test("transport never silently falls back to React Native global fetch", () => {
  assert.throws(() => createVisionTransport({ baseUrl: "https://example.test" }), /redirect-aware/);
});
