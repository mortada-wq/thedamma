import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
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

export interface DownloadedAudio {
  source: ExtractedSource;
  audioPath: string;
  /** Temp dir that owns audioPath — caller must rm -rf when done. */
  tempDir: string;
  /** True if the audio was truncated to fit within the 8 MB inline limit. */
  truncated: boolean;
}

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
    const child = spawn(YT_DLP, args, { env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("yt-dlp timed out"));
    }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
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
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
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
  webpage_url?: string;
  entries?: YtMeta[];
}

async function fetchMetadata(target: string): Promise<YtMeta> {
  const { stdout } = await runYtDlp(
    [...baseYtDlpArgs(), "-J", "--no-warnings", "--no-playlist", target],
    90_000,
  );
  const parsed = JSON.parse(stdout) as YtMeta;
  if (parsed.entries && parsed.entries.length > 0) return parsed.entries[0];
  return parsed;
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

/** Max bytes Gemini accepts inline (8 MB limit; use 7 MB to be safe). */
const MAX_INLINE_BYTES = 7 * 1024 * 1024;

/**
 * Fetch YouTube metadata and download audio for Gemini inline analysis.
 * Returns the source info, path to the mp3 file, and the temp dir to clean up.
 * Caller MUST call `rm(result.tempDir, { recursive: true, force: true })` after use.
 */
export async function fetchAndDownloadAudio(
  input: string,
  inputType: "youtube" | "name",
): Promise<DownloadedAudio> {
  const resolvedFrom: "youtube-url" | "youtube-search" =
    inputType === "youtube" ? "youtube-url" : "youtube-search";
  const metaTarget = inputType === "youtube" ? input : `ytsearch1:${input}`;

  if (inputType === "youtube" && !isAllowedYouTubeUrl(input)) {
    throw new Error("Unsupported or invalid YouTube URL");
  }

  const meta = await fetchMetadata(metaTarget);
  const source = toSource(meta, resolvedFrom);
  const videoTarget = source.webpageUrl ?? metaTarget;

  const dir = await mkdtemp(join(tmpdir(), "songforge-"));
  const audioPath = join(dir, "audio.mp3");

  await runYtDlp(
    [
      ...baseYtDlpArgs(),
      "-f", "bestaudio",
      "-x",
      "--audio-format", "mp3",
      "--audio-quality", "9",
      "--no-warnings",
      "--no-playlist",
      "-o", join(dir, "audio.%(ext)s"),
      videoTarget,
    ],
    180_000,
  );

  if (!existsSync(audioPath)) {
    throw new Error("Audio download produced no file");
  }

  const { size } = await stat(audioPath);
  let finalPath = audioPath;
  let truncated = false;

  if (size > MAX_INLINE_BYTES) {
    // Re-encode at 16 kbps mono to fit within the inline limit
    const smallPath = join(dir, "audio-small.mp3");
    await runFfmpeg(
      [
        "-hide_banner", "-loglevel", "error",
        "-i", audioPath,
        "-b:a", "16k",
        "-ac", "1",
        "-y",
        smallPath,
      ],
      90_000,
    );
    if (existsSync(smallPath)) {
      finalPath = smallPath;
      truncated = true;
    }
  }

  logger.info(
    { resolvedFrom, videoId: source.videoId, sizeBytes: size, truncated },
    "Audio downloaded for Gemini analysis",
  );

  return { source, audioPath: finalPath, tempDir: dir, truncated };
}
