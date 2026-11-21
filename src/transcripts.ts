import type { Innertube } from "youtubei";
import { NotFoundError, UpstreamError } from "./errors.ts";
import type { FetchLike } from "./innertube.ts";
import { extractRawCaptionTracks, mapCaptionTrack } from "./mappers.ts";
import { asArray, asNumber, asRecord, text } from "./utils.ts";

export interface TranscriptSegment {
  start: number;
  duration: number;
  end: number;
  text: string;
}

export interface TranscriptResponse {
  video_id: string;
  title: string;
  language: string;
  language_name: string;
  is_auto_generated: boolean;
  source: "manual" | "automatic";
  segment_count: number;
  segments: TranscriptSegment[];
  text: string;
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

export function cleanCaptionText(raw: string): string {
  // Strip WebVTT/SRT formatting tags (<c>, <b>, <i>, <00:00:01.000>, etc.)
  let out = raw.replace(/<[^>]+>/g, "");
  out = out.replace(
    /&(?:amp|lt|gt|quot|apos|nbsp|#39);/gi,
    (m) => HTML_ENTITIES[m.toLowerCase()] ?? m,
  );
  out = out.replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number.parseInt(code, 10)));
  out = out.replace(/&#x([0-9a-f]+);/gi, (_m, hex) =>
    String.fromCodePoint(Number.parseInt(hex, 16)));
  return out.replace(/\s+/g, " ").trim();
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function dedupeSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const result: TranscriptSegment[] = [];
  for (const seg of segments) {
    if (!seg.text) continue;
    const prev = result[result.length - 1];
    // ASR json3 frequently emits duplicate cues at the same timestamp or rolling duplicates.
    if (prev && prev.text === seg.text && Math.abs(prev.start - seg.start) < 0.05) {
      continue;
    }
    if (prev && prev.text === seg.text && seg.start <= prev.end + 0.05) {
      prev.end = Math.max(prev.end, seg.end);
      prev.duration = round3(Math.max(0, prev.end - prev.start));
      continue;
    }
    result.push(seg);
  }
  return result;
}

export function parseJson3(data: unknown): TranscriptSegment[] {
  const rec = asRecord(data);
  const events = asArray(rec?.events);
  const segments: TranscriptSegment[] = [];

  for (const item of events) {
    const ev = asRecord(item);
    if (!ev) continue;
    const segs = asArray(ev.segs);
    if (segs.length === 0) continue;

    const rawText = segs
      .map((s) => {
        const sr = asRecord(s);
        return typeof sr?.utf8 === "string" ? sr.utf8 : "";
      })
      .join("");

    // Drop zero-length ASR events whose text is only whitespace/newlines.
    const cleaned = cleanCaptionText(rawText);
    if (!cleaned) continue;

    const startMs = asNumber(ev.tStartMs, 0);
    const durMs = Math.max(0, asNumber(ev.dDurationMs, 0));
    const start = round3(startMs / 1000);
    const duration = round3(durMs / 1000);
    const end = round3(start + duration);

    segments.push({ start, duration, end, text: cleaned });
  }

  return dedupeSegments(segments);
}

function parseTimestamp(ts: string): number {
  const cleaned = ts.trim().replace(",", ".");
  const parts = cleaned.split(":");
  if (parts.length === 3) {
    const h = Number.parseFloat(parts[0]);
    const m = Number.parseFloat(parts[1]);
    const s = Number.parseFloat(parts[2]);
    return round3(h * 3600 + m * 60 + s);
  }
  if (parts.length === 2) {
    const m = Number.parseFloat(parts[0]);
    const s = Number.parseFloat(parts[1]);
    return round3(m * 60 + s);
  }
  return 0;
}

export function parseVtt(raw: string): TranscriptSegment[] {
  const normalized = raw.replace(/\r\n?/g, "\n");
  const blocks = normalized.split(/\n{2,}/);
  const segments: TranscriptSegment[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    if (lines[0].startsWith("WEBVTT") || lines[0].startsWith("NOTE") || lines[0].startsWith("STYLE")) {
      continue;
    }

    const timingIdx = lines.findIndex((l) => l.includes("-->"));
    if (timingIdx === -1) continue;

    const match = lines[timingIdx].match(
      /(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3})/,
    );
    if (!match) continue;

    const start = parseTimestamp(match[1]);
    const end = parseTimestamp(match[2]);
    const duration = round3(Math.max(0, end - start));
    const body = cleanCaptionText(lines.slice(timingIdx + 1).join(" "));
    if (!body) continue;

    segments.push({ start, duration, end, text: body });
  }

  return dedupeSegments(segments);
}

