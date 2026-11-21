import assert from "node:assert/strict";
import { Hono } from "@hono/hono";
import { createApiKeyMiddleware, createRateLimitMiddleware } from "../src/middleware.ts";

Deno.test("rate limit middleware returns 429 with Retry-After on third request when limit is 2", async () => {
  const app = new Hono();
  app.use("*", createRateLimitMiddleware(2, 60_000));
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/ping", (c) => c.json({ pong: true }));

  const headers = { "x-forwarded-for": "203.0.113.10" };
  assert.equal((await app.request("/ping", { headers })).status, 200);
  assert.equal((await app.request("/ping", { headers })).status, 200);

  const third = await app.request("/ping", { headers });
  assert.equal(third.status, 429);
  assert.ok(Number(third.headers.get("retry-after")) >= 1);

  // /health is always exempt
  assert.equal((await app.request("/health", { headers })).status, 200);
});

Deno.test("API key middleware enforces key when set and skips when unset", async () => {
  const protectedApp = new Hono();
  protectedApp.use("*", createApiKeyMiddleware("super-secret"));
  protectedApp.get("/health", (c) => c.json({ status: "ok" }));
  protectedApp.get("/video", (c) => c.json({ ok: true }));

  assert.equal((await protectedApp.request("/video")).status, 401);
  assert.equal(
    (await protectedApp.request("/video", { headers: { "x-api-key": "wrong" } })).status,
    401,
  );
  assert.equal(
    (await protectedApp.request("/video", { headers: { "x-api-key": "super-secret" } })).status,
    200,
  );
  assert.equal((await protectedApp.request("/video?key=super-secret")).status, 200);
  assert.equal((await protectedApp.request("/health")).status, 200);

  const openApp = new Hono();
  openApp.use("*", createApiKeyMiddleware(""));
  openApp.get("/video", (c) => c.json({ ok: true }));
  assert.equal((await openApp.request("/video")).status, 200);
});
