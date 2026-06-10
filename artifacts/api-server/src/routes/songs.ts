import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, songsTable, type Song as DbSong } from "@workspace/db";
import { GenerateSongBody, GetSongParams, DeleteSongParams } from "@workspace/api-zod";
import { classifyInput, generateSongMetadata, isAllowedYouTubeUrl, isBotCheckError } from "../lib/songMetadata";
import { isVideoUnavailableError, fetchYouTubeOEmbedTitle } from "../lib/audioExtraction";

const router: IRouter = Router();

function serialize(row: DbSong) {
  return {
    id: row.id,
    title: row.title,
    singer: row.singer,
    era: row.era,
    geography: row.geography,
    inputType: row.inputType,
    inputValue: row.inputValue,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  };
}

function countBy(rows: DbSong[], key: (r: DbSong) => string) {
  const map = new Map<string, number>();
  for (const r of rows) {
    const label = (key(r) || "Unknown").trim() || "Unknown";
    map.set(label, (map.get(label) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

router.get("/songs", async (_req, res) => {
  const rows = await db.select().from(songsTable).orderBy(desc(songsTable.createdAt));
  res.json(rows.map(serialize));
});

router.get("/songs/stats", async (_req, res) => {
  const rows = await db.select().from(songsTable);
  res.json({
    total: rows.length,
    byEra: countBy(rows, (r) => r.era),
    byGeography: countBy(rows, (r) => r.geography),
    byDialect: countBy(rows, (r) => r.metadata?.dialect ?? "Unknown"),
  });
});

router.get("/songs/export", async (_req, res) => {
  const rows = await db.select().from(songsTable).orderBy(desc(songsTable.createdAt));
  res.json({
    generatedAt: new Date().toISOString(),
    count: rows.length,
    songs: rows.map(serialize),
  });
});

router.post("/songs", async (req, res) => {
  const parsed = GenerateSongBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "An input (song name or YouTube link) is required" });
  }

  const input = parsed.data.input.trim();
  if (!input) {
    return res.status(400).json({ error: "An input (song name or YouTube link) is required" });
  }
  const inputType = classifyInput(input);

  if (inputType === "youtube" && !isAllowedYouTubeUrl(input)) {
    return res.status(400).json({
      error: "That does not look like a valid YouTube link. Use a youtube.com or youtu.be URL.",
    });
  }

  let metadata;
  try {
    metadata = await generateSongMetadata(input, inputType);
  } catch (err) {
    req.log.error({ err }, "Song metadata generation failed");
    if (isBotCheckError(err)) {
      return res.status(503).json({
        error:
          "YouTube is currently blocking automated access from this server. This usually affects the published app. Adding a YTDLP_COOKIES secret resolves it.",
      });
    }
    if (inputType === "youtube" && isVideoUnavailableError(err)) {
      req.log.info({ input }, "Video unavailable — attempting oEmbed title fallback");
      const oEmbedTitle = await fetchYouTubeOEmbedTitle(input);
      if (oEmbedTitle) {
        req.log.info({ oEmbedTitle }, "oEmbed title retrieved; falling back to name-based generation");
        try {
          metadata = await generateSongMetadata(oEmbedTitle, "name");
        } catch (fallbackErr) {
          req.log.error({ fallbackErr }, "Name-based fallback generation failed");
          return res.status(502).json({ error: "Could not generate metadata for this song. Please try again." });
        }
        const [row] = await db
          .insert(songsTable)
          .values({
            title: metadata.title || oEmbedTitle,
            singer: metadata.singer || "Unknown",
            era: metadata.era || "Unknown",
            geography: metadata.geography || "Unknown",
            inputType: "name",
            inputValue: oEmbedTitle,
            metadata,
          })
          .returning();
        return res.status(201).json(serialize(row));
      }
    }
    return res.status(502).json({
      error:
        inputType === "youtube"
          ? "Could not access this video. Check the YouTube link and try again."
          : "Could not find a matching recording for that name. Try a YouTube link or a more specific name.",
    });
  }

  const [row] = await db
    .insert(songsTable)
    .values({
      title: metadata.title || (inputType === "name" ? input : "Untitled"),
      singer: metadata.singer || "Unknown",
      era: metadata.era || "Unknown",
      geography: metadata.geography || "Unknown",
      inputType,
      inputValue: input,
      metadata,
    })
    .returning();

  return res.status(201).json(serialize(row));
});

router.get("/songs/:id", async (req, res) => {
  const parsed = GetSongParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Song not found" });
  }
  const [row] = await db.select().from(songsTable).where(eq(songsTable.id, parsed.data.id));
  if (!row) {
    return res.status(404).json({ error: "Song not found" });
  }
  return res.json(serialize(row));
});

router.delete("/songs/:id", async (req, res) => {
  const parsed = DeleteSongParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Song not found" });
  }
  const [row] = await db
    .delete(songsTable)
    .where(eq(songsTable.id, parsed.data.id))
    .returning();
  if (!row) {
    return res.status(404).json({ error: "Song not found" });
  }
  return res.status(204).end();
});

export default router;
