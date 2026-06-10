---
name: Song dossier generation pipeline (Gemini native audio)
description: How the pipeline works, key constraints, build quirks after the Gemini migration.
---

# Song dossier pipeline — Gemini native audio

yt-dlp downloads audio → Gemini hears and analyzes it → Zod-validated JSON saved to DB.
No separate transcription step, no captions, no GPT. One Gemini call does everything.

## Pipeline

1. `fetchAndDownloadAudio(input, inputType)` in `audioExtraction.ts` — yt-dlp fetches metadata (`-J`)
   then downloads audio (mp3, `--audio-quality 9`, ~24-32 kbps). Name inputs use `ytsearch1:`.
   Returns `{ source, audioPath, tempDir, truncated }`. Caller must `rm(tempDir, {recursive:true})`.
2. Audio read as base64 (inline) → `gemini-2.5-flash` via `@workspace/integrations-gemini-ai`.
   Gemini hears instruments, lyrics, timestamps directly from the audio waveform.
3. Response schema enforced with `responseMimeType: "application/json"` + `responseSchema`.
   Validated against `GetSongResponse.shape.metadata` Zod schema before DB insert.

## yt-dlp / ffmpeg environment
- yt-dlp resolved by walking `process.cwd()` upward for `.pythonlibs/bin/yt-dlp`; env `YT_DLP_PATH` overrides.
- ffmpeg on PATH (Nix); libmp3lame available.

## SSRF guard (important)
- `classifyInput` regex is loose — `https://evil.com/youtube.com/watch?v=x` would match "youtube".
- **Always** run `isAllowedYouTubeUrl()` (hostname allowlist) before handing URLs to yt-dlp.
- Name inputs are safe — they go through `ytsearch1:` (search), never a direct fetch.

## Bot-check mitigation (YouTube on cloud IPs)
- `baseYtDlpArgs()`: adds `player_client=default,tv,web_safari,android,ios` to every yt-dlp call.
- `YTDLP_COOKIES` secret → written to `yt-cookies.txt` → passed via `--cookies` (robust fallback).
- `isBotCheckError()` regex surfaces a 503 with a clear message to the user.

## Gemini inline audio limit
- 8 MB max per inline request. At quality 9 (~32 kbps), songs up to ~33 min fit in one call.
- If downloaded file > 7 MB, ffmpeg re-encodes to 16 kbps mono before sending. `truncated: true` is noted in the prompt.
- Rate-limit retry: 3 attempts, delays 3s / 10s / 25s.

## Build quirk — @google/genai must NOT be external

**Do NOT put `@google/*` in the esbuild external list.**
`@google/genai` is bundleable. Externalizing it causes `ERR_MODULE_NOT_FOUND` at runtime because
the package only lives in `lib/integrations-gemini-ai/node_modules`, not in api-server's own deps.

**Why:** esbuild marks it external but doesn't hoist it; Node can't find it at the artifact's runtime path.

**Fix:** Changed `"@google/*"` → `"@google-cloud/*"` in `artifacts/api-server/build.mjs` external list.
(`@google-cloud/*` still needs to be external for its `.proto` file path-traversal loading.)
