# TD AI v3.7.1 — Voice + Smart Answer Fix

## What changed

- Smart Answer now:
  1. Translates the selected message to your Arabic.
  2. Detects the sender language.
  3. Drafts the actual reply in the sender's language.
  4. Shows the Arabic meaning of the reply.
  5. Regenerate / Shorter / More Detail keeps the same behavior.

- Voice AI now identifies the failed stage:
  - Speech recognition failed
  - AI reply failed
  - Voice synthesis/playback failed

- STT_PROVIDER=auto can fall back from the private STT service to Gemini audio understanding.

- Separate models:
  - AI_MODEL / VOICE_AI_MODEL = reasoning/chat
  - GEMINI_STT_MODEL = speech recognition
  - GEMINI_TTS_MODEL = speech generation

## Recommended Railway variables

```env
ENABLE_GUILD_VOICE_AI=true

AI_API_URL=https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
AI_MODEL=gemini-3.7-flash
VOICE_AI_MODEL=gemini-3.7-flash

STT_PROVIDER=gemini
GEMINI_STT_MODEL=gemini-3.7-flash

GEMINI_TTS_MODEL=gemini-3.1-flash-tts-preview
GEMINI_TTS_VOICE=Kore
```

If AI_API_KEY is your Gemini API key, it is reused by Gemini STT/TTS when their dedicated keys are empty.
For production, you can set separate keys later.

## Commit message

`Fix voice AI pipeline and multilingual smart answers v3.7.1`
