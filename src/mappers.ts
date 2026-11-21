import {
  asArray,
  asBool,
  asNumber,
  asRecord,
  formatDuration,
  parseDurationText,
  parseHumanCount,
  text,
} from "./utils.ts";

export interface ThumbnailItem {
  url: string;
  width: number;
  height: number;
}

export interface ChapterItem {
  title: string;
  start_seconds: number;
  end_seconds: number;
}

export interface FormatItem {
  itag: number;
  mime_type: string;
  container: string;
  codecs: { video: string; audio: string };
  quality_label: string;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  average_bitrate: number;
  audio_quality: string;
  audio_channels: number;
  audio_sample_rate: number;
  content_length: number;
  url: string;
  has_video: boolean;
  has_audio: boolean;
  is_hls: boolean;
}

export interface CaptionItem {
  language_code: string;
  name: string;
  is_auto_generated: boolean;
  url: string;
}

export interface RelatedVideoItem {
  id: string;
  url: string;
  title: string;
  author: string;
  duration_seconds: number;
  duration: string;
  view_count: number;
  thumbnails: ThumbnailItem[];
  thumbnail: string;
}

export interface VideoResponse {
  id: string;
  url: string;
  title: string;
  description: string;
  duration_seconds: number;
  duration: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  category: string;
  tags: string[];
  keywords: string[];
  is_live: boolean;
  is_private: boolean;
  is_unlisted: boolean;
  is_family_safe: boolean;
  upload_date: string | null;
  publish_date: string | null;
  channel: {
    id: string;
    name: string;
    handle: string;
    url: string;
    thumbnail: string;
    subscriber_count: number;
    verified: boolean;
  };
  thumbnails: ThumbnailItem[];
  thumbnail: string;
  chapters: ChapterItem[];
  formats: FormatItem[];
  captions: CaptionItem[];
  related: RelatedVideoItem[];
}

export interface SearchResultItem {
  type: string;
  id: string;
  url: string;
  title: string;
  author: {
    name: string;
    id: string;
    url: string;
    thumbnail: string;
    verified: boolean;
  };
  duration_seconds: number;
  duration: string;
  view_count: number;
  published_time: string;
  thumbnails: ThumbnailItem[];
  thumbnail: string;
  description: string;
}

export interface ChannelVideoItem {
  id: string;
  url: string;
  title: string;
  duration_seconds: number;
  duration: string;
  view_count: number;
  published_time: string;
  thumbnails: ThumbnailItem[];
  thumbnail: string;
}

export interface ChannelResponse {
  id: string;
  url: string;
  title: string;
  handle: string;
  description: string;
  subscriber_count: number;
  subscriber_text: string;
  video_count: number;
  avatar: string;
  thumbnails: ThumbnailItem[];
  banners: string[];
  verified: boolean;
  links: { title: string; url: string }[];
  joined_date: string;
  country: string;
  videos: ChannelVideoItem[];
}

export interface PlaylistVideoItem {
  index: number;
  id: string;
  url: string;
  title: string;
  author: string;
  duration_seconds: number;
  duration: string;
  view_count: number;
  thumbnails: ThumbnailItem[];
  thumbnail: string;
}

export interface PlaylistResponse {
  id: string;
  url: string;
  title: string;
  author: string;
  description: string;
  video_count: number;
  view_count: number;
  last_updated: string;
  thumbnails: ThumbnailItem[];
  thumbnail: string;
  videos: PlaylistVideoItem[];
}

export interface CommentItem {
  id: string;
  author: string;
  author_id: string;
  author_url: string;
  author_thumbnail: string;
  text: string;
  published_time: string;
  like_count: number;
  reply_count: number;
  is_pinned: boolean;
  is_uploader: boolean;
  is_hearted: boolean;
  replies: CommentItem[];
}

