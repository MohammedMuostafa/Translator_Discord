import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message
} from 'discord.js';
import { env } from '../config.js';
import {
  aiChatConfigured,
  askAiChat,
  type ChatResponseLanguage,
  type ChatTurn
} from './aiChat.js';
import { runWithUsageUser } from './usageContext.js';
import { assertFeatureAccess, recordUsage } from './billingStore.js';
import { getUserPersonalization } from './userPersonalization.js';
import { generateImageForUser, generateVideoForUser } from './mediaGeneration.js';
import { translateText } from '../providers/translator.js';
import { callTextModel } from './modelRouter.js';

interface ChatSession {
  userId: string;
  language: ChatResponseLanguage;
  history: ChatTurn[];
  lastActivityAt: number;
}

const sessions = new Map<string, ChatSession>();
let gatewayStarted = false;

const client = new Client({
  intents: [
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel]
});

export function getGatewayClient(): Client {
  return client;
}

function sessionTtlMs(): number {
  return env.CHAT_SESSION_TTL_MINUTES * 60_000;
}

function freshSession(userId: string): ChatSession | undefined {
  const session = sessions.get(userId);
  if (!session) return undefined;

  if (Date.now() - session.lastActivityAt > sessionTtlMs()) {
    sessions.delete(userId);
    return undefined;
  }

  return session;
}

function trimHistory(history: ChatTurn[]): ChatTurn[] {
  const maxTurns = Math.max(2, env.CHAT_MAX_HISTORY);
  return history.slice(-maxTurns);
}

function splitDiscordMessage(text: string, maxLength = 1900): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf('\n\n', maxLength);
    if (splitAt < Math.floor(maxLength * 0.45)) {
      splitAt = remaining.lastIndexOf('\n', maxLength);
    }
    if (splitAt < Math.floor(maxLength * 0.45)) {
      splitAt = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitAt < 1) splitAt = maxLength;

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}

async function sendChunks(message: Message, text: string): Promise<void> {
  for (const chunk of splitDiscordMessage(text)) {
    await message.reply({
      content: chunk,
      allowedMentions: { parse: [] }
    });
  }
}

