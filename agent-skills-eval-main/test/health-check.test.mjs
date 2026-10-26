import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { OpenAICompatibleProvider } from "../dist/openai-compatible-provider.js";

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}/v1`, server);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("health check authenticates against the models endpoint and returns latency", async () => {
  await withServer((req, res) => {
    assert.equal(req.url, "/v1/models");
    assert.equal(req.headers.authorization, "Bearer secret-key");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [] }));
  }, async (baseUrl) => {
    const provider = new OpenAICompatibleProvider({
      baseUrl,
      apiKey: "secret-key",
      model: "test-model",
      providerName: "test-provider",
    });
    const result = await provider.checkHealth();
    assert.equal(result.status, "healthy");
    assert.equal(result.statusCode, 200);
    assert.equal(result.provider, "test-provider");
    assert.equal(result.model, "test-model");
    assert.ok(result.latencyMs >= 0);
    assert.ok(!JSON.stringify(result).includes("secret-key"));
  });
});

test("health check reports HTTP failures without returning response bodies", async () => {
  await withServer((_req, res) => {
    res.writeHead(401);
    res.end("sensitive upstream response");
  }, async (baseUrl) => {
    const result = await new OpenAICompatibleProvider({ baseUrl, apiKey: "bad-key" }).checkHealth();
    assert.equal(result.status, "unhealthy");
    assert.equal(result.statusCode, 401);
    assert.equal(result.error, "Endpoint returned HTTP 401");
    assert.ok(!JSON.stringify(result).includes("sensitive"));
  });
});

test("health check timeout returns an unhealthy result", async () => {
  await withServer(() => {}, async (baseUrl) => {
    const result = await new OpenAICompatibleProvider({
      baseUrl,
      apiKey: "test-key",
      timeoutMs: 20,
    }).checkHealth();
    assert.equal(result.status, "unhealthy");
    assert.match(result.error, /abort/i);
  });
});

test("provider rejects invalid timeout and retry configuration", () => {
  assert.throws(
    () => new OpenAICompatibleProvider({ baseUrl: "http://localhost/v1", apiKey: "key", timeoutMs: 0 }),
    /timeoutMs must be a positive finite number/,
  );
  assert.throws(
    () => new OpenAICompatibleProvider({
      baseUrl: "http://localhost/v1",
      apiKey: "key",
      retry: { attempts: 0 },
    }),
    /retry.attempts must be a positive integer/,
  );
});
