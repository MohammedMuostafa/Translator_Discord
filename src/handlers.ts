import type { DiscordAttachment, DiscordInteraction, DiscordMessage } from './types.js';
import { clipDiscord, editOriginalResponse, editOriginalResponseWithFile } from './discord.js';
import { languageLabel, normalizeLanguage, targetSelectOptions } from './languages.js';
import {
  aiConfigured,
  translateText,
  translationConfiguration,
  type TranslationProvider,
  type TranslationStyle
} from './providers/translator.js';
import { env } from './config.js';
import { transcribeDiscordAttachment } from './services/stt.js';
import { getPreference, updatePreference } from './storage/preferences.js';
import { createTranslationSession, getTranslationSession } from './services/translationSessions.js';
import { createSpeechSession, getSpeechSession } from './services/speechSessions.js';
import { generateGeminiSpeech, geminiTtsConfigured } from './services/geminiTts.js';

function userIdOf(interaction: DiscordInteraction): string {
  const id = interaction.member?.user?.id ?? interaction.user?.id;
  if (!id) throw new Error('Could not resolve the invoking Discord user.');
  return id;
}

function option<T extends string | boolean>(interaction: DiscordInteraction, name: string): T | undefined {
  return interaction.data?.options?.find((item) => item.name === name)?.value as T | undefined;
}

function targetMessage(interaction: DiscordInteraction): DiscordMessage | undefined {
  const id = interaction.data?.target_id;
  if (!id) return undefined;
  return interaction.data?.resolved?.messages?.[id];
}

function targetAttachment(interaction: DiscordInteraction, optionName = 'audio'): DiscordAttachment | undefined {
  const attachmentId = option<string>(interaction, optionName);
  if (!attachmentId) return undefined;
  return interaction.data?.resolved?.attachments?.[attachmentId];
}

function safeCodeBlock(text: string): string {
  return text.replaceAll('```', 'ˋˋˋ');
}

const RLI = '\u2067';
const LRI = '\u2066';
const PDI = '\u2069';

function isRtlLanguage(code: string): boolean {
  const normalized = normalizeLanguage(code, true);
  return normalized === 'ar-eg' || normalized === 'ar-msa' || normalized === 'fa' || normalized === 'he';
}

function protectDirectionalTokens(text: string): { text: string; restore: (value: string) => string } {
  const protectedValues: string[] = [];
  const protect = (value: string): string => {
    const index = protectedValues.push(value) - 1;
    return String.fromCharCode(0xe000 + index);
  };

  // Keep code, URLs and Discord markup byte-for-byte intact so bidi helpers do
  // not break links, mentions, custom emojis or inline code.
  let value = text
    .replace(/`[^`\n]+`/g, protect)
    .replace(/https?:\/\/[^\s<>)]+/g, protect)
    .replace(/www\.[^\s<>)]+/g, protect)
    .replace(/<(?:(?:@!?|#|@&)?\d+|a?:[^:>]+:\d+)>/g, protect);

  // Isolate consecutive Latin/number runs such as "Wilder World", "4K 1080p"
  // or "Infinity Rising" while leaving Arabic/Persian sentence order intact.
  value = value.replace(
    /(?:[A-Za-z0-9][A-Za-z0-9._:/@#%+&?=,'()\-]*)(?:[ \t]+(?:[A-Za-z0-9][A-Za-z0-9._:/@#%+&?=,'()\-]*))*/g,
    `${LRI}$&${PDI}`
  );

  return {
    text: value,
    restore: (current: string) =>
      current.replace(/[\ue000-\uf8ff]/g, (placeholder) => {
        const index = placeholder.charCodeAt(0) - 0xe000;
        return protectedValues[index] ?? placeholder;
      })
  };
}

function splitMarkdownPrefix(line: string): { prefix: string; body: string } {
  const patterns = [
    /^(\s{0,3}#{1,3}\s+)/,
    /^(\s*>\s?)/,
    /^(\s*[-*+]\s+(?:\[[ xX]\]\s+)?)/,
    /^(\s*\d+[.)]\s+)/
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match?.[1]) return { prefix: match[1], body: line.slice(match[1].length) };
  }
  return { prefix: '', body: line };
}

function stabilizeRtlMarkdown(text: string): string {
  let inCodeFence = false;

  return text
    .split('\n')
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inCodeFence = !inCodeFence;
        return line;
      }
      if (inCodeFence || !line.trim()) return line;

      const { prefix, body } = splitMarkdownPrefix(line);
      const protectedBody = protectDirectionalTokens(body);
      return `${prefix}${RLI}${protectedBody.restore(protectedBody.text)}${PDI}`;
    })
    .join('\n');
}

function directionalText(text: string, language: string): string {
  return isRtlLanguage(language) ? stabilizeRtlMarkdown(text) : text;
}

function normalizedTranslation(text: string, language: string): string {
  // Preserve Discord Markdown produced by the AI. Only normalize excessive blank
  // lines and bidi direction; do not promote every line to a heading.
  const normalized = text.replace(/\n{3,}/g, '\n\n').trim();
  return directionalText(normalized, language);
}

function buildListenComponents(userId: string, translated: string, target: string): Array<Record<string, unknown>> {
  if (!geminiTtsConfigured()) return [];
  const sessionId = createSpeechSession(userId, translated, target);
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 2,
          label: '🔊 Listen / استمع',
          custom_id: `listen_tts:${sessionId}`
        }
      ]
    }
  ];
}

function formatTranslation(
  input: string,
  translated: string,
  target: string,
  detectedSource?: string,
  provider?: string
): string {
  const source = detectedSource && detectedSource !== 'auto' ? ` • detected: ${languageLabel(detectedSource)}` : '';
  const engine = provider ? ` • ${provider}` : '';
  const output = normalizedTranslation(translated, target);
  const original = directionalText(clipDiscord(input, 420), detectedSource ?? 'auto');

  const header = `## 🌐 ${languageLabel(target)}${source}${engine}\n\n`;
  const originalBlock = `\n\n**Original**\n> ${original.replaceAll('\n', '\n> ')}`;

  // Prioritize the full translated content. If the original would push the
  // Discord message over the limit, omit the original preview instead of
  // truncating the translation prematurely.
  if ((header + output + originalBlock).length <= 1900) {
    return header + output + originalBlock;
  }
  return clipDiscord(header + output, 1900);
}

