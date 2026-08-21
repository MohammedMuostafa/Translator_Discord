import type { DiscordInteraction, DiscordMessage } from './types.js';
import { clipDiscord, editOriginalResponse } from './discord.js';
import { languageLabel, normalizeLanguage, targetSelectOptions } from './languages.js';
import { getPreference } from './storage/preferences.js';
import { createAiActionSession, getAiActionSession } from './services/aiActionSessions.js';
import { runAiAction, type AiAction } from './services/aiActions.js';
import { translateText } from './providers/translator.js';
import { createSpeechSession } from './services/speechSessions.js';
import { geminiTtsConfigured } from './services/geminiTts.js';
import { createSmartReply, type SmartReplyMode, type SmartReplyResult } from './services/smartReply.js';
import {
  createSmartReplySession,
  getSmartReplySession,
  updateSmartReplySession
} from './services/smartReplySessions.js';

const RLM = '\u200f';
const LRI = '\u2066';
const PDI = '\u2069';

function userIdOf(interaction: DiscordInteraction): string {
  const id = interaction.member?.user?.id ?? interaction.user?.id;
  if (!id) throw new Error('Could not resolve the invoking Discord user.');
  return id;
}

function option(interaction: DiscordInteraction, name: string): string | undefined {
  return interaction.data?.options?.find((item) => item.name === name)?.value as string | undefined;
}

function targetMessage(interaction: DiscordInteraction): DiscordMessage | undefined {
  const id = interaction.data?.target_id;
  if (!id) return undefined;
  return interaction.data?.resolved?.messages?.[id];
}

function safeCodeBlock(text: string): string {
  return text.replaceAll('```', 'ˋˋˋ');
}

function isRtl(code: string): boolean {
  const normalized = normalizeLanguage(code, true);
  return normalized === 'ar-eg' || normalized === 'ar-msa' || normalized === 'fa' || normalized === 'he';
}

function stabilizeRtl(text: string, language: string): string {
  if (!isRtl(language)) return text;

  let inFence = false;
  return text
    .replace(/\(\s*\(([^()\n]*[A-Za-z][^()\n]*)\)\s*\)/g, '($1)')
    .replace(/\[\s*\[([^\[\]\n]*[A-Za-z][^\[\]\n]*)\]\s*\]/g, '[$1]')
    .split('\n')
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence || !line.trim()) return line;

      const prefixMatch = line.match(/^(\s{0,3}#{1,3}\s+|\s*>\s?|\s*[-*+]\s+|\s*\d+[.)]\s+)?/);
      const prefix = prefixMatch?.[0] ?? '';
      let body = line.slice(prefix.length);

      body = body
        .replace(/\(([^()\n]*[A-Za-z][^()\n]*)\)/g, `${LRI}($1)${PDI}`)
        .replace(/\[([^\[\]\n]*[A-Za-z][^\[\]\n]*)\]/g, `${LRI}[$1]${PDI}`)
        .replace(/https?:\/\/[^\s]+/g, `${LRI}$&${PDI}`)
        .replace(/(?:[A-Za-z0-9][A-Za-z0-9._:/@#%+&?=,'\-]*)(?:[ \t]+(?:[A-Za-z0-9][A-Za-z0-9._:/@#%+&?=,'\-]*))*/g, `${LRI}$&${PDI}`)
        .replace(/\s+([،؛؟])/g, '$1');

      return `${prefix}${RLM}${body}`;
    })
    .join('\n');
}

function listenComponents(userId: string, text: string, language: string): Array<Record<string, unknown>> {
  if (!geminiTtsConfigured() || language === 'auto') return [];
  const sessionId = createSpeechSession(userId, text, language);
  return [{
    type: 1,
    components: [{
      type: 2,
      style: 2,
      label: '🔊 Listen / استمع',
      custom_id: `listen_tts:${sessionId}`
    }]
  }];
}

function actionLabel(action: AiAction): string {
  switch (action) {
    case 'summarize': return '📝 Summary';
    case 'explain': return '🧠 Explain';
    case 'simplify': return '💡 Simplify';
    case 'rewrite': return '✍️ Rewrite';
    case 'reply': return '💬 Draft Reply';
    default: return '🤖 TD AI';
  }
}

function arabicReplyLanguage(preferred: string): string {
  const normalized = normalizeLanguage(preferred, true);
  return normalized === 'ar-msa' ? 'ar-msa' : 'ar-eg';
}

function smartReplyContent(result: SmartReplyResult, arabicLanguage: string): string {
  const messageLabel = result.isQuestion ? 'السؤال بالعربي' : 'الرسالة بالعربي';

  return [
    `## ${result.isQuestion ? '❓' : '💬'} Smart Answer`,
    '',
    `**${messageLabel}**`,
    stabilizeRtl(result.translatedMessage, arabicLanguage),
    '',
    `**الرد على الشخص — ${result.sourceLanguage}**`,
    stabilizeRtl(result.answer, result.sourceLanguageCode),
    '',
    '**معنى الرد بالعربي**',
    stabilizeRtl(result.answerArabic, arabicLanguage)
  ].join('\n');
}

function smartReplyComponents(
  userId: string,
  sessionId: string,
  result: SmartReplyResult,
  arabicLanguage: string
): Array<Record<string, unknown>> {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 1, label: '🔄 Change Answer', custom_id: `smart_reply:regen:${sessionId}` },
        { type: 2, style: 2, label: '✂️ Shorter', custom_id: `smart_reply:shorter:${sessionId}` },
        { type: 2, style: 2, label: '🧠 More Detail', custom_id: `smart_reply:detailed:${sessionId}` },
        { type: 2, style: 3, label: '✅ Use This Reply', custom_id: `smart_reply:use:${sessionId}` }
      ]
    },
    ...listenComponents(userId, result.answerArabic, arabicLanguage)
  ];
}

