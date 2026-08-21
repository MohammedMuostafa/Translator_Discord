import type { DiscordInteraction, DiscordMessage } from './types.js';
import { clipDiscord, editOriginalResponse } from './discord.js';
import { languageLabel, normalizeLanguage, targetSelectOptions } from './languages.js';
import { getPreference } from './storage/preferences.js';
import { createAiActionSession, getAiActionSession } from './services/aiActionSessions.js';
import { runAiAction, type AiAction } from './services/aiActions.js';
import { translateText } from './providers/translator.js';
import { createSpeechSession } from './services/speechSessions.js';
import { geminiTtsConfigured } from './services/geminiTts.js';

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

function isRtl(code: string): boolean {
  const normalized = normalizeLanguage(code, true);
  return normalized === 'ar-eg' || normalized === 'ar-msa' || normalized === 'fa' || normalized === 'he';
}

function stabilizeRtl(text: string, language: string): string {
  if (!isRtl(language)) return text;

  let inFence = false;
  return text
    .replace(/\(\s*\(([^()\n]*[A-Za-z][^()\n]*)\)\s*\)/g, '($1)')
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
        // Parentheses/brackets containing LTR content are isolated as a whole.
        .replace(/\(([^()\n]*[A-Za-z][^()\n]*)\)/g, `${LRI}($1)${PDI}`)
        .replace(/\[([^\[\]\n]*[A-Za-z][^\[\]\n]*)\]/g, `${LRI}[$1]${PDI}`)
        // URLs and remaining Latin runs.
        .replace(/https?:\/\/[^\s]+/g, `${LRI}$&${PDI}`)
        .replace(/(?:[A-Za-z0-9][A-Za-z0-9._:/@#%+&?=,'\-]*)(?:[ \t]+(?:[A-Za-z0-9][A-Za-z0-9._:/@#%+&?=,'\-]*))*/g, `${LRI}$&${PDI}`);

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
      'What do you want to do with this message?'
    ].join('\n'),
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 1, label: '🌐 Translate', custom_id: `ai_action:translate:${sessionId}` },
          { type: 2, style: 2, label: '📝 Summarize', custom_id: `ai_action:summarize:${sessionId}` },
          { type: 2, style: 2, label: '🧠 Explain', custom_id: `ai_action:explain:${sessionId}` }
        ]
      },
      {
        type: 1,
        components: [
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

    if (actionRaw === 'translate') {
      const prefs = await getPreference(userId);
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

    const action = actionRaw as AiAction;
    if (!['summarize', 'explain', 'simplify', 'rewrite', 'reply'].includes(action)) {
      throw new Error('Unknown TD AI action.');
    }

    const prefs = await getPreference(userId);
    const output = await runAiAction(action, session.message.content, prefs.incoming);
    const formatted = stabilizeRtl(output, prefs.incoming);

    return {
      content: clipDiscord(`## ${actionLabel(action)}\n\n${formatted}`, 1900),
      components: listenComponents(userId, output, prefs.incoming),
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
      '🌐 Translate • 📝 Summarize • 🧠 Explain • 💡 Simplify • ✍️ Rewrite • 💬 Draft Reply',
      '',
      '**Commands**',
      '`/translate` — translate text with automatic source detection',
      '`/ai` — summarize, explain, simplify, rewrite, draft a reply, or ask AI',
      '`/chat open` — start an interactive private AI chat in DMs',
      '`/voice` — transcribe and translate an audio file',
      '`/say` — create a copy-ready translation',
      '`/settings` — choose your language and translation defaults',
      '`/status` — check configured services',
      '',
      '🔊 **Listen** is available on supported AI/translation results when Gemini TTS is configured.'
    ].join('\n'),
    allowed_mentions: { parse: [] }
  };
}
