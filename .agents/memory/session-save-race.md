---
name: Session save race condition
description: express-session with connect-pg-simple must use session.save() before responding or the cookie arrives before the DB row is committed
---

## Rule
Always call `req.session.save(cb)` before sending the response after mutating session data (`req.session.userId = ...`).

**Why:** connect-pg-simple writes the session row to Postgres asynchronously. If you call `res.json()` immediately after setting a session value, the browser receives the cookie before the row is committed. The next request with that cookie finds no matching session row → "Not authenticated".

**How to apply:** Wrap the response inside the save callback:
```ts
req.session.userId = user.id;
req.session.save((err) => {
  if (err) { res.status(500).json({ error: "Session save failed" }); return; }
  res.json({ id: user.id, email: user.email, role: user.role });
});
```
This applies to every route that first assigns session data and then responds (login, register, any OAuth callback).
