import { Router } from "express";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpdateAdminSettingsBody } from "@workspace/api-zod";

const router = Router();

const DEFAULTS = {
  activeProvider: "gemini",
  activeModel: "gemini-2.0-flash",
} as const;

async function getSettings(): Promise<{ activeProvider: string; activeModel: string }> {
  const rows = await db.select().from(settingsTable);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    activeProvider: map["activeProvider"] ?? DEFAULTS.activeProvider,
    activeModel: map["activeModel"] ?? DEFAULTS.activeModel,
  };
}

router.get("/admin/settings", async (req, res) => {
  const settings = await getSettings();
  res.json(settings);
});

router.put("/admin/settings", async (req, res) => {
  const parsed = UpdateAdminSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid settings", details: parsed.error.issues });
    return;
  }

  const { activeProvider, activeModel } = parsed.data;

  await db
    .insert(settingsTable)
    .values({ key: "activeProvider", value: activeProvider })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: activeProvider, updatedAt: new Date() } });

  await db
    .insert(settingsTable)
    .values({ key: "activeModel", value: activeModel })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: activeModel, updatedAt: new Date() } });

  req.log.info({ activeProvider, activeModel }, "Admin settings updated");
  res.json({ activeProvider, activeModel });
});

export { getSettings };
export default router;
