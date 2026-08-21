import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import {
  AudioPlayerStatus,
  EndBehaviorType,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  type AudioPlayer,
  type VoiceConnection
} from '@discordjs/voice';
import type { VoiceBasedChannel } from 'discord.js';
import { env } from '../config.js';
import { askAiChat, type ChatResponseLanguage, type ChatTurn } from './aiChat.js';
import { generateGeminiSpeech, geminiTtsConfigured } from './geminiTts.js';
import { getGatewayClient, waitForGatewayReady } from './gatewayChat.js';
import { sttConfigured, transcribeAudioBytes } from './stt.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const OpusScript: any = require('opusscript');

interface VoiceAiSession {
  guildId: string;
  channelId: string;
  userId: string;
  language: ChatResponseLanguage;
  connection: VoiceConnection;
  player: AudioPlayer;
  history: ChatTurn[];
  busy: boolean;
  capturing: boolean;
  startedAt: number;
}

const sessions = new Map<string, VoiceAiSession>();

function pcmToWav(pcm: Buffer, sampleRate = 48_000, channels = 2): Uint8Array<ArrayBufferLike> {
  const header = Buffer.alloc(44);
  const dataSize = pcm.byteLength;
  const blockAlign = channels * 2;
  const byteRate = sampleRate * blockAlign;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return new Uint8Array(Buffer.concat([header, pcm]));
}

function trimHistory(history: ChatTurn[]): ChatTurn[] {
  return history.slice(-Math.max(2, env.VOICE_AI_MAX_HISTORY));
}

function inferSpeechLanguage(reply: string, preferred: ChatResponseLanguage): string {
  if (preferred !== 'auto') return preferred;
  if (/[پچژگک]/u.test(reply)) return 'fa';
  if (/\p{Script=Arabic}/u.test(reply)) return 'ar-eg';
  return 'en';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function notifyUser(userId: string, text: string): Promise<void> {
  const client = getGatewayClient();
  const user = await client.users.fetch(userId).catch(() => undefined);
  if (!user) return;
  await user.send({ content: text.slice(0, 1900), allowedMentions: { parse: [] } }).catch(() => undefined);
}

async function playSpeech(session: VoiceAiSession, text: string): Promise<void> {
  if (!geminiTtsConfigured()) {
    throw new Error('Gemini TTS is not configured.');
  }

  const language = inferSpeechLanguage(text, session.language);
  const audio = await generateGeminiSpeech(text, language);
  const input = Readable.from([Buffer.from(audio.data)]);
  const resource = createAudioResource(input, { inputType: StreamType.Arbitrary });

  session.player.play(resource);
  await entersState(session.player, AudioPlayerStatus.Playing, 15_000);
  await entersState(session.player, AudioPlayerStatus.Idle, 180_000);
}

async function processUtterance(session: VoiceAiSession, pcmChunks: Buffer[]): Promise<void> {
  if (pcmChunks.length === 0) return;

  const pcm = Buffer.concat(pcmChunks);
  if (pcm.byteLength < 24_000) return;

  session.busy = true;
  try {
    const wav = pcmToWav(pcm);

    let transcript;
    try {
      transcript = await transcribeAudioBytes(wav, 'td-ai-voice.wav', 'audio/wav');
    } catch (error) {
      throw new Error(`Speech recognition failed: ${errorMessage(error)}`);
    }

    let reply: string;
    try {
      reply = await askAiChat(
        session.history,
        transcript.text,
        session.language,
        env.VOICE_AI_MODEL ?? env.AI_MODEL
      );
    } catch (error) {
      throw new Error(`AI reply failed: ${errorMessage(error)}`);
    }

    session.history = trimHistory([
      ...session.history,
      { role: 'user', content: transcript.text },
      { role: 'assistant', content: reply }
    ]);

    try {
      await playSpeech(session, reply);
    } catch (error) {
      throw new Error(`Voice synthesis/playback failed: ${errorMessage(error)}`);
    }
  } catch (error) {
    const message = errorMessage(error);
    console.error('Voice AI error:', error);
    await notifyUser(session.userId, `❌ **TD AI Voice:** ${message}`);
  } finally {
    session.busy = false;
  }
}

function attachReceiver(session: VoiceAiSession): void {
  const receiver = session.connection.receiver;

  receiver.speaking.on('start', (speakerId) => {
    const current = sessions.get(session.guildId);
    if (!current || current !== session) return;
    if (speakerId !== session.userId || session.busy || session.capturing) return;
    session.capturing = true;

    const opusStream = receiver.subscribe(speakerId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: env.VOICE_AI_SILENCE_MS
      }
    });

    const decoder = new OpusScript(48_000, 2, OpusScript.Application.AUDIO);
    const pcmChunks: Buffer[] = [];
    let finalized = false;

    const maxDurationTimer = setTimeout(() => {
      opusStream.destroy();
    }, env.VOICE_AI_MAX_UTTERANCE_SECONDS * 1000);

    const finalize = (processAudio: boolean) => {
      if (finalized) return;
      finalized = true;
      clearTimeout(maxDurationTimer);
      session.capturing = false;
      try { decoder.delete(); } catch { /* no-op */ }
      if (processAudio) void processUtterance(session, pcmChunks);
    };

    opusStream.on('data', (packet: Buffer) => {
      try {
        const decoded = decoder.decode(packet);
        if (decoded?.byteLength) pcmChunks.push(Buffer.from(decoded));
      } catch (error) {
        console.error('Voice Opus decode error:', error);
      }
    });

    opusStream.once('end', () => finalize(true));
    opusStream.once('close', () => finalize(true));
    opusStream.once('error', (error) => {
      console.error('Voice receive stream error:', error.message);
      finalize(false);
    });
  });
}

