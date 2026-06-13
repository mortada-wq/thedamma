import { Router } from "express";
import { db, projectMembersTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { getMembership } from "./projects";

const router = Router();

// ── Middleware ────────────────────────────────────────────────────────────────
async function requireApproved(req: any, res: any, next: any) {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId))
    .limit(1);
  if (!user || user.role === "pending") {
    res.status(403).json({ error: "Account pending approval" });
    return;
  }
  req.currentUser = user;
  next();
}

async function requireMember(req: any, res: any, next: any) {
  const projectId = Number(req.params.id);
  if (!projectId) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const membership = await getMembership(projectId, req.currentUser.id);
  if (!membership) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  req.membership = membership;
  next();
}

// ── GET /projects/:id/members — list members ────────────────────────────────
router.get("/projects/:id/members", requireApproved, requireMember, async (req: any, res) => {
  const projectId = Number(req.params.id);

  const members = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      role: projectMembersTable.role,
      addedAt: projectMembersTable.addedAt,
    })
    .from(projectMembersTable)
    .innerJoin(usersTable, eq(projectMembersTable.userId, usersTable.id))
    .where(eq(projectMembersTable.projectId, projectId))
    .orderBy(projectMembersTable.addedAt);

  res.json(members);
});

// ── POST /projects/:id/members — invite by email (owner only) ───────────────
const InviteBody = z.object({ email: z.string().email() });

router.post("/projects/:id/members", requireApproved, requireMember, async (req: any, res) => {
  const projectId = Number(req.params.id);

  if (req.membership.role !== "owner") {
    res.status(403).json({ error: "Only the project owner can add members" });
    return;
  }

  const parsed = InviteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Valid email required" });
    return;
  }

  const email = parsed.data.email.toLowerCase();
  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (!user) {
    res.json({ found: false, email });
    return;
  }
  if (user.role === "pending") {
    res.json({ found: true, pending: true, email, id: user.id });
    return;
  }

  await db
    .insert(projectMembersTable)
    .values({ projectId, userId: user.id, role: "member" })
    .onConflictDoNothing();

  req.log.info({ projectId, addedUserId: user.id }, "User added to project");
  res.json({ found: true, pending: false, added: true, id: user.id, email: user.email, role: "member" });
});

// ── DELETE /projects/:id/members/:userId — remove or leave ──────────────────
router.delete("/projects/:id/members/:userId", requireApproved, requireMember, async (req: any, res) => {
  const projectId = Number(req.params.id);
  const targetUserId = Number(req.params.userId);

  const isOwner = req.membership.role === "owner";
  const isSelf = targetUserId === req.currentUser.id;

  if (!isOwner && !isSelf) {
    res.status(403).json({ error: "Only the project owner can remove others" });
    return;
  }
  if (isOwner && isSelf) {
    res.status(400).json({ error: "The project owner cannot leave the project" });
    return;
  }

  await db
    .delete(projectMembersTable)
    .where(and(eq(projectMembersTable.projectId, projectId), eq(projectMembersTable.userId, targetUserId)));

  res.status(204).end();
});

export { requireApproved, requireMember };
export default router;
