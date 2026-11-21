import { Hono } from "@hono/hono";
import type { Innertube } from "youtubei";
import { TtlCache } from "./src/cache.ts";
import { type AppConfig, loadConfig } from "./src/config.ts";
import { DOCS_HTML } from "./src/docs.ts";
import { BadInputError, HttpError, NotFoundError, RateLimitError } from "./src/errors.ts";
import {
  classifyUpstreamError,
  createFetcher,
  getClient,
  getPlayerClient,
  resolveChannelId,
  withRetry,
  withTimeout,
  YOUTUBEI_VERSION,
} from "./src/innertube.ts";
import {
  type ChannelResponse,
  type CommentItem,
  type FormatItem,
  mapChannel,
  mapComment,
  mapPlaylist,
  mapSearchResult,
  mapVideo,
  type PlaylistResponse,
  type SearchResultItem,
  type VideoResponse,
} from "./src/mappers.ts";
import { createApiKeyMiddleware, createRateLimitMiddleware } from "./src/middleware.ts";
import {
  fetchTranscript,
  toJson,
  toSrt,
  toTxt,
  toVtt,
  type TranscriptResponse,
} from "./src/transcripts.ts";
import {
  asArray,
  asRecord,
  type ChannelInput,
  clampLimit,
  parseChannelInput,
  parsePlaylistId,
  parseVideoId,
} from "./src/utils.ts";

export const SERVICE_NAME = "VexoStream YouTube Scraper";
export const SERVICE_VERSION = "2.0.0";

const SEARCH_TYPES = new Set(["video", "channel", "playlist"]);
const SEARCH_SORTS = new Set(["relevance", "date", "views", "rating"]);
const DOWNLOAD_FORMATS = new Set(["srt", "vtt", "txt", "json"]);

const SORT_TO_INNERTUBE: Record<string, "relevance" | "upload_date" | "view_count" | "rating"> = {
  relevance: "relevance",
  date: "upload_date",
  views: "view_count",
  rating: "rating",
};

export interface ScraperService {
  getVideo(videoId: string): Promise<VideoResponse>;
  getFormats(
    videoId: string,
  ): Promise<{ video_id: string; title: string; format_count: number; formats: FormatItem[] }>;
  search(
    query: string,
    type: "video" | "channel" | "playlist",
    sort: "relevance" | "date" | "views" | "rating",
    limit: number,
  ): Promise<{
    query: string;
    type: string;
    sort: string;
    count: number;
    results: SearchResultItem[];
  }>;
  getChannel(input: ChannelInput, limit: number): Promise<ChannelResponse>;
  getPlaylist(playlistId: string, limit: number): Promise<PlaylistResponse>;
  getComments(
    videoId: string,
    limit: number,
    repliesLimit: number,
    repliesAll: boolean,
  ): Promise<{ video_id: string; count: number; comments: CommentItem[] }>;
  getTranscript(videoId: string, lang: string): Promise<TranscriptResponse>;
}

