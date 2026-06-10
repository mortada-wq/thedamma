# SongForge

A musicological knowledge base: paste a YouTube link or type a song name, and AI generates a rich dossier (singer, composer, era, geography, history, subject, dialect, instruments, voices, related works, full lyric transcription, pronunciation notes, and an interval-by-interval track breakdown). Songs are saved to a growing library and exportable as RAG JSON to feed AI music generators.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- API contract (source of truth): `lib/api-spec/openapi.yaml` → regenerate hooks/Zod with the codegen command.
- DB schema: `lib/db/src/schema/songs.ts` (`songsTable`, `SongMetadata`/`TrackSegment` types).
- Backend routes: `artifacts/api-server/src/routes/songs.ts`; AI generation helper: `artifacts/api-server/src/lib/songMetadata.ts`.
- Frontend (React+Vite): `artifacts/songforge/src` — `pages/home.tsx`, `pages/song-detail.tsx`, components in `components/`, theme in `index.css`.
- OpenAI access: `@workspace/integrations-openai-ai-server` (via Replit AI Integrations proxy).

## Architecture decisions

- Contract-first: OpenAPI drives generated React Query hooks (`@workspace/api-client-react`) and Zod schemas (`@workspace/api-zod`).
- AI metadata is requested with a strict JSON schema (`response_format: json_schema`) and re-validated server-side using the generated `GetSongResponse.shape.metadata` Zod schema before DB insert.
- `inputType` (`youtube` | `name`) is classified by regex on the raw input; full metadata is stored as a JSON column, with `title`/`singer`/`era`/`geography` denormalized for list/stat queries.

## Product

- Catalog a song from a YouTube URL or a song name; AI produces a full musicological dossier.
- Browse a growing library with a running count and archive stats (by era, geography, dialect).
- View a per-song detail page with a track timeline, transcription, and pronunciation notes.
- Export a single song as JSON, or the whole library as one combined RAG JSON file.

## User preferences

- No emojis anywhere in the UI.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