export function parseSrt(raw: string): TranscriptSegment[] {
  return parseVtt(raw);
}

export function parseXmlTimedText(raw: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const regex = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(raw)) !== null) {
    const attrs = match[1];
    const startMatch = attrs.match(/\bstart="([^"]+)"/i);
    const durMatch = attrs.match(/\bdur="([^"]+)"/i);
    const start = round3(Number.parseFloat(startMatch?.[1] ?? "0") || 0);
    const duration = round3(Number.parseFloat(durMatch?.[1] ?? "0") || 0);
    const end = round3(start + duration);
    const cleaned = cleanCaptionText(match[2]);
    if (!cleaned) continue;
    segments.push({ start, duration, end, text: cleaned });
  }

  return dedupeSegments(segments);
}

function formatCueTime(seconds: number, decimalSep: "." | ","): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hrs = Math.floor(totalMs / 3_600_000);
  const mins = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${
    String(secs).padStart(2, "0")
  }${decimalSep}${String(ms).padStart(3, "0")}`;
}

export function toVtt(segments: TranscriptSegment[]): string {
  const cues = segments.map((s) =>
    `${formatCueTime(s.start, ".")} --> ${formatCueTime(s.end, ".")}\n${s.text}`
  );
  return cues.length > 0 ? `WEBVTT\n\n${cues.join("\n\n")}\n` : "WEBVTT\n";
}

export function toSrt(segments: TranscriptSegment[]): string {
  const cues = segments.map((s, idx) =>
    `${idx + 1}\n${formatCueTime(s.start, ",")} --> ${formatCueTime(s.end, ",")}\n${s.text}`
  );
  return cues.length > 0 ? `${cues.join("\n\n")}\n` : "";
}

export function toTxt(segments: TranscriptSegment[]): string {
  return segments.map((s) => s.text).join("\n");
}

export function toJson(transcript: TranscriptResponse): string {
  return JSON.stringify(transcript, null, 2);
}

function appendQueryParam(url: string, key: string, value: string): string {
  // Timed-text base_url already contains query params, so append with `&` when `?` is present.
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

let loggedTranscriptPanelError = false;

async function fallbackTranscriptPanel(
  yt: Innertube,
  info: Record<string, unknown>,
): Promise<TranscriptSegment[]> {
  const panels = asArray(info.engagement_panels);
  let params = "";
  for (const p of panels) {
    const pr = asRecord(p);
    const id = text(pr?.panel_identifier);
    if (!id.toLowerCase().includes("transcript")) continue;
    const content = asRecord(pr?.content);
    const continuation = asRecord(content?.continuation);
    const endpoint = asRecord(continuation?.endpoint);
    const payload = asRecord(endpoint?.payload);
    if (typeof payload?.params === "string" && payload.params) {
      params = payload.params;
      break;
    }
  }
  if (!params) return [];

  try {
    const res = await yt.actions.execute("/get_transcript", { params });
    const data = asRecord(res?.data);
    const actions = asArray(data?.actions);
    const segments: TranscriptSegment[] = [];
    for (const act of actions) {
      const panel = asRecord(asRecord(act)?.updateEngagementPanelAction);
      const body = asRecord(asRecord(asRecord(panel?.content)?.transcriptRenderer)?.content);
      const list = asRecord(asRecord(body?.transcriptSearchPanelRenderer)?.body);
      const initialSegments = asArray(
        asRecord(list?.transcriptSegmentListRenderer)?.initialSegments,
      );
      for (const item of initialSegments) {
        const seg = asRecord(asRecord(item)?.transcriptSegmentRenderer);
        if (!seg) continue;
        const startMs = asNumber(seg.startMs, 0);
        const endMs = asNumber(seg.endMs, startMs);
        const cleaned = cleanCaptionText(text(seg.snippet));
        if (!cleaned) continue;
        segments.push({
          start: round3(startMs / 1000),
          duration: round3(Math.max(0, endMs - startMs) / 1000),
          end: round3(endMs / 1000),
          text: cleaned,
        });
      }
    }
    return dedupeSegments(segments);
  } catch (err) {
    if (!loggedTranscriptPanelError) {
      loggedTranscriptPanelError = true;
      console.error("[transcript-fallback] /get_transcript raw error:", err);
    }
    return [];
  }
}

export async function fetchTranscript(
  yt: Innertube,
  rawInfo: unknown,
  videoId: string,
  lang = "en",
  fetcher: FetchLike = fetch,
): Promise<TranscriptResponse> {
  const info = asRecord(rawInfo) ?? {};
  const basic = asRecord(info.basic_info) ?? {};
  const title = text(basic.title);
  const rawTracks = extractRawCaptionTracks(info);

  if (rawTracks.length === 0) {
    // Try engagement panel fallback before concluding no captions exist.
    const fallbackSegs = await fallbackTranscriptPanel(yt, info);
    if (fallbackSegs.length === 0) {
      throw new NotFoundError("This video has no captions");
    }
    return {
      video_id: videoId,
      title,
      language: lang,
      language_name: lang,
      is_auto_generated: true,
      source: "automatic",
      segment_count: fallbackSegs.length,
      segments: fallbackSegs,
      text: fallbackSegs.map((s) => s.text).join(" "),
    };
  }

  const tracks = rawTracks.map(mapCaptionTrack).filter((t) => Boolean(t.url));
  if (tracks.length === 0) {
    throw new NotFoundError("This video has no captions");
  }

  const normalizedLang = lang.trim().toLowerCase();
  const track =
    tracks.find((t) => t.language_code.toLowerCase() === normalizedLang && !t.is_auto_generated) ??
    tracks.find((t) => t.language_code.toLowerCase() === normalizedLang) ??
    tracks.find((t) =>
      t.language_code.toLowerCase().startsWith(normalizedLang) && !t.is_auto_generated
    ) ??
    tracks.find((t) => t.language_code.toLowerCase().startsWith(normalizedLang)) ??
    tracks.find((t) => !t.is_auto_generated) ??
    tracks[0];

  let segments: TranscriptSegment[] = [];

  // Primary fix (§7.1): fetch timed-text directly as json3 instead of calling getTranscript().
  try {
    const json3Url = appendQueryParam(track.url, "fmt", "json3");
    const res = await fetcher(json3Url);
    if (res.ok) {
      const bodyText = await res.text();
      if (bodyText.trim().startsWith("{")) {
        segments = parseJson3(JSON.parse(bodyText));
      }
    }
  } catch {
    // Fall through to VTT / XML fallback
  }

  // Fallback B: fetch VTT or raw timedtext XML when json3 is unavailable or empty.
  if (segments.length === 0) {
    for (const candidateUrl of [appendQueryParam(track.url, "fmt", "vtt"), track.url]) {
      try {
        const res = await fetcher(candidateUrl);
        if (!res.ok) continue;
        const body = await res.text();
        if (!body.trim()) continue;
        if (body.trimStart().startsWith("WEBVTT") || body.includes("-->")) {
          segments = parseVtt(body);
        } else if (body.includes("<text")) {
          segments = parseXmlTimedText(body);
        }
        if (segments.length > 0) break;
      } catch {
        // Try next candidate
      }
    }
  }

  // Fallback A: engagement panel /get_transcript
  if (segments.length === 0) {
    segments = await fallbackTranscriptPanel(yt, info);
  }

  if (segments.length === 0) {
    throw new UpstreamError("Caption track was found but could not be parsed from YouTube");
  }

  return {
    video_id: videoId,
    title,
    language: track.language_code || lang,
    language_name: track.name || track.language_code || lang,
    is_auto_generated: track.is_auto_generated,
    source: track.is_auto_generated ? "automatic" : "manual",
    segment_count: segments.length,
    segments,
    text: segments.map((s) => s.text).join(" "),
  };
}
