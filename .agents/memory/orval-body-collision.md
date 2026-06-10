---
name: Orval body schema name collision
description: Orval generates {OperationId}Body for every request body; if a component schema has the same name, it's exported twice and typecheck fails
---

## Rule
Named component schemas used as request bodies must NOT match the `{OperationId}Body` naming pattern.

**Why:** Orval generates a Zod schema AND a TypeScript type both named `{OperationId}Body`. If a component schema is also named e.g. `CreateProjectBody` (matching operationId `createProject` → `CreateProjectBody`), both are exported from the same module → TS2308 "already exported a member".

**How to apply:**
- Use `NewXxxInput`, `XxxPatch`, `XxxInput` etc. for request body component schemas
- Never name a component schema `CreateXxxBody`, `UpdateXxxBody`, `PatchXxxBody` etc.
- Inline request body schemas are also dangerous — Orval generates the same `{OperationId}Body` name for them in both `api.ts` (Zod) and `types/` (TS types); always use a named $ref with a non-colliding name instead
- The pattern that works: `$ref: "#/components/schemas/NewProjectInput"` for operationId `createProject`