export function mapThumbnails(raw: unknown): ThumbnailItem[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else {
    const rec = asRecord(raw);
    if (rec) {
      if (Array.isArray(rec.thumbnails)) list = rec.thumbnails;
      else if (Array.isArray(rec.sources)) list = rec.sources;
      else if (Array.isArray(rec.image)) list = rec.image;
      else if (asRecord(rec.image) && Array.isArray(asRecord(rec.image)?.sources)) {
        list = asArray(asRecord(rec.image)?.sources);
      }
    }
  }

  return list
    .map((item): ThumbnailItem | null => {
      const r = asRecord(item);
      if (!r || typeof r.url !== "string" || !r.url) return null;
      const url = r.url.startsWith("//") ? `https:${r.url}` : r.url;
      return {
        url,
        width: asNumber(r.width, 0),
        height: asNumber(r.height, 0),
      };
    })
    .filter((t): t is ThumbnailItem => t !== null);
}

function bestThumbnail(thumbnails: ThumbnailItem[]): string {
  if (thumbnails.length === 0) return "";
  const sorted = [...thumbnails].sort((a, b) => b.width - a.width);
  return sorted[0].url;
}

function parseMimeAndCodecs(
  mimeRaw: string,
  hasVideo: boolean,
  hasAudio: boolean,
): { mime_type: string; container: string; video: string; audio: string } {
  const [basePart = "", ...rest] = mimeRaw.split(";");
  const mimeType = basePart.trim();
  const container = mimeType.includes("/") ? mimeType.split("/")[1].trim() : "";

  const codecMatch = rest.join(";").match(/codecs="([^"]+)"/i);
  const codecs = codecMatch
    ? codecMatch[1].split(",").map((c) => c.trim()).filter(Boolean)
    : [];

  let video = "";
  let audio = "";
  if (hasVideo && hasAudio && codecs.length >= 2) {
    video = codecs[0];
    audio = codecs[1];
  } else if (hasVideo && !hasAudio) {
    video = codecs[0] ?? "";
  } else if (!hasVideo && hasAudio) {
    audio = codecs[0] ?? "";
  } else if (codecs.length === 1) {
    if (mimeType.startsWith("audio/")) audio = codecs[0];
    else video = codecs[0];
  }

  return { mime_type: mimeType, container, video, audio };
}

export function mapFormat(raw: unknown): FormatItem {
  const r = asRecord(raw) ?? {};
  const mimeRaw = typeof r.mime_type === "string"
    ? r.mime_type
    : typeof r.mimeType === "string"
    ? r.mimeType
    : "";

  const width = asNumber(r.width, 0);
  const height = asNumber(r.height, 0);
  const hasVideo = typeof r.has_video === "boolean"
    ? r.has_video
    : mimeRaw.startsWith("video/") || width > 0 || height > 0;
  const hasAudio = typeof r.has_audio === "boolean"
    ? r.has_audio
    : mimeRaw.startsWith("audio/") ||
      Boolean(r.audio_quality ?? r.audioQuality ?? r.audio_channels ?? r.audioChannels);

  const parsed = parseMimeAndCodecs(mimeRaw, hasVideo, hasAudio);
  const url = typeof r.url === "string" ? r.url : "";
  const isHls = asBool(r.is_hls, false) || url.includes(".m3u8") || mimeRaw.includes("mpegurl");

  return {
    itag: asNumber(r.itag, 0),
    mime_type: parsed.mime_type,
    container: parsed.container,
    codecs: {
      video: parsed.video,
      audio: parsed.audio,
    },
    quality_label: text(r.quality_label ?? r.qualityLabel ?? r.quality),
    width,
    height,
    fps: asNumber(r.fps, 0),
    bitrate: asNumber(r.bitrate, 0),
    average_bitrate: asNumber(r.average_bitrate ?? r.averageBitrate ?? r.bitrate, 0),
    audio_quality: text(r.audio_quality ?? r.audioQuality),
    audio_channels: asNumber(r.audio_channels ?? r.audioChannels, 0),
    audio_sample_rate: asNumber(r.audio_sample_rate ?? r.audioSampleRate, 0),
    content_length: asNumber(r.content_length ?? r.contentLength, 0),
    url,
    has_video: hasVideo,
    has_audio: hasAudio,
    is_hls: isHls,
  };
}

