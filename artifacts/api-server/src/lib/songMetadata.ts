import { readFile, rm } from "node:fs/promises";
import { ai } from "@workspace/integrations-gemini-ai";
import { isRateLimitError } from "@workspace/integrations-gemini-ai/batch";
import { GetSongResponse } from "@workspace/api-zod";
import type { SongMetadata } from "@workspace/db";
import {
  fetchAndDownloadAudio,
  isAllowedYouTubeUrl,
  isBotCheckError,
} from "./audioExtraction";
import { logger } from "./logger";

export { isBotCheckError, isAllowedYouTubeUrl };

const SongMetadataSchema = GetSongResponse.shape.metadata;

const YOUTUBE_RE =
  /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)/i;

export function classifyInput(input: string): "youtube" | "name" {
  return YOUTUBE_RE.test(input) ? "youtube" : "name";
}

function buildResponseSchema() {
  const stringArray = {
    type: "array" as const,
    items: { type: "string" as const },
  };
  const trackSegment = {
    type: "object" as const,
    properties: {
      timestamp: { type: "string" as const },
      label: { type: "string" as const },
      instruments: stringArray,
      vocals: { type: "string" as const },
      notes: { type: "string" as const },
    },
    required: ["timestamp", "label", "instruments", "vocals", "notes"],
  };
  return {
    type: "object" as const,
    properties: {
      title: { type: "string" as const },
      singer: { type: "string" as const },
      composer: { type: "string" as const },
      era: { type: "string" as const },
      geography: { type: "string" as const },
      history: { type: "string" as const },
      subject: { type: "string" as const },
      relatedSubjects: stringArray,
      dialect: { type: "string" as const },
      instruments: stringArray,
      voices: stringArray,
      relatedWorks: stringArray,
      transcription: { type: "string" as const },
      pronunciationNotes: { type: "string" as const },
      track: { type: "array" as const, items: trackSegment },
    },
    required: [
      "title",
      "singer",
      "composer",
      "era",
      "geography",
      "history",
      "subject",
      "relatedSubjects",
      "dialect",
      "instruments",
      "voices",
      "relatedWorks",
      "transcription",
      "pronunciationNotes",
      "track",
    ],
  };
}

const SYSTEM_PROMPT = `You are an expert ethnomusicologist, musicologist, and linguist building a richly detailed knowledge base of songs to be used as RAG context for AI music generation systems.

You will receive the actual audio of the song plus verified metadata (title, channel, duration, upload date, description, tags).

Your job:
1. LISTEN to the audio and transcribe the lyrics exactly as sung, preserving the original language and script.
2. Build an interval-by-interval track breakdown from what you actually hear — real timestamps, section labels (Intro, Verse 1, Chorus, Bridge, Outro, Instrumental, etc.), instruments audible in each section, vocal description, and musical notes (key, tempo/BPM estimate, mode, melodic motion, dynamics).
3. Provide deep cultural and musicological analysis: history, subject, dialect, pronunciation guidance for a non-native performer, related subjects, related works.

Strict rules:
- Transcription MUST reflect the actual lyrics you hear from the audio — do not substitute from memory or a different version.
- Track timestamps MUST be grounded in what you hear, not invented. Use the format "M:SS" (e.g. "0:00", "1:24").
- Instruments MUST be what you actually hear in the audio — not genre assumptions.
- All arrays (instruments, voices, relatedSubjects, relatedWorks) should contain multiple meaningful entries.
- pronunciationNotes: concrete phonetic guidance for tricky words/phonemes in the song's dialect, grounded in the real lyrics.
- history: several substantive sentences on cultural and historical background.
- Always return every required field.`;

const KNOWLEDGE_SYSTEM_PROMPT = `You are an expert ethnomusicologist, musicologist, and linguist building a richly detailed knowledge base of songs to be used as RAG context for AI music generation systems.

No audio is available for this song. You will produce the full dossier from your training knowledge.

Your job:
1. Provide the complete lyrics as accurately as you know them from your training data, in the original language and script.
2. Build a plausible interval-by-interval track breakdown based on the typical structure of this specific recording — use the format "M:SS" for timestamps, and base them on the known or typical duration of the song.
3. Provide deep cultural and musicological analysis: history, subject, dialect, pronunciation guidance for a non-native performer, instruments, voices, related subjects, related works.

Rules:
- Timestamps are APPROXIMATE based on typical song length and structure; mark them as such in the "notes" field of each segment if they are not verified.
- Lyrics should be as accurate as your training data allows; preserve the original language and script.
- Instruments and voices should reflect what is known about the canonical recording.
- All arrays (instruments, voices, relatedSubjects, relatedWorks) should have multiple meaningful entries.
- pronunciationNotes: concrete phonetic guidance grounded in the actual lyrics.
- history: several substantive sentences on cultural and historical background.
- Always return every required field.`;