function formatCopyTranslation(
  translated: string,
  target: string,
  detectedSource?: string,
  provider?: string
): string {
  const source = detectedSource && detectedSource !== 'auto' ? ` • detected: ${languageLabel(detectedSource)}` : '';
  const preview = normalizedTranslation(translated, target);
  const copyBlock = `\n\n**Copy text:**\n\`\`\`text\n${safeCodeBlock(translated)}\n\`\`\`\nPaste it into Discord and press Send so the message is authored by your own account.`;
  const header = `## ✍️ Copy & send as yourself — ${languageLabel(target)}${source}${provider ? ` • ${provider}` : ''}\n\n`;

  if ((header + preview + copyBlock).length <= 1900) return header + preview + copyBlock;
  return clipDiscord(header + preview, 1900);
}

async function runAndEdit(
  interaction: DiscordInteraction,
  fn: () => Promise<Record<string, unknown>>
): Promise<void> {
  try {
    const payload = await fn();
    await editOriginalResponse(interaction.application_id, interaction.token, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    console.error(error);
    await editOriginalResponse(interaction.application_id, interaction.token, {
      content: clipDiscord(`❌ ${message}`),
      components: [],
      allowed_mentions: { parse: [] }
    }).catch(console.error);
  }
}

function requestOptions(interaction: DiscordInteraction, defaults: { provider: TranslationProvider | 'default'; style: TranslationStyle }) {
  return {
    source: 'auto',
    provider: (option<string>(interaction, 'provider') as TranslationProvider | 'default' | undefined) ?? defaults.provider,
    style: (option<string>(interaction, 'style') as TranslationStyle | undefined) ?? defaults.style
  };
}

function resolveTarget(raw: string | undefined, fallback: string, myLanguage: string): string {
  if (!raw) return normalizeLanguage(fallback);
  if (raw === 'my') return normalizeLanguage(myLanguage);
  return normalizeLanguage(raw);
}

function audioFromMessage(message: DiscordMessage): DiscordAttachment | undefined {
  return message.attachments?.find((attachment) =>
    attachment.content_type?.startsWith('audio/') || /\.(ogg|oga|opus|mp3|m4a|wav|webm|aac|flac)$/i.test(attachment.filename)
  );
}

async function messageText(message: DiscordMessage): Promise<{ text: string; spokenLanguage?: string }> {
  const content = message.content?.trim();
  if (content) return { text: content };

  const audio = audioFromMessage(message);
  if (!audio) throw new Error('This message has no text or supported voice/audio attachment.');
  const transcript = await transcribeDiscordAttachment(audio);
  return { text: transcript.text, spokenLanguage: transcript.language };
}

export async function handleTranslateMessagePicker(interaction: DiscordInteraction): Promise<Record<string, unknown>> {
  const userId = userIdOf(interaction);
  const prefs = await getPreference(userId);
  const message = targetMessage(interaction);
  if (!message) throw new Error('Discord did not provide the selected message.');
  if (!message.content?.trim() && !audioFromMessage(message)) {
    throw new Error('This message has no text or supported voice/audio attachment.');
  }

  const sessionId = createTranslationSession(userId, message);
  return {
    content: [
      '🌐 **Translate this message**',
      'AI will detect the source automatically — including **Egyptian Arabic vs Modern Standard Arabic**.',
      'Choose the language you want:'
    ].join('\n'),
    components: [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `translate_target:${sessionId}`,
            placeholder: `Translate to… (My language: ${languageLabel(prefs.incoming)})`.slice(0, 150),
            min_values: 1,
            max_values: 1,
            options: targetSelectOptions(prefs.incoming)
          }
        ]
      }
    ],
    allowed_mentions: { parse: [] }
  };
}