async function runAndEdit(interaction: DiscordInteraction, fn: () => Promise<Record<string, unknown>>): Promise<void> {
  try {
    await editOriginalResponse(interaction.application_id, interaction.token, await fn());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected AI error.';
    console.error(error);
    await editOriginalResponse(interaction.application_id, interaction.token, {
      content: clipDiscord(`❌ ${message}`),
      components: [],
      allowed_mentions: { parse: [] }
    }).catch(console.error);
  }
}

export async function handleAiMessagePicker(interaction: DiscordInteraction): Promise<Record<string, unknown>> {
  const userId = userIdOf(interaction);
  const message = targetMessage(interaction);
  if (!message?.content?.trim()) throw new Error('This message has no text for TD AI to process.');

  const prefs = await getPreference(userId);
  const sessionId = createAiActionSession(userId, message);

  return {
    content: [
      '## 🤖 TD AI',
      `Output language: **${languageLabel(prefs.incoming)}**`,
      '',
      'Choose what you want to do with this message:'
    ].join('\n'),
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 1, label: '🌐 Translate', custom_id: `ai_action:translate:${sessionId}` },
          { type: 2, style: 3, label: '❓ Answer', custom_id: `ai_action:answer:${sessionId}` },
          { type: 2, style: 2, label: '📝 Summarize', custom_id: `ai_action:summarize:${sessionId}` }
        ]
      },
      {
        type: 1,
        components: [
          { type: 2, style: 2, label: '🧠 Explain', custom_id: `ai_action:explain:${sessionId}` },
          { type: 2, style: 2, label: '💡 Simplify', custom_id: `ai_action:simplify:${sessionId}` },
          { type: 2, style: 2, label: '✍️ Rewrite', custom_id: `ai_action:rewrite:${sessionId}` },
          { type: 2, style: 2, label: '💬 Draft Reply', custom_id: `ai_action:reply:${sessionId}` }
        ]
      }
    ],
    allowed_mentions: { parse: [] }
  };
}

export function handleAiActionButton(interaction: DiscordInteraction): void {
  void runAndEdit(interaction, async () => {
    const customId = interaction.data?.custom_id ?? '';
    const [, actionRaw, sessionId] = customId.split(':');
    const session = sessionId ? getAiActionSession(sessionId) : undefined;
    if (!session) throw new Error('This TD AI menu expired. Right-click the message and choose Apps → TD AI again.');

    const userId = userIdOf(interaction);
    if (session.userId !== userId) throw new Error('This TD AI menu belongs to another user.');

    const prefs = await getPreference(userId);

    if (actionRaw === 'translate') {
      return {
        content: '🌐 **Choose the translation language:**',
        components: [{
          type: 1,
          components: [{
            type: 3,
            custom_id: `ai_translate_target:${sessionId}`,
            placeholder: `Translate to… (My language: ${languageLabel(prefs.incoming)})`.slice(0, 150),
            min_values: 1,
            max_values: 1,
            options: targetSelectOptions(prefs.incoming)
          }]
        }],
        allowed_mentions: { parse: [] }
      };
    }

    if (actionRaw === 'answer') {
      const language = arabicReplyLanguage(prefs.incoming);
      const result = await createSmartReply(session.message.content, language);
      const smartSessionId = createSmartReplySession(userId, session.message.content, language, result);

      return {
        content: clipDiscord(smartReplyContent(result, language), 1900),
        components: smartReplyComponents(userId, smartSessionId, result, language),
        allowed_mentions: { parse: [] }
      };
    }

    const action = actionRaw as AiAction;
    if (!['summarize', 'explain', 'simplify', 'rewrite', 'reply'].includes(action)) {
      throw new Error('Unknown TD AI action.');
    }

    const output = await runAiAction(action, session.message.content, prefs.incoming);
    const formatted = stabilizeRtl(output, prefs.incoming);

    return {
      content: clipDiscord(`## ${actionLabel(action)}\n\n${formatted}`, 1900),
      components: listenComponents(userId, output, prefs.incoming),
      allowed_mentions: { parse: [] }
    };
  });
}

