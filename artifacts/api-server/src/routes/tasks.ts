import { Router } from "express";
import { db, projectsTable, projectMembersTable, tasksTable, usersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { ai } from "@workspace/integrations-gemini-ai";
import { requireApproved, requireMember } from "./project-members";

const router = Router();

const TASK_STATUSES = ["todo", "in_progress", "done"] as const;

// ── GET /projects/:id/tasks — list tasks ─────────────────────────────────────
router.get("/projects/:id/tasks", requireApproved, requireMember, async (req: any, res) => {
  const projectId = Number(req.params.id);

  const rows = await db
    .select({
      id: tasksTable.id,
      projectId: tasksTable.projectId,
      title: tasksTable.title,
      description: tasksTable.description,
      status: tasksTable.status,
      assigneeId: tasksTable.assigneeId,
      assigneeEmail: usersTable.email,
      createdBy: tasksTable.createdBy,
      dueDate: tasksTable.dueDate,
      createdAt: tasksTable.createdAt,
      updatedAt: tasksTable.updatedAt,
    })
    .from(tasksTable)
    .leftJoin(usersTable, eq(tasksTable.assigneeId, usersTable.id))
    .where(eq(tasksTable.projectId, projectId))
    .orderBy(desc(tasksTable.createdAt));

  res.json(rows);
});

// ── POST /projects/:id/tasks — create a task ─────────────────────────────────
const CreateTaskBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  assigneeId: z.number().int().optional(),
  dueDate: z.string().datetime().optional(),
});

router.post("/projects/:id/tasks", requireApproved, requireMember, async (req: any, res) => {
  const projectId = Number(req.params.id);
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid task data", details: parsed.error.issues });
    return;
  }

  const { title, description, assigneeId, dueDate } = parsed.data;

  if (assigneeId !== undefined) {
    const [assigneeMembership] = await db
      .select({ id: projectMembersTable.id })
      .from(projectMembersTable)
      .where(and(eq(projectMembersTable.projectId, projectId), eq(projectMembersTable.userId, assigneeId)))
      .limit(1);
    if (!assigneeMembership) {
      res.status(400).json({ error: "Assignee must be a project member" });
      return;
    }
  }

  const [task] = await db
    .insert(tasksTable)
    .values({
      projectId,
      title,
      description,
      assigneeId,
      createdBy: req.currentUser.id,
      dueDate: dueDate ? new Date(dueDate) : undefined,
    })
    .returning();

  req.log.info({ taskId: task.id, projectId }, "Task created");
  res.status(201).json(task);
});

// ── PATCH /projects/:id/tasks/:taskId — update a task ────────────────────────
const UpdateTaskBody = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  assigneeId: z.number().int().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
});

router.patch("/projects/:id/tasks/:taskId", requireApproved, requireMember, async (req: any, res) => {
  const projectId = Number(req.params.id);
  const taskId = Number(req.params.taskId);

  const parsed = UpdateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid update data", details: parsed.error.issues });
    return;
  }

  const [existing] = await db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .where(and(eq(tasksTable.id, taskId), eq(tasksTable.projectId, projectId)))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const { dueDate, ...rest } = parsed.data;

  if (rest.assigneeId !== undefined && rest.assigneeId !== null) {
    const [assigneeMembership] = await db
      .select({ id: projectMembersTable.id })
      .from(projectMembersTable)
      .where(and(eq(projectMembersTable.projectId, projectId), eq(projectMembersTable.userId, rest.assigneeId)))
      .limit(1);
    if (!assigneeMembership) {
      res.status(400).json({ error: "Assignee must be a project member" });
      return;
    }
  }

  const [updated] = await db
    .update(tasksTable)
    .set({
      ...rest,
      ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(tasksTable.id, taskId))
    .returning();

  res.json(updated);
});

// ── DELETE /projects/:id/tasks/:taskId ───────────────────────────────────────
router.delete("/projects/:id/tasks/:taskId", requireApproved, requireMember, async (req: any, res) => {
  const projectId = Number(req.params.id);
  const taskId = Number(req.params.taskId);

  const [existing] = await db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .where(and(eq(tasksTable.id, taskId), eq(tasksTable.projectId, projectId)))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
  res.status(204).end();
});

// ── POST /projects/:id/tasks/suggest — AI task breakdown ─────────────────────
router.post("/projects/:id/tasks/suggest", requireApproved, requireMember, async (req: any, res) => {
  const projectId = Number(req.params.id);

  const [project] = await db
    .select({ title: projectsTable.title, category: projectsTable.category, summary: projectsTable.summary })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const existingTasks = await db
    .select({ title: tasksTable.title })
    .from(tasksTable)
    .where(eq(tasksTable.projectId, projectId));

  const prompt = `You are helping plan work for a project titled "${project.title}" (category: ${project.category}).${
    project.summary ? ` Summary: ${project.summary}.` : ""
  }
${
  existingTasks.length > 0
    ? `Existing tasks: ${existingTasks.map((t) => t.title).join(", ")}.`
    : "There are no existing tasks yet."
}

Suggest up to 5 new, concrete, non-duplicate tasks that would help move this project forward.

Return ONLY valid JSON with this shape:
{
  "suggestions": [
    { "title": "...", "description": "..." }
  ]
}`;

  try {
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
    res.json({ suggestions: parsed.suggestions ?? [] });
  } catch (err) {
    req.log.error(err, "Task suggestion generation failed");
    res.status(502).json({ error: "Failed to generate task suggestions" });
  }
});

export default router;
