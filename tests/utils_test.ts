import assert from "node:assert/strict";
import { BadInputError } from "../src/errors.ts";
import {
  clampLimit,
  formatDuration,
  parseChannelInput,
  parsePlaylistId,
  parseVideoId,
  text,
} from "../src/utils.ts";

Deno.test("parseVideoId accepts all valid YouTube URL forms and bare IDs", () => {
  const cases = [
    "dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL1234567890",
    "https://youtu.be/dQw4w9WgXcQ?si=abcdef",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ?feature=share",
  ];
  for (const input of cases) {
    assert.equal(parseVideoId(input), "dQw4w9WgXcQ", `Failed for ${input}`);
  }
});

Deno.test("parseVideoId rejects non-YouTube hosts, short IDs, and empty strings", () => {
  const invalid = [
    "",
    "   ",
    "dQw4w9WgXc", // 10 chars
    "dQw4w9WgXcQ1", // 12 chars
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://evil-youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=short",
    "not a valid id at all",
  ];
  for (const input of invalid) {
    assert.throws(() => parseVideoId(input), BadInputError, `Expected error for "${input}"`);
  }
});

Deno.test("parseChannelInput handles UC IDs, @handles, bare handles, and URLs", () => {
  assert.deepEqual(parseChannelInput("UCuAXFkgsw1L7xaCfnd5JJOw"), {
    kind: "id",
    value: "UCuAXFkgsw1L7xaCfnd5JJOw",
  });
  assert.deepEqual(
    parseChannelInput("https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw"),
    { kind: "id", value: "UCuAXFkgsw1L7xaCfnd5JJOw" },
  );
  assert.deepEqual(parseChannelInput("@RickAstleyYT"), {
    kind: "handle",
    value: "RickAstleyYT",
  });
  assert.deepEqual(parseChannelInput("RickAstleyYT"), {
    kind: "handle",
    value: "RickAstleyYT",
  });
  assert.deepEqual(parseChannelInput("https://www.youtube.com/@RickAstleyYT/videos"), {
    kind: "handle",
    value: "RickAstleyYT",
  });
  assert.throws(() => parseChannelInput(""), BadInputError);
  assert.throws(() => parseChannelInput("https://example.com/@RickAstleyYT"), BadInputError);
});

Deno.test("parsePlaylistId handles bare IDs and watch/playlist URLs", () => {
  assert.equal(
    parsePlaylistId("PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI"),
    "PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI",
  );
  assert.equal(
    parsePlaylistId(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI",
    ),
    "PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI",
  );
  assert.equal(
    parsePlaylistId("https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI"),
    "PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI",
  );
  assert.throws(() => parsePlaylistId(""), BadInputError);
  assert.throws(
    () => parsePlaylistId("https://example.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI"),
    BadInputError,
  );
});

Deno.test("formatDuration, text, and clampLimit work safely", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(59), "0:59");
  assert.equal(formatDuration(3661), "1:01:01");

  assert.equal(text(null), "");
  assert.equal(text(undefined), "");
  assert.equal(text({ text: "hello" }), "hello");
  assert.equal(text({ runs: [{ text: "foo " }, { text: "bar" }] }), "foo bar");

  assert.equal(clampLimit(undefined, 10, 50), 10);
  assert.equal(clampLimit("999", 10, 50), 50);
  assert.equal(clampLimit("0", 10, 50), 1);
  assert.equal(clampLimit("0", 0, 50, 0), 0);
});
