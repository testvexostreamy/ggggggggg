import assert from "node:assert/strict";
import { parseJson3, parseSrt, parseVtt, toSrt, toTxt, toVtt } from "../src/transcripts.ts";

Deno.test("parseJson3 drops newline-only events and deduplicates rolling ASR cues", () => {
  const sample = {
    events: [
      { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "\n" }] },
      { tStartMs: 1000, dDurationMs: 2500, segs: [{ utf8: "Never gonna " }, { utf8: "give you up" }] },
      { tStartMs: 1000, dDurationMs: 2500, segs: [{ utf8: "Never gonna give you up" }] },
      { tStartMs: 4000, dDurationMs: 2000, segs: [{ utf8: "Never gonna let you down" }] },
    ],
  };

  const segments = parseJson3(sample);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments[0], {
    start: 1,
    duration: 2.5,
    end: 3.5,
    text: "Never gonna give you up",
  });
  assert.deepEqual(segments[1], {
    start: 4,
    duration: 2,
    end: 6,
    text: "Never gonna let you down",
  });
});

Deno.test("parseVtt strips <c>/<b> tags and decodes HTML entities", () => {
  const vtt = `WEBVTT
Kind: captions
Language: en

00:00:01.000 --> 00:00:03.500 align:start position:0%
<c>Hello</c> <b>world</b> &amp; friends

00:00:04.000 --> 00:00:06.000
Second <i>line</i> &#39;ok&#39;
`;
  const segments = parseVtt(vtt);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].text, "Hello world & friends");
  assert.equal(segments[1].text, "Second line 'ok'");
});

Deno.test("parseSrt decodes entities and handles comma decimal timestamps", () => {
  const srt = `1
00:00:01,250 --> 00:00:03,750
Tom &amp; Jerry

2
00:00:04,000 --> 00:00:05,500
Done
`;
  const segments = parseSrt(srt);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].start, 1.25);
  assert.equal(segments[0].end, 3.75);
  assert.equal(segments[0].text, "Tom & Jerry");
});

Deno.test("toVtt, toSrt, and toTxt produce byte-exact output for two-segment fixture", () => {
  const fixture = [
    { start: 1.25, duration: 2.5, end: 3.75, text: "First line" },
    { start: 65.5, duration: 1.5, end: 67, text: "Second line" },
  ];

  assert.equal(
    toVtt(fixture),
    "WEBVTT\n\n00:00:01.250 --> 00:00:03.750\nFirst line\n\n00:01:05.500 --> 00:01:07.000\nSecond line\n",
  );
  assert.equal(
    toSrt(fixture),
    "1\n00:00:01,250 --> 00:00:03,750\nFirst line\n\n2\n00:01:05,500 --> 00:01:07,000\nSecond line\n",
  );
  assert.equal(toTxt(fixture), "First line\nSecond line");
});
