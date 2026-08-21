# Translator Discord v3.4

AI-powered user-installed Discord translator with automatic source detection, Egyptian Arabic, Modern Standard Arabic, Persian, structured message formatting, voice input, and text-to-speech playback.

## Highlights

- **Right-click → Apps → Translate** on a Discord message, then choose only the target language.
- `/translate`: type the text first; AI detects the source automatically.
- `/say`: returns a private copy-ready translation so **you** paste and send it from your own Discord account.
- Egyptian Arabic (`ar-eg`) and Modern Standard Arabic (`ar-msa`) are separate targets.
- Persian / Farsi and many other languages are supported.
- Gemini AI can detect the source language/dialect automatically and translate naturally.
- LibreTranslate, Google Translate and DeepL remain available as optional providers/fallbacks.
- Voice messages can be transcribed and translated when STT is configured.
- **🔊 Listen / استمع** generates playable speech for a translated result using Gemini TTS.

## v3.4 — structured formatting + Listen

v3.4 focuses on long announcements and mixed Arabic/English messages:

- The AI is instructed to preserve **Discord Markdown structure** instead of flattening the whole message.
- Headings remain headings, bullets remain bullets, numbered steps remain numbered steps, block quotes remain block quotes, and blank lines remain section separators.
- URLs, code, mentions, custom emojis, product names and technical identifiers are preserved.
- Arabic/Persian RTL stabilization is applied **after Markdown prefixes**, so formatting remains valid while embedded English phrases stay readable.
- The old behavior that made every translated line a Markdown heading was removed.
- Long results prioritize translated content; the original preview is omitted if it would consume the Discord message limit.
- A **Listen / استمع** button is attached to translated results when Gemini TTS is configured.

## Gemini AI translation

Use an OpenAI-compatible Gemini endpoint for translation:

```env
TRANSLATION_PROVIDER=ai
AI_API_URL=https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
AI_API_KEY=YOUR_GEMINI_API_KEY
AI_MODEL=YOUR_GEMINI_TEXT_MODEL
```

Keep real keys in Railway Variables or another secret manager. Never commit them to GitHub.

## Gemini TTS / Listen button

If `AI_API_KEY` is already a Gemini API key, v3.4 can reuse it automatically for TTS. Optionally configure a separate key:

```env
GEMINI_TTS_API_KEY=
GEMINI_TTS_MODEL=gemini-3.1-flash-tts-preview
GEMINI_TTS_VOICE=Kore
TTS_MAX_CHARS=4000
```

When configured, translated messages show a private **🔊 Listen / استمع** button. Pressing it creates a WAV attachment that Discord can play directly.

## Main commands

- `/translate` — auto-detect source, choose target, translate privately.
- `/say` — translate privately and copy/paste so the final public message is authored by your own account.
- `/voice` — transcribe an audio attachment and translate it.
- `/settings` — set your preferred incoming/outgoing language, provider and style.
- `/status` — check translation, AI, STT and TTS configuration.

## Public repository safety

The repository can be public **only if secrets are excluded**. Never commit:

- `.env`
- Discord bot token
- Gemini/API keys
- STT secrets
- provider credentials

Use `.env.example` only for placeholder values and keep production values in Railway Variables.
