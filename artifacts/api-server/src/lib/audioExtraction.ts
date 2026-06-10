import { spawn } from "node:child_process";
import { createReadStream, writeFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "./logger";

export interface ExtractedSource {
  resolvedFrom: "youtube-url" | "youtube-search";
  videoId: string | null;
  webpageUrl: string | null;
  title: string | null;
  uploader: string | null;
  channel: string | null;
  durationSec: number | null;
  uploadDate: string | null;
  description: string | null;
  tags: string[];
  categories: string[];
  viewCount: number | null;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export type TranscriptionMethod =
  | "manual-captions"
  | "auto-captions"
  | "audio-chunks"
  | "none";

export interface ExtractedTranscription {
  method: TranscriptionMethod;
  language: string | null;
  segments: TranscriptSegment[];
  fullText: string;
  /** True when the source was longer than we could fully transcribe. */
  truncated: boolean;
}

export interface ExtractedSongData {
  source: ExtractedSource;
  transcription: ExtractedTranscription;
}

const CHUNK_WINDOW_SEC = 45;
const MAX_CHUNKS = 30;
const MAX_SEGMENTS = 400;
const CHUNK_CALL_TIMEOUT_MS = 60_000;
const CHUNK_TOTAL_DEADLINE_MS = 240_000;

const ALLOWED_YT_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

/**
 * Strict allowlist check. classifyInput uses a loose substring regex, so a URL
 * like https://evil.com/youtube.com/watch?v=x would otherwise be handed to
 * yt-dlp and fetched server-side (SSRF). Only real YouTube hosts are allowed.
 */
export function isAllowedYouTubeUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  return ALLOWED_YT_HOSTS.has(u.hostname.toLowerCase());
}

function resolveYtDlpPath(): string {
  if (process.env.YT_DLP_PATH && existsSync(process.env.YT_DLP_PATH)) {
    return process.env.YT_DLP_PATH;
  }
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, ".pythonlibs", "bin", "yt-dlp");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "yt-dlp";
}

const YT_DLP = resolveYtDlpPath();

let cookieFilePath: string | null | undefined;

/**
 * If a `YTDLP_COOKIES` secret is set (contents of a Netscape cookies.txt from a
 * logged-in YouTube session), write it to a temp file once and reuse it. This is
 * the reliable way past YouTube's "confirm you're not a bot" block on cloud IPs.
 */
function getCookieFile(): string | null {
  if (cookieFilePath !== undefined) return cookieFilePath;
  const content = process.env.YTDLP_COOKIES;
  if (content && content.trim()) {
    try {
      const p = join(tmpdir(), "yt-cookies.txt");
      writeFileSync(p, content, "utf8");
      cookieFilePath = p;
    } catch (err) {
      logger.warn({ err }, "Failed to write yt-dlp cookies file");
      cookieFilePath = null;
    }
  } else {
    cookieFilePath = null;
  }
  return cookieFilePath;
}

/**
 * Args shared by every yt-dlp call. The player-client list avoids the plain
 * `web` client that triggers YouTube's anti-bot check most aggressively on
 * datacenter IPs; cookies (when provided) are the robust fallback.
 */
function baseYtDlpArgs(): string[] {
  const args = [
    "--extractor-args",
    "youtube:player_client=default,tv,web_safari,android,ios",
  ];
  const cookie = getCookieFile();
  if (cookie) args.push("--cookies", cookie);
  return args;
}

export function isBotCheckError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /confirm you.?re not a bot|Sign in to confirm|cookies/i.test(msg);
}

function runYtDlp(
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(YT_DLP, args, {
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("yt-dlp timed out"));
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`yt-dlp exited with code ${code}: ${stderr.slice(-500)}`));
    });
  });
}

