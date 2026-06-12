import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
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
      maqamat: stringArray,
      iqaat: stringArray,
      ornamentation: { type: "string" as const },
    },
    required: [
      "title", "singer", "composer", "era", "geography", "history",
      "subject", "relatedSubjects", "dialect", "instruments", "voices",
      "relatedWorks", "transcription", "pronunciationNotes", "track",
      "maqamat", "iqaat", "ornamentation",
    ],
  };
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are an expert ethnomusicologist, musicologist, and linguist specialising in Arab and Iraqi music traditions, building a richly detailed knowledge base of songs to be used as RAG context for AI music generation systems.

You will receive the actual audio of the song plus verified metadata (title, channel, duration, upload date, description, tags).

Your job:
1. LISTEN to the audio and transcribe the lyrics exactly as sung, preserving the original language and script.
2. Build an interval-by-interval track breakdown from what you actually hear — real timestamps, section labels (Intro, Verse 1, Chorus, Bridge, Outro, Instrumental, etc.), instruments audible in each section, vocal description, and musical notes (key, tempo/BPM estimate, mode, melodic motion, dynamics).
3. Provide deep cultural and musicological analysis: history, subject, dialect, pronunciation guidance for a non-native performer, related subjects, related works.
4. Identify the Maqamat (melodic modes) present. For each maqam heard, provide its name, tonic, and characteristic microtonal or interval features — e.g. "Bayat — tonic: D, lowered 2nd (E half-flat) and 6th", "Sikah — tonic: E half-flat, neutral 3rd above tonic". If the piece modulates between maqamat, list all that appear. For non-Arab/Iraqi music, return an empty array.
5. Identify the Iqa'at (rhythmic cycles) used. For each iqa' heard, provide its name and time signature — e.g. "Maqsum 4/4", "Wahda 4/4", "Chobi 6/8", "Malfuf 2/4", "Sama'i Thaqil 10/8", "Ayyub 4/4", "Jurjina 6/8". For non-Arab/Iraqi music, return an empty array.
6. Describe specific vocal and instrumental ornamentation techniques audible in this recording: melisma (tahrir), glottal ornaments, messa di voce, portamento, mordent, trill, vibrato, layali passages, mawwal phrases, etc. Be specific about where and how each technique appears.

Strict rules:
- Transcription MUST reflect the actual lyrics you hear from the audio — do not substitute from memory or a different version.
- Track timestamps MUST be grounded in what you hear, not invented. Use the format "M:SS" (e.g. "0:00", "1:24").
- Instruments MUST be what you actually hear in the audio — not genre assumptions.
- All arrays (instruments, voices, relatedSubjects, relatedWorks, maqamat, iqaat) should contain multiple meaningful entries where applicable.
- pronunciationNotes: concrete phonetic guidance for tricky words/phonemes in the song's dialect, grounded in the real lyrics.
- history: several substantive sentences on cultural and historical background.
- Always return every required field.`;

const KNOWLEDGE_SYSTEM_PROMPT = `You are an expert ethnomusicologist, musicologist, and linguist specialising in Arab and Iraqi music traditions, building a richly detailed knowledge base of songs to be used as RAG context for AI music generation systems.

No audio is available for this song. You will produce the full dossier from your training knowledge.

Your job:
1. Provide the complete lyrics as accurately as you know them from your training data, in the original language and script.
2. Build a plausible interval-by-interval track breakdown based on the typical structure of this specific recording — use the format "M:SS" for timestamps, and base them on the known or typical duration of the song.
3. Provide deep cultural and musicological analysis: history, subject, dialect, pronunciation guidance for a non-native performer, instruments, voices, related subjects, related works.
4. Identify the Maqamat (melodic modes) traditionally associated with this song or recording. For each maqam, provide its name, tonic, and characteristic interval features — e.g. "Bayat — tonic: D, lowered 2nd (E half-flat) and 6th", "Rast — tonic: C, neutral 3rd". If multiple maqamat or modulations are characteristic, list them all. For non-Arab/Iraqi music, return an empty array.
5. Identify the Iqa'at (rhythmic cycles) used in this song. For each: name and time signature — e.g. "Maqsum 4/4", "Wahda 4/4", "Chobi 6/8", "Malfuf 2/4", "Sama'i Thaqil 10/8". For non-Arab/Iraqi music, return an empty array.
6. Describe the vocal and instrumental ornamentation techniques characteristic of this song or the singer's style: melisma (tahrir), glottal ornaments, messa di voce, portamento, mordent, trill, vibrato, layali, mawwal, etc.