export function handleTranslateMessageSelection(interaction: DiscordInteraction): void {
  void runAndEdit(interaction, async () => {
    const customId = interaction.data?.custom_id ?? '';
    const sessionId = customId.startsWith('translate_target:') ? customId.slice('translate_target:'.length) : '';
    const session = sessionId ? getTranslationSession(sessionId) : undefined;
    if (!session) throw new Error('This translation menu expired. Right-click the message and choose Apps → Translate again.');

    const userId = userIdOf(interaction);
    if (session.userId !== userId) throw new Error('This translation menu belongs to another user.');

    const prefs = await getPreference(userId);
    const selected = interaction.data?.values?.[0];
    const target = resolveTarget(selected, prefs.incoming, prefs.incoming);
    const source = await messageText(session.message);
    const translated = await translateText(source.text, target, {
      source: source.spokenLanguage ?? 'auto',
      provider: prefs.provider,
      style: prefs.style
    });

    return {
      content: formatTranslation(
        source.text,
        translated.text,
        target,
        translated.detectedSourceLanguage ?? source.spokenLanguage,
        translated.provider
      ),
      components: buildListenComponents(userId, translated.text, target),
      allowed_mentions: { parse: [] }
    };
  });
}

export function handleTranslateText(interaction: DiscordInteraction): void {
  void runAndEdit(interaction, async () => {
    const userId = userIdOf(interaction);
    const prefs = await getPreference(userId);
    const text = option<string>(interaction, 'text')?.trim();
    if (!text) throw new Error('Text is required.');

    const target = resolveTarget(option<string>(interaction, 'target'), prefs.incoming, prefs.incoming);
    const options = requestOptions(interaction, prefs);
    const translated = await translateText(text, target, options);
    return {
      content: formatTranslation(text, translated.text, target, translated.detectedSourceLanguage, translated.provider),
      components: buildListenComponents(userId, translated.text, target),
      allowed_mentions: { parse: [] }
    };
  });
}

export function handleSay(interaction: DiscordInteraction): void {
  void runAndEdit(interaction, async () => {
    const userId = userIdOf(interaction);
    const prefs = await getPreference(userId);
    const text = option<string>(interaction, 'text')?.trim();
    if (!text) throw new Error('Text is required.');

    const target = resolveTarget(option<string>(interaction, 'target'), prefs.outgoing, prefs.incoming);
    const translated = await translateText(text, target, requestOptions(interaction, prefs));
    return {
      content: formatCopyTranslation(translated.text, target, translated.detectedSourceLanguage, translated.provider),
      components: buildListenComponents(userId, translated.text, target),
      allowed_mentions: { parse: [] }
    };
  });
}

export function handleVoice(interaction: DiscordInteraction): void {
  void runAndEdit(interaction, async () => {
    const userId = userIdOf(interaction);
    const prefs = await getPreference(userId);
    const attachment = targetAttachment(interaction);
    if (!attachment) throw new Error('Audio attachment is required.');

    const target = resolveTarget(option<string>(interaction, 'target'), prefs.outgoing, prefs.incoming);
    const transcript = await transcribeDiscordAttachment(attachment);
    const options = requestOptions(interaction, prefs);
    const translated = await translateText(transcript.text, target, {
      ...options,
      source: transcript.language ?? 'auto'
    });
    return {
      content: clipDiscord(
        `🎙️ **Transcript${transcript.language ? ` (${languageLabel(transcript.language)})` : ''}:** ${transcript.text}\n\n` +
          formatCopyTranslation(translated.text, target, translated.detectedSourceLanguage ?? transcript.language, translated.provider)
      ),
      components: buildListenComponents(userId, translated.text, target),
      allowed_mentions: { parse: [] }
    };
  });
}

