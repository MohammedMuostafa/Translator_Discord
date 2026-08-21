<div align="center">

<img width="350" height="350" alt="ChatGPT Image Aug 21, 2026, 03_45_09 PM" src="https://github.com/user-attachments/assets/774b6c02-6b5c-43c6-8b2e-573bfa603e46" />

# 🌍 Translator Discord

### AI-powered translation directly inside Discord

Translate messages across servers, DMs, and group DMs with automatic language detection, Egyptian Arabic, Modern Standard Arabic, Persian, English, French, and many more languages.

Powered by **Gemini AI**, with optional **LibreTranslate**, voice transcription, structured translation, RTL support, and text-to-speech playback.

<br />

[![Use Translator Discord](https://img.shields.io/badge/Use%20Translator%20Discord-5865F2?style=for-the-badge\&logo=discord\&logoColor=white)](https://discord.com/oauth2/authorize?client_id=1540313821833330739)

[![GitHub](https://img.shields.io/badge/GitHub-Source%20Code-181717?style=for-the-badge\&logo=github)](https://github.com/MohammedMuostafa/Translator_Discord)

<br />

**[🚀 Add Translator Discord to your account](https://discord.com/oauth2/authorize?client_id=1540313821833330739)**

</div>

---

## ✨ What is Translator Discord?

**Translator Discord** is a user-installed Discord application built to make multilingual conversations easier.

Instead of copying messages into external translation websites, you can translate content directly from Discord.

Right-click a message, choose:

```text
Apps → Translate
```

select your target language, and Translator Discord handles the rest.

The application can automatically detect the original language using AI, including recognizing conversational Arabic and distinguishing between **Egyptian Arabic** and **Modern Standard Arabic** when possible.

The app is designed as a **User Install Discord application**, meaning users can install it to their Discord account and use supported application commands across servers, DMs, and group DMs where Discord permits external apps.

---

# 🚀 Try Translator Discord

You do **not** need to deploy the project yourself if you simply want to use the official instance.

### Click below:

## 👉 [Add Translator Discord to Discord](https://discord.com/oauth2/authorize?client_id=1540313821833330739)

The application is installed to your Discord account rather than requiring a traditional bot installation in every server.

After installation, open Discord and try:

```text
/status
```

or right-click a message:

```text
Apps
└── Translate
```

---

# 🌟 Main Features

## 🌍 Automatic Language Detection

You normally do not need to specify the source language.

Enter:

```text
انا داخل الجيم دلوقتي استنوني
```

Choose:

```text
Target → English
```

Gemini can detect that the source is Arabic and translate it naturally.

The same flow works for:

```text
English → Arabic
French → Arabic
Persian → English
Arabic → Persian
Spanish → English
and more...
```

---

## 🇪🇬 Egyptian Arabic Support

Translator Discord treats Egyptian Arabic as its own translation target.

Example:

```text
English:
I'll join you guys in five minutes.

Target:
Arabic — Egyptian
```

Possible result:

```text
هدخل معاكم كمان خمس دقايق يا جماعة
```

This is particularly useful for conversational Discord chats where formal Arabic can feel unnatural.

---

## 📖 Modern Standard Arabic

For announcements, documentation, professional communication, news, and formal text, choose:

```text
Arabic — Modern Standard
```

Example:

```text
The update introduces several improvements to the platform.
```

becomes a formal Arabic translation rather than Egyptian conversational Arabic.

---

## 🇮🇷 Persian / Farsi

Persian is also available as a translation target.

You can translate between combinations such as:

```text
Persian → English
English → Persian
Persian → Arabic
Arabic → Persian
```

---

# 🤖 Gemini AI Translation

Translator Discord can use **Google Gemini** as its primary AI translation engine.

AI translation is useful for more than direct word replacement.

It can understand:

* Context
* Slang
* Egyptian Arabic
* Modern Standard Arabic
* Mixed Arabic + English messages
* Technical terminology
* Product names
* Conversational tone
* Long announcements
* Structured Discord messages

The application can also provide several translation styles.

### Natural

Recommended for most messages.

```text
style: Natural
```

### Casual

Useful for normal Discord conversations.

```text
style: Casual
```

### Formal

Useful for announcements and professional communication.

```text
style: Formal
```

### Literal

Useful when you want a closer word-for-word translation.

```text
style: Literal
```

---

# 🧠 Translation Providers

Translator Discord supports multiple translation backends.

### AI / Gemini

Best for:

* Egyptian Arabic
* Dialects
* Context
* Slang
* Natural translations
* Complex sentences
* Mixed-language messages

### LibreTranslate

Open-source translation backend.

Useful as:

* A self-hosted translator
* A fallback provider
* A translation option that does not require an AI request

### Google Translate

Can be configured with a Google Translation API key.

### DeepL

Can be configured as an additional translation provider.

---

# 🖱️ Right-Click Message Translation

One of the easiest ways to use Translator Discord is directly from a message.

Right-click any supported Discord message:

```text
Right Click Message
        ↓
Apps
        ↓
Translate
        ↓
Choose Target Language
```

The source language is detected automatically.

You can choose destinations such as:

```text
🇪🇬 Arabic — Egyptian
📖 Arabic — Modern Standard
🇺🇸 English
🇮🇷 Persian
🇫🇷 French
🇩🇪 German
🇪🇸 Spanish
and more...
```

The result is returned privately through Discord interactions.

---

# 💬 `/translate`

Translate text manually.

Example:

```text
/translate
```

Then provide:

```text
text:
انا داخل الجيم دلوقتي

target:
English

style:
Natural

provider:
AI / Gemini
```

You only need to choose the destination.

The AI detects the source automatically.

---

# ✍️ `/say`

`/say` is designed for messages **you want to send yourself**.

Example:

You want to write:

```text
انا داخل بعد خمس دقايق استنوني
```

but send it in English.

Use:

```text
/say
```

Translator Discord returns a private translated version:

```text
I'm joining in five minutes, wait for me.
```

Copy it, paste it into Discord, and send it.

This means the final message is sent by **your own Discord account**, not displayed publicly as a bot-authored translation.

Translator Discord intentionally does not use self-bot behavior or automate personal Discord user accounts.

---

# 🎤 Voice Translation

Translator Discord includes support for voice/audio translation when the speech-to-text service is configured.

Use:

```text
/voice
```

Upload an audio file or supported Discord voice message.

The pipeline is:

```text
Audio
  ↓
Speech-to-Text
  ↓
Automatic Language Detection
  ↓
Translation
  ↓
Translated Text
```

A self-hosted Whisper-compatible STT service can be used.

---

# 🔊 Listen / Text-to-Speech

Translated results can include:

```text
🔊 Listen / استمع
```

When Gemini TTS is configured, pressing the button generates speech from the translated result.

This can be useful when:

* Learning pronunciation
* Reading Persian
* Reading Arabic
* Understanding English pronunciation
* Listening instead of reading
* Practicing languages

Translator Discord can reuse the configured Gemini API key for TTS.

---

# 📝 Structured Message Translation

Translator Discord is designed to preserve the structure of larger Discord messages.

For example, an original message containing:

```markdown
## New Update

Short introduction.

### Features

- New equipment
- New weapons
- Improved performance

### How to participate

1. Upload your video
2. Add a title
3. Add a description
```

is translated while attempting to preserve:

* Headings
* Paragraphs
* Bullet lists
* Numbered lists
* Blank lines
* URLs
* Mentions
* Technical names
* Emojis
* Product names
* Discord Markdown

This is particularly useful for translating announcements and long community posts.

---

# ↔️ Arabic RTL Support

Arabic and Persian require right-to-left rendering.

Translator Discord applies RTL stabilization to translated output while trying to keep embedded English text readable.

Example:

```text
يمكنك استخدام Hardware Lumen لتحسين جودة الإضاءة.
```

Instead of allowing mixed RTL/LTR text to completely reorder the line, the formatter attempts to preserve the intended reading order.

---

# ⚙️ Commands

| Command            | Description                               |
| ------------------ | ----------------------------------------- |
| `Apps → Translate` | Translate a selected Discord message      |
| `/translate`       | Translate manually entered text           |
| `/say`             | Generate a private copy-ready translation |
| `/voice`           | Transcribe and translate audio            |
| `/settings`        | Configure translation preferences         |
| `/status`          | Check translator, AI, STT, and TTS status |

---

# ⚙️ User Settings

Use:

```text
/settings
```

to configure your preferences.

For example:

```text
My Language:
Arabic — Egyptian

Outgoing:
English

Provider:
AI

Style:
Natural
```

`My Language` can be used as a convenient translation target when translating messages.

---

# 🏗️ Architecture

```text
Discord
   │
   │ HTTPS Interactions
   ▼
Translator Discord
Node.js + TypeScript
   │
   ├──── Gemini AI
   │       ├── Translation
   │       ├── Language Detection
   │       ├── Dialect Awareness
   │       └── Text-to-Speech
   │
   ├──── LibreTranslate
   │       └── Translation / Fallback
   │
   └──── Speech-to-Text
           └── Whisper
```

---

# 🛠️ Technology Stack

### Core

```text
Node.js 22+
TypeScript
Express
Discord Interactions API
Zod
```

### Translation

```text
Google Gemini
LibreTranslate
Google Translation API
DeepL
```

### Voice

```text
Whisper / Speech-to-Text
Gemini Text-to-Speech
```

### Deployment

```text
Docker
Railway
GitHub
```

---

# 📦 Run Your Own Instance

If you are a developer and want to self-host Translator Discord, clone the project:

```bash
git clone https://github.com/MohammedMuostafa/Translator_Discord.git
cd Translator_Discord
```

Install dependencies:

```bash
npm install
```

The project requires:

```text
Node.js >= 22
```

---

# 🔐 Environment Configuration

Copy the environment template:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Never commit the real `.env` file.

---

## Discord Configuration

Required:

```env
DISCORD_APP_ID=YOUR_APPLICATION_ID
DISCORD_PUBLIC_KEY=YOUR_PUBLIC_KEY
DISCORD_BOT_TOKEN=YOUR_BOT_TOKEN

REGISTER_COMMANDS_ON_START=true
```

Get these values from:

```text
Discord Developer Portal
→ Applications
→ Your Application
```

`DISCORD_BOT_TOKEN` must always remain private.

---

# 🤖 Gemini Configuration

Example:

```env
TRANSLATION_PROVIDER=ai

AI_API_URL=https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
AI_API_KEY=YOUR_GEMINI_API_KEY
AI_MODEL=YOUR_GEMINI_MODEL
```

The Gemini API key should be stored only in:

* Railway Variables
* Environment variables
* A secure secret manager

Never put it inside the public repository.

---

# 🔊 Gemini TTS Configuration

Optional:

```env
GEMINI_TTS_API_KEY=
GEMINI_TTS_MODEL=YOUR_GEMINI_TTS_MODEL
GEMINI_TTS_VOICE=Kore
TTS_MAX_CHARS=4000
```

If `GEMINI_TTS_API_KEY` is empty, the application can reuse:

```env
AI_API_KEY
```

when that key belongs to Gemini.

---

# 🌐 LibreTranslate

For Docker Compose:

```env
LIBRETRANSLATE_URL=http://libretranslate:5000
```

For Railway private networking:

```env
LIBRETRANSLATE_URL=http://libretranslate.railway.internal:5000
```

LibreTranslate can run as a separate Docker service using:

```text
libretranslate/libretranslate:latest
```

---

# 🎤 Speech-to-Text

Optional voice configuration:

```env
STT_URL=http://stt:8000
STT_API_KEY=CHANGE_TO_A_LONG_RANDOM_SECRET

MAX_AUDIO_BYTES=15728640
```

For Railway private networking:

```env
STT_URL=http://stt.railway.internal:8000
```

---

# 💻 Local Development

Start development mode:

```bash
npm run dev
```

Type-check the project:

```bash
npm run check
```

Build:

```bash
npm run build
```

Run the production build:

```bash
npm start
```

Register Discord commands manually:

```bash
npm run register
```

---

# 🚂 Railway Deployment

Translator Discord can be deployed from GitHub directly to Railway.

### Main Translator Service

Deploy the repository and configure the required environment variables.

The application listens on:

```text
HOST=0.0.0.0
PORT=8080
```

Railway may manage the exposed networking configuration.

Create a public domain and configure:

```env
PUBLIC_BASE_URL=https://YOUR-SERVICE.up.railway.app
```

---

## Discord Interactions Endpoint

In Discord Developer Portal:

```text
General Information
→ Interactions Endpoint URL
```

Set:

```text
https://YOUR-SERVICE.up.railway.app/interactions
```

Health check:

```text
https://YOUR-SERVICE.up.railway.app/health
```

A healthy deployment should return application status information.

---

# 👤 Discord User Installation

Translator Discord is designed primarily for:

```text
User Install
```

Recommended Discord installation configuration:

```text
Installation Contexts

✅ User Install
❌ Guild Install
```

Scope:

```text
applications.commands
```

This allows supported application commands to follow the installed user across Discord contexts where Discord permits them.

---

# 🔒 Security

This repository is intentionally safe to publish **only when secrets remain outside Git**.

## Never commit:

```text
.env
Discord Bot Token
Gemini API Key
Google API Key
DeepL API Key
STT secrets
Railway secrets
Private credentials
```

Use placeholders inside:

```text
.env.example
```

Production credentials should live inside Railway Variables or another secure secrets manager.

---

# ⚠️ If You Fork This Repository

A fork of this repository does **not** gain access to the official application's credentials.

You must create your own:

```text
Discord Application
Discord Bot Token
Discord Public Key
Gemini API Key
Railway project
Translation provider configuration
```

The official application's secrets are not supposed to exist in the source code.

---

# 🚫 No Self-Bot

Translator Discord does not use Discord user tokens and does not attempt to automate a personal Discord account.

For outgoing translations, `/say` returns private text for the user to copy and send manually.

This keeps the project based on official Discord application interactions instead of self-bot behavior.

---

# 📁 Project Structure

```text
Translator_Discord/
│
├── src/
│   ├── commands.ts
│   ├── config.ts
│   ├── discord.ts
│   ├── handlers.ts
│   ├── index.ts
│   ├── languages.ts
│   ├── register.ts
│   │
│   ├── providers/
│   │   ├── translator.ts
│   │   ├── translatorAI.ts
│   │   ├── translatorLibre.ts
│   │   ├── translatorGoogle.ts
│   │   └── translatorDeepL.ts
│   │
│   ├── services/
│   │   ├── stt.ts
│   │   ├── geminiTts.ts
│   │   └── ...
│   │
│   └── storage/
│
├── python-stt/
│
├── docs/
│   ├── terms.html
│   └── privacy.html
│
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

---

# 🩺 Troubleshooting

## `fetch failed`

Usually means the translator cannot reach the selected provider.

For Railway + LibreTranslate, verify:

```env
LIBRETRANSLATE_URL=http://libretranslate.railway.internal:5000
```

and confirm the `libretranslate` service is online.

---

## Gemini 503

If Gemini returns:

```text
503 UNAVAILABLE
```

the selected Gemini model may temporarily be under high demand.

Possible actions:

* Retry the request
* Use another Gemini model
* Use LibreTranslate as fallback
* Configure automatic provider fallback

---

## Discord endpoint verification fails

Verify:

```text
https://YOUR-DOMAIN/health
```

works.

Then make sure Discord uses:

```text
https://YOUR-DOMAIN/interactions
```

not:

```text
https://YOUR-DOMAIN/
```

---

## Bot is thinking for a long time

Check:

```text
Railway
→ Translator_Discord
→ Deploy Logs
```

and check the translation provider service.

---

# 📜 Terms & Privacy

Translator Discord has public legal pages:

### Terms of Service

[Terms of Service](https://mohammedmuostafa.github.io/Translator_Discord/terms.html)

### Privacy Policy

[Privacy Policy](https://mohammedmuostafa.github.io/Translator_Discord/privacy.html)

---

# 🔗 Links

### 🚀 Use Translator Discord

https://discord.com/oauth2/authorize?client_id=1540313821833330739

### 💻 Source Code

https://github.com/MohammedMuostafa/Translator_Discord

### 📜 Terms of Service

https://mohammedmuostafa.github.io/Translator_Discord/terms.html

### 🔐 Privacy Policy

https://mohammedmuostafa.github.io/Translator_Discord/privacy.html

---

# 🤝 Contributing

Contributions, bug reports, and feature suggestions are welcome.

If you find a problem:

1. Check existing GitHub issues.
2. Create a new issue with clear reproduction steps.
3. Include relevant logs after removing secrets.
4. Never post API keys, Discord tokens, or private credentials.

Pull requests should:

* Keep secrets out of the repository
* Follow the existing TypeScript structure
* Avoid self-bot functionality
* Preserve Discord interaction security
* Maintain RTL and multilingual compatibility

---

# ⭐ Support the Project

If Translator Discord helps you communicate with international communities, consider starring the repository.

A GitHub ⭐ helps more developers discover and improve the project.

---

<div align="center">

## 🌍 Break the language barrier without leaving Discord.

### [🚀 Use Translator Discord](https://discord.com/oauth2/authorize?client_id=1540313821833330739)

Built with TypeScript, Discord Interactions, Gemini AI, and open translation tools.

</div>
