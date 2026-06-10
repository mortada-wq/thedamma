---
name: Audio pipeline
description: How Gemini audio analysis works — yt-dlp download, mp3 conversion, 7MB inline limit
---
- yt-dlp downloads best audio at quality 9 (low bitrate mp3, ~32kbps)
- If result > 7MB, ffmpeg re-encodes at 16kbps mono to fit Gemini inline limit
- Audio sent as base64 inlineData (mimeType: audio/mpeg) to gemini-2.5-flash
- Response validated against SongMetadata Zod schema from GetSongResponse.shape.metadata
- `fetchAndDownloadAudio()` in audioExtraction.ts is the single download entry point
- `generateSongMetadata(input, inputType)` in songMetadata.ts is the full pipeline entry

**Why:** Gemini 2.5 Flash accepts inline audio up to 8MB; keeping below 7MB gives a safety margin. Quality 9 = ~32kbps which covers ~33min of audio.

**How to apply:** If adding new audio sources, ensure they go through the same conversion + size check before passing to Gemini.