export function mapFormats(streamingData: unknown): FormatItem[] {
  const sd = asRecord(streamingData);
  if (!sd) return [];
  const combined = [...asArray(sd.formats), ...asArray(sd.adaptive_formats)];
  const mapped = combined.map(mapFormat);

  // Video formats sorted by resolution desc (then fps/bitrate desc), followed by audio-only sorted by bitrate desc.
  return mapped.sort((a, b) => {
    if (a.has_video !== b.has_video) return a.has_video ? -1 : 1;
    if (a.has_video) {
      if (b.height !== a.height) return b.height - a.height;
      if (b.fps !== a.fps) return b.fps - a.fps;
      if (a.has_audio !== b.has_audio) return a.has_audio ? -1 : 1;
      return b.bitrate - a.bitrate;
    }
    return b.bitrate - a.bitrate;
  });
}

export function extractRawCaptionTracks(info: unknown): Record<string, unknown>[] {
  const rec = asRecord(info);
  if (!rec) return [];

  const directCaptions = asRecord(rec.captions);
  if (directCaptions && Array.isArray(directCaptions.caption_tracks)) {
    return directCaptions.caption_tracks
      .map(asRecord)
      .filter((t): t is Record<string, unknown> => t !== null);
  }

  const page = asArray(rec.page);
  const page0 = asRecord(page[0]);
  const page0Captions = asRecord(page0?.captions);
  if (page0Captions && Array.isArray(page0Captions.caption_tracks)) {
    return page0Captions.caption_tracks
      .map(asRecord)
      .filter((t): t is Record<string, unknown> => t !== null);
  }

  const playerResponse = asRecord(page0?.player_response ?? rec.player_response);
  const prCaptions = asRecord(playerResponse?.captions);
  const renderer = asRecord(prCaptions?.playerCaptionsTracklistRenderer);
  if (renderer && Array.isArray(renderer.captionTracks)) {
    return renderer.captionTracks
      .map(asRecord)
      .filter((t): t is Record<string, unknown> => t !== null);
  }

  return [];
}

export function mapCaptionTrack(raw: Record<string, unknown>): CaptionItem {
  const languageCode = text(raw.language_code ?? raw.languageCode);
  const name = text(raw.name) || languageCode;
  const kind = text(raw.kind).toLowerCase();
  const vssId = text(raw.vss_id ?? raw.vssId);
  const url = text(raw.base_url ?? raw.baseUrl);
  const isAuto = kind === "asr" || vssId.startsWith("a.");
  return {
    language_code: languageCode,
    name,
    is_auto_generated: isAuto,
    url,
  };
}

function mapChapters(info: Record<string, unknown>, durationSeconds: number): ChapterItem[] {
  const overlays = asRecord(info.player_overlays);
  const decoratedBar = asRecord(overlays?.decorated_player_bar);
  const playerBar = asRecord(decoratedBar?.player_bar);
  const markersMap = asArray(playerBar?.markers_map);

  let rawChapters: unknown[] = [];
  for (const entry of markersMap) {
    const e = asRecord(entry);
    const val = asRecord(e?.value);
    if (val && Array.isArray(val.chapters) && val.chapters.length > 0) {
      rawChapters = val.chapters;
      break;
    }
  }

  if (rawChapters.length === 0 && Array.isArray(info.chapters)) {
    rawChapters = info.chapters;
  }

  const items = rawChapters
    .map((ch) => {
      const r = asRecord(ch);
      if (!r) return null;
      const startMs = asNumber(r.time_range_start_millis ?? r.start_ms, -1);
      const startSeconds = startMs >= 0
        ? Math.floor(startMs / 1000)
        : asNumber(r.start_seconds, 0);
      return {
        title: text(r.title),
        start_seconds: startSeconds,
        end_seconds: asNumber(r.end_seconds, 0),
      };
    })
    .filter((c): c is ChapterItem => c !== null && c.title !== "");

  for (let i = 0; i < items.length; i++) {
    if (items[i].end_seconds <= items[i].start_seconds) {
      const nextStart = i + 1 < items.length ? items[i + 1].start_seconds : durationSeconds;
      items[i].end_seconds = Math.max(items[i].start_seconds, nextStart);
    }
  }
  return items;
}

