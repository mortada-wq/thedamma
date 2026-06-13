import { Router } from "express";
import { db, projectsTable, entriesTable, usersTable, projectMembersTable } from "@workspace/db";
import { eq, desc, and, count } from "drizzle-orm";
import { z } from "zod";
import { ai } from "@workspace/integrations-gemini-ai";

const router = Router();

// ── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req: any, res: any, next: any) {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

function requireApproved(req: any, res: any, next: any) {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  // role is checked at the handler level for approved
  next();
}

// ── Helpers ─────────────────────────────────────────────────────────────────
async function getApprovedUser(userId: number) {
  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return user;
}

export async function getMembership(projectId: number, userId: number) {
  const [membership] = await db
    .select({ role: projectMembersTable.role })
    .from(projectMembersTable)
    .where(and(eq(projectMembersTable.projectId, projectId), eq(projectMembersTable.userId, userId)))
    .limit(1);
  return membership;
}

async function generateEntryContent(inputUrl: string): Promise<{
  aiQuestion: string;
  descriptions: { label: string; text: string }[];
}> {
  const prompt = `You are an AI assistant helping a user build a structured dataset entry.

The user has provided this input: "${inputUrl}"

Your job:
1. Ask a focused clarifying question that helps the user describe what they want from this input (what they want the AI to generate/extract/analyze from it).
2. Generate two descriptions of this input in different styles:
   - Description 1 (label: "Descriptive"): a detailed, factual description of what this input contains or represents.
   - Description 2 (label: "Generative"): a creative, generative framing — how this input could be used as a prompt or seed for AI generation.

Return ONLY valid JSON with this shape:
{
  "aiQuestion": "Your clarifying question here",
  "descriptions": [
    { "label": "Descriptive", "text": "..." },
    { "label": "Generative", "text": "..." }
  ]
}`;

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 1024,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Empty response from AI");
  const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/m, "").trim());
  return parsed;
}

