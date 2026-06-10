---
name: Zod version in api-server
description: The workspace catalog pins zod v3; api-server uses v3 syntax, not v4
---

## Rule
In `artifacts/api-server`, import zod as `import { z } from "zod"` and use v3 API.

**Why:** The pnpm workspace catalog has `zod: "catalog:"` pointing to v3.x. The `zod/v4` subpath does not exist. Using `z.email()` (v4 standalone) or `import from 'zod/v4'` causes TS2307.

**How to apply:**
- `z.string().email()` not `z.email()`
- `z.string().url()` not `z.url()`
- `import { z } from "zod"` not `"zod/v4"`
- `@workspace/api-zod` and `@workspace/api-server` both operate on zod v3