export function handleSmartReplyButton(interaction: DiscordInteraction): void {
  void runAndEdit(interaction, async () => {
    const customId = interaction.data?.custom_id ?? '';
    const [, action, sessionId] = customId.split(':');
    const session = sessionId ? getSmartReplySession(sessionId) : undefined;
    if (!sessionId || !session) throw new Error('This answer expired. Open TD AI on the message again.');

    const userId = userIdOf(interaction);
    if (session.userId !== userId) throw new Error('This answer belongs to another user.');

    if (action === 'use') {
      return {
        content: [
          '## ✅ Ready to send',
          '',
          `Reply language: **${session.result.sourceLanguage}**`,
          'Copy the reply below, paste it into the chat, then press Enter:',
          '',
          '```text',
          safeCodeBlock(session.result.answer),
          '```',
          '',
          '**معنى الرد بالعربي**',
          stabilizeRtl(session.result.answerArabic, session.language)
        ].join('\n'),
        components: listenComponents(userId, session.result.answerArabic, session.language),
        allowed_mentions: { parse: [] }
      };
    }

    const modeMap: Record<string, SmartReplyMode> = {
      regen: 'alternative',
      shorter: 'shorter',
      detailed: 'detailed'
    };
    const mode = modeMap[action ?? ''];
    if (!mode) throw new Error('Unknown answer action.');

    const result = await createSmartReply(
      session.sourceMessage,
      session.language,
      mode,
      session.result.answer
    );
    updateSmartReplySession(sessionId, result);

    return {
      content: clipDiscord(smartReplyContent(result, session.language), 1900),
      components: smartReplyComponents(userId, sessionId, result, session.language),
      allowed_mentions: { parse: [] }
    };
  });
}

export function handleAiTranslateTarget(interaction: DiscordInteraction): void {
  void runAndEdit(interaction, async () => {
    const customId = interaction.data?.custom_id ?? '';
    const sessionId = customId.startsWith('ai_translate_target:')
      ? customId.slice('ai_translate_target:'.length)
      : '';
    const session = sessionId ? getAiActionSession(sessionId) : undefined;
    if (!session) throw new Error('This TD AI menu expired. Open it again from the message.');

    const userId = userIdOf(interaction);
    if (session.userId !== userId) throw new Error('This TD AI menu belongs to another user.');

    const prefs = await getPreference(userId);
    const selected = interaction.data?.values?.[0];
    const target = normalizeLanguage(selected === 'my' || !selected ? prefs.incoming : selected);
    const translated = await translateText(session.message.content, target, {
      source: 'auto',
      provider: prefs.provider,
      style: prefs.style
    });

    const output = stabilizeRtl(translated.text, target);
    const source = translated.detectedSourceLanguage
      ? ` • detected: ${languageLabel(translated.detectedSourceLanguage)}`
      : '';

    return {
      content: clipDiscord(`## 🌐 ${languageLabel(target)}${source} • ${translated.provider}\n\n${output}`, 1900),
      components: listenComponents(userId, translated.text, target),
      allowed_mentions: { parse: [] }
    };
  });
}

export function handleAiSlash(interaction: DiscordInteraction): void {
  void runAndEdit(interaction, async () => {
    const userId = userIdOf(interaction);
    const prefs = await getPreference(userId);
    const action = (option(interaction, 'action') ?? 'ask') as AiAction;
    const text = option(interaction, 'text')?.trim();
    if (!text) throw new Error('Text is required.');

    const requestedLanguage = option(interaction, 'language') ?? 'my';
    const language = requestedLanguage === 'my' ? prefs.incoming : normalizeLanguage(requestedLanguage, true);
    const result = await runAiAction(action, text, language);
    const formatted = stabilizeRtl(result, language);

    return {
      content: clipDiscord(`## ${actionLabel(action)}\n\n${formatted}`, 1900),
      components: listenComponents(userId, result, language),
      allowed_mentions: { parse: [] }
    };
  });
}

export function handleHelp(): Record<string, unknown> {
  return {
    content: [
      '## ✨ TD AI — Quick Help',
      '',
      '**Right-click any message → Apps → TD AI**',
      '🌐 Translate • ❓ Smart Answer • 📝 Summarize • 🧠 Explain • 💡 Simplify • ✍️ Rewrite • 💬 Draft Reply',
      '',
      '**Smart Answer**',
      'Shows the selected message in Arabic, drafts the reply in the sender’s own language, and shows the Arabic meaning of that reply.',
      '',
      '**Commands**',
      '`/translate` — translate text with automatic source detection',
      '`/ai` — summarize, explain, simplify, rewrite, draft a reply, or ask AI',
      '`/chat open` — start an interactive private AI chat in DMs',
      '`/voicechat join` — join your voice channel and talk with TD AI',
      '`/voicechat leave` — disconnect TD AI from voice',
      '`/voice` — transcribe and translate an uploaded audio file',
      '`/say` — create a copy-ready translation',
      '`/settings` — choose your language and translation defaults',
      '`/status` — check configured services',
      '',
      '🔊 **Listen** is available on supported AI/translation results when Gemini TTS is configured.'
    ].join('\n'),
    allowed_mentions: { parse: [] }
  };
}