export function createLiveService(config: AppConfig, cache: TtlCache): ScraperService {
  const fetcher = createFetcher(config.ytProxy);
  const run = <T>(entity: string, task: () => Promise<T>): Promise<T> =>
    withTimeout(() => withRetry(task), config.requestTimeoutMs).catch((err) => {
      throw classifyUpstreamError(err, entity);
    });

  async function fetchVideoInfo(videoId: string): Promise<{ yt: Innertube; raw: unknown }> {
    const yt = await getPlayerClient(config.ytProxy);
    const raw = await yt.getInfo(videoId);
    const rec = asRecord(raw);
    const basic = asRecord(rec?.basic_info);
    const playability = asRecord(rec?.playability_status);
    const status = typeof playability?.status === "string" ? playability.status : "";
    if (status === "ERROR" || (!basic?.title && !basic?.id)) {
      throw new NotFoundError(`Video "${videoId}" not found or unavailable`);
    }
    return { yt, raw };
  }

  return {
    getVideo(videoId) {
      return cache.wrap(`video:${videoId}`, config.cacheTtl, () =>
        run(`video ${videoId}`, async () => {
          const { raw } = await fetchVideoInfo(videoId);
          return mapVideo(raw);
        }));
    },

    async getFormats(videoId) {
      const video = await this.getVideo(videoId);
      return {
        video_id: video.id || videoId,
        title: video.title,
        format_count: video.formats.length,
        formats: video.formats,
      };
    },

    search(query, type, sort, limit) {
      const key = `search:${type}:${sort}:${limit}:${query.toLowerCase()}`;
      return cache.wrap(key, config.cacheTtl, () =>
        run(`search "${query}"`, async () => {
          const yt = await getClient(config.ytProxy);
          let page = await yt.search(query, {
            type,
            sort_by: SORT_TO_INNERTUBE[sort],
          });

          const collected: SearchResultItem[] = [];
          const pushResults = (rawList: unknown[]) => {
            for (const item of rawList) {
              if (collected.length >= limit) break;
              const mapped = mapSearchResult(item, type);
              if (mapped && mapped.type === type) {
                collected.push(mapped);
              }
            }
          };

          pushResults(asArray(asRecord(page)?.results));
          while (collected.length < limit && page.has_continuation) {
            page = await page.getContinuation();
            pushResults(asArray(asRecord(page)?.results));
          }

          return {
            query,
            type,
            sort,
            count: collected.length,
            results: collected,
          };
        }));
    },

    getChannel(input, limit) {
      const key = `channel:${input.kind}:${input.value.toLowerCase()}:${limit}`;
      return cache.wrap(key, config.cacheTtl, () =>
        run(`channel "${input.value}"`, async () => {
          const yt = await getClient(config.ytProxy);
          const channelId = await resolveChannelId(yt, input, cache, fetcher);
          const channel = await yt.getChannel(channelId);

          const rawVideos: unknown[] = [];
          try {
            let videosTab = await channel.getVideos();
            rawVideos.push(...asArray(asRecord(videosTab)?.videos));
            while (rawVideos.length < limit && videosTab.has_continuation) {
              videosTab = await videosTab.getContinuation();
              rawVideos.push(...asArray(asRecord(videosTab)?.videos));
            }
          } catch {
            // Some channels have no Videos tab; fall back to any videos on the landing response.
            rawVideos.push(...asArray(asRecord(channel)?.videos));
          }

          return mapChannel(channel, rawVideos.slice(0, limit), channelId);
        }));
    },

    getPlaylist(playlistId, limit) {
      const key = `playlist:${playlistId}:${limit}`;
      return cache.wrap(key, config.cacheTtl, () =>
        run(`playlist ${playlistId}`, async () => {
          const yt = await getClient(config.ytProxy);
          let playlist = await yt.getPlaylist(playlistId);
          const items: unknown[] = [...asArray(asRecord(playlist)?.items ?? asRecord(playlist)?.videos)];

          while (items.length < limit && playlist.has_continuation) {
            playlist = await playlist.getContinuation();
            items.push(...asArray(asRecord(playlist)?.items ?? asRecord(playlist)?.videos));
          }

          return mapPlaylist(playlist, items.slice(0, limit), playlistId);
        }));
    },

    getComments(videoId, limit, repliesLimit, repliesAll) {
      const key = `comments:${videoId}:${limit}:${repliesLimit}:${repliesAll}`;
      return cache.wrap(key, config.cacheTtl, () =>
        run(`comments for ${videoId}`, async () => {
          const yt = await getClient(config.ytProxy);
          let feed = await yt.getComments(videoId);
          const threads: unknown[] = [...asArray(asRecord(feed)?.contents)];

          while (threads.length < limit && feed.has_continuation) {
            feed = await feed.getContinuation();
            threads.push(...asArray(asRecord(feed)?.contents));
          }

          const selected = threads.slice(0, limit);
          const comments: CommentItem[] = [];

          for (const thread of selected) {
            const replies: CommentItem[] = [];
            const wantsReplies = repliesAll || repliesLimit > 0;
            const threadRec = asRecord(thread);
            const hasGetReplies = typeof threadRec?.getReplies === "function";
            const hasReplies = Boolean(threadRec?.has_replies ?? asRecord(threadRec?.comment)?.reply_count);

            if (wantsReplies && hasGetReplies && hasReplies) {
              try {
                const getRepliesFn = threadRec.getReplies as () => Promise<Record<string, unknown>>;
                let replyFeed = await getRepliesFn.call(thread);
                const rawReplies: unknown[] = [...asArray(replyFeed?.contents)];

                while (
                  (repliesAll || rawReplies.length < repliesLimit) &&
                  Boolean(replyFeed?.has_continuation) &&
                  typeof replyFeed?.getContinuation === "function"
                ) {
                  const contFn = replyFeed.getContinuation as () => Promise<Record<string, unknown>>;
                  replyFeed = await contFn.call(replyFeed);
                  rawReplies.push(...asArray(replyFeed?.contents));
                }

                const capped = repliesAll ? rawReplies : rawReplies.slice(0, repliesLimit);
                for (const rep of capped) {
                  replies.push(mapComment(rep));
                }
              } catch {
                // Keep top-level comment even if reply pagination fails.
              }
            }

            comments.push(mapComment(thread, replies));
          }

          return {
            video_id: videoId,
            count: comments.length,
            comments,
          };
        }));
    },

    getTranscript(videoId, lang) {
      const key = `transcript:${videoId}:${lang.toLowerCase()}`;
      return cache.wrap(key, config.cacheTtl, () =>
        run(`transcript for ${videoId}`, async () => {
          const { yt, raw } = await fetchVideoInfo(videoId);
          return await fetchTranscript(yt, raw, videoId, lang, fetcher);
        }));
    },
  };
}

