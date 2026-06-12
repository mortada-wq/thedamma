import { Router, type IRouter } from "express";
import { rm } from "node:fs/promises";
import { desc, eq } from "drizzle-orm";
import multer from "multer";
import { db, songsTable, type Song as DbSong } from "@workspace/db";
import { GenerateSongBody, GetSongParams, DeleteSongParams } from "@workspace/api-zod";
import { classifyInput, generateSongMetadata, generateFromKnowledgeOnly, generateFromUploadedAudio, generateDnaOnly, isAllowedYouTubeUrl, isBotCheckError } from "../lib/songMetadata";
import { getSettings } from "./admin";
import { isVideoUnavailableError, isYtDlpUnavailableError, fetchYouTubeOEmbedTitle } from "../lib/audioExtraction";

const upload = multer({
  dest: "/tmp",
  limits: { fileSize: 200 * 1024 * 1024 },
});

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
    analyzedAt: row.analyzedAt.toISOString(),
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

function extractMaqamName(entry: string): string {
  return (entry.split(" — ")[0] || entry).trim();
}

function countByArray(rows: DbSong[], extract: (r: DbSong) => string[]) {
  const map = new Map<string, number>();
  for (const r of rows) {
    for (const label of extract(r)) {
      const key = label.trim();
      if (key) map.set(key, (map.get(key) ?? 0) + 1);
    }
  }
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

router.post("/songs/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file provided" });
  }
  const { path: filePath, originalname } = req.file;
  try {
    const metadata = await generateFromUploadedAudio(filePath, originalname);
    const [row] = await db
      .insert(songsTable)
      .values({
        title: metadata.title || originalname,
        singer: metadata.singer || "Unknown",
        era: metadata.era || "Unknown",
        geography: metadata.geography || "Unknown",
        inputType: "file",
        inputValue: originalname,
        metadata,
      })
      .returning();
    return res.status(201).json(serialize(row));
  } catch (err) {
    req.log.error({ err }, "Upload generation failed");
    return res.status(502).json({
      error: "Could not analyze the uploaded file. Make sure it contains audio and try again.",
    });
  } finally {
    await rm(filePath, { force: true }).catch(() => {});
  }
});

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
    byMaqam: countByArray(rows, (r) =>
      (r.metadata?.maqamat ?? []).map(extractMaqamName)
    ),
    byIqa: countByArray(rows, (r) => r.metadata?.iqaat ?? []),
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

  const { activeProvider, activeModel } = await getSettings();
  req.log.info({ activeProvider, activeModel }, "Using AI provider");

  let metadata;
  let savedInputType = inputType;
  let savedInputValue = input;
  let generationNote: string | undefined;

  try {
    metadata = await generateSongMetadata(input, inputType, activeProvider, activeModel);
  } catch (err) {
    req.log.error({ err }, "Primary generation failed");

    if (isYtDlpUnavailableError(err)) {
      // yt-dlp binary is not installed in this environment (production container).
      // Resolve the video title via oEmbed (no auth needed) and fall back to knowledge-only.
      req.log.warn({ input }, "yt-dlp unavailable — falling back to oEmbed + knowledge-only generation");
      let fallbackTitle: string | null = inputType === "name" ? input : null;
      if (inputType === "youtube") {
        fallbackTitle = await fetchYouTubeOEmbedTitle(input);
        req.log.info({ fallbackTitle }, "yt-dlp unavailable — resolved oEmbed title for knowledge fallback");
      }
      if (!fallbackTitle) {
        return res.status(503).json({
          error:
            "Audio extraction is unavailable in this environment and the video title could not be resolved. Try entering the song name directly instead of a link.",
        });
      }
      try {
        req.log.info({ fallbackTitle, activeProvider, activeModel }, "yt-dlp unavailable — knowledge-only fallback");
        metadata = await generateFromKnowledgeOnly(fallbackTitle, activeProvider, activeModel);
        savedInputType = "name";
        savedInputValue = fallbackTitle;
        generationNote =
          "Dossier generated from knowledge only — audio extraction is unavailable in this environment.";
      } catch (fallbackErr) {
        req.log.error({ fallbackErr }, "Knowledge-only fallback failed");
        return res.status(503).json({
          error:
            "Audio extraction is unavailable and the knowledge-only fallback also failed. Please try again.",
        });
      }
    } else if (isBotCheckError(err)) {
      // YouTube is blocking yt-dlp on this IP. Fall back to knowledge-only.
      // For a URL we first resolve the video title via oEmbed (no auth needed).
      let fallbackTitle: string | null = inputType === "name" ? input : null;
      if (inputType === "youtube") {
        fallbackTitle = await fetchYouTubeOEmbedTitle(input);
        req.log.info({ fallbackTitle }, "Bot-check — resolved oEmbed title for knowledge fallback");
      }
      if (!fallbackTitle) {
        return res.status(503).json({
          error:
            "YouTube is blocking automated access from this server. Paste the song title into the search box instead of a link.",
        });
      }
      try {
        req.log.info({ fallbackTitle, activeProvider, activeModel }, "Falling back to knowledge-only generation");
        metadata = await generateFromKnowledgeOnly(fallbackTitle, activeProvider, activeModel);
        savedInputType = "name";
        savedInputValue = fallbackTitle;
      } catch (fallbackErr) {
        req.log.error({ fallbackErr }, "Knowledge-only fallback failed");
        return res.status(503).json({
          error: "YouTube is blocking access and the knowledge-only fallback also failed. Please try again.",
        });
      }
    } else if (inputType === "youtube" && isVideoUnavailableError(err)) {
      req.log.info({ input }, "Video unavailable — attempting oEmbed title fallback");
      const oEmbedTitle = await fetchYouTubeOEmbedTitle(input);
      if (oEmbedTitle) {
        req.log.info({ oEmbedTitle }, "oEmbed title retrieved; retrying as name-based search");
        try {
          metadata = await generateSongMetadata(oEmbedTitle, "name", activeProvider, activeModel);
          savedInputType = "name";
          savedInputValue = oEmbedTitle;
        } catch (fallbackErr) {
          req.log.error({ fallbackErr }, "Name-based fallback generation failed");
          return res.status(502).json({ error: "Could not generate metadata for this song. Please try again." });
        }
      } else {
        return res.status(502).json({ error: "That video is unavailable. Try a different link or type the song name." });
      }
    } else if (inputType === "youtube") {
      // Unrecognised YouTube error — try oEmbed title → knowledge-only as last resort
      req.log.warn({ err }, "Unrecognised YouTube error — attempting oEmbed fallback");
      const oEmbedTitle = await fetchYouTubeOEmbedTitle(input);
      if (!oEmbedTitle) {
        return res.status(503).json({
          error:
            "YouTube is not accessible from this server. Paste the song title into the search box instead of a link.",
        });
      }
      try {
        req.log.info({ oEmbedTitle, activeProvider, activeModel }, "YouTube blocked — knowledge-only fallback");
        metadata = await generateFromKnowledgeOnly(oEmbedTitle, activeProvider, activeModel);
        savedInputType = "name";
        savedInputValue = oEmbedTitle;
        generationNote =
          "Dossier generated from knowledge only — YouTube audio could not be accessed from this server.";
      } catch (fallbackErr) {
        req.log.error({ fallbackErr }, "Knowledge-only fallback failed after YouTube block");
        return res.status(503).json({
          error:
            "YouTube is not accessible from this server and the knowledge-only fallback also failed. Please try again.",
        });
      }
    } else {
      return res.status(502).json({
        error: "Could not find a matching recording for that name. Try a YouTube link or a more specific name.",
      });
    }
  }

  const [row] = await db
    .insert(songsTable)
    .values({
      title: metadata.title || (savedInputType === "name" ? savedInputValue : "Untitled"),
      singer: metadata.singer || "Unknown",
      era: metadata.era || "Unknown",
      geography: metadata.geography || "Unknown",
      inputType: savedInputType,
      inputValue: savedInputValue,
      metadata,
    })
    .returning();

  const serialized = serialize(row);
  return res.status(201).json(generationNote ? { ...serialized, generationNote } : serialized);
});