Rules:
- Timestamps are APPROXIMATE based on typical song length and structure; mark them as such in the "notes" field of each segment if they are not verified.
- Lyrics should be as accurate as your training data allows; preserve the original language and script.
- Instruments and voices should reflect what is known about the canonical recording.
- All arrays (instruments, voices, relatedSubjects, relatedWorks, maqamat, iqaat) should have multiple meaningful entries where applicable.
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
  "track": [{ "timestamp": "M:SS", "label": string, "instruments": string[], "vocals": string, "notes": string }],
  "maqamat": string[] (each entry: maqam name + tonic + characteristic intervals; empty array if not Arab/Iraqi music),
  "iqaat": string[] (each entry: iqa name + time signature, e.g. "Maqsum 4/4"; empty array if not Arab/Iraqi music),
  "ornamentation": string (vocal and instrumental ornament techniques; empty string if none)
}
No markdown, no code fences, no explanation — only the raw JSON object.`;

// ---------------------------------------------------------------------------
// Music Flamingo (NVIDIA / HuggingFace Space)
// ---------------------------------------------------------------------------

const FLAMINGO_BASE = "https://nvidia-music-flamingo.hf.space";
const FLAMINGO_TIMEOUT_MS = 6 * 60 * 1000; // 6 minutes

const FLAMINGO_MUSICOLOGY_PROMPT = `You are an expert ethnomusicologist specialising in Arab and Iraqi music traditions. Listen carefully to this audio and produce a complete musicological dossier. Return ONLY a raw JSON object — absolutely no markdown, no code fences, no commentary before or after. The JSON must have exactly these fields:

{
  "title": "song title",
  "singer": "artist / performer name",
  "composer": "composer name if known, else empty string",
  "era": "decade or period (e.g. 1960s, Golden Age of Arabic music)",
  "geography": "country or region of origin",
  "history": "3-5 sentences of cultural and historical background",
  "subject": "main theme or subject of the song",
  "relatedSubjects": ["topic1", "topic2"],
  "dialect": "language and dialect (e.g. Egyptian Arabic, Classical Arabic, Andalusian)",
  "instruments": ["every instrument you actually hear in the audio"],
  "voices": ["voice type descriptions, e.g. tenor, contralto, choir"],
  "relatedWorks": ["related songs or artists"],
  "transcription": "complete lyric transcription exactly as sung, in the original language and script",
  "pronunciationNotes": "phonetic guidance for a non-native performer on tricky syllables or vowels",
  "track": [
    { "timestamp": "0:00", "label": "Intro", "instruments": ["oud"], "vocals": "none", "notes": "key, tempo, mood" }
  ],
  "maqamat": ["e.g. Bayat — tonic: D, lowered 2nd & 6th", "Sikah — tonic: E half-flat, neutral 3rd"],
  "iqaat": ["e.g. Maqsum 4/4", "Wahda 4/4"],
  "ornamentation": "description of vocal and instrumental ornament techniques heard (melisma, glottal ornaments, portamento, trill, vibrato, mawwal, etc.)"
}

The track array must cover the full song with real timestamps from what you hear. For maqamat and iqaat, provide only what is actually audible; use empty arrays for non-Arab/Iraqi music. Return the JSON object only.`;

async function uploadAudioToFlamingo(
  audioPath: string,
  hfToken?: string,
): Promise<{ path: string; orig_name: string; mime_type: string }> {
  const fileBuffer = await readFile(audioPath);
  const filename = path.basename(audioPath);
  const mimeType = filename.endsWith(".mp3") ? "audio/mpeg" : "audio/wav";

  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: mimeType });
  formData.append("files", blob, filename);

  const uploadId = Math.random().toString(36).slice(2);
  const headers: Record<string, string> = {};
  if (hfToken) headers["Authorization"] = `Bearer ${hfToken}`;

  const res = await fetch(`${FLAMINGO_BASE}/upload?upload_id=${uploadId}`, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`Flamingo upload failed (${res.status}): ${txt}`);
  }

  const paths = (await res.json()) as string[];
  if (!paths?.[0]) throw new Error("Flamingo upload returned no file path");
  return { path: paths[0], orig_name: filename, mime_type: mimeType };
}

async function callFlamingoInfer(
  audioDatum: object | null,
  youtubeUrl: string,
  hfToken?: string,
): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (hfToken) headers["Authorization"] = `Bearer ${hfToken}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FLAMINGO_TIMEOUT_MS);

  try {
    const res = await fetch(`${FLAMINGO_BASE}/run/infer`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        data: [audioDatum, youtubeUrl, FLAMINGO_MUSICOLOGY_PROMPT],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => res.statusText);
      throw new Error(`Flamingo inference failed (${res.status}): ${txt}`);
    }

    const json = (await res.json()) as { data?: [string]; error?: string };
    if (json.error) throw new Error(`Flamingo error: ${json.error}`);
    const text = json.data?.[0];
    if (!text) throw new Error("Flamingo returned empty response");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function generateFromFlamingo(
  input: string,
  inputType: "youtube" | "name",
  audioFilePath?: string,
): Promise<SongMetadata> {
  const hfToken = process.env.HF_TOKEN;

  let rawText: string;

  if (inputType === "youtube") {
    logger.info({ url: input }, "Music Flamingo: calling with YouTube URL");
    rawText = await callFlamingoInfer(null, input, hfToken);
  } else if (audioFilePath) {
    logger.info({ audioFilePath }, "Music Flamingo: uploading audio file");
    const audioDatum = await uploadAudioToFlamingo(audioFilePath, hfToken);
    rawText = await callFlamingoInfer(audioDatum, "", hfToken);
  } else {
    throw new Error(
      "Music Flamingo requires audio (YouTube URL or uploaded file). For song-name queries, choose a different provider.",
    );
  }

  logger.info({ inputType }, "Music Flamingo: inference complete, parsing response");
  return parseJsonResponse(rawText);
}

