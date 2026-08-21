# Discord User Translator v3.3

A user-installed Discord translator focused on AI auto-detection, Egyptian Arabic, Modern Standard Arabic, Persian, and fast target selection.

## UX

- `/translate`: type text first, choose target only; source is auto-detected.
- `/say`: same flow, but returns a private copy-ready translation so the human user sends it from their own account.
- Right-click message → Apps → Translate → select target language from an ephemeral menu.
- `My language` target uses the user's saved `/settings my_language` preference.
- AI/Gemini can distinguish Egyptian Arabic (`ar-eg`) vs MSA (`ar-msa`) and honor target dialect.
- AI retries temporary 429/5xx errors; Auto mode can fall back to LibreTranslate.

See `UPGRADE-V3.3-AR.md` for the RTL/readability update and `UPGRADE-V3.2-AR.md` for the auto-detection upgrade.


## RTL readability

Arabic, Egyptian Arabic, Modern Standard Arabic, Persian and Hebrew output uses Unicode bidi isolation so embedded English product names, acronyms and URLs stay in the correct left-to-right order inside right-to-left text. Translation output is also displayed using Discord-supported heading formatting for better readability.