router.post("/songs/:id/reanalyze", async (req, res) => {
  const parsed = GetSongParams.safeParse(req.params);
  if (!parsed.success) return res.status(404).json({ error: "Song not found" });

  const [current] = await db.select().from(songsTable).where(eq(songsTable.id, parsed.data.id));
  if (!current) return res.status(404).json({ error: "Song not found" });

  const { activeProvider, activeModel } = await getSettings();
  req.log.info({ id: parsed.data.id, activeProvider, activeModel, inputType: current.inputType }, "Re-analyzing full dossier (draft mode)");

  const inputType = current.inputType as "youtube" | "name" | "file";
  const inputValue = current.inputValue;

  let metadata;
  let generationNote: string | undefined;

  // File uploads can't be re-downloaded; fall back to knowledge-only from the song title
  if (inputType === "file") {
    const fallbackTitle = current.metadata?.title || current.title;
    try {
      metadata = await generateFromKnowledgeOnly(fallbackTitle, activeProvider, activeModel);
      generationNote = "Dossier regenerated from knowledge only — original audio file is no longer available.";
    } catch (err) {
      req.log.error({ err }, "Knowledge-only re-analysis failed for uploaded file");
      return res.status(502).json({ error: "Re-analysis failed. Please try again." });
    }
  } else {
    try {
      metadata = await generateSongMetadata(inputValue, inputType, activeProvider, activeModel);
    } catch (err) {
      req.log.error({ err }, "Primary re-analysis generation failed");

      if (isYtDlpUnavailableError(err)) {
        let fallbackTitle: string | null = inputType === "name" ? inputValue : null;
        if (inputType === "youtube") {
          fallbackTitle = await fetchYouTubeOEmbedTitle(inputValue);
        }
        if (!fallbackTitle) {
          return res.status(503).json({
            error: "Audio extraction is unavailable in this environment. Try entering the song name directly.",
          });
        }
        try {
          metadata = await generateFromKnowledgeOnly(fallbackTitle, activeProvider, activeModel);
          generationNote = "Dossier regenerated from knowledge only — audio extraction is unavailable in this environment.";
        } catch (fallbackErr) {
          req.log.error({ fallbackErr }, "Knowledge-only fallback failed during re-analysis");
          return res.status(503).json({ error: "Audio extraction is unavailable and the knowledge-only fallback also failed. Please try again." });
        }
      } else if (isBotCheckError(err)) {
        let fallbackTitle: string | null = inputType === "name" ? inputValue : null;
        if (inputType === "youtube") {
          fallbackTitle = await fetchYouTubeOEmbedTitle(inputValue);
        }
        if (!fallbackTitle) {
          return res.status(503).json({
            error: "YouTube is blocking automated access. Try using the song name instead.",
          });
        }
        try {
          metadata = await generateFromKnowledgeOnly(fallbackTitle, activeProvider, activeModel);
        } catch (fallbackErr) {
          req.log.error({ fallbackErr }, "Knowledge-only fallback failed during re-analysis");
          return res.status(503).json({ error: "YouTube is blocking access and the knowledge-only fallback also failed. Please try again." });
        }
      } else if (inputType === "youtube" && isVideoUnavailableError(err)) {
        const oEmbedTitle = await fetchYouTubeOEmbedTitle(inputValue);
        if (oEmbedTitle) {
          try {
            metadata = await generateSongMetadata(oEmbedTitle, "name", activeProvider, activeModel);
          } catch (fallbackErr) {
            req.log.error({ fallbackErr }, "Name-based fallback failed during re-analysis");
            return res.status(502).json({ error: "Could not re-analyze this song. The video may be unavailable. Please try again." });
          }
        } else {
          return res.status(502).json({ error: "That video is unavailable. The dossier could not be refreshed." });
        }
      } else if (inputType === "youtube") {
        // Unrecognised YouTube error in re-analysis — oEmbed → knowledge-only last resort
        req.log.warn({ err }, "Unrecognised YouTube error during re-analysis — attempting oEmbed fallback");
        const oEmbedTitle = await fetchYouTubeOEmbedTitle(inputValue);
        if (!oEmbedTitle) {
          return res.status(503).json({
            error: "YouTube is not accessible from this server. Re-analysis unavailable for this entry.",
          });
        }
        try {
          metadata = await generateFromKnowledgeOnly(oEmbedTitle, activeProvider, activeModel);
          generationNote = "Dossier regenerated from knowledge only — YouTube audio could not be accessed from this server.";
        } catch (fallbackErr) {
          req.log.error({ fallbackErr }, "Knowledge-only fallback failed during re-analysis after YouTube block");
          return res.status(503).json({ error: "Re-analysis failed. Please try again." });
        }
      } else {
        return res.status(502).json({ error: "Re-analysis failed. Please try again." });
      }
    }
  }

  // Return the draft for user review — do NOT write to DB yet
  return res.json({
    current: serialize(current),
    draft: metadata,
    ...(generationNote ? { generationNote } : {}),
  });
});