async function handleDirectMessage(message: Message): Promise<void> {
  if (message.author.bot || message.channel.type !== ChannelType.DM) return;

  const userId = message.author.id;
  const personal = await getUserPersonalization(userId);

  // Lazy-initialize temporary session for natural DM conversation
  let session = freshSession(userId);
  if (!session) {
    session = {
      userId,
      language: (personal.defaultReplyLanguage || 'auto') as ChatResponseLanguage,
      history: [],
      lastActivityAt: Date.now()
    };
    sessions.set(userId, session);
  }

  const content = message.content.trim();
  const attachment = message.attachments.first();

  // Natural reset commands
  if (/^(?:ابدأ من جديد|امسح المحادثة|امسح الشات|reset chat|clear chat|reset|ابدأ تاني)$/iu.test(content)) {
    session.history = [];
    session.lastActivityAt = Date.now();
    await message.reply({
      content: '🧹 **تم مسح سياق المحادثة وبدء جلسة جديدة بنجاح.**',
      allowedMentions: { parse: [] }
    }).catch(() => undefined);
    return;
  }

  if (!content && !attachment) return;

  if (content.length > env.CHAT_MAX_INPUT_CHARS) {
    await message.reply({
      content: `⚠️ That message is too long. Maximum: ${env.CHAT_MAX_INPUT_CHARS.toLocaleString()} characters.`,
      allowedMentions: { parse: [] }
    }).catch(() => undefined);
    return;
  }

  session.lastActivityAt = Date.now();
  await message.channel.sendTyping().catch(() => undefined);

  try {
    // 1. Image Editing via attachment
    if (attachment && attachment.contentType?.startsWith('image/')) {
      await assertFeatureAccess(userId, 'image_edit');
      const res = await fetch(attachment.url);
      if (!res.ok) throw new Error('Could not download image attachment.');
      const buffer = new Uint8Array(await res.arrayBuffer());
      const editPrompt = content || 'Enhance and edit this image with high detail';

      const media = await generateImageForUser(
        userId,
        editPrompt,
        personal.imageQuality || 'standard',
        personal.defaultImageAspect as any || '1:1',
        { data: buffer, contentType: attachment.contentType }
      );

      await message.reply({
        content: `🖼️ **Edited Image**\n**Prompt:** ${editPrompt}`,
        files: [{ attachment: Buffer.from(media.data), name: media.filename }]
      });
      return;
    }

    // 2. Image Generation intent
    const imageMatch = content.match(/^(?:اعمل(?:لي)? صورة|صمم(?:لي)? صورة|ولد صورة|ارسم(?:لي)?|generate image|draw|image:)\s*(.+)$/iu);
    if (imageMatch?.[1]) {
      await assertFeatureAccess(userId, 'image_generate');
      const prompt = imageMatch[1].trim();
      const media = await generateImageForUser(
        userId,
        prompt,
        personal.imageQuality || 'standard',
        personal.defaultImageAspect as any || '1:1'
      );

      await message.reply({
        content: `🖼️ **Generated Image**\n**Prompt:** ${prompt}`,
        files: [{ attachment: Buffer.from(media.data), name: media.filename }]
      });
      return;
    }

    // 3. Video Generation intent
    const videoMatch = content.match(/^(?:اعمل(?:لي)? فيديو|صمم(?:لي)? فيديو|ولد فيديو|generate video|video:)\s*(.+)$/iu);
    if (videoMatch?.[1]) {
      await assertFeatureAccess(userId, 'video_generate');
      const prompt = videoMatch[1].trim();
      const media = await generateVideoForUser(
        userId,
        prompt,
        personal.videoQuality || 'fast',
        personal.defaultVideoAspect as any || '16:9'
      );

      await message.reply({
        content: `🎬 **Generated Video**\n**Prompt:** ${prompt}`,
        files: [{ attachment: Buffer.from(media.data), name: media.filename }]
      });
      return;
    }

    // 4. Translation intent
    const translateMatch = content.match(/^(?:ترجم(?:لي)?|translate)\s*(?:ال(?:كلام|نص|جملة)\s*(?:ده|دي|هذا|هذه)?\s*)?(?:لـ?|to\s+)?([a-zA-Z\u0600-\u06FF\s-]*?)?[:：,\-]?\s+([\s\S]+)$/iu);
    if (translateMatch && translateMatch[2]) {
      await assertFeatureAccess(userId, 'translation');
      const explicitLang = translateMatch[1]?.trim();
      const target = explicitLang && explicitLang.length >= 2
        ? explicitLang
        : personal.myLanguage || 'ar-eg';
      const textToTranslate = translateMatch[2].trim();

      const translated = await translateText(textToTranslate, target, {
        provider: personal.translationProvider || 'default',
        style: personal.translationStyle || 'natural'
      });

      await message.reply({
        content: `🌐 **Translation (${target}):**\n${translated.text}`,
        allowedMentions: { parse: [] }
      });
      return;
    }

    // 5. Code request intent
    const isCode = /^(?:اكتب(?:لي)? كود|اكتبلي كود|اكتبلي دالة|اكتبلي react|اكتبلي سكريبت|write code|code:|function)\b/iu.test(content);
    if (isCode) {
      await assertFeatureAccess(userId, 'code');
      const res = await callTextModel(
        'code',
        [
          { role: 'system', content: 'You are an expert programming assistant. Write clean, production-grade code with explanations in concise Markdown.' },
          ...session.history,
          { role: 'user', content }
        ],
        { temperature: 0.2, timeoutMs: env.AI_ACTION_TIMEOUT_MS }
      );

      session.history = trimHistory([
        ...session.history,
        { role: 'user', content },
        { role: 'assistant', content: res.text }
      ]);
      session.lastActivityAt = Date.now();
      await recordUsage(userId, 'code', Math.max(1, Math.ceil(res.text.length / 8)));
      await sendChunks(message, res.text);
      return;
    }

    // 6. General Chat
    if (!aiChatConfigured()) {
      await message.reply({
        content: '❌ AI chat is not configured on this deployment.',
        allowedMentions: { parse: [] }
      }).catch(() => undefined);
      return;
    }

    await assertFeatureAccess(userId, 'chat');
    const reply = await runWithUsageUser(
      userId,
      () => askAiChat(session.history, content, session.language)
    );

    session.history = trimHistory([
      ...session.history,
      { role: 'user', content },
      { role: 'assistant', content: reply }
    ]);
    session.lastActivityAt = Date.now();

    await sendChunks(message, reply);
  } catch (error) {
    const text = error instanceof Error ? error.message : 'Unexpected AI error.';
    await message.reply({
      content: `❌ ${text}`.slice(0, 1900),
      allowedMentions: { parse: [] }
    }).catch(() => undefined);
  }
}