function runFfmpeg(args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { env: process.env });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("ffmpeg timed out"));
    }, timeoutMs);
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-300)}`));
    });
  });
}

interface YtMeta {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  upload_date?: string;
  description?: string;
  tags?: string[];
  categories?: string[];
  view_count?: number;
  language?: string;
  webpage_url?: string;
  subtitles?: Record<string, unknown>;
  automatic_captions?: Record<string, unknown>;
  entries?: YtMeta[];
}

async function fetchMetadata(target: string): Promise<YtMeta> {
  const { stdout } = await runYtDlp(
    [...baseYtDlpArgs(), "-J", "--no-warnings", "--no-playlist", target],
    90_000,
  );
  const parsed = JSON.parse(stdout) as YtMeta;
  if (parsed.entries && parsed.entries.length > 0) {
    return parsed.entries[0];
  }
  return parsed;
}

function pickCaptionLanguage(
  meta: YtMeta,
): { kind: "manual" | "auto"; lang: string } | null {
  const manual = meta.subtitles ?? {};
  const auto = meta.automatic_captions ?? {};
  const detected = meta.language ?? undefined;

  const manualLangs = Object.keys(manual).filter((l) => !l.startsWith("live_"));
  if (manualLangs.length > 0) {
    const lang =
      (detected && manualLangs.includes(detected) && detected) ||
      manualLangs.find((l) => !l.includes("-")) ||
      manualLangs[0];
    return { kind: "manual", lang };
  }

  // Auto-captions: the original ASR is keyed by the bare detected language.
  // Translated tracks look like "xx-en" (target-source); avoid those.
  const autoLangs = Object.keys(auto);
  if (autoLangs.length > 0) {
    if (detected && autoLangs.includes(detected)) {
      return { kind: "auto", lang: detected };
    }
    if (detected) {
      const origStyle = autoLangs.find((l) => l === `${detected}-orig`);
      if (origStyle) return { kind: "auto", lang: origStyle };
    }
    // Language detection absent/odd: prefer a non-translated base track
    // (no source suffix), then an "-orig" track, then anything available.
    const base =
      autoLangs.find((l) => !l.includes("-")) ??
      autoLangs.find((l) => l.endsWith("-orig")) ??
      autoLangs[0];
    return { kind: "auto", lang: base };
  }
  return null;
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: { utf8?: string }[];
}

function parseJson3(raw: string): TranscriptSegment[] {
  const data = JSON.parse(raw) as { events?: Json3Event[] };
  const segments: TranscriptSegment[] = [];
  for (const ev of data.events ?? []) {
    if (typeof ev.tStartMs !== "number" || !ev.segs) continue;
    const text = ev.segs
      .map((s) => s.utf8 ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const start = ev.tStartMs / 1000;
    const end = start + (ev.dDurationMs ?? 0) / 1000;
    segments.push({ start, end, text });
  }
  return segments;
}

async function downloadCaptions(
  target: string,
  choice: { kind: "manual" | "auto"; lang: string },
  dir: string,
): Promise<TranscriptSegment[] | null> {
  const writeFlag = choice.kind === "manual" ? "--write-subs" : "--write-auto-subs";
  try {
    await runYtDlp(
      [
        ...baseYtDlpArgs(),
        "--skip-download",
        writeFlag,
        "--sub-langs",
        choice.lang,
        "--sub-format",
        "json3",
        "--no-warnings",
        "--no-playlist",
        "-o",
        join(dir, "cap.%(ext)s"),
        target,
      ],
      90_000,
    );
  } catch (err) {
    logger.warn({ err }, "Caption download failed");
    return null;
  }
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json3"));
  if (files.length === 0) return null;
  const raw = await readFile(join(dir, files[0]), "utf8");
  const segments = parseJson3(raw);
  return segments.length > 0 ? segments : null;
}

async function transcribeByChunks(
  target: string,
  durationSec: number | null,
  dir: string,
): Promise<{ segments: TranscriptSegment[]; truncated: boolean } | null> {
  const audioPath = join(dir, "audio.mp3");
  try {
    await runYtDlp(
      [
        ...baseYtDlpArgs(),
        "-f",
        "bestaudio",
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "9",
        "--no-warnings",
        "--no-playlist",
        "-o",
        join(dir, "audio.%(ext)s"),
        target,
      ],
      180_000,
    );
  } catch (err) {
    logger.warn({ err }, "Audio download failed");
    return null;
  }
  if (!existsSync(audioPath)) return null;

  const total = durationSec && durationSec > 0 ? durationSec : CHUNK_WINDOW_SEC;
  const neededChunks = Math.ceil(total / CHUNK_WINDOW_SEC);
  const chunkCount = Math.min(neededChunks, MAX_CHUNKS);
  const segments: TranscriptSegment[] = [];
  const deadline = Date.now() + CHUNK_TOTAL_DEADLINE_MS;
  let truncated = neededChunks > MAX_CHUNKS;

  for (let i = 0; i < chunkCount; i++) {
    if (Date.now() > deadline) {
      truncated = true;
      logger.warn({ done: i, total: chunkCount }, "Chunk transcription deadline reached");
      break;
    }
    const start = i * CHUNK_WINDOW_SEC;
    const chunkPath = join(dir, `chunk-${i}.wav`);
    try {
      await runFfmpeg(
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-ss",
          String(start),
          "-t",
          String(CHUNK_WINDOW_SEC),
          "-i",
          audioPath,
          "-vn",
          "-ar",
          "16000",
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          "-f",
          "wav",
          "-y",
          chunkPath,
        ],
        60_000,
      );
      if (!existsSync(chunkPath)) continue;
      const res = await openai.audio.transcriptions.create(
        {
          file: createReadStream(chunkPath),
          model: "gpt-4o-transcribe",
        },
        { timeout: CHUNK_CALL_TIMEOUT_MS },
      );
      const text = res.text?.replace(/\s+/g, " ").trim();
      if (text) {
        segments.push({
          start,
          end: Math.min(start + CHUNK_WINDOW_SEC, total),
          text,
        });
      }
    } catch (err) {
      logger.warn({ err, chunk: i }, "Chunk transcription failed");
    } finally {
      await rm(chunkPath, { force: true }).catch(() => {});
    }
  }
  return segments.length > 0 ? { segments, truncated } : null;
}

function toSource(
  meta: YtMeta,
  resolvedFrom: "youtube-url" | "youtube-search",
): ExtractedSource {
  return {
    resolvedFrom,
    videoId: meta.id ?? null,
    webpageUrl: meta.webpage_url ?? null,
    title: meta.title ?? null,
    uploader: meta.uploader ?? null,
    channel: meta.channel ?? null,
    durationSec: typeof meta.duration === "number" ? meta.duration : null,
    uploadDate: meta.upload_date ?? null,
    description: meta.description ? meta.description.slice(0, 2000) : null,
    tags: Array.isArray(meta.tags) ? meta.tags.slice(0, 30) : [],
    categories: Array.isArray(meta.categories) ? meta.categories : [],
    viewCount: typeof meta.view_count === "number" ? meta.view_count : null,
  };
}

/**
 * Extract real, verifiable data about a song before any interpretive AI call.
 * For a YouTube URL the video is used directly; for a free-text name the first
 * YouTube search result is resolved. Returns real metadata plus a timestamped
 * transcription sourced from captions (preferred) or chunked audio transcription.
 */
export async function extractRealSongData(
  input: string,
  inputType: "youtube" | "name",
): Promise<ExtractedSongData> {
  const resolvedFrom: "youtube-url" | "youtube-search" =
    inputType === "youtube" ? "youtube-url" : "youtube-search";
  const metaTarget = inputType === "youtube" ? input : `ytsearch1:${input}`;

  if (inputType === "youtube" && !isAllowedYouTubeUrl(input)) {
    throw new Error("Unsupported or invalid YouTube URL");
  }

  const meta = await fetchMetadata(metaTarget);
  const source = toSource(meta, resolvedFrom);
  // For follow-up caption/audio calls, target the resolved video directly.
  const videoTarget = source.webpageUrl ?? metaTarget;

  const dir = await mkdtemp(join(tmpdir(), "songforge-"));
  let transcription: ExtractedTranscription = {
    method: "none",
    language: null,
    segments: [],
    fullText: "",
    truncated: false,
  };

  try {
    const captionChoice = pickCaptionLanguage(meta);
    let segments: TranscriptSegment[] | null = null;
    let method: TranscriptionMethod = "none";
    let language: string | null = null;
    let truncated = false;

    if (captionChoice) {
      segments = await downloadCaptions(videoTarget, captionChoice, dir);
      if (segments) {
        method = captionChoice.kind === "manual" ? "manual-captions" : "auto-captions";
        language = captionChoice.lang;
      }
    }

    if (!segments) {
      const chunked = await transcribeByChunks(videoTarget, source.durationSec, dir);
      if (chunked) {
        segments = chunked.segments;
        truncated = chunked.truncated;
        method = "audio-chunks";
        language = meta.language ?? null;
      }
    }

    if (segments && segments.length > 0) {
      const trimmed = segments.slice(0, MAX_SEGMENTS);
      transcription = {
        method,
        language,
        segments: trimmed,
        fullText: trimmed.map((s) => s.text).join("\n"),
        truncated: truncated || trimmed.length < segments.length,
      };
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  logger.info(
    {
      resolvedFrom,
      videoId: source.videoId,
      method: transcription.method,
      segmentCount: transcription.segments.length,
    },
    "Extracted real song data",
  );

  return { source, transcription };
}

function fmtTimestamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Render extracted data as a compact, grounded context block for the AI prompt. */
export function buildRealDataContext(data: ExtractedSongData): string {
  const { source, transcription } = data;
  const lines: string[] = [];
  lines.push("=== VERIFIED SOURCE METADATA (from yt-dlp, treat as ground truth) ===");
  if (source.title) lines.push(`Video title: ${source.title}`);
  if (source.uploader) lines.push(`Uploader/channel: ${source.uploader}`);
  if (source.channel && source.channel !== source.uploader)
    lines.push(`Channel: ${source.channel}`);
  if (source.durationSec != null)
    lines.push(`Duration: ${fmtTimestamp(source.durationSec)} (${source.durationSec}s)`);
  if (source.uploadDate) lines.push(`Upload date: ${source.uploadDate}`);
  if (source.viewCount != null) lines.push(`View count: ${source.viewCount}`);
  if (source.categories.length) lines.push(`Categories: ${source.categories.join(", ")}`);
  if (source.tags.length) lines.push(`Tags: ${source.tags.join(", ")}`);
  if (source.webpageUrl) lines.push(`URL: ${source.webpageUrl}`);
  if (source.resolvedFrom === "youtube-search")
    lines.push(
      "NOTE: This video was resolved from a text search and may be a specific recording, cover, or live version.",
    );
  if (source.description) {
    lines.push("Description (verbatim):");
    lines.push(source.description);
  }

  lines.push("");
  if (transcription.segments.length > 0) {
    const label =
      transcription.method === "manual-captions"
        ? "real uploaded captions"
        : transcription.method === "auto-captions"
          ? "real auto-generated captions"
          : "real transcription of the actual audio (window-level timestamps)";
    lines.push(
      `=== REAL TIMESTAMPED TRANSCRIPTION (${label}${transcription.language ? `, language: ${transcription.language}` : ""}) ===`,
    );
    lines.push(
      "These timestamps and lyrics come from the actual recording. Use them as the factual basis for the transcription and the interval-by-interval track breakdown. Do NOT invent different timings or lyrics.",
    );
    if (transcription.truncated) {
      lines.push(
        "NOTE: This transcription is PARTIAL (the recording was longer than could be fully transcribed). Only build grounded timestamps up to the last segment below; do not invent timings beyond it.",
      );
    }
    for (const seg of transcription.segments) {
      lines.push(`[${fmtTimestamp(seg.start)}] ${seg.text}`);
    }
  } else {
    lines.push("=== TRANSCRIPTION UNAVAILABLE ===");
    lines.push(
      "No captions or audio transcription could be extracted. Do NOT fabricate exact per-line timestamps. If you know the song's published lyrics, you may provide them but state clearly that precise timings are approximate.",
    );
  }

  return lines.join("\n");
}
