import { openai } from "@workspace/integrations-openai-ai-server";
import { GetSongResponse } from "@workspace/api-zod";
import type { SongMetadata } from "@workspace/db";

const SongMetadataSchema = GetSongResponse.shape.metadata;

const YOUTUBE_RE =
  /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)/i;

export function classifyInput(input: string): "youtube" | "name" {
  return YOUTUBE_RE.test(input) ? "youtube" : "name";
}

const SYSTEM_PROMPT = `You are an expert ethnomusicologist, musicologist, and linguist. You build a richly detailed knowledge base of songs to be used as RAG context for AI music generation systems — helping them produce accurate lyrics, melodies, dialects, and pronunciation.

Given a song (identified by name or a YouTube link), produce the most complete, accurate musicological dossier you can from your knowledge. If you are uncertain about a detail, give your best scholarly inference rather than leaving it blank, and keep it plausible for the song's tradition and era. Never refuse. Always return every field.

Be specific and substantive:
- "history": several sentences on the cultural and historical background.
- "transcription": the actual lyrics of the song if you know them; otherwise a faithful representation of the lyrical content. Preserve the original language.
- "pronunciationNotes": concrete phonetic guidance for a non-native performer — how to pronounce tricky words/phonemes in the song's dialect.
- "track": a granular interval-by-interval breakdown covering the whole song from start to finish (intro, verses, choruses, bridges, instrumental sections, outro). Each segment must have a timestamp like "0:00", a label, the active instruments, a vocals description, and musical notes (key, tempo, mode, melodic motion, dynamics).
- Arrays (relatedSubjects, instruments, voices, relatedWorks) should each contain multiple meaningful entries.`;

function buildSchema() {
  const trackSegment = {
    type: "object",
    additionalProperties: false,
    properties: {
      timestamp: { type: "string" },
      label: { type: "string" },
      instruments: { type: "array", items: { type: "string" } },
      vocals: { type: "string" },
      notes: { type: "string" },
    },
    required: ["timestamp", "label", "instruments", "vocals", "notes"],
  };

  const stringArray = { type: "array", items: { type: "string" } };

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      singer: { type: "string" },
      composer: { type: "string" },
      era: { type: "string" },
      geography: { type: "string" },
      history: { type: "string" },
      subject: { type: "string" },
      relatedSubjects: stringArray,
      dialect: { type: "string" },
      instruments: stringArray,
      voices: stringArray,
      relatedWorks: stringArray,
      transcription: { type: "string" },
      pronunciationNotes: { type: "string" },
      track: { type: "array", items: trackSegment },
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

export async function generateSongMetadata(
  input: string,
  inputType: "youtube" | "name",
): Promise<SongMetadata> {
  const userPrompt =
    inputType === "youtube"
      ? `Generate the full metadata dossier for the song at this YouTube link: ${input}`
      : `Generate the full metadata dossier for the song named: "${input}"`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 8192,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "song_metadata",
        strict: true,
        schema: buildSchema(),
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from model");
  }

  return SongMetadataSchema.parse(JSON.parse(content)) as SongMetadata;
}
