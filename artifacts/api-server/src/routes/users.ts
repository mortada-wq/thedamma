import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, ne } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";

const router = Router();

// ── Admin middleware ─────────────────────────────────────────────────────────
async function requireAdmin(req: any, res: any, next: any) {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const [user] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId))
    .limit(1);
  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

// GET /admin/users — list all users
router.get("/admin/users", requireAdmin, async (_req, res) => {
  const users = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      role: usersTable.role,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .orderBy(usersTable.createdAt);
  res.json(users);
});

// PATCH /admin/users/:id — approve / change role
const UpdateUserBody = z.object({
  role: z.enum(["pending", "user", "admin"]),
});

router.patch("/admin/users/:id", requireAdmin, async (req, res) => {
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "role must be pending | user | admin" });
    return;
  }

  const userId = Number(req.params.id);
  const [updated] = await db
    .update(usersTable)
    .set({ role: parsed.data.role })
    .where(eq(usersTable.id, userId))
    .returning({ id: usersTable.id, email: usersTable.email, role: usersTable.role });

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  req.log.info({ userId, role: parsed.data.role }, "User role updated");
  res.json(updated);
});

// DELETE /admin/users/:id — remove user
router.delete("/admin/users/:id", requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  res.status(204).end();
});

// POST /admin/users/invite — invite by email (creates pending account with temp password)
const InviteBody = z.object({
  email: z.string().email(),
});

router.post("/admin/users/invite", requireAdmin, async (req, res) => {
  const parsed = InviteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Valid email required" });
    return;
  }

  const email = parsed.data.email.toLowerCase();
  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "User already exists" });
    return;
  }

  // Temp password: user must reset after first login
  const tempPassword = Math.random().toString(36).slice(2, 10);
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  const [user] = await db
    .insert(usersTable)
    .values({ email, passwordHash, role: "user", invitedBy: req.session.userId })
    .returning({ id: usersTable.id, email: usersTable.email, role: usersTable.role });

  req.log.info({ userId: user.id, invitedBy: req.session.userId }, "User invited");
  // Return the temp password so admin can share it out-of-band
  res.status(201).json({ ...user, tempPassword });
});

export default router;