// ---------------------------------------------------------------------------
// Shared user prompt for YouTube/name metadata display
// ---------------------------------------------------------------------------
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
  // Strip markdown fences if present
  const stripped = raw
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/m, "")
    .trim();
  // Extract first {...} block in case the model prefixed/suffixed text
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in model response");
  return SongMetadataSchema.parse(JSON.parse(match[0])) as SongMetadata;
}

// ---------------------------------------------------------------------------
// Knowledge-only generation (text models: all providers except flamingo)
// ---------------------------------------------------------------------------

export async function generateFromKnowledgeOnly(
  songTitle: string,
  provider = "gemini",
  model = "gemini-2.0-flash",
): Promise<SongMetadata> {
  if (provider === "flamingo") {
    throw new Error(
      "Music Flamingo requires audio input. For song-name queries, please use Gemini, Claude, DeepSeek, or Silicon Flow.",
    );
  }

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
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set.");
    raw = await callOpenAICompatible(
      "https://api.deepseek.com/v1",
      apiKey,
      model,
      KNOWLEDGE_SYSTEM_PROMPT,
      userPrompt,
    );
  } else if (provider === "siliconflow") {
    const apiKey = process.env.SILICON_FLOW_API_KEY;
    if (!apiKey) throw new Error("SILICON_FLOW_API_KEY is not set.");
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
// Audio-based generation from uploaded file
// ---------------------------------------------------------------------------

/**
 * Generate from an uploaded audio/video file.
 * - If provider is "flamingo": upload to the HuggingFace Space and call Music Flamingo.
 * - Otherwise: convert to mp3, send inline to Gemini (only Gemini supports inline audio).
 */
export async function generateFromUploadedAudio(
  filePath: string,
  originalFilename: string,
  provider = "gemini",
): Promise<SongMetadata> {
  if (provider === "flamingo") {
    const converted = await convertToMp3ForGemini(filePath);
    try {
      const metadata = await generateFromFlamingo("uploaded-file", "name", converted.mp3Path);
      logger.info({ originalFilename }, "Music Flamingo upload dossier generated");
      return metadata;
    } finally {
      await rm(converted.tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // All non-Flamingo providers: convert to mp3 and send to Gemini inline
  // (only Gemini supports inline audio; other text models fall back to knowledge prompt)
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

// ---------------------------------------------------------------------------
// DNA-only re-analysis (maqamat, iqaat, ornamentation)
// ---------------------------------------------------------------------------

const DNA_SYSTEM_PROMPT = `You are an expert ethnomusicologist specialising in Arab and Iraqi music traditions.
You will be given the title and singer of a known song. Your only task is to identify and describe its Musical DNA:
1. Maqamat (melodic modes) — list every maqam present with its name, tonic, and characteristic interval features.
2. Iqa'at (rhythmic cycles) — list every iqa' with name and time signature (e.g. "Maqsum 4/4").
3. Ornamentation — describe the vocal and instrumental ornament techniques characteristic of this song/performer (melisma, glottal ornaments, portamento, trill, vibrato, mawwal, tahrir, etc.).
For non-Arab/Iraqi music return empty arrays for maqamat and iqaat.
Always return all three fields even if empty.`;

const DNA_JSON_FIELDS_SPEC = `Return ONLY a valid JSON object with exactly these three fields:
{
  "maqamat": string[],
  "iqaat": string[],
  "ornamentation": string
}
No markdown, no code fences, no explanation — only the raw JSON object.`;

function buildDnaResponseSchema() {
  const stringArray = { type: "array" as const, items: { type: "string" as const } };
  return {
    type: "object" as const,
    properties: {
      maqamat: stringArray,
      iqaat: stringArray,
      ornamentation: { type: "string" as const },
    },
    required: ["maqamat", "iqaat", "ornamentation"],
  };
}

const DnaResultSchema = z.object({
  maqamat: z.array(z.string()),
  iqaat: z.array(z.string()),
  ornamentation: z.string(),
});

export type DnaResult = z.infer<typeof DnaResultSchema>;

function parseDnaResponse(raw: string): DnaResult {
  const stripped = raw
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/m, "")
    .trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in DNA model response");
  return DnaResultSchema.parse(JSON.parse(match[0]));
}

export async function generateDnaOnly(
  title: string,
  singer: string,
  provider = "gemini",
  model = "gemini-2.0-flash",
): Promise<DnaResult> {
  if (provider === "flamingo") {
    throw new Error("Music Flamingo requires audio. Choose Gemini, Claude, DeepSeek, or Silicon Flow for DNA re-analysis.");
  }

  const userPrompt = `Song title: "${title}"
Performer: "${singer}"

Identify the Musical DNA for this song: maqamat, iqa'at, and ornamentation techniques.`;

  let raw: string;

  if (provider === "gemini") {
    raw = await callGeminiWithRetry(async () => {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        config: {
          systemInstruction: DNA_SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseSchema: buildDnaResponseSchema(),
          maxOutputTokens: 2048,
        },
      });
      const text = response.text;
      if (!text) throw new Error("Empty response from Gemini");
      return text;
    });
  } else if (provider === "claude") {
    raw = await callClaude(model, DNA_SYSTEM_PROMPT + "\n\n" + DNA_JSON_FIELDS_SPEC, userPrompt);
  } else if (provider === "deepseek") {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set.");
    raw = await callOpenAICompatible(
      "https://api.deepseek.com/v1",
      apiKey,
      model,
      DNA_SYSTEM_PROMPT + "\n\n" + DNA_JSON_FIELDS_SPEC,
      userPrompt,
    );
  } else if (provider === "siliconflow") {
    const apiKey = process.env.SILICON_FLOW_API_KEY;
    if (!apiKey) throw new Error("SILICON_FLOW_API_KEY is not set.");
    raw = await callOpenAICompatible(
      "https://api.siliconflow.cn/v1",
      apiKey,
      model,
      DNA_SYSTEM_PROMPT + "\n\n" + DNA_JSON_FIELDS_SPEC,
      userPrompt,
    );
  } else {
    throw new Error(`Unknown provider: ${provider}`);
  }

  logger.info({ title, singer, provider, model }, "DNA-only re-analysis generated");
  return parseDnaResponse(raw);
}

// ---------------------------------------------------------------------------
// Main entry point: YouTube or song-name generation
// ---------------------------------------------------------------------------

/**
 * Generate a full musicological dossier for a YouTube link or song name.
 * - flamingo provider: pass YouTube URL directly to Music Flamingo (audio-native).
 *   Song-name inputs fall back to knowledge-only with Gemini.
 * - gemini: download audio via yt-dlp and send inline.
 * - Other providers: text/knowledge-only (no audio).
 */
export async function generateSongMetadata(
  input: string,
  inputType: "youtube" | "name",
  provider = "gemini",
  model = "gemini-2.0-flash",
): Promise<SongMetadata> {
  // Music Flamingo path
  if (provider === "flamingo") {
    if (inputType === "youtube") {
      return generateFromFlamingo(input, "youtube");
    }
    // Name input: Flamingo needs audio — fall back to Gemini knowledge-only
    logger.info(
      { input },
      "Music Flamingo: no audio for name input — falling back to Gemini knowledge-only",
    );
    return generateFromKnowledgeOnly(input, "gemini", "gemini-2.0-flash");
  }

  // Non-Gemini text providers: skip audio download, go straight to knowledge-only
  if (provider !== "gemini" && inputType === "name") {
    return generateFromKnowledgeOnly(input, provider, model);
  }

  // Gemini (or non-Gemini with YouTube — download audio then use Gemini inline)
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