router.post("/songs/:id/commit-draft", async (req, res) => {
  const parsed = GetSongParams.safeParse(req.params);
  if (!parsed.success) return res.status(404).json({ error: "Song not found" });

  const [current] = await db.select().from(songsTable).where(eq(songsTable.id, parsed.data.id));
  if (!current) return res.status(404).json({ error: "Song not found" });

  const body = req.body as { metadata?: unknown; generationNote?: string };
  if (!body.metadata || typeof body.metadata !== "object") {
    return res.status(400).json({ error: "A metadata object is required" });
  }

  const metadata = body.metadata as typeof current.metadata;

  const [updated] = await db
    .update(songsTable)
    .set({
      title: metadata.title || current.title,
      singer: metadata.singer || current.singer,
      era: metadata.era || current.era,
      geography: metadata.geography || current.geography,
      metadata,
      analyzedAt: new Date(),
    })
    .where(eq(songsTable.id, parsed.data.id))
    .returning();

  req.log.info({ id: parsed.data.id }, "Draft committed to DB");
  const serialized = serialize(updated);
  return res.json(body.generationNote ? { ...serialized, generationNote: body.generationNote } : serialized);
});

router.post("/songs/:id/reanalyze-dna", async (req, res) => {
  const parsed = GetSongParams.safeParse(req.params);
  if (!parsed.success) return res.status(404).json({ error: "Song not found" });

  const [current] = await db.select().from(songsTable).where(eq(songsTable.id, parsed.data.id));
  if (!current) return res.status(404).json({ error: "Song not found" });

  const { activeProvider, activeModel } = await getSettings();
  req.log.info({ id: parsed.data.id, activeProvider, activeModel }, "Re-analyzing Musical DNA");

  let dna;
  try {
    dna = await generateDnaOnly(
      current.metadata?.title || current.title,
      current.metadata?.singer || current.singer,
      activeProvider,
      activeModel,
    );
  } catch (err) {
    req.log.error({ err }, "DNA re-analysis failed");
    return res.status(502).json({ error: "DNA re-analysis failed. Please try again." });
  }

  const mergedMetadata = {
    ...current.metadata,
    maqamat: dna.maqamat,
    iqaat: dna.iqaat,
    ornamentation: dna.ornamentation,
  };

  const [updated] = await db
    .update(songsTable)
    .set({ metadata: mergedMetadata, analyzedAt: new Date() })
    .where(eq(songsTable.id, parsed.data.id))
    .returning();

  return res.json(serialize(updated));
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

router.patch("/songs/:id", async (req, res) => {
  const parsed = GetSongParams.safeParse(req.params);
  if (!parsed.success) return res.status(404).json({ error: "Song not found" });

  const [current] = await db.select().from(songsTable).where(eq(songsTable.id, parsed.data.id));
  if (!current) return res.status(404).json({ error: "Song not found" });

  const body = req.body as {
    title?: string;
    singer?: string;
    era?: string;
    geography?: string;
    metadata?: Partial<typeof current.metadata>;
  };

  const mergedMetadata = body.metadata
    ? { ...current.metadata, ...body.metadata }
    : current.metadata;

  const [updated] = await db
    .update(songsTable)
    .set({
      title: body.title ?? current.title,
      singer: body.singer ?? current.singer,
      era: body.era ?? current.era,
      geography: body.geography ?? current.geography,
      metadata: mergedMetadata,
    })
    .where(eq(songsTable.id, parsed.data.id))
    .returning();

  return res.json(serialize(updated));
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