export function voiceAiConfigured(): boolean {
  return Boolean(
    env.DISCORD_BOT_TOKEN &&
    env.AI_API_URL &&
    env.AI_API_KEY &&
    env.AI_MODEL &&
    sttConfigured() &&
    geminiTtsConfigured()
  );
}

export async function joinVoiceAi(
  guildId: string,
  userId: string,
  language: ChatResponseLanguage = 'auto'
): Promise<{ channelName: string }> {
  if (!voiceAiConfigured()) {
    throw new Error(
      'Voice AI is not fully configured. It needs AI chat, speech recognition (STT service or Gemini STT), Gemini TTS, and DISCORD_BOT_TOKEN.'
    );
  }

  await waitForGatewayReady();
  const client = getGatewayClient();
  const guild = await client.guilds.fetch(guildId);
  const voiceState = guild.voiceStates.cache.get(userId);
  const channel = voiceState?.channel as VoiceBasedChannel | null | undefined;

  if (!channel) throw new Error('Join a Discord voice channel first, then run `/voicechat join`.');

  const existing = sessions.get(guildId);
  if (existing) {
    existing.connection.destroy();
    sessions.delete(guildId);
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
    daveEncryption: true
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 25_000);

  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Pause }
  });
  connection.subscribe(player);
  player.on('error', (error) => console.error('Voice player error:', error.message));

  const session: VoiceAiSession = {
    guildId,
    channelId: channel.id,
    userId,
    language,
    connection,
    player,
    history: [],
    busy: false,
    capturing: false,
    startedAt: Date.now()
  };

  sessions.set(guildId, session);
  attachReceiver(session);

  connection.on('stateChange', (_oldState, newState) => {
    if (newState.status !== VoiceConnectionStatus.Destroyed) return;
    const current = sessions.get(guildId);
    if (current === session) sessions.delete(guildId);
  });

  return { channelName: channel.name };
}

export function leaveVoiceAi(guildId: string, requesterId?: string): boolean {
  const session = sessions.get(guildId);
  if (!session) return false;
  if (requesterId && requesterId !== session.userId) {
    throw new Error('Only the user who started this voice session can close it.');
  }

  sessions.delete(guildId);
  session.player.stop(true);
  session.history = [];
  session.connection.destroy();
  return true;
}

export function voiceAiStatus(guildId: string): {
  active: boolean;
  userId?: string;
  channelId?: string;
  language?: ChatResponseLanguage;
  busy?: boolean;
  turns?: number;
} {
  const session = sessions.get(guildId);
  if (!session) return { active: false };

  return {
    active: true,
    userId: session.userId,
    channelId: session.channelId,
    language: session.language,
    busy: session.busy,
    turns: session.history.length
  };
}