function buildUserPrompt(
  input: string,
  inputType: "youtube" | "name",
  source: {
    title: string | null;
    uploader: string | null;
    channel: string | null;
    durationSec: number | null;
    uploadDate: string | null;
    description: string | null;
    tags: string[];
    categories: string[];
    viewCount: number | null;
    webpageUrl: string | null;
    resolvedFrom: string;
  },
  truncated: boolean,
): string {
  const identity =
    inputType === "youtube"
      ? `the song at this YouTube link: ${input}`
      : `the song the user named: "${input}"`;

  const lines: string[] = [
    `Produce the full musicological dossier for ${identity}.`,
    "",
    "=== VERIFIED SOURCE METADATA (from yt-dlp, treat as ground truth) ===",
  ];
  if (source.title) lines.push(`Video title: ${source.title}`);
  if (source.uploader) lines.push(`Uploader/channel: ${source.uploader}`);
  if (source.channel && source.channel !== source.uploader)
    lines.push(`Channel: ${source.channel}`);
  if (source.durationSec != null) {
    const m = Math.floor(source.durationSec / 60);
    const s = Math.floor(source.durationSec % 60);
    lines.push(`Duration: ${m}:${String(s).padStart(2, "0")} (${source.durationSec}s)`);
  }
  if (source.uploadDate) lines.push(`Upload date: ${source.uploadDate}`);
  if (source.viewCount != null) lines.push(`View count: ${source.viewCount}`);
  if (source.categories.length)
    lines.push(`Categories: ${source.categories.join(", ")}`);
  if (source.tags.length) lines.push(`Tags: ${source.tags.join(", ")}`);
  if (source.webpageUrl) lines.push(`URL: ${source.webpageUrl}`);
  if (source.resolvedFrom === "youtube-search")
    lines.push(
      "NOTE: Resolved from a text search — may be a specific recording, cover, or live version.",
    );
  if (source.description) {
    lines.push("Description (verbatim):");
    lines.push(source.description);
  }
  if (truncated)
    lines.push(
      "\nNOTE: The audio was re-encoded at very low bitrate to fit inline limits; the full song is present.",
    );
  lines.push("\nListen to the audio above and produce the complete musicological dossier.");
  return lines.join("\n");
}

async function callGeminiWithRetry(fn: () => Promise<string>): Promise<string> {
  const delays = [3000, 10000, 25000];
  let lastErr: unknown;
  for (let i = 0; i <= delays.length; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < delays.length && isRateLimitError(err)) {
        logger.warn({ attempt: i + 1 }, "Gemini rate limit — backing off");
        await new Promise((r) => setTimeout(r, delays[i]));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/**
 * Generate a full musicological dossier from Gemini's training knowledge only.
 * Used as a fallback when yt-dlp cannot reach YouTube (bot-check on cloud IPs).
 * Timestamps and lyrics are approximate — not from verified audio.
 */
export async function generateFromKnowledgeOnly(
  songTitle: string,
): Promise<SongMetadata> {
  const userPrompt = `Produce the full musicological dossier for the song: "${songTitle}".

No audio file is provided. Use your training knowledge to supply accurate lyrics (in the original language), plausible timestamps based on the song's known duration and structure, instrumentation, cultural history, dialect, pronunciation notes, and related works.`;

  const content = await callGeminiWithRetry(async () => {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction: KNOWLEDGE_SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: buildResponseSchema(),
        maxOutputTokens: 8192,
      },
    });
    const text = response.text;
    if (!text) throw new Error("Empty response from Gemini");
    return text;
  });

  logger.info({ songTitle }, "Gemini knowledge-only dossier generated");
  return SongMetadataSchema.parse(JSON.parse(content)) as SongMetadata;
}

/**
 * Generate a full musicological dossier for a song.
 * Downloads the audio via yt-dlp, passes it inline to Gemini gemini-2.5-flash,
 * and validates the structured response against the SongMetadata Zod schema.
 */
export async function generateSongMetadata(
  input: string,
  inputType: "youtube" | "name",
): Promise<SongMetadata> {
  const downloaded = await fetchAndDownloadAudio(input, inputType);

  try {
    const audioBytes = await readFile(downloaded.audioPath);
    const base64Audio = audioBytes.toString("base64");

    const userPrompt = buildUserPrompt(
      input,
      inputType,
      downloaded.source,
      downloaded.truncated,
    );

    const content = await callGeminiWithRetry(async () => {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: "audio/mpeg",
                  data: base64Audio,
                },
              },
              { text: userPrompt },
            ],
          },
        ],
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseSchema: buildResponseSchema(),
          maxOutputTokens: 8192,
        },
      });
      const text = response.text;
      if (!text) throw new Error("Empty response from Gemini");
      return text;
    });

    logger.info(
      { videoId: downloaded.source.videoId, truncated: downloaded.truncated },
      "Gemini dossier generated",
    );

    return SongMetadataSchema.parse(JSON.parse(content)) as SongMetadata;
  } finally {
    await rm(downloaded.tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