async function generateProjectSummary(title: string, category: string): Promise<string> {
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Write a single sentence (max 20 words) summarizing a user project titled "${title}" of type "${category}". Return only the sentence, no quotes.`,
          },
        ],
      },
    ],
    config: { maxOutputTokens: 64 },
  });
  return response.text?.trim() ?? title;
}

// ── Public gallery (no auth required) ───────────────────────────────────────
router.get("/projects/public", async (_req, res) => {
  const rows = await db
    .select({
      id: projectsTable.id,
      title: projectsTable.title,
      category: projectsTable.category,
      summary: projectsTable.summary,
      createdAt: projectsTable.createdAt,
      ownerEmail: usersTable.email,
    })
    .from(projectsTable)
    .innerJoin(usersTable, eq(projectsTable.userId, usersTable.id))
    .where(eq(projectsTable.isPublic, true))
    .orderBy(desc(projectsTable.createdAt))
    .limit(6);
  res.json(rows);
});

// ── List my projects ─────────────────────────────────────────────────────────
router.get("/projects", requireAuth, async (req, res) => {
  const user = await getApprovedUser(req.session.userId!);
  if (!user || user.role === "pending") {
    res.status(403).json({ error: "Account pending approval" });
    return;
  }

  const rows = await db
    .select({
      id: projectsTable.id,
      title: projectsTable.title,
      category: projectsTable.category,
      provider: projectsTable.provider,
      summary: projectsTable.summary,
      isPublic: projectsTable.isPublic,
      createdAt: projectsTable.createdAt,
      entryCount: count(entriesTable.id),
    })
    .from(projectsTable)
    .innerJoin(projectMembersTable, eq(projectMembersTable.projectId, projectsTable.id))
    .leftJoin(entriesTable, eq(entriesTable.projectId, projectsTable.id))
    .where(eq(projectMembersTable.userId, user.id))
    .groupBy(projectsTable.id)
    .orderBy(desc(projectsTable.createdAt));

  res.json(rows);
});

// ── Create project ───────────────────────────────────────────────────────────
const CreateProjectBody = z.object({
  title: z.string().min(1).max(200),
  category: z.enum(["rag-dataset", "fine-tune", "document", "other"]),
  provider: z.string().min(1).default("gemini"),
});

router.post("/projects", requireAuth, async (req, res) => {
  const user = await getApprovedUser(req.session.userId!);
  if (!user || user.role === "pending") {
    res.status(403).json({ error: "Account pending approval" });
    return;
  }

  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid project data", details: parsed.error.issues });
    return;
  }

  const { title, category, provider } = parsed.data;
  const summary = await generateProjectSummary(title, category).catch(() => null);

  const [project] = await db
    .insert(projectsTable)
    .values({ userId: user.id, title, category, provider, summary })
    .returning();

  await db
    .insert(projectMembersTable)
    .values({ projectId: project.id, userId: user.id, role: "owner" });

  req.log.info({ projectId: project.id }, "Project created");
  res.status(201).json({ ...project, entryCount: 0 });
});

// ── Get project + entries ────────────────────────────────────────────────────
router.get("/projects/:id", requireAuth, async (req, res) => {
  const user = await getApprovedUser(req.session.userId!);
  if (!user || user.role === "pending") {
    res.status(403).json({ error: "Account pending approval" });
    return;
  }

  const projectId = Number(req.params.id);
  const membership = await getMembership(projectId, user.id);
  if (!membership) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const entries = await db
    .select()
    .from(entriesTable)
    .where(eq(entriesTable.projectId, projectId))
    .orderBy(entriesTable.createdAt);

  res.json({ ...project, role: membership.role, entries });
});

// ── Update project (title, isPublic) ────────────────────────────────────────
const UpdateProjectBody = z.object({
  title: z.string().min(1).max(200).optional(),
  isPublic: z.boolean().optional(),
});

router.patch("/projects/:id", requireAuth, async (req, res) => {
  const user = await getApprovedUser(req.session.userId!);
  if (!user || user.role === "pending") {
    res.status(403).json({ error: "Account pending approval" });
    return;
  }

  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid update data" });
    return;
  }

  const projectId = Number(req.params.id);
  const membership = await getMembership(projectId, user.id);
  if (!membership || membership.role !== "owner") {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const [updated] = await db
    .update(projectsTable)
    .set(parsed.data)
    .where(eq(projectsTable.id, projectId))
    .returning();

  res.json(updated);
});

// ── Delete project ───────────────────────────────────────────────────────────
router.delete("/projects/:id", requireAuth, async (req, res) => {
  const user = await getApprovedUser(req.session.userId!);
  if (!user || user.role === "pending") {
    res.status(403).json({ error: "Account pending approval" });
    return;
  }

  const projectId = Number(req.params.id);
  const membership = await getMembership(projectId, user.id);
  if (!membership || membership.role !== "owner") {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  res.status(204).end();
});

// ── Add entry to project ─────────────────────────────────────────────────────
const CreateEntryBody = z.object({
  inputUrl: z.string().min(1),
});

router.post("/projects/:id/entries", requireAuth, async (req, res) => {
  const user = await getApprovedUser(req.session.userId!);
  if (!user || user.role === "pending") {
    res.status(403).json({ error: "Account pending approval" });
    return;
  }

  const parsed = CreateEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "inputUrl is required" });
    return;
  }

  const projectId = Number(req.params.id);
  const membership = await getMembership(projectId, user.id);
  if (!membership) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const { aiQuestion, descriptions } = await generateEntryContent(parsed.data.inputUrl);

  const [entry] = await db
    .insert(entriesTable)
    .values({
      projectId,
      inputUrl: parsed.data.inputUrl,
      aiQuestion,
      descriptions,
    })
    .returning();

  req.log.info({ entryId: entry.id, projectId }, "Entry created");
  res.status(201).json(entry);
});

// ── Delete entry ─────────────────────────────────────────────────────────────
router.delete("/projects/:id/entries/:entryId", requireAuth, async (req, res) => {
  const user = await getApprovedUser(req.session.userId!);
  if (!user || user.role === "pending") {
    res.status(403).json({ error: "Account pending approval" });
    return;
  }

  const projectId = Number(req.params.id);
  const entryId = Number(req.params.entryId);

  const membership = await getMembership(projectId, user.id);
  if (!membership) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  await db.delete(entriesTable).where(eq(entriesTable.id, entryId));
  res.status(204).end();
});

// ── Export project as JSON ───────────────────────────────────────────────────
router.get("/projects/:id/export", requireAuth, async (req, res) => {
  const user = await getApprovedUser(req.session.userId!);
  if (!user || user.role === "pending") {
    res.status(403).json({ error: "Account pending approval" });
    return;
  }

  const projectId = Number(req.params.id);
  const membership = await getMembership(projectId, user.id);
  if (!membership) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const entries = await db
    .select()
    .from(entriesTable)
    .where(eq(entriesTable.projectId, projectId))
    .orderBy(entriesTable.createdAt);

  res.setHeader("Content-Disposition", `attachment; filename="project-${projectId}.json"`);
  res.json({ project, entries, exportedAt: new Date().toISOString() });
});

export default router;
