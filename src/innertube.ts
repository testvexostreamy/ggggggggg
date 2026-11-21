import { Innertube } from "youtubei";
import { TtlCache } from "./cache.ts";
import { HttpError, NotFoundError, TimeoutError, UpstreamError } from "./errors.ts";
import { asRecord, ChannelInput } from "./utils.ts";

export const YOUTUBEI_VERSION = "18.3.0";
const HANDLE_CACHE_TTL_SECONDS = 86_400; // 24 hours
const RETRY_BACKOFF_MS = 300;
const CHANNEL_ID_RE = /UC[A-Za-z0-9_-]{22}/;

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

let proxyHttpClient: Deno.HttpClient | null = null;
let cachedProxyUrl = "";

function buildProxyClient(proxyUrl: string): Deno.HttpClient | null {
  if (!proxyUrl) return null;
  if (proxyHttpClient && cachedProxyUrl === proxyUrl) return proxyHttpClient;

  try {
    const parsed = new URL(proxyUrl);
    const hasAuth = parsed.username !== "" || parsed.password !== "";
    const basicAuth = hasAuth
      ? {
        username: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
      }
      : undefined;
    parsed.username = "";
    parsed.password = "";

    proxyHttpClient = Deno.createHttpClient({
      proxy: {
        url: parsed.toString(),
        ...(basicAuth ? { basicAuth } : {}),
      },
    });
    cachedProxyUrl = proxyUrl;
    return proxyHttpClient;
  } catch {
    return null;
  }
}

export function createFetcher(proxyUrl = ""): FetchLike {
  const client = buildProxyClient(proxyUrl);
  if (!client) {
    return (input, init) => fetch(input, init);
  }
  return (input, init) =>
    fetch(input, {
      ...init,
      client,
    } as RequestInit & { client: Deno.HttpClient });
}

let baseClientPromise: Promise<Innertube> | null = null;
let playerClientPromise: Promise<Innertube> | null = null;

export function getClient(proxyUrl = ""): Promise<Innertube> {
  if (!baseClientPromise) {
    const customFetch = createFetcher(proxyUrl);
    // Anonymous in-memory session only — no login, cookies, or persisted state.
    baseClientPromise = Innertube.create({
      retrieve_player: false,
      generate_session_locally: true,
      fetch: customFetch,
    }).catch((err) => {
      baseClientPromise = null;
      throw err;
    });
  }
  return baseClientPromise;
}

export function getPlayerClient(proxyUrl = ""): Promise<Innertube> {
  if (!playerClientPromise) {
    const customFetch = createFetcher(proxyUrl);
    // retrieve_player: true is needed for streaming formats and timed-text caption URLs.
    playerClientPromise = Innertube.create({
      retrieve_player: true,
      generate_session_locally: true,
      fetch: customFetch,
    }).catch((err) => {
      playerClientPromise = null;
      throw err;
    });
  }
  return playerClientPromise;
}

