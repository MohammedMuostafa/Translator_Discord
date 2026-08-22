# TD AI v3.12.2 TTS streaming hotfix

Fixes:

`TD AI Voice: Gemini TTS returned no audio chunks.`

Changes:
- Forces Gemini Interactions streaming with `?alt=sse`.
- Requests inline `audio/l16` explicitly.
- Handles Interactions API `error` events instead of hiding them as "no audio chunks".
- Supports snake_case / camelCase audio metadata.
- Flushes the final TextDecoder bytes.
- Adds useful diagnostics if Gemini returns no audio.

Replace only:

`src/services/geminiTts.ts`

Recommended commit:

`Fix Gemini TTS SSE audio streaming`
