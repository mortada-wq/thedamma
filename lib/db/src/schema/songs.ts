import { pgTable, serial, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type TrackSegment = {
  timestamp: string;
  label: string;
  instruments: string[];
  vocals: string;
  notes: string;
};

export type SongMetadata = {
  title: string;
  singer: string;
  composer: string;
  era: string;
  geography: string;
  history: string;
  subject: string;
  relatedSubjects: string[];
  dialect: string;
  instruments: string[];
  voices: string[];
  relatedWorks: string[];
  transcription: string;
  pronunciationNotes: string;
  track: TrackSegment[];
};

export const songsTable = pgTable("songs", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  singer: text("singer").notNull(),
  era: text("era").notNull(),
  geography: text("geography").notNull(),
  inputType: text("input_type").notNull(),
  inputValue: text("input_value").notNull(),
  metadata: jsonb("metadata").$type<SongMetadata>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSongSchema = createInsertSchema(songsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertSong = z.infer<typeof insertSongSchema>;
export type Song = typeof songsTable.$inferSelect;
