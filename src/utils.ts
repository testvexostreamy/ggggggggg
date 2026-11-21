import { BadInputError } from "./errors.ts";

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const HANDLE_RE = /^@?[A-Za-z0-9._-]{2,60}$/;
const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{10,64}$/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

export type ChannelInput = { kind: "id" | "handle"; value: string };

export function asRecord(v: unknown): Record<string, unknown> | null {
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/,/g, "").trim();
    if (cleaned !== "") {
      const n = Number(cleaned);
      if (Number.isFinite(n)) return n;
    }
  }
  return fallback;
}

export function asBool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/**
 * Normalize youtubei.js Text / RichText / TextRun / string values to a plain string.
 * Always returns "" for null, undefined, or non-text values so mappers never throw.
 */
export function text(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    return v.map((item) => text(item)).filter(Boolean).join(" ").trim();
  }
  const rec = asRecord(v);
  if (!rec) return "";

  if (typeof rec.text === "string") return rec.text.trim();
  if (typeof rec.simpleText === "string") return rec.simpleText.trim();
  if (typeof rec.content === "string") return rec.content.trim();
  if (Array.isArray(rec.runs)) {
    return rec.runs
      .map((run) => {
        const r = asRecord(run);
        return r && typeof r.text === "string" ? r.text : text(run);
      })
      .join("")
      .trim();
  }
  if (typeof rec.toString === "function" && rec.toString !== Object.prototype.toString) {
    const rendered = String(rec.toString());
    if (rendered !== "[object Object]" && rendered !== "N/A") {
      return rendered.trim();
    }
  }
  return "";
}

function tryParseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    if (/^(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(raw)) {
      try {
        return new URL(`https://${raw}`);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function assertYouTubeHost(url: URL): void {
  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) {
    throw new BadInputError(`Unsupported host "${url.hostname}": expected a YouTube URL`);
  }
}

export function parseVideoId(input: string): string {
  const raw = input.trim();
  if (!raw) throw new BadInputError("Missing video url or id");

  if (VIDEO_ID_RE.test(raw)) return raw;

  const parsed = tryParseUrl(raw);
  if (!parsed) {
    throw new BadInputError("Invalid YouTube video URL or 11-character video id");
  }
  assertYouTubeHost(parsed);

  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split("/").filter(Boolean);
  let candidate = "";

  if (host === "youtu.be" || host === "www.youtu.be") {
    candidate = segments[0] ?? "";
  } else if (parsed.pathname === "/watch" || segments[0] === "watch") {
    candidate = parsed.searchParams.get("v") ?? "";
  } else if (
    segments[0] === "shorts" ||
    segments[0] === "embed" ||
    segments[0] === "live" ||
    segments[0] === "v"
  ) {
    candidate = segments[1] ?? "";
  } else {
    candidate = parsed.searchParams.get("v") ?? "";
  }

  if (!VIDEO_ID_RE.test(candidate)) {
    throw new BadInputError("Could not extract a valid 11-character YouTube video id");
  }
  return candidate;
}

export function parseChannelInput(input: string): ChannelInput {
  const raw = input.trim();
  if (!raw) throw new BadInputError("Missing channel url, handle, or id");

  if (CHANNEL_ID_RE.test(raw)) {
    return { kind: "id", value: raw };
  }

  const parsed = tryParseUrl(raw);
  if (parsed) {
    assertYouTubeHost(parsed);
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length === 0) {
      throw new BadInputError("YouTube channel URL is missing a channel id or handle");
    }

    if (segments[0] === "channel" && segments[1] && CHANNEL_ID_RE.test(segments[1])) {
      return { kind: "id", value: segments[1] };
    }
    if (segments[0].startsWith("@")) {
      const handle = segments[0].slice(1);
      if (HANDLE_RE.test(handle)) {
        return { kind: "handle", value: handle };
      }
    }
    if ((segments[0] === "c" || segments[0] === "user") && segments[1]) {
      return { kind: "handle", value: segments[1] };
    }
    throw new BadInputError("Unsupported YouTube channel URL format");
  }

  if (raw.includes("/") || raw.includes("://") || raw.includes(" ")) {
    throw new BadInputError("Invalid YouTube channel identifier");
  }

  const cleaned = raw.startsWith("@") ? raw.slice(1) : raw;
  if (!HANDLE_RE.test(cleaned)) {
    throw new BadInputError("Invalid YouTube channel handle or UC id");
  }
  return { kind: "handle", value: cleaned };
}

export function parsePlaylistId(input: string): string {
  const raw = input.trim();
  if (!raw) throw new BadInputError("Missing playlist url or id");

  if (PLAYLIST_ID_RE.test(raw) && !raw.includes(".")) {
    return raw;
  }

  const parsed = tryParseUrl(raw);
  if (!parsed) {
    throw new BadInputError("Invalid YouTube playlist URL or id");
  }
  assertYouTubeHost(parsed);

  const list = parsed.searchParams.get("list") ?? "";
  if (!PLAYLIST_ID_RE.test(list)) {
    throw new BadInputError("Could not extract a valid YouTube playlist id");
  }
  return list;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const secStr = String(secs).padStart(2, "0");
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${secStr}`;
  }
  return `${mins}:${secStr}`;
}

export function parseDurationText(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  const parts = trimmed.split(":").map((p) => Number.parseInt(p, 10));
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

export function parseHumanCount(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  const raw = text(v);
  if (!raw) return 0;
  const match = raw.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([KMB])?/i);
  if (!match) return 0;
  const num = Number.parseFloat(match[1]);
  if (!Number.isFinite(num)) return 0;
  const suffix = (match[2] ?? "").toUpperCase();
  const mult = suffix === "K" ? 1_000 : suffix === "M" ? 1_000_000 : suffix === "B" ? 1_000_000_000 : 1;
  return Math.round(num * mult);
}

export function clampLimit(
  raw: string | undefined | null,
  fallback: number,
  max: number,
  min = 1,
): number {
  if (raw === undefined || raw === null || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
