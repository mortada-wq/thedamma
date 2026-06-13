import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export type EntryDescription = {
  label: string;
  text: string;
};

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  category: text("category").notNull(), // rag-dataset | fine-tune | document | other
  provider: text("provider").notNull().default("gemini"),
  summary: text("summary"),
  isPublic: boolean("is_public").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const entriesTable = pgTable("entries", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  inputUrl: text("input_url").notNull(),
  aiQuestion: text("ai_question"),
  descriptions: jsonb("descriptions")
    .$type<EntryDescription[]>()
    .notNull()
    .default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;

export const insertEntrySchema = createInsertSchema(entriesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertEntry = z.infer<typeof insertEntrySchema>;
export type Entry = typeof entriesTable.$inferSelect;

// ── Project members ──────────────────────────────────────────────────────────
export const projectMembersTable = pgTable(
  "project_members",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // owner | member
    addedAt: timestamp("added_at").defaultNow().notNull(),
  },
  (t) => [unique("project_members_unique").on(t.projectId, t.userId)],
);

export type ProjectMember = typeof projectMembersTable.$inferSelect;

// ── Tasks ─────────────────────────────────────────────────────────────────────
export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("todo"), // todo | in_progress | done
  assigneeId: integer("assignee_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdBy: integer("created_by")
    .notNull()
    .references(() => usersTable.id),
  dueDate: timestamp("due_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertTaskSchema = createInsertSchema(tasksTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;

// ── Project chat ──────────────────────────────────────────────────────────────
export const projectMessagesTable = pgTable("project_messages", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  senderId: integer("sender_id").references(() => usersTable.id), // null when isAi = true
  isAi: boolean("is_ai").notNull().default(false),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ProjectMessage = typeof projectMessagesTable.$inferSelect;
