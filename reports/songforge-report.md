# SongForge — Application Report

*Prepared June 10, 2026*

---

## 1. What it is

SongForge is a **musicological knowledge base**. You give it a YouTube link or a song
name, and an AI generates a rich, structured dossier about the song — who sang and
composed it, its era and geography, its history and subject, dialect, instruments,
voices, related works, a full lyric transcription, pronunciation notes, and an
interval-by-interval breakdown of the recording.

Every song is saved to a growing library with running counts and archive statistics.
Individual dossiers — or the entire library at once — can be exported as JSON, formatted
to feed downstream AI music generators (a "RAG" export).

The core idea: turn scattered knowledge about a song into one clean, machine-readable
record, and let that library compound over time.

---

## 2. What you can do with it

- **Catalog a song** from a YouTube URL or a plain song name. The AI produces a complete
  dossier in a single pass.
- **Browse the library** — a grid of saved works with a live entry count and archive
  stats grouped by era, geography, and dialect.
- **Read a dossier** — a per-song detail page with origin/era metadata, instrumentation
  and voices, historical context, transcription, pronunciation notes, and a visual
  timeline of the track broken into intervals.
- **Export for AI** — download a single song as JSON, or the whole library as one
  combined RAG JSON file.

---

## 3. How it's built

SongForge is a **contract-first, full-stack TypeScript** application running in a pnpm
monorepo.

| Layer | Technology |
|---|---|
| Frontend | React + Vite, Wouter routing, TanStack Query, Tailwind CSS |
| Backend | Express 5 (Node.js 24, TypeScript 5.9) |
| Database | PostgreSQL via Drizzle ORM |
| Validation | Zod (`zod/v4`) + `drizzle-zod` |
| AI | OpenAI, Gemini, and Anthropic via server-side API credentials |
| API codegen | Orval — generates React Query hooks and Zod schemas from the OpenAPI spec |
| Build | esbuild |

**The contract is the source of truth.** A single OpenAPI spec (`lib/api-spec/openapi.yaml`)
drives both the typed React Query hooks the frontend uses and the Zod schemas the server
validates against. Change the contract, regenerate, and both sides stay in lockstep.

**The data flow when you catalog a song:**

1. The raw input is classified by regex as a YouTube URL or a song name.
2. The AI is asked for metadata under a **strict JSON schema** (`response_format:
   json_schema`), so the model must return well-formed structured data.
3. The server **re-validates** that response against the generated Zod schema before it
   ever touches the database — bad data fails loudly instead of being silently stored.
4. The full dossier is saved as a JSON column, with `title`, `singer`, `era`, and
   `geography` denormalized into their own columns so list and stat queries stay fast.

---

## 4. Design language

The interface uses the **Sahib (صاحب)** design system — a dark, matte aesthetic built
around a clear color discipline:

- **Obsidian canvas** — a near-black background stepping up through layered dark surfaces.
- **Orange `#F7731E` is rare** — reserved for the single highest-intent action on any
  surface (the *Generate Dossier* button), plus the logo and input focus. It never
  decorates.
- **Blue `#5E94FF` carries everything secondary** — navigation, section icons, chips,
  links, timeline markers, and export buttons.
- **Typography** — IBM Plex Sans Arabic for all interface text, and the calligraphic
  **Aref Ruqaa** reserved exclusively for song titles, which gives each dossier a
  distinctive editorial signature.
- **Restraint in motion** — no glows, short downward shadows, and hover states that wash
  color rather than lifting or scaling elements.

A signature detail is the **prompt bar**: the input where you catalog a song wears a
slowly sweeping orange-to-blue gradient rim.

The app is left-to-right; Sahib's right-to-left rules apply to Arabic content, while
SongForge's interface is English.

---

## 5. Where things live

- **API contract:** `lib/api-spec/openapi.yaml`
- **Database schema:** `lib/db/src/schema/songs.ts`
- **Backend routes:** `artifacts/api-server/src/routes/songs.ts`
- **AI generation helper:** `artifacts/api-server/src/lib/songMetadata.ts`
- **Frontend:** `artifacts/songforge/src` (pages, components, and the Sahib theme in
  `index.css`)

---

## 6. State and quality

- The backend is complete and tested end-to-end — generation, listing, retrieval,
  deletion, stats, and both export paths all work, with input validation guarding the
  generate endpoint.
- The frontend has been fully restyled to the Sahib design language and passes a clean
  TypeScript check.
- A code review was run on the redesign; its findings (chiefly tightening the orange/blue
  color hierarchy) were addressed.

---

## 7. Possible next steps

These are options, not commitments:

- **Search and filter** the library (by era, geography, dialect) as it grows.
- **Audio embedding** — surface the source YouTube player alongside the interval timeline.
- **Editing** — let users correct or annotate AI-generated fields.
- **Authentication** — give each user their own private archive.
- **Deployment** — the app is in a publishable state and ready to go live.
