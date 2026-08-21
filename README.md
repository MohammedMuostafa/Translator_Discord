# Discord User Translator v2

A user-installed Discord translation app designed to follow a user's account across servers, DMs, and group DMs through Discord application commands.

## Core commands

- **Message context → Translate**: right-click a message and translate it privately.
- `/translate`: private text translation.
- `/say`: translate your text and send the translated output.
- `/settings`: configure incoming/outgoing default languages.
- `/status`: check translation and voice configuration.
- `/voice`: transcribe + translate an uploaded audio/voice file.

## Architecture

```text
Discord
   │ HTTPS interactions
   ▼
translator (Node.js / Express)
   ├── LibreTranslate (private Railway service)
   └── Whisper STT (optional private Railway service)
```

The main `translator` service can boot before LibreTranslate/STT are configured, which makes Discord endpoint verification and deployment easier to debug.

## Important defaults

- Host: `0.0.0.0`
- Port: `8080`
- Incoming target: `ar`
- Outgoing target: `en`
- Installation context for commands: `USER_INSTALL`
- Interaction contexts: guilds, bot DMs, private DMs/GDMs

## Setup

See [START-HERE-AR.md](./START-HERE-AR.md) for the full Arabic step-by-step setup.

## Security

- Never commit `.env`.
- Never expose `DISCORD_BOT_TOKEN` in screenshots.
- Reset a Discord token immediately if it is exposed.
- Interactions are verified using Discord's Ed25519 signature middleware.
- Translation output disables mention parsing.
