# TD AI v3.12 Upload Notes

Upload this archive at the repository root.

## Replace
- `src/adminDashboard.ts`
- `src/commands.ts`
- `src/index.ts`
- `src/voiceHandlers.ts`
- `src/services/gatewayChat.ts`
- `src/services/geminiTts.ts`
- `src/services/modelRouter.ts`
- `src/services/stt.ts`
- `src/services/voiceAi.ts`
- `package.json`

## Add
- `src/services/billingStore.ts`
- `src/services/usageContext.ts`
- `src/services/voiceControl.ts`
- `docs/guides/V3.12-VOICE-SAAS-AR.md`

## Do not move TypeScript files to repository root.

## Required validation

```bash
npm ci
npm run check
npm run build
```

Only merge/deploy if CI is green.

## Important product note
Payment is not connected in this version. Plans, credits, user roles and subscriptions are management foundations only.
