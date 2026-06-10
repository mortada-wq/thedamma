---
name: Bot-check fallback
description: YouTube blocks yt-dlp on cloud IPs; knowledge-only Gemini fallback handles both name and URL inputs
---
- Cloud/datacenter IPs get "Sign in to confirm you're not a bot" from YouTube
- isBotCheckError() detects this in the error message
- Fallback chain:
  - name input → generateFromKnowledgeOnly(input) directly
  - URL input → fetchYouTubeOEmbedTitle(url) (credential-free) → generateFromKnowledgeOnly(title)
  - URL + oEmbed fails → 503 instructing user to type song name instead
- YTDLP_COOKIES secret (Netscape cookies.txt) bypasses the block if set
- isBotCheckError lives in audioExtraction.ts, re-exported from songMetadata.ts

**Why:** Published app is on a datacenter IP; yt-dlp is always blocked there without cookies. Knowledge-only gives full dossier for well-known songs with approximate timestamps.
