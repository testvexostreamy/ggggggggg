# VexoStream YouTube Scraper

Self-hosted REST API for extracting public YouTube metadata and captions **anonymously** with Deno, TypeScript, Hono, and `youtubei.js`.

- **No login, no OAuth, no cookies, no session files.** Every request uses an anonymous in-memory InnerTube session.
- **Full format metadata.** Returns every available video and audio-only `itag` with mime type, container, codecs, resolution, fps, bitrate, audio quality, channels, and content length.
- **Metadata and captions only.** There is no media download endpoint.

## Framework Note (Hono instead of Warp)

There is no Warp web framework for Deno (`warp` on npm is the ScaleDynamics container SDK, `@deco/warp` on JSR is a tunnel, `@geeksquad/warp` is a SQLite engine, and the real Warp framework is Rust-only). This service uses **[Hono](https://jsr.io/@hono/hono)** (`jsr:@hono/hono@^4`), the standard lightweight web framework for Deno.

## One-Step Railway Deploy

Push this repository to GitHub and connect it to Railway. `railway.json` and `Dockerfile` handle building, caching dependencies, binding `$PORT`, and health-checking `/health` with zero manual dashboard setup (env vars are optional).

## Local Run

With Python (installs Deno automatically if missing, caches deps, and starts the server):

```bash
python setup.py
```

Or directly with Deno:

```bash
deno task cache
deno task start
```

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8000` | HTTP server port (set automatically by Railway) |
| `API_KEY` | *(unset)* | Optional API key enforced via `X-API-Key` header or `?key=` |
| `RATE_LIMIT_PER_MIN` | `60` | Per-IP fixed-window requests/minute (`0` disables) |
| `CACHE_TTL` | `300` | In-memory cache TTL in seconds (`0` disables) |
| `REQUEST_TIMEOUT` | `45` | Upstream YouTube request timeout in seconds |
| `YT_PROXY` | *(unset)* | Optional HTTP/HTTPS/SOCKS5 egress proxy URL passed to `Deno.createHttpClient` |

**Proxy & cloud IP note:** `YT_PROXY` routes both `youtubei.js` InnerTube requests and direct caption/handle fetches through Deno's native `Deno.createHttpClient({ proxy })` client. Some cloud-provider datacenter IPs are bot-checked by YouTube; if you encounter upstream blocks on a cloud host, route traffic through a proxy-capable host via `YT_PROXY` rather than using cookies or authenticated sessions.

## Endpoints

| Method & Path | Query Parameters | Description |
| --- | --- | --- |
| `GET /` | — | Service info and endpoint list |
| `GET /health` | — | Instant liveness check (`{status, youtubei}`), no network call |
| `GET /video` | `url` (URL or 11-char ID) | Full video metadata, all `formats[]`, `captions[]`, `related[]` |
| `GET /formats` | `url` | Complete list of video and audio-only format itags |
| `GET /search` | `q`, `type=video\|channel\|playlist`, `limit=10`, `sort=relevance\|date\|views\|rating` | Search YouTube |
| `GET /channel` | `url` (`@handle`, `UC…`, or URL), `limit=10` (max 50) | Channel metadata and latest videos |
| `GET /playlist` | `url` (URL or playlist ID), `limit=50` | Playlist metadata and paginated videos |
| `GET /comments` | `url`, `limit=20`, `replies=0`, `replies_all=false` | Top-level comments and optional replies |
| `GET /transcript` | `url`, `lang=en` | Parsed transcript segments and joined full text |
| `GET /download` | `url`, `lang=en`, `format=srt\|vtt\|txt\|json` | Download captions as an attachment |
| `GET /docs` | — | HTML documentation page |

## Example Requests

```bash
curl -s "http://localhost:8000/health"
curl -s "http://localhost:8000/video?url=dQw4w9WgXcQ"
curl -s "http://localhost:8000/formats?url=dQw4w9WgXcQ"
curl -s "http://localhost:8000/search?q=lo-fi&limit=3"
curl -s "http://localhost:8000/channel?url=@RickAstleyYT&limit=3"
curl -s "http://localhost:8000/playlist?url=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI&limit=3"
curl -s "http://localhost:8000/comments?url=dQw4w9WgXcQ&limit=3"
curl -s "http://localhost:8000/transcript?url=dQw4w9WgXcQ&lang=en"
curl -s "http://localhost:8000/download?url=dQw4w9WgXcQ&format=vtt" -o captions.vtt
```

## Testing

```bash
deno check main.ts
deno fmt --check
deno test
```

## Compliance Notice

Scraping YouTube may violate YouTube's Terms of Service. The deployer is solely responsible for legal compliance, respecting rate limits, and honoring copyright and content ownership rights.
