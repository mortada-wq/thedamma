import { Router } from "express";
import { db, projectsTable, projectMessagesTable, tasksTable, usersTable } from "@workspace/db";
import { eq, and, gt, desc } from "drizzle-orm";
import { z } from "zod";
import { ai } from "@workspace/integrations-gemini-ai";
import { requireApproved, requireMember } from "./project-members";

const router = Router();

// ── GET /projects/:id/messages — poll messages ───────────────────────────────
router.get("/projects/:id/messages", requireApproved, requireMember, async (req: any, res) => {
  const projectId = Number(req.params.id);
  const afterId = req.query.after ? Number(req.query.after) : 0;
  const limit = Math.min(Number(req.query.limit ?? 80), 200);

  const rows = await db
    .select({
      id: projectMessagesTable.id,
      content: projectMessagesTable.content,
      createdAt: projectMessagesTable.createdAt,
      senderId: projectMessagesTable.senderId,
      isAi: projectMessagesTable.isAi,
      senderEmail: usersTable.email,
    })
    .from(projectMessagesTable)
    .leftJoin(usersTable, eq(projectMessagesTable.senderId, usersTable.id))
    .where(
      and(
        eq(projectMessagesTable.projectId, projectId),
        afterId > 0 ? gt(projectMessagesTable.id, afterId) : undefined,
      ),
    )
    .orderBy(afterId > 0 ? projectMessagesTable.id : desc(projectMessagesTable.id))
    .limit(limit);

  const messages = (afterId > 0 ? rows : rows.reverse()).map((m) => ({
    ...m,
    senderEmail: m.isAi ? "AI" : m.senderEmail,
  }));
  res.json(messages);
});

// ── POST /projects/:id/messages — send a message ─────────────────────────────
const SendMessageBody = z.object({ content: z.string().min(1).max(4000) });

async function generateAiReply(projectId: number): Promise<string | null> {
  const [project] = await db
    .select({ title: projectsTable.title, category: projectsTable.category, summary: projectsTable.summary })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!project) return null;

  const tasks = await db
    .select({ title: tasksTable.title, status: tasksTable.status })
    .from(tasksTable)
    .where(eq(tasksTable.projectId, projectId));

  const recent = await db
    .select({ content: projectMessagesTable.content, isAi: projectMessagesTable.isAi, senderId: projectMessagesTable.senderId })
    .from(projectMessagesTable)
    .where(eq(projectMessagesTable.projectId, projectId))
    .orderBy(desc(projectMessagesTable.id))
    .limit(20);

  const history = recent
    .reverse()
    .map((m) => `${m.isAi ? "AI" : "User"}: ${m.content}`)
    .join("\n");

  const prompt = `You are an AI assistant embedded in the team chat for a project titled "${project.title}" (category: ${project.category}).${
    project.summary ? ` Summary: ${project.summary}.` : ""
  }
${tasks.length > 0 ? `Current tasks: ${tasks.map((t) => `${t.title} (${t.status})`).join(", ")}.` : "No tasks yet."}

Recent conversation:
${history}

Reply helpfully and concisely (max 150 words) to the latest message, which mentioned you with @ai.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { maxOutputTokens: 512 },
  });

  return response.text?.trim() ?? null;
}

router.post("/projects/:id/messages", requireApproved, requireMember, async (req: any, res) => {
  const projectId = Number(req.params.id);
  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Message content required (max 4000 chars)" });
    return;
  }

  const content = parsed.data.content.trim();

  const [msg] = await db
    .insert(projectMessagesTable)
    .values({ projectId, senderId: req.currentUser.id, content })
    .returning();

  const message = { ...msg, senderEmail: req.currentUser.email ?? "" };

  let aiReply: any = null;
  if (/@ai\b/i.test(content)) {
    try {
      const reply = await generateAiReply(projectId);
      if (reply) {
        const [aiMsg] = await db
          .insert(projectMessagesTable)
          .values({ projectId, senderId: null, isAi: true, content: reply })
          .returning();
        aiReply = { ...aiMsg, senderEmail: "AI" };
      }
    } catch (err) {
      req.log.error(err, "AI chat reply failed");
    }
  }

  res.status(201).json({ message, aiReply });
});

export default router;