client.on(Events.ClientReady, (readyClient) => {
  console.log(`TD AI Gateway connected as ${readyClient.user.tag}.`);
});

client.on(Events.MessageCreate, (message) => {
  void handleDirectMessage(message);
});

client.on(Events.Error, (error) => {
  console.error('Discord Gateway error:', error.message);
});

export function gatewayChatConfigured(): boolean {
  return Boolean(env.DISCORD_BOT_TOKEN && aiChatConfigured());
}

export async function startGatewayChat(): Promise<void> {
  if (gatewayStarted) return;
  gatewayStarted = true;

  if (!env.DISCORD_BOT_TOKEN) {
    console.log('Interactive DM/voice gateway disabled: DISCORD_BOT_TOKEN is missing.');
    return;
  }

  await client.login(env.DISCORD_BOT_TOKEN);
}

export async function waitForGatewayReady(timeoutMs = 15_000): Promise<void> {
  if (client.isReady()) return;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Discord Gateway is not ready yet. Try again in a few seconds.'));
    }, timeoutMs);

    const onReady = () => {
      cleanup();
      resolve();
    };

    const cleanup = () => {
      clearTimeout(timeout);
      client.off(Events.ClientReady, onReady);
    };

    client.once(Events.ClientReady, onReady);
  });
}

export async function openAiDmChat(
  userId: string,
  language: ChatResponseLanguage = 'auto'
): Promise<void> {
  if (!env.DISCORD_BOT_TOKEN) {
    throw new Error('Interactive chat requires DISCORD_BOT_TOKEN.');
  }
  if (!aiChatConfigured()) {
    throw new Error('AI chat is not configured.');
  }

  await assertFeatureAccess(userId, 'chat');
  await waitForGatewayReady();

  sessions.set(userId, {
    userId,
    language,
    history: [],
    lastActivityAt: Date.now()
  });

  const user = await client.users.fetch(userId);
  await user.send({
    content: [
      '🤖 **TD AI is ready.**',
      '',
      'You can chat, code, generate images, render videos, or translate directly here in DMs.',
      `Memory: **temporary session** (auto-expires after ${env.CHAT_SESSION_TTL_MINUTES} minutes of inactivity).`,
      'Say `"ابدأ من جديد"` or `"reset chat"` at any time to clear context.'
    ].join('\n'),
    allowedMentions: { parse: [] }
  });
}

export function closeAiDmChat(userId: string): boolean {
  return sessions.delete(userId);
}

export function resetAiDmChat(userId: string): boolean {
  const session = freshSession(userId);
  if (!session) return false;
  session.history = [];
  return true;
}

export function aiDmChatStatus(userId: string): { active: boolean; language?: ChatResponseLanguage; turns?: number; expiresInMinutes?: number } {
  const session = freshSession(userId);
  if (!session) return { active: false };
  const elapsedMs = Date.now() - session.lastActivityAt;
  const remainingMs = Math.max(0, sessionTtlMs() - elapsedMs);
  return {
    active: true,
    language: session.language,
    turns: session.history.length,
    expiresInMinutes: Math.max(1, Math.round(remainingMs / 60_000))
  };
}

export function chatLanguageLabel(language: ChatResponseLanguage): string {
  switch (language) {
    case 'ar-eg': return 'Egyptian Arabic (عربي مصري)';
    case 'ar-msa': return 'Modern Standard Arabic (فصحى)';
    case 'en': return 'English';
    case 'fa': return 'Persian (فارسی)';
    case 'auto':
    default: return 'Auto match user';
  }
}
