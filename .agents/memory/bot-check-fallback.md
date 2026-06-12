---
name: Bot-check fallback
description: YouTube blocks yt-dlp on cloud IPs; all YouTube errors now fall through to oEmbed → knowledge-only fallback
---
- Cloud/datacenter IPs get blocked by YouTube via yt-dlp (bot-check, 403, 429, geo-block, etc.)
- isBotCheckError() pattern is intentionally broad — covers: "Sign in to confirm", "cookies",
  "HTTP Error 403", "HTTP Error 429", "Too Many Requests", "Precondition Failed",
  "requires authentication", "age-restricted", "login required", "not available in your country", "geo-restrict"
- Fallback chain (applied at every YouTube error branch including the catch-all):
  1. name input → generateFromKnowledgeOnly(input) directly
  2. URL input → fetchYouTubeOEmbedTitle(url) (credential-free oEmbed) → generateFromKnowledgeOnly(title)
  3. URL + oEmbed fails → 503 instructing user to type song name instead
- The catch-all `else` branch in songs.ts ALSO attempts oEmbed → knowledge-only for YouTube
  (not just the bot-check branch) — this is the key fix; any unrecognised YouTube error now falls through
- generationNote is set on the saved song when knowledge-only fallback is used
- YTDLP_COOKIES secret (Netscape cookies.txt) bypasses the block if set; optional
- isBotCheckError lives in audioExtraction.ts, re-exported through songMetadata.ts

**Why:** Published app is on a datacenter IP; yt-dlp is always blocked there without cookies.
The "could not access this video" hard error was caused by the catch-all branch not attempting
the oEmbed fallback. Knowledge-only gives a full dossier for well-known songs.

**How to apply:** Any new YouTube error path (new routes, etc.) must include the
oEmbed → knowledge-only fallback, not just a hard error return.