function mapRelatedVideos(info: Record<string, unknown>): RelatedVideoItem[] {
  const feed = asArray(info.watch_next_feed ?? info.related);
  const results: RelatedVideoItem[] = [];

  for (const item of feed) {
    const r = asRecord(item);
    if (!r) continue;
    const id = text(r.id ?? r.video_id);
    if (!id) continue;
    const durObj = asRecord(r.duration);
    const durationSeconds = durObj
      ? asNumber(durObj.seconds, parseDurationText(text(durObj.text)))
      : asNumber(r.duration_seconds, parseDurationText(text(r.duration)));
    const thumbnails = mapThumbnails(r.thumbnails);
    const authorRec = asRecord(r.author);
    results.push({
      id,
      url: `https://www.youtube.com/watch?v=${id}`,
      title: text(r.title),
      author: authorRec ? text(authorRec.name) : text(r.author),
      duration_seconds: durationSeconds,
      duration: formatDuration(durationSeconds),
      view_count: parseHumanCount(r.view_count ?? r.short_view_count),
      thumbnails,
      thumbnail: bestThumbnail(thumbnails),
    });
    if (results.length >= 20) break;
  }
  return results;
}

export function mapVideo(raw: unknown): VideoResponse {
  const info = asRecord(raw) ?? {};
  const basic = asRecord(info.basic_info) ?? info;
  const primary = asRecord(info.primary_info);
  const secondary = asRecord(info.secondary_info);
  const owner = asRecord(secondary?.owner);
  const ownerAuthor = asRecord(owner?.author);

  const id = text(basic.id ?? info.id);
  const durationSeconds = asNumber(basic.duration, 0);
  const thumbnails = mapThumbnails(basic.thumbnail ?? basic.thumbnails);

  const channelId = text(basic.channel_id ?? ownerAuthor?.id);
  const channelName = text(basic.author ?? ownerAuthor?.name ?? asRecord(basic.channel)?.name);
  const channelUrlRaw = text(ownerAuthor?.url ?? asRecord(basic.channel)?.url);
  const channelUrl = channelUrlRaw || (channelId ? `https://www.youtube.com/channel/${channelId}` : "");
  const handleMatch = channelUrl.match(/@([A-Za-z0-9._-]+)/);
  const channelThumbs = mapThumbnails(ownerAuthor?.thumbnails ?? asRecord(basic.channel)?.thumbnails);

  const tags = asArray(basic.tags).map(text).filter(Boolean);
  const keywords = asArray(basic.keywords).map(text).filter(Boolean);

  const uploadDate = text(basic.upload_date) || text(primary?.published) || null;
  const publishDate = text(basic.publish_date) || uploadDate;

  const captions = extractRawCaptionTracks(info).map(mapCaptionTrack);
  const formats = mapFormats(info.streaming_data);

  return {
    id,
    url: id ? `https://www.youtube.com/watch?v=${id}` : "",
    title: text(basic.title ?? primary?.title),
    description: text(secondary?.description ?? basic.short_description ?? basic.description),
    duration_seconds: durationSeconds,
    duration: formatDuration(durationSeconds),
    view_count: asNumber(basic.view_count, parseHumanCount(primary?.view_count)),
    like_count: asNumber(basic.like_count, 0),
    comment_count: asNumber(basic.comment_count, 0),
    category: text(basic.category),
    tags,
    keywords,
    is_live: asBool(basic.is_live, false),
    is_private: asBool(basic.is_private, false),
    is_unlisted: asBool(basic.is_unlisted, false),
    is_family_safe: asBool(basic.is_family_safe, true),
    upload_date: uploadDate,
    publish_date: publishDate,
    channel: {
      id: channelId,
      name: channelName,
      handle: handleMatch ? `@${handleMatch[1]}` : "",
      url: channelUrl,
      thumbnail: bestThumbnail(channelThumbs),
      subscriber_count: parseHumanCount(owner?.subscriber_count),
      verified: asBool(ownerAuthor?.is_verified, false),
    },
    thumbnails,
    thumbnail: bestThumbnail(thumbnails),
    chapters: mapChapters(info, durationSeconds),
    formats,
    captions,
    related: mapRelatedVideos(info),
  };
}