export function handleListenTts(interaction: DiscordInteraction): void {
  void (async () => {
    try {
      const customId = interaction.data?.custom_id ?? '';
      const sessionId = customId.startsWith('listen_tts:') ? customId.slice('listen_tts:'.length) : '';
      const session = sessionId ? getSpeechSession(sessionId) : undefined;
      if (!session) throw new Error('This Listen button expired. Translate the message again to create a new one.');

      const userId = userIdOf(interaction);
      if (session.userId !== userId) throw new Error('This Listen button belongs to another user.');

      const audio = await generateGeminiSpeech(session.text, session.language);
      await editOriginalResponseWithFile(
        interaction.application_id,
        interaction.token,
        {
          content: `🔊 **${languageLabel(session.language)} — audio**\nPress play on the attached file.`,
          allowed_mentions: { parse: [] }
        },
        audio
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected TTS error.';
      console.error(error);
      await editOriginalResponse(interaction.application_id, interaction.token, {
        content: clipDiscord(`❌ ${message}`),
        allowed_mentions: { parse: [] }
      }).catch(console.error);
    }
  })();
}

export async function handleSettings(interaction: DiscordInteraction): Promise<Record<string, unknown>> {
  const userId = userIdOf(interaction);
  const myLanguage = option<string>(interaction, 'my_language') ?? option<string>(interaction, 'incoming');
  const outgoing = option<string>(interaction, 'outgoing');
  const provider = option<string>(interaction, 'provider') as TranslationProvider | 'default' | undefined;
  const style = option<string>(interaction, 'style') as TranslationStyle | undefined;

  const prefs = myLanguage || outgoing || provider || style
    ? await updatePreference(userId, {
        ...(myLanguage ? { incoming: myLanguage } : {}),
        ...(outgoing ? { outgoing } : {}),
        ...(provider ? { provider } : {}),
        ...(style ? { style } : {})
      })
    : await getPreference(userId);

  return {
    content: [
      `🌍 My language → **${languageLabel(prefs.incoming)}**`,
      `⬆️ Outgoing default → **${languageLabel(prefs.outgoing)}**`,
      `🤖 Engine → **${prefs.provider === 'default' ? 'Auto (AI preferred)' : prefs.provider}**`,
      `✍️ Style → **${prefs.style}**`,
      `🔊 Listen → **${geminiTtsConfigured() ? `enabled (${env.GEMINI_TTS_VOICE})` : 'not configured'}**`,
      '',
      'Source detection is automatic. With AI enabled, Arabic is classified as Egyptian Arabic or Modern Standard Arabic when possible.'
    ].join('\n'),
    allowed_mentions: { parse: [] }
  };
}

export function handleStatus(): Record<string, unknown> {
  const translation = translationConfiguration();
  const voiceConfigured = Boolean(env.STT_URL && env.STT_API_KEY);
  return {
    content: [
      '✅ **Discord endpoint:** online',
      `🌐 **Configured default provider:** ${translation.provider} — ${translation.configured ? 'configured' : 'not configured'}`,
      `🤖 **AI/Gemini:** ${aiConfigured() ? 'configured — auto detection + Egyptian/MSA aware' : 'not configured'}`,
      `🎙️ **Voice input / STT:** ${voiceConfigured ? 'configured' : 'not configured'}`,
      `🔊 **Listen / Gemini TTS:** ${geminiTtsConfigured() ? `configured — ${env.GEMINI_TTS_MODEL} / ${env.GEMINI_TTS_VOICE}` : 'not configured'}`,
      `🌍 **Default my language:** ${languageLabel(env.DEFAULT_INCOMING_LANGUAGE)}`,
      `⬆️ **Default outgoing:** ${languageLabel(env.DEFAULT_OUTGOING_LANGUAGE)}`,
      '👤 **Send-as-user:** copy/paste mode; Discord apps cannot impersonate a personal account.'
    ].join('\n'),
    allowed_mentions: { parse: [] }
  };
}
