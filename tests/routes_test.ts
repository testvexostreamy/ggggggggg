import assert from "node:assert/strict";
import { createApp, type ScraperService } from "../main.ts";
import { NotFoundError } from "../src/errors.ts";
import { mapVideo } from "../src/mappers.ts";
import videoFixture from "./fixtures/video_info.json" with { type: "json" };

function createMockService(): ScraperService {
  const mappedVideo = mapVideo(videoFixture);
  return {
    async getVideo(videoId) {
      if (videoId === "00000000000") throw new NotFoundError("Video not found");
      return { ...mappedVideo, id: videoId };
    },
    async getFormats(videoId) {
      return {
        video_id: videoId,
        title: mappedVideo.title,
        format_count: mappedVideo.formats.length,
        formats: mappedVideo.formats,
      };
    },
    async search(query, type, sort) {
      return { query, type, sort, count: 0, results: [] };
    },
    async getChannel(input) {
      return {
        id: input.kind === "id" ? input.value : "UCuAXFkgsw1L7xaCfnd5JJOw",
        url: "https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw",
        title: "Rick Astley",
        handle: "@RickAstleyYT",
        description: "",
        subscriber_count: 4_200_000,
        subscriber_text: "4.2M subscribers",
        video_count: 215,
        avatar: "",
        thumbnails: [],
        banners: [],
        verified: true,
        links: [],
        joined_date: "",
        country: "",
        videos: [],
      };
    },
    async getPlaylist(playlistId) {
      return {
        id: playlistId,
        url: `https://www.youtube.com/playlist?list=${playlistId}`,
        title: "Popular Music Videos",
        author: "YouTube",
        description: "",
        video_count: 0,
        view_count: 0,
        last_updated: "",
        thumbnails: [],
        thumbnail: "",
        videos: [],
      };
    },
    async getComments(videoId) {
      return { video_id: videoId, count: 0, comments: [] };
    },
    async getTranscript(videoId, lang) {
      return {
        video_id: videoId,
        title: mappedVideo.title,
        language: lang,
        language_name: "English",
        is_auto_generated: false,
        source: "manual",
        segment_count: 1,
        segments: [{ start: 1, duration: 2, end: 3, text: "Hello world" }],
        text: "Hello world",
      };
    },
  };
}

Deno.test("route contracts: /health, /video bad input 400, 404, and /download headers", async () => {
  const app = createApp({
    config: { apiKey: "", rateLimitPerMin: 0, cacheTtl: 0 },
    service: createMockService(),
  });

  const healthRes = await app.request("/health");
  assert.equal(healthRes.status, 200);
  const health = await healthRes.json();
  assert.equal(health.status, "ok");

  const badVideo = await app.request("/video?url=bad");
  assert.equal(badVideo.status, 400);
  const badBody = await badVideo.json();
  assert.equal(typeof badBody.error, "string");

  const missingVideo = await app.request("/video?url=00000000000");
  assert.equal(missingVideo.status, 404);

  const okVideo = await app.request("/video?url=dQw4w9WgXcQ");
  assert.equal(okVideo.status, 200);
  const videoBody = await okVideo.json();
  assert.equal(videoBody.id, "dQw4w9WgXcQ");

  const dl = await app.request("/download?url=dQw4w9WgXcQ&lang=en&format=vtt");
  assert.equal(dl.status, 200);
  assert.ok(dl.headers.get("content-disposition")?.includes("attachment;"));
  const vtt = await dl.text();
  assert.ok(vtt.startsWith("WEBVTT"));

  const docs = await app.request("/docs");
  assert.equal(docs.status, 200);
  assert.ok((await docs.text()).includes("VexoStream YouTube Scraper"));
});
