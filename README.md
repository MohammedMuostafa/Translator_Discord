# Discord User Translator v3

A user-installed Discord translation app that works through interactions across servers, DMs and group DMs.

## Highlights

- Right-click message → Apps → Translate
- `/translate` with source, target, provider and style choices
- `/say` private copy mode so the final message can be sent by the human user
- Arabic MSA and Egyptian Arabic modes
- Persian / Farsi
- LibreTranslate, Google, DeepL and optional OpenAI-compatible AI provider
- Optional voice transcription/translation
- Railway-friendly HTTP interactions deployment

## Important Discord limitation

Discord apps cannot impersonate a normal user account. `/say` therefore returns the translated text ephemerally for copy/paste. Automating a normal Discord user token is not supported by this project.

See `UPGRADE-V3-AR.md` for the v3 upgrade steps.
