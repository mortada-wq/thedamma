import { Router } from "express";
import { db, groupsTable, groupMembersTable, groupMessagesTable, usersTable } from "@workspace/db";
import { eq, and, desc, gt, sql } from "drizzle-orm";
import { z } from "zod";

const router = Router();

// ── Middleware ────────────────────────────────────────────────────────────────
async function requireApproved(req: any, res: any, next: any) {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const [user] = await db
    .select({ id: usersTable.id, role: usersTable.role })
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
  const groupId = Number(req.params.id);
  if (!groupId) { res.status(400).json({ error: "Invalid group id" }); return; }
  const [membership] = await db
    .select({ id: groupMembersTable.id })
    .from(groupMembersTable)
    .where(and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.userId, req.currentUser.id)))
    .limit(1);
  if (!membership) { res.status(403).json({ error: "Not a member of this group" }); return; }
  next();
}

// ── GET /groups — list groups I belong to ────────────────────────────────────
router.get("/groups", requireApproved, async (req: any, res) => {
  const rows = await db
    .select({
      id: groupsTable.id,
      name: groupsTable.name,
      createdBy: groupsTable.createdBy,
      createdAt: groupsTable.createdAt,
      memberCount: sql<number>`count(distinct ${groupMembersTable.id})`,
    })
    .from(groupsTable)
    .innerJoin(groupMembersTable, eq(groupMembersTable.groupId, groupsTable.id))
    .where(
      sql`${groupsTable.id} IN (
        SELECT group_id FROM group_members WHERE user_id = ${req.currentUser.id}
      )`
    )
    .groupBy(groupsTable.id)
    .orderBy(desc(groupsTable.createdAt));

  res.json(rows);
});

// ── POST /groups — create a group ────────────────────────────────────────────
const CreateGroupBody = z.object({
  name: z.string().min(1).max(120),
});

router.post("/groups", requireApproved, async (req: any, res) => {
  const parsed = CreateGroupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Group name (1–120 chars) required" });
    return;
  }
  const [group] = await db
    .insert(groupsTable)
    .values({ name: parsed.data.name.trim(), createdBy: req.currentUser.id })
    .returning();

  await db.insert(groupMembersTable).values({ groupId: group.id, userId: req.currentUser.id });

  req.log.info({ groupId: group.id }, "Group created");
  res.status(201).json({ ...group, memberCount: 1 });
});

// ── GET /groups/:id — group detail + members ─────────────────────────────────
router.get("/groups/:id", requireApproved, requireMember, async (req: any, res) => {
  const groupId = Number(req.params.id);
  const [group] = await db
    .select()
    .from(groupsTable)
    .where(eq(groupsTable.id, groupId))
    .limit(1);
  if (!group) { res.status(404).json({ error: "Group not found" }); return; }

  const members = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      role: usersTable.role,
      joinedAt: groupMembersTable.joinedAt,
    })
    .from(groupMembersTable)
    .innerJoin(usersTable, eq(groupMembersTable.userId, usersTable.id))
    .where(eq(groupMembersTable.groupId, groupId))
    .orderBy(groupMembersTable.joinedAt);

  res.json({ ...group, members });
});

// ── POST /groups/:id/invite — look up email, add if registered ───────────────
const InviteBody = z.object({ email: z.string().email() });

router.post("/groups/:id/invite", requireApproved, requireMember, async (req: any, res) => {
  const groupId = Number(req.params.id);
  const parsed = InviteBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Valid email required" }); return; }

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

  // Insert, ignore if already a member
  await db
    .insert(groupMembersTable)
    .values({ groupId, userId: user.id })
    .onConflictDoNothing();

  req.log.info({ groupId, invitedUserId: user.id }, "User added to group");
  res.json({ found: true, pending: false, added: true, id: user.id, email: user.email, role: user.role });
});

// ── DELETE /groups/:id/members/:userId — leave or remove ─────────────────────
router.delete("/groups/:id/members/:userId", requireApproved, requireMember, async (req: any, res) => {
  const groupId = Number(req.params.id);
  const targetUserId = Number(req.params.userId);

  const [group] = await db
    .select({ createdBy: groupsTable.createdBy })
    .from(groupsTable)
    .where(eq(groupsTable.id, groupId))
    .limit(1);
  if (!group) { res.status(404).json({ error: "Group not found" }); return; }

  const isCreator = group.createdBy === req.currentUser.id;
  const isSelf = targetUserId === req.currentUser.id;
  if (!isCreator && !isSelf) {
    res.status(403).json({ error: "Only the group creator can remove others" });
    return;
  }

  await db
    .delete(groupMembersTable)
    .where(and(eq(groupMembersTable.groupId, groupId), eq(groupMembersTable.userId, targetUserId)));

  res.status(204).end();
});

// ── GET /groups/:id/messages — poll messages ──────────────────────────────────
router.get("/groups/:id/messages", requireApproved, requireMember, async (req: any, res) => {
  const groupId = Number(req.params.id);
  const afterId = req.query.after ? Number(req.query.after) : 0;
  const limit = Math.min(Number(req.query.limit ?? 80), 200);

  const rows = await db
    .select({
      id: groupMessagesTable.id,
      content: groupMessagesTable.content,
      createdAt: groupMessagesTable.createdAt,
      senderId: groupMessagesTable.senderId,
      senderEmail: usersTable.email,
    })
    .from(groupMessagesTable)
    .innerJoin(usersTable, eq(groupMessagesTable.senderId, usersTable.id))
    .where(
      and(
        eq(groupMessagesTable.groupId, groupId),
        afterId > 0 ? gt(groupMessagesTable.id, afterId) : undefined,
      )
    )
    .orderBy(afterId > 0 ? groupMessagesTable.id : desc(groupMessagesTable.id))
    .limit(limit);

  // When loading history (no afterId), reverse so oldest-first
  const messages = afterId > 0 ? rows : rows.reverse();
  res.json(messages);
});

// ── POST /groups/:id/messages — send a message ────────────────────────────────
const SendMessageBody = z.object({ content: z.string().min(1).max(4000) });

router.post("/groups/:id/messages", requireApproved, requireMember, async (req: any, res) => {
  const groupId = Number(req.params.id);
  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Message content required (max 4000 chars)" }); return; }

  const [msg] = await db
    .insert(groupMessagesTable)
    .values({ groupId, senderId: req.currentUser.id, content: parsed.data.content.trim() })
    .returning();

  res.status(201).json({ ...msg, senderEmail: req.currentUser.email ?? "" });
});

export default router;