export function mapSearchResult(raw: unknown, requestedType = "video"): SearchResultItem | null {
  const r = asRecord(raw);
  if (!r) return null;

  const rawType = text(r.type).toLowerCase();
  let kind = requestedType;
  if (rawType.includes("channel")) kind = "channel";
  else if (rawType.includes("playlist")) kind = "playlist";
  else if (rawType.includes("video") || rawType.includes("reel") || rawType.includes("short")) {
    kind = "video";
  }

  const authorRec = asRecord(r.author);
  const id = text(r.id ?? r.video_id ?? authorRec?.id);
  if (!id) return null;

  const url = kind === "channel"
    ? (text(authorRec?.url) || `https://www.youtube.com/channel/${id}`)
    : kind === "playlist"
    ? `https://www.youtube.com/playlist?list=${id}`
    : `https://www.youtube.com/watch?v=${id}`;

  const durObj = asRecord(r.duration);
  const durationSeconds = durObj
    ? asNumber(durObj.seconds, parseDurationText(text(durObj.text)))
    : asNumber(r.duration_seconds, parseDurationText(text(r.duration)));

  const thumbnails = mapThumbnails(r.thumbnails ?? authorRec?.thumbnails);
  const authorThumbs = mapThumbnails(authorRec?.thumbnails);
  const authorId = text(authorRec?.id);
  const authorUrl = text(authorRec?.url) ||
    (authorId ? `https://www.youtube.com/channel/${authorId}` : "");

  return {
    type: kind,
    id,
    url,
    title: text(r.title ?? authorRec?.name),
    author: {
      name: text(authorRec?.name),
      id: authorId,
      url: authorUrl,
      thumbnail: bestThumbnail(authorThumbs),
      verified: asBool(authorRec?.is_verified, false),
    },
    duration_seconds: durationSeconds,
    duration: formatDuration(durationSeconds),
    view_count: parseHumanCount(r.view_count ?? r.short_view_count),
    published_time: text(r.published ?? r.published_time),
    thumbnails,
    thumbnail: bestThumbnail(thumbnails),
    description: text(r.description_snippet ?? r.description ?? r.snippets),
  };
}

