---
name: File upload pipeline
description: POST /api/songs/upload accepts audio/video files; ffmpeg converts; same Gemini inline analysis
---
- multer middleware (200MB limit) handles multipart/form-data
- convertToMp3ForGemini(filePath) in audioExtraction.ts: ffmpeg → mp3, re-encodes if > 7MB
- generateFromUploadedAudio(filePath, originalFilename) in songMetadata.ts: calls Gemini with same SYSTEM_PROMPT as YouTube path
- Saved with inputType="file", inputValue=originalFilename
- Frontend uses raw fetch + FormData (not the generated hook) — multipart is awkward with Orval codegen
- OpenAPI spec has "file" in inputType enum for type generation

**How to apply:** Upload route must be declared BEFORE /songs GET/POST routes in Express so the path /songs/upload isn't matched as /songs/:id.