export interface CreateAppOptions {
  config?: Partial<AppConfig>;
  service?: ScraperService;
}

export function createApp(options: CreateAppOptions = {}): Hono {
  const baseConfig: AppConfig = {
    ...loadConfig(),
    ...options.config,
  };
  const cache = new TtlCache(baseConfig.cacheTtl, 2048);
  const service = options.service ?? createLiveService(baseConfig, cache);

  const app = new Hono();

  app.use("*", createRateLimitMiddleware(baseConfig.rateLimitPerMin));
  app.use("*", createApiKeyMiddleware(baseConfig.apiKey));

  app.get("/", (c) =>
    c.json({
      name: SERVICE_NAME,
      version: SERVICE_VERSION,
      docs: "/docs",
      endpoints: [
        "GET /health",
        "GET /video?url=",
        "GET /formats?url=",
        "GET /search?q=&type=video&limit=10&sort=relevance",
        "GET /channel?url=&limit=10",
        "GET /playlist?url=&limit=50",
        "GET /comments?url=&limit=20&replies=0&replies_all=false",
        "GET /transcript?url=&lang=en",
        "GET /download?url=&lang=en&format=srt|vtt|txt|json",
        "GET /docs",
      ],
    }));

  // Instant liveness probe — intentionally never touches the network.
  app.get("/health", (c) => c.json({ status: "ok", youtubei: YOUTUBEI_VERSION }));

  app.get("/docs", (c) => c.html(DOCS_HTML));

  app.get("/video", async (c) => {
    const videoId = parseVideoId(c.req.query("url") ?? "");
    const data = await service.getVideo(videoId);
    return c.json(data);
  });

  app.get("/formats", async (c) => {
    const videoId = parseVideoId(c.req.query("url") ?? "");
    const data = await service.getFormats(videoId);
    return c.json(data);
  });

  app.get("/search", async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    if (!q) throw new BadInputError("Missing search query parameter 'q'");

    const rawType = (c.req.query("type") ?? "video").trim().toLowerCase();
    if (!SEARCH_TYPES.has(rawType)) {
      throw new BadInputError("Invalid 'type': expected video, channel, or playlist");
    }

    const rawSort = (c.req.query("sort") ?? "relevance").trim().toLowerCase();
    if (!SEARCH_SORTS.has(rawSort)) {
      throw new BadInputError("Invalid 'sort': expected relevance, date, views, or rating");
    }

    const limit = clampLimit(c.req.query("limit"), 10, 50);
    const data = await service.search(
      q,
      rawType as "video" | "channel" | "playlist",
      rawSort as "relevance" | "date" | "views" | "rating",
      limit,
    );
    return c.json(data);
  });

  app.get("/channel", async (c) => {
    const input = parseChannelInput(c.req.query("url") ?? "");
    const limit = clampLimit(c.req.query("limit"), 10, 50);
    const data = await service.getChannel(input, limit);
    return c.json(data);
  });

  app.get("/playlist", async (c) => {
    const playlistId = parsePlaylistId(c.req.query("url") ?? "");
    const limit = clampLimit(c.req.query("limit"), 50, 200);
    const data = await service.getPlaylist(playlistId, limit);
    return c.json(data);
  });

  app.get("/comments", async (c) => {
    const videoId = parseVideoId(c.req.query("url") ?? "");
    const limit = clampLimit(c.req.query("limit"), 20, 100);
    const repliesLimit = clampLimit(c.req.query("replies"), 0, 50, 0);
    const repliesAll = (c.req.query("replies_all") ?? "false").trim().toLowerCase() === "true";
    const data = await service.getComments(videoId, limit, repliesLimit, repliesAll);
    return c.json(data);
  });

  app.get("/transcript", async (c) => {
    const videoId = parseVideoId(c.req.query("url") ?? "");
    const lang = (c.req.query("lang") ?? "en").trim() || "en";
    const data = await service.getTranscript(videoId, lang);
    return c.json(data);
  });

  app.get("/download", async (c) => {
    const videoId = parseVideoId(c.req.query("url") ?? "");
    const lang = (c.req.query("lang") ?? "en").trim() || "en";
    const fmt = (c.req.query("format") ?? "vtt").trim().toLowerCase();
    if (!DOWNLOAD_FORMATS.has(fmt)) {
      throw new BadInputError("Invalid 'format': expected srt, vtt, txt, or json");
    }

    const transcript = await service.getTranscript(videoId, lang);
    const safeLang = (transcript.language || lang).replace(/[^A-Za-z0-9_-]/g, "");
    const filename = `${videoId}.${safeLang}.${fmt}`;

    let body: string;
    let contentType: string;
    switch (fmt) {
      case "srt":
        body = toSrt(transcript.segments);
        contentType = "application/x-subrip; charset=utf-8";
        break;
      case "txt":
        body = toTxt(transcript.segments);
        contentType = "text/plain; charset=utf-8";
        break;
      case "json":
        body = toJson(transcript);
        contentType = "application/json; charset=utf-8";
        break;
      default:
        body = toVtt(transcript.segments);
        contentType = "text/vtt; charset=utf-8";
        break;
    }

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  });

  app.notFound((c) => c.json({ error: "Endpoint not found" }, 404));

  app.onError((err, c) => {
    if (err instanceof RateLimitError) {
      c.header("Retry-After", String(err.retryAfter));
      return c.json({ error: err.message }, 429);
    }
    if (err instanceof HttpError) {
      return c.json({ error: err.message }, err.status as 400 | 401 | 404 | 429 | 502 | 504);
    }
    console.error("[unhandled-error]", err);
    return c.json({ error: "Internal server error" }, 500);
  });

  return app;
}

if (import.meta.main) {
  const config = loadConfig();
  const app = createApp({ config });
  Deno.serve({ port: config.port }, app.fetch);
}
