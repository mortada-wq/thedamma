import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { z } from "zod";

const router = Router();

const AuthBody = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

// POST /auth/register
router.post("/auth/register", async (req, res) => {
  const parsed = AuthBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Email and password (min 6 chars) required" });
    return;
  }
  const { email, password } = parsed.data;

  // Check duplicate
  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "An account with that email already exists" });
    return;
  }

  // First user ever → admin
  const [{ total }] = await db.select({ total: count() }).from(usersTable);
  const role = total === 0 ? "admin" : "pending";

  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db
    .insert(usersTable)
    .values({ email: email.toLowerCase(), passwordHash, role })
    .returning();

  req.session.userId = user.id;
  req.session.save((err) => {
    if (err) {
      req.log.error(err, "Session save failed on register");
      res.status(500).json({ error: "Session save failed" });
      return;
    }
    req.log.info({ userId: user.id, role }, "User registered");
    res.status(201).json({ id: user.id, email: user.email, role: user.role });
  });
});

// POST /auth/login
router.post("/auth/login", async (req, res) => {
  const parsed = AuthBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }
  const { email, password } = parsed.data;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  req.session.userId = user.id;
  req.session.save((err) => {
    if (err) {
      req.log.error(err, "Session save failed on login");
      res.status(500).json({ error: "Session save failed" });
      return;
    }
    req.log.info({ userId: user.id }, "User logged in");
    res.json({ id: user.id, email: user.email, role: user.role });
  });
});

// POST /auth/logout
router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("damma.sid");
    res.json({ ok: true });
  });
});

// GET /auth/me
router.get("/auth/me", async (req, res) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId))
    .limit(1);

  if (!user) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "User not found" });
    return;
  }
  res.json(user);
});

export default router;
