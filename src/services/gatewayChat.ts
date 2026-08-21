import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message
} from 'discord.js';
import { env } from '../config.js';
import { aiChatConfigured, askAiChat, type ChatResponseLanguage, type ChatTurn } from './aiChat.js';

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
    if (splitAt < Math.floor(maxLength * 0.45)) splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt < Math.floor(maxLength * 0.45)) splitAt = remaining.lastIndexOf(' ', maxLength);
    if (splitAt < 1) splitAt = maxLength;

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}

async function sendChunks(message: Message, text: string): Promise<void> {
  const chunks = splitDiscordMessage(text);
  for (const chunk of chunks) {
    await message.reply({
      content: chunk,
      allowedMentions: { parse: [] }
    });
  }
}

async function handleDirectMessage(message: Message): Promise<void> {
  if (message.author.bot || message.channel.type !== ChannelType.DM) return;

  const userId = message.author.id;
  const session = freshSession(userId);

  if (!session) {
    await message.reply({
      content: '🤖 **TD AI chat is closed.** Use `/chat open` to start a private AI conversation.',
      allowedMentions: { parse: [] }
    }).catch(() => undefined);
    return;
  }

  const content = message.content.trim();
  if (!content) return;

  if (content.length > env.CHAT_MAX_INPUT_CHARS) {
    await message.reply({
      content: `⚠️ That message is too long. Maximum: ${env.CHAT_MAX_INPUT_CHARS.toLocaleString()} characters.`,
      allowedMentions: { parse: [] }
    }).catch(() => undefined);
    return;
  }

  if (!aiChatConfigured()) {
    await message.reply({
      content: '❌ AI chat is not configured on this deployment.',
      allowedMentions: { parse: [] }
    }).catch(() => undefined);
    return;
  }

  session.lastActivityAt = Date.now();
  await message.channel.sendTyping().catch(() => undefined);

  try {
    const reply = await askAiChat(session.history, content, session.language);
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
  if (!env.DISCORD_BOT_TOKEN) throw new Error('Interactive chat requires DISCORD_BOT_TOKEN.');
  if (!aiChatConfigured()) throw new Error('AI chat is not configured.');

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
      '🤖 **TD AI Chat is ready.**',
      '',
      'Just type normally in this DM — no slash command is needed for each message.',
      `Language: **${chatLanguageLabel(language)}**`,
      `Memory: **temporary session only** (auto-expires after ${env.CHAT_SESSION_TTL_MINUTES} minutes of inactivity).`,
      '',
      'Use `/chat reset` to clear the current context or `/chat close` when you are done.'
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
  session.lastActivityAt = Date.now();
  return true;
}

export function aiDmChatStatus(userId: string): {
  active: boolean;
  language?: ChatResponseLanguage;
  turns?: number;
  expiresInMinutes?: number;
} {
  const session = freshSession(userId);
  if (!session) return { active: false };

  const expiresAt = session.lastActivityAt + sessionTtlMs();
  const expiresInMinutes = Math.max(1, Math.ceil((expiresAt - Date.now()) / 60_000));

  return {
    active: true,
    language: session.language,
    turns: session.history.length,
    expiresInMinutes
  };
}

export function chatLanguageLabel(language: ChatResponseLanguage): string {
  switch (language) {
    case 'ar-eg': return 'Egyptian Arabic';
    case 'ar-msa': return 'Modern Standard Arabic';
    case 'en': return 'English';
    case 'fa': return 'Persian / Farsi';
    default: return 'Auto — follow my language';
  }
}
