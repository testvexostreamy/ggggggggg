import type { MiddlewareHandler } from "@hono/hono";

const EXEMPT_PATHS = new Set(["/", "/health", "/docs"]);

interface WindowBucket {
  count: number;
  resetAt: number;
}

export function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}

export function createRateLimitMiddleware(
  limitPerMin: number,
  windowMs = 60_000,
): MiddlewareHandler {
  const buckets = new Map<string, WindowBucket>();

  return async (c, next) => {
    if (limitPerMin <= 0 || EXEMPT_PATHS.has(c.req.path)) {
      await next();
      return;
    }

    const now = Date.now();
    const ip = getClientIp(c.req.raw);
    let bucket = buckets.get(ip);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(ip, bucket);
      // Periodically prune expired buckets to bound memory.
      if (buckets.size > 4096) {
        for (const [key, b] of buckets) {
          if (now >= b.resetAt) buckets.delete(key);
        }
      }
    }

    bucket.count += 1;
    if (bucket.count > limitPerMin) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    await next();
  };
}

export function createApiKeyMiddleware(apiKey: string): MiddlewareHandler {
  const expected = apiKey.trim();

  return async (c, next) => {
    if (!expected || EXEMPT_PATHS.has(c.req.path)) {
      await next();
      return;
    }

    const provided = (c.req.header("x-api-key") ?? c.req.query("key") ?? "").trim();
    if (!provided || !constantTimeEqual(provided, expected)) {
      return c.json({ error: "Invalid or missing API key" }, 401);
    }

    await next();
  };
}