function extractPageHeaderMetadata(header: Record<string, unknown>): {
  title: string;
  handle: string;
  subscriberText: string;
  videoCount: number;
  avatarThumbs: ThumbnailItem[];
  bannerThumbs: ThumbnailItem[];
  verified: boolean;
  description: string;
  links: { title: string; url: string }[];
} {
  // youtubei.js v16-18 PageHeader wraps a PageHeaderView in header.content; C4TabbedHeader puts fields directly on header.
  const content = asRecord(header.content) ?? header;
  const titleObj = asRecord(content.title);
  const title = text(titleObj?.text ?? content.title ?? header.title ?? asRecord(header.author)?.name);

  let handle = "";
  let subscriberText = text(
    asRecord(header.subscribers)?.text ??
      header.subscribers ??
      asRecord(header.subscriber_count)?.text ??
      header.subscriber_count,
  );
  let videoCount = parseHumanCount(header.videos_count);

  const metaRec = asRecord(content.metadata);
  const rows = asArray(metaRec?.metadata_rows);
  for (const row of rows) {
    const rowRec = asRecord(row);
    for (const part of asArray(rowRec?.metadata_parts)) {
      const partText = text(asRecord(part)?.text ?? part);
      if (!partText) continue;
      if (partText.startsWith("@") && !handle) {
        handle = partText;
      } else if (/subscriber/i.test(partText) && !subscriberText) {
        subscriberText = partText;
      } else if (/video/i.test(partText) && videoCount === 0) {
        videoCount = parseHumanCount(partText);
      }
    }
  }

  const imageRec = asRecord(content.image);
  const avatarRec = asRecord(imageRec?.avatar);
  const avatarThumbs = mapThumbnails(
    avatarRec?.image ?? imageRec?.image ?? header.avatar ?? asRecord(header.author)?.thumbnails,
  );

  const bannerRec = asRecord(content.banner);
  const bannerThumbs = mapThumbnails(bannerRec?.image ?? header.banner);

  const verified = asBool(header.is_verified, false) ||
    asBool(asRecord(header.author)?.is_verified, false) ||
    asArray(titleObj?.attachment_runs).length > 0;

  const descRec = asRecord(content.description);
  const description = text(descRec?.content ?? content.description ?? header.description);

  const rawLinks = asArray(header.links);
  const links = rawLinks
    .map((item) => {
      const l = asRecord(item);
      if (!l) return null;
      const url = text(l.url ?? asRecord(l.endpoint)?.payload);
      const linkTitle = text(l.title ?? l.label) || url;
      return url ? { title: linkTitle, url } : null;
    })
    .filter((l): l is { title: string; url: string } => l !== null);

  return {
    title,
    handle,
    subscriberText,
    videoCount,
    avatarThumbs,
    bannerThumbs,
    verified,
    description,
    links,
  };
}

export function mapChannel(
  rawChannel: unknown,
  rawVideos: unknown[],
  fallbackId = "",
): ChannelResponse {
  const ch = asRecord(rawChannel) ?? {};
  const header = asRecord(ch.header) ?? {};
  const metadata = asRecord(ch.metadata) ?? {};
  const parsed = extractPageHeaderMetadata(header);

  const id = text(metadata.external_id ?? asRecord(header.author)?.id) || fallbackId;
  const vanityUrl = text(metadata.vanity_channel_url ?? metadata.url);
  const handleMatch = vanityUrl.match(/@([A-Za-z0-9._-]+)/);
  const handle = parsed.handle || (handleMatch ? `@${handleMatch[1]}` : "");

  const metaAvatars = mapThumbnails(metadata.avatar);
  const thumbnails = parsed.avatarThumbs.length > 0 ? parsed.avatarThumbs : metaAvatars;
  const banners = parsed.bannerThumbs.map((b) => b.url);

  const metaLinks = asArray(metadata.external_links).map((item) => {
    if (typeof item === "string") return { title: item, url: item };
    const r = asRecord(item);
    const url = text(r?.url);
    return url ? { title: text(r?.title) || url, url } : null;
  }).filter((l): l is { title: string; url: string } => l !== null);

  const videos: ChannelVideoItem[] = [];
  for (const item of rawVideos) {
    const r = asRecord(item);
    if (!r) continue;
    const vid = text(r.id ?? r.video_id);
    if (!vid) continue;
    const durObj = asRecord(r.duration);
    const durationSeconds = durObj
      ? asNumber(durObj.seconds, parseDurationText(text(durObj.text)))
      : asNumber(r.duration_seconds, parseDurationText(text(r.duration)));
    const vThumbs = mapThumbnails(r.thumbnails);
    videos.push({
      id: vid,
      url: `https://www.youtube.com/watch?v=${vid}`,
      title: text(r.title),
      duration_seconds: durationSeconds,
      duration: formatDuration(durationSeconds),
      view_count: parseHumanCount(r.view_count ?? r.short_view_count),
      published_time: text(r.published ?? r.published_time),
      thumbnails: vThumbs,
      thumbnail: bestThumbnail(vThumbs),
    });
  }

  return {
    id,
    url: id ? `https://www.youtube.com/channel/${id}` : vanityUrl,
    title: parsed.title || text(metadata.title),
    handle,
    description: text(metadata.description) || parsed.description,
    subscriber_count: parseHumanCount(parsed.subscriberText),
    subscriber_text: parsed.subscriberText,
    video_count: parsed.videoCount,
    avatar: bestThumbnail(thumbnails),
    thumbnails,
    banners,
    verified: parsed.verified,
    links: parsed.links.length > 0 ? parsed.links : metaLinks,
    joined_date: text(metadata.joined_date),
    country: text(metadata.country),
    videos,
  };
}

