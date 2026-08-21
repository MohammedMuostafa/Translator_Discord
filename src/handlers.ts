import type { DiscordAttachment, DiscordInteraction, DiscordMessage } from './types.js';
import { clipDiscord, editOriginalResponse } from './discord.js';
import { languageLabel, normalizeLanguage } from './languages.js';
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

function formatTranslation(
  input: string,
  translated: string,
  target: string,
  source?: string,
  provider?: string
): string {
  const detected = source ? ` • from: ${languageLabel(source)}` : '';
  const engine = provider ? ` • ${provider}` : '';
  return clipDiscord(`🌐 **${languageLabel(target)}**${detected}${engine}\n${translated}\n\n> ${clipDiscord(input, 500)}`);
}

function formatCopyTranslation(translated: string, target: string, provider?: string): string {
  return clipDiscord(
    `✍️ **Copy this and send it yourself — ${languageLabel(target)}${provider ? ` • ${provider}` : ''}:**\n\n\`\`\`text\n${safeCodeBlock(translated)}\n\`\`\`\n` +
      `Discord apps cannot send a message as your personal user account; pasting this into the composer keeps the message authored by you.`
  );
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
      allowed_mentions: { parse: [] }
    }).catch(console.error);
  }
}

function requestOptions(interaction: DiscordInteraction, defaults: { provider: TranslationProvider | 'default'; style: TranslationStyle }) {
  return {
    source: normalizeLanguage(option<string>(interaction, 'source') ?? 'auto', true),
    provider: (option<string>(interaction, 'provider') as TranslationProvider | 'default' | undefined) ?? defaults.provider,
    style: (option<string>(interaction, 'style') as TranslationStyle | undefined) ?? defaults.style
  };
}

export function handleTranslateMessage(interaction: DiscordInteraction): void {
  void runAndEdit(interaction, async () => {
    const userId = userIdOf(interaction);
    const prefs = await getPreference(userId);
    const message = targetMessage(interaction);
    if (!message) throw new Error('Discord did not provide the selected message.');

    let sourceText = message.content?.trim();
    let spokenLanguage: string | undefined;

    if (!sourceText) {
      const audio = message.attachments?.find((attachment) =>
        attachment.content_type?.startsWith('audio/') || /\.(ogg|oga|opus|mp3|m4a|wav|webm|aac|flac)$/i.test(attachment.filename)
      );
      if (!audio) throw new Error('This message has no text or supported voice/audio attachment.');
      const transcript = await transcribeDiscordAttachment(audio);
      sourceText = transcript.text;
      spokenLanguage = transcript.language;
    }

    const translated = await translateText(sourceText, prefs.incoming, {
      source: spokenLanguage ?? 'auto',
      provider: prefs.provider,
      style: prefs.style
    });
    const source = translated.detectedSourceLanguage ?? spokenLanguage;
    return {
      content: formatTranslation(sourceText, translated.text, prefs.incoming, source, translated.provider),
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
    const target = normalizeLanguage(option<string>(interaction, 'target') ?? prefs.incoming);
    const options = requestOptions(interaction, prefs);
    const translated = await translateText(text, target, options);
    return {
      content: formatTranslation(text, translated.text, target, translated.detectedSourceLanguage ?? options.source, translated.provider),
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
    const target = normalizeLanguage(option<string>(interaction, 'target') ?? prefs.outgoing);
    const translated = await translateText(text, target, requestOptions(interaction, prefs));
    return {
      content: formatCopyTranslation(translated.text, target, translated.provider),
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
    const target = normalizeLanguage(option<string>(interaction, 'target') ?? prefs.outgoing);
    const transcript = await transcribeDiscordAttachment(attachment);
    const options = requestOptions(interaction, prefs);
    const translated = await translateText(transcript.text, target, {
      ...options,
      source: transcript.language ?? 'auto'
    });
    return {
      content: clipDiscord(
        `🎙️ **Transcript${transcript.language ? ` (${languageLabel(transcript.language)})` : ''}:** ${transcript.text}\n\n` +
          formatCopyTranslation(translated.text, target, translated.provider)
      ),
      allowed_mentions: { parse: [] }
    };
  });
}

export async function handleSettings(interaction: DiscordInteraction): Promise<Record<string, unknown>> {
  const userId = userIdOf(interaction);
  const incoming = option<string>(interaction, 'incoming');
  const outgoing = option<string>(interaction, 'outgoing');
  const provider = option<string>(interaction, 'provider') as TranslationProvider | 'default' | undefined;
  const style = option<string>(interaction, 'style') as TranslationStyle | undefined;

  const prefs = incoming || outgoing || provider || style
    ? await updatePreference(userId, {
        ...(incoming ? { incoming } : {}),
        ...(outgoing ? { outgoing } : {}),
        ...(provider ? { provider } : {}),
        ...(style ? { style } : {})
      })
    : await getPreference(userId);

  return {
    content: [
      `⚙️ Incoming translations → **${languageLabel(prefs.incoming)}**`,
      `Outgoing /say & /voice → **${languageLabel(prefs.outgoing)}**`,
      `Engine → **${prefs.provider}**`,
      `Style → **${prefs.style}**`
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
      `🌐 **Default translation:** ${translation.provider} — ${translation.configured ? 'configured' : 'not configured'}`,
      `🤖 **AI translation:** ${aiConfigured() ? 'configured' : 'not configured'}`,
      `🎙️ **Voice:** ${voiceConfigured ? 'configured' : 'not configured'}`,
      `⬇️ **Incoming target:** ${languageLabel(env.DEFAULT_INCOMING_LANGUAGE)}`,
      `⬆️ **Outgoing target:** ${languageLabel(env.DEFAULT_OUTGOING_LANGUAGE)}`,
      '👤 **Send-as-user:** copy/paste mode (Discord does not allow apps to impersonate your user account)'
    ].join('\n'),
    allowed_mentions: { parse: [] }
  };
}
