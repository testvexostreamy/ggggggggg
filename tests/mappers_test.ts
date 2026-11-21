import assert from "node:assert/strict";
import { mapChannel, mapComment, mapVideo } from "../src/mappers.ts";
import channelC4Fixture from "./fixtures/channel_c4_header.json" with { type: "json" };
import channelPageFixture from "./fixtures/channel_page_header.json" with { type: "json" };
import commentsFixture from "./fixtures/comments.json" with { type: "json" };
import videoFixture from "./fixtures/video_info.json" with { type: "json" };

function assertNoUndefined(obj: unknown, path = "root"): void {
  assert.notEqual(obj, undefined, `Unexpected undefined at ${path}`);
  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => assertNoUndefined(item, `${path}[${idx}]`));
  } else if (typeof obj === "object" && obj !== null) {
    for (const [k, v] of Object.entries(obj)) {
      assertNoUndefined(v, `${path}.${k}`);
    }
  }
}

Deno.test("mapVideo maps full video metadata, sorted formats, captions, and related without undefined", () => {
  const mapped = mapVideo(videoFixture);
  assertNoUndefined(mapped);

  assert.equal(mapped.id, "dQw4w9WgXcQ");
  assert.equal(mapped.duration, "3:33");
  assert.equal(mapped.channel.handle, "@RickAstleyYT");
  assert.equal(mapped.channel.verified, true);
  assert.equal(mapped.formats.length, 3);
  // Video formats sorted by height desc (1080p before 360p), then audio-only (itag 251)
  assert.deepEqual(mapped.formats.map((f) => f.itag), [137, 18, 251]);
  assert.equal(mapped.formats[0].codecs.video, "avc1.640028");
  assert.equal(mapped.formats[1].codecs.audio, "mp4a.40.2");
  assert.equal(mapped.formats[2].has_video, false);
  assert.equal(mapped.formats[2].has_audio, true);
  assert.equal(mapped.captions.length, 2);
  assert.equal(mapped.captions[0].is_auto_generated, false);
  assert.equal(mapped.captions[1].is_auto_generated, true);
  assert.equal(mapped.related.length, 1);
});

Deno.test("mapChannel handles both PageHeader and C4TabbedHeader layouts", () => {
  const pageMapped = mapChannel(channelPageFixture, [], "UCuAXFkgsw1L7xaCfnd5JJOw");
  assertNoUndefined(pageMapped);
  assert.equal(pageMapped.title, "Rick Astley");
  assert.equal(pageMapped.handle, "@RickAstleyYT");
  assert.equal(pageMapped.subscriber_count, 4_200_000);
  assert.equal(pageMapped.video_count, 215);
  assert.equal(pageMapped.verified, true);
  assert.equal(pageMapped.avatar, "https://yt3.ggpht.com/page-avatar.jpg");
  assert.equal(pageMapped.banners[0], "https://yt3.ggpht.com/page-banner.jpg");

  const c4Mapped = mapChannel(channelC4Fixture, [], "UCuAXFkgsw1L7xaCfnd5JJOw");
  assertNoUndefined(c4Mapped);
  assert.equal(c4Mapped.title, "Rick Astley");
  assert.equal(c4Mapped.subscriber_count, 4_200_000);
  assert.equal(c4Mapped.verified, true);
  assert.equal(c4Mapped.avatar, "https://yt3.ggpht.com/c4-avatar.jpg");
});

Deno.test("mapComment handles CommentThread and CommentView safely without undefined", () => {
  const first = mapComment(commentsFixture[0]);
  assertNoUndefined(first);
  assert.equal(first.id, "Ugw123456");
  assert.equal(first.author, "@musicfan");
  assert.equal(first.text, "Still an absolute classic!");
  assert.equal(first.like_count, 12_000);
  assert.equal(first.reply_count, 42);
  assert.equal(first.is_pinned, true);
  assert.equal(first.is_hearted, true);

  const second = mapComment(commentsFixture[1]);
  assertNoUndefined(second);
  assert.equal(second.id, "Ugw999999");
  assert.equal(second.text, "Never gonna let you down");
  assert.equal(second.is_uploader, true);
});