export async function withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  let timer: number | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(`Request timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
  });

  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function getErrorStatus(err: unknown): number | null {
  const rec = asRecord(err);
  if (!rec) return null;
  if (typeof rec.status_code === "number") return rec.status_code;
  if (typeof rec.status === "number") return rec.status;
  const info = asRecord(rec.info);
  if (info && typeof info.status_code === "number") return info.status_code;
  const msg = err instanceof Error ? err.message : "";
  const match = msg.match(/status(?:\s+code)?\s+(\d{3})/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof HttpError) return false;
  const status = getErrorStatus(err);
  if (status !== null) {
    return status >= 500;
  }
  // Transient network errors (connection reset, DNS glitch, unexpected EOF)
  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  return (
    msg.includes("network") ||
    msg.includes("econnreset") ||
    msg.includes("timed out") ||
    msg.includes("socket") ||
    msg.includes("fetch failed") ||
    msg.includes("error sending request")
  );
}

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isRetryableError(err)) throw err;
    await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));
    return await fn();
  }
}

export function classifyUpstreamError(err: unknown, entityName: string): HttpError {
  if (err instanceof HttpError) return err;

  const status = getErrorStatus(err);
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (
    status === 404 ||
    lower.includes("not found") ||
    lower.includes("does not exist") ||
    lower.includes("video unavailable") ||
    lower.includes("this video isn't available") ||
    lower.includes("invalid video id") ||
    lower.includes("channel does not exist") ||
    lower.includes("playlist does not exist") ||
    lower.includes("invalid playlist")
  ) {
    return new NotFoundError(`${entityName} not found`);
  }

  if (lower.includes("timed out") || lower.includes("timeout")) {
    return new TimeoutError(`Upstream YouTube request timed out while fetching ${entityName}`);
  }

  return new UpstreamError(`Failed to fetch ${entityName} from YouTube`);
}

function extractBrowseId(obj: unknown): string | null {
  const rec = asRecord(obj);
  if (!rec) return null;

  const payload = asRecord(rec.payload);
  const payloadEndpoint = asRecord(payload?.browseEndpoint);
  if (typeof payloadEndpoint?.browseId === "string" && CHANNEL_ID_RE.test(payloadEndpoint.browseId)) {
    return payloadEndpoint.browseId;
  }
  if (typeof payload?.browseId === "string" && CHANNEL_ID_RE.test(payload.browseId)) {
    return payload.browseId;
  }

  const data = asRecord(rec.data);
  const endpoint = asRecord(data?.endpoint ?? rec.endpoint);
  const browseEndpoint = asRecord(endpoint?.browseEndpoint);
  if (typeof browseEndpoint?.browseId === "string" && CHANNEL_ID_RE.test(browseEndpoint.browseId)) {
    return browseEndpoint.browseId;
  }

  return null;
}

/**
 * Resolve a channel handle (@handle) to its canonical UC... browseId.
 * Required because Innertube's /browse endpoint returns HTTP 400 when given a raw @handle URL.
 */
export async function resolveChannelId(
  yt: Innertube,
  input: ChannelInput,
  cache: TtlCache,
  fetcher: FetchLike = fetch,
): Promise<string> {
  if (input.kind === "id") return input.value;

  const normalizedHandle = input.value.replace(/^@/, "").toLowerCase();
  const cacheKey = `handle:${normalizedHandle}`;
  const cached = cache.get<string>(cacheKey);
  if (cached) return cached;

  const handleUrl = `https://www.youtube.com/@${encodeURIComponent(input.value.replace(/^@/, ""))}`;

  // Strategy 1: youtubei.js resolveURL
  try {
    const resolved = await yt.resolveURL(handleUrl);
    const id = extractBrowseId(resolved);
    if (id) {
      cache.set(cacheKey, id, HANDLE_CACHE_TTL_SECONDS);
      return id;
    }
  } catch {
    // Fall through to Strategy 2
  }

  // Strategy 2: direct /navigation/resolve_url action
  try {
    const res = await yt.actions.execute("/navigation/resolve_url", { url: handleUrl });
    const id = extractBrowseId(res);
    if (id) {
      cache.set(cacheKey, id, HANDLE_CACHE_TTL_SECONDS);
      return id;
    }
  } catch {
    // Fall through to Strategy 3
  }

  // Strategy 3: fetch public channel page HTML and extract UC id
  try {
    const resp = await fetcher(handleUrl, {
      headers: {
        "accept-language": "en-US,en;q=0.9",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
    });
    if (resp.status === 404) {
      throw new NotFoundError(`Channel "@${input.value}" not found`);
    }
    if (resp.ok) {
      const html = await resp.text();
      const patterns = [
        /\/channel\/(UC[\w-]{22})/,
        /"externalId"\s*:\s*"(UC[\w-]{22})"/,
        /"browseId"\s*:\s*"(UC[\w-]{22})"/,
      ];
      for (const re of patterns) {
        const match = html.match(re);
        if (match?.[1]) {
          cache.set(cacheKey, match[1], HANDLE_CACHE_TTL_SECONDS);
          return match[1];
        }
      }
    }
  } catch (err) {
    if (err instanceof NotFoundError) throw err;
  }

  throw new NotFoundError(`Could not resolve YouTube channel "@${input.value}"`);
}