export function mapPlaylist(
  rawPlaylist: unknown,
  rawItems: unknown[],
  fallbackId = "",
): PlaylistResponse {
  const pl = asRecord(rawPlaylist) ?? {};
  const info = asRecord(pl.info) ?? pl;
  const authorRec = asRecord(info.author);

  const id = text(info.id ?? pl.id) || fallbackId;
  const thumbnails = mapThumbnails(info.thumbnails);

  const videos: PlaylistVideoItem[] = [];
  let idx = 1;
  for (const item of rawItems) {
    const r = asRecord(item);
    if (!r) continue;
    const vid = text(r.id ?? r.video_id);
    if (!vid) continue;
    const durObj = asRecord(r.duration);
    const durationSeconds = durObj
      ? asNumber(durObj.seconds, parseDurationText(text(durObj.text)))
      : asNumber(r.duration_seconds, parseDurationText(text(r.duration)));
    const vAuthor = asRecord(r.author);
    const vThumbs = mapThumbnails(r.thumbnails);
    videos.push({
      index: idx++,
      id: vid,
      url: `https://www.youtube.com/watch?v=${vid}`,
      title: text(r.title),
      author: vAuthor ? text(vAuthor.name) : text(r.author),
      duration_seconds: durationSeconds,
      duration: formatDuration(durationSeconds),
      view_count: parseHumanCount(r.view_count ?? r.short_view_count),
      thumbnails: vThumbs,
      thumbnail: bestThumbnail(vThumbs),
    });
  }

  return {
    id,
    url: id ? `https://www.youtube.com/playlist?list=${id}` : "",
    title: text(info.title),
    author: authorRec ? text(authorRec.name) : text(info.author),
    description: text(info.description),
    video_count: parseHumanCount(info.total_items ?? info.video_count) || videos.length,
    view_count: parseHumanCount(info.views ?? info.view_count),
    last_updated: text(info.last_updated),
    thumbnails,
    thumbnail: bestThumbnail(thumbnails),
    videos,
  };
}

export function mapComment(raw: unknown, replies: CommentItem[] = []): CommentItem {
  const rec = asRecord(raw) ?? {};
  // CommentThread wraps the actual CommentView / Comment inside `.comment`.
  const c = asRecord(rec.comment) ?? rec;
  const authorRec = asRecord(c.author);
  const authorEndpoint = asRecord(authorRec?.endpoint);
  const authorPayload = asRecord(authorEndpoint?.payload);

  const authorId = text(authorRec?.id ?? authorPayload?.browseId);
  const authorUrl = text(authorRec?.url) ||
    (authorId ? `https://www.youtube.com/channel/${authorId}` : "");
  const authorThumbs = mapThumbnails(authorRec?.thumbnails);

  return {
    id: text(c.comment_id ?? c.id),
    author: text(authorRec?.name ?? c.author_text),
    author_id: authorId,
    author_url: authorUrl,
    author_thumbnail: bestThumbnail(authorThumbs),
    text: text(c.content ?? c.text),
    published_time: text(c.published_time ?? c.published),
    like_count: parseHumanCount(c.like_count ?? c.vote_count),
    reply_count: parseHumanCount(c.reply_count ?? rec.reply_count),
    is_pinned: asBool(c.is_pinned, false),
    is_uploader: asBool(
      c.author_is_channel_owner ?? c.is_uploader ?? authorRec?.is_owner,
      false,
    ),
    is_hearted: asBool(c.is_hearted, false) || Boolean(c.creator_heart),
    replies,
  };
}
