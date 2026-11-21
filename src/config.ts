export interface AppConfig {
  port: number;
  apiKey: string;
  rateLimitPerMin: number;
  cacheTtl: number;
  requestTimeoutMs: number;
  ytProxy: string;
}

function readInt(name: string, fallback: number, min = 0): number {
  const raw = Deno.env.get(name);
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return parsed;
}

export function loadConfig(): AppConfig {
  return {
    port: readInt("PORT", 8000, 1),
    apiKey: (Deno.env.get("API_KEY") ?? "").trim(),
    rateLimitPerMin: readInt("RATE_LIMIT_PER_MIN", 60, 0),
    cacheTtl: readInt("CACHE_TTL", 300, 0),
    requestTimeoutMs: readInt("REQUEST_TIMEOUT", 45, 1) * 1000,
    ytProxy: (Deno.env.get("YT_PROXY") ?? "").trim(),
  };
}
