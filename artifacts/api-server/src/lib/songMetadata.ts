import { readFile, rm } from "node:fs/promises";
import { ai } from "@workspace/integrations-gemini-ai";
import { isRateLimitError } from "@workspace/integrations-gemini-ai/batch";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { GetSongResponse } from "@workspace/api-zod";
import type { SongMetadata } from "@workspace/db";
import {
  fetchAndDownloadAudio,
  convertToMp3ForGemini,
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

// ---------------------------------------------------------------------------
// JSON schema for Gemini structured output
// ---------------------------------------------------------------------------
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
      "title", "singer", "composer", "era", "geography", "history",
      "subject", "relatedSubjects", "dialect", "instruments", "voices",
      "relatedWorks", "transcription", "pronunciationNotes", "track",
    ],
  };
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------
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

const JSON_FIELDS_SPEC = `Return ONLY a valid JSON object with exactly these fields:
{
  "title": string,
  "singer": string,
  "composer": string,
  "era": string,
  "geography": string,
  "history": string (several sentences),
  "subject": string,
  "relatedSubjects": string[],
  "dialect": string,
  "instruments": string[],
  "voices": string[],
  "relatedWorks": string[],
  "transcription": string (full lyrics in original language),
  "pronunciationNotes": string,
  "track": [{ "timestamp": "M:SS", "label": string, "instruments": string[], "vocals": string, "notes": string }]
}
No markdown, no code fences, no explanation — only the raw JSON object.`;

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

// ---------------------------------------------------------------------------
// Provider helpers
// ---------------------------------------------------------------------------

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

async function callClaude(model: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const message = await anthropic.messages.create({
    model,
    max_tokens: 8192,
    system: systemPrompt + "\n\n" + JSON_FIELDS_SPEC,
    messages: [{ role: "user", content: userPrompt }],
  });
  const block = message.content[0];
  if (!block || block.type !== "text") throw new Error("Empty response from Claude");
  return block.text.trim();
}

async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt + "\n\n" + JSON_FIELDS_SPEC },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 8192,
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Provider error ${response.status}: ${text}`);
  }
  const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from provider");
  return content.trim();
}

function parseJsonResponse(raw: string): SongMetadata {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  return SongMetadataSchema.parse(JSON.parse(stripped)) as SongMetadata;
}

// ---------------------------------------------------------------------------
// Knowledge-only generation (text models: all providers)
// ---------------------------------------------------------------------------

export async function generateFromKnowledgeOnly(
  songTitle: string,
  provider = "gemini",
  model = "gemini-2.0-flash",
): Promise<SongMetadata> {
  const userPrompt = `Produce the full musicological dossier for the song: "${songTitle}".

No audio file is provided. Use your training knowledge to supply accurate lyrics (in the original language), plausible timestamps based on the song's known duration and structure, instrumentation, cultural history, dialect, pronunciation notes, and related works.`;

  let raw: string;

  if (provider === "gemini") {
    raw = await callGeminiWithRetry(async () => {
      const response = await ai.models.generateContent({
        model,
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
  } else if (provider === "claude") {
    raw = await callClaude(model, KNOWLEDGE_SYSTEM_PROMPT, userPrompt);
  } else if (provider === "deepseek") {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set — configure it in the environment secrets.");
    raw = await callOpenAICompatible(
      "https://api.deepseek.com/v1",
      apiKey,
      model,
      KNOWLEDGE_SYSTEM_PROMPT,
      userPrompt,
    );
  } else if (provider === "siliconflow") {
    const apiKey = process.env.SILICON_FLOW_API_KEY;
    if (!apiKey) throw new Error("SILICON_FLOW_API_KEY is not set — configure it in the environment secrets.");
    raw = await callOpenAICompatible(
      "https://api.siliconflow.cn/v1",
      apiKey,
      model,
      KNOWLEDGE_SYSTEM_PROMPT,
      userPrompt,
    );
  } else {
    throw new Error(`Unknown provider: ${provider}`);
  }

  logger.info({ songTitle, provider, model }, "Knowledge-only dossier generated");
  return parseJsonResponse(raw);
}

// ---------------------------------------------------------------------------
// Audio-based generation (Gemini only — requires multimodal support)
// ---------------------------------------------------------------------------

/**
 * Generate a full musicological dossier from an uploaded audio/video file.
 * Converts the file to mp3 via ffmpeg, then sends it inline to Gemini.
 * Note: audio analysis requires Gemini regardless of the active provider setting.
 */
export async function generateFromUploadedAudio(
  filePath: string,
  originalFilename: string,
): Promise<SongMetadata> {
  const converted = await convertToMp3ForGemini(filePath);
  try {
    const audioBytes = await readFile(converted.mp3Path);
    const base64Audio = audioBytes.toString("base64");

    const userPrompt = `Produce the full musicological dossier for the song in this audio file.
Original filename: "${originalFilename}"

Listen to the audio and provide: exact lyrics transcription in the original language, a real interval-by-interval track breakdown with timestamps from what you actually hear, instrumentation, cultural history, dialect, pronunciation notes, related works, and all other required fields.`;

    const content = await callGeminiWithRetry(async () => {
      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "audio/mpeg", data: base64Audio } },
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

    logger.info({ originalFilename }, "Gemini upload dossier generated");
    return SongMetadataSchema.parse(JSON.parse(content)) as SongMetadata;
  } finally {
    await rm(converted.tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Generate a full musicological dossier for a YouTube link or song name.
 * Downloads audio via yt-dlp; passes to Gemini for audio analysis.
 * If a non-Gemini provider is active and the input is a song name, routes
 * to knowledge-only generation with that provider.
 */
export async function generateSongMetadata(
  input: string,
  inputType: "youtube" | "name",
  provider = "gemini",
  model = "gemini-2.0-flash",
): Promise<SongMetadata> {
  // Non-Gemini providers cannot process audio — use knowledge-only path
  if (provider !== "gemini" && inputType === "name") {
    return generateFromKnowledgeOnly(input, provider, model);
  }

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
        model: "gemini-2.0-flash",
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "audio/mpeg", data: base64Audio } },
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
