# TD AI v3.10 — Group Voice + Display Studio

## 1. Group Voice

The old voice receiver explicitly rejected every speaker except the user who ran `/voicechat join`.

v3.10 changes the voice session into a group session:

- Default access: **Everyone in the connected voice channel**
- Ignores bots and TD AI itself
- Verifies the speaker is still inside the same voice channel
- Any human can interrupt TD AI while it is speaking
- Session owner still controls `/voicechat leave`
- Tracks participant count and current speaker in `/voicechat status`
- One spoken turn is processed at a time so two overlapping PCM streams are not mixed together

Dashboard → Voice AI now contains:

`Who can talk to TD AI?`
- Everyone in the voice channel
- Session owner only

After deploying, run:

```text
/voicechat leave
/voicechat join
```

The existing session must be recreated because voice runtime settings are loaded when joining.

---

## 2. Display Studio

Dashboard → Display is now configurable.

Controls:

- Heading size: Large / Medium / Small
- Text density: Compact / Comfortable / Relaxed
- Section divider: None / Horizontal line / Extra spacing
- Show/hide emojis
- Show/hide detected language
- Show/hide provider name
- Show/hide original message
- Original preview length
- Quote Arabic explanation blocks
- Arabic explanation first / reply first in Smart Answer
- Live preview before saving

These settings are stored in `/data/runtime-config.json` and apply to new Discord responses.

### Important Discord limitation

Discord itself owns the actual body font family and body font size. A bot cannot force a custom font such as Cairo or set arbitrary `18px`.

v3.10 changes the visual hierarchy using Discord-supported Markdown:
- `#` large heading
- `##` medium heading
- `###` small heading
- spacing
- quotes
- section order
- metadata visibility
- emojis

---

## 3. Included routing fixes

This bundle also carries forward the v3.9.2 fixes:
- dashboard routes reflect the effective model
- common Gemini shorthand model IDs are normalized
- Gemini text requests can use the native Gemini endpoint
- Translation / Smart Answer use structured JSON output with Gemini Native

---

## Upload

Replace these files with the files from this package:

```text
package.json
src/adminDashboard.ts
src/aiActionHandlers.ts
src/handlers.ts
src/voiceHandlers.ts
src/providers/translatorAI.ts
src/services/modelRouter.ts
src/services/runtimeConfig.ts
src/services/smartReply.ts
src/services/voiceAi.ts
```

Suggested commit:

```text
Add group voice and display studio v3.10
```

After Railway deploy:

1. Open `/admin`
2. Hard refresh: `Ctrl + Shift + R`
3. Voice AI → Who can talk → **Everyone in the voice channel**
4. Save Voice Settings
5. `/voicechat leave`
6. `/voicechat join`
7. Let another human in the same channel speak to TD AI
8. Check `/voicechat status` → `Participants heard` should increase
