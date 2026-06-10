---
name: user_sessions Postgres table
description: connect-pg-simple createTableIfMissing may silently fail on cold start; pre-create the table if sessions break
---

## Rule
If session cookies are set but not honoured (every /me returns 401), check whether the `user_sessions` table exists.

**Why:** `connect-pg-simple` with `createTableIfMissing: true` attempts to create the table on first session write, but this can silently fail in certain environments. The server starts, accepts logins, and sends cookies — but the session row was never saved, so the next request can't find it.

**How to apply:**
Run once after DB provisioning:
```sql
CREATE TABLE IF NOT EXISTS user_sessions (
  sid VARCHAR NOT NULL COLLATE "default",
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL,
  CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX IF NOT EXISTS IDX_session_expire ON user_sessions (expire);
```
Or add this to the Drizzle migration / `pnpm --filter @workspace/db run push` workflow so it's always present before the server starts.
