import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';
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
import { GoogleGenAI, Modality, type LiveServerMessage } from '@google/genai';
import type { VoiceBasedChannel } from 'discord.js';
import { env } from '../config.js';
import { askAiChat, type ChatResponseLanguage, type ChatTurn } from './aiChat.js';
import { generateGeminiSpeech, geminiTtsConfigured } from './geminiTts.js';
import { getGatewayClient, waitForGatewayReady } from './gatewayChat.js';
import { sttConfigured, transcribeAudioBytes } from './stt.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const OpusScript: any = require('opusscript');

type LiveSessionLike = {
  sendRealtimeInput(params: {
    audio?: { data: string; mimeType: string };
    activityStart?: Record<string, never>;
    activityEnd?: Record<string, never>;
  }): void;
  close(): void;
};

type VoiceMode = 'live' | 'cascade';

interface VoiceAiSession {
  guildId: string;
  channelId: string;
  userId: string;
  language: ChatResponseLanguage;
  mode: VoiceMode;
  connection: VoiceConnection;
  player: AudioPlayer;

  // Live API state.
  live?: LiveSessionLike;
  outputStream?: PassThrough;
  inputTranscript: string;
  outputTranscript: string;
  turns: number;

  // Cascade fallback state.
  history: ChatTurn[];

  busy: boolean;
  capturing: boolean;
  startedAt: number;
}

const sessions = new Map<string, VoiceAiSession>();

function liveApiKey(): string | undefined {
  return env.GEMINI_LIVE_API_KEY ?? env.AI_API_KEY;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function notifyUser(userId: string, text: string): Promise<void> {
  const client = getGatewayClient();
  const user = await client.users.fetch(userId).catch(() => undefined);
  if (!user) return;
  await user.send({
    content: text.slice(0, 1900),
    allowedMentions: { parse: [] }
  }).catch(() => undefined);
}

function languageSystemInstruction(language: ChatResponseLanguage): string {
  const base = [
    'You are TD AI speaking naturally with one user inside a Discord voice channel.',
    'Reply conversationally and quickly. Prefer one to three short sentences unless the user asks for detail.',
    'Do not announce internal processing steps.',
    'If the user interrupts you, stop and listen.',
    'Never claim you performed an external action unless you actually did.'
  ];

  switch (language) {
    case 'ar-eg':
      base.push('Always answer in natural Egyptian Arabic unless the user explicitly asks for another language.');
      break;
    case 'ar-msa':
      base.push('Always answer in clear Modern Standard Arabic unless the user explicitly asks for another language.');
      break;
    case 'en':
      base.push('Answer in English unless the user explicitly asks for another language.');
      break;
    case 'fa':
      base.push('Answer in natural Persian (Farsi) unless the user explicitly asks for another language.');
      break;
    default:
      base.push('Automatically follow the language the user is currently speaking. If they switch language, switch naturally.');
  }

  return base.join(' ');
}

/**
 * Discord voice decoder gives signed 16-bit PCM at 48kHz stereo.
 * Gemini Live prefers 16kHz mono input.
 *
 * Discord Opus frames are normally 20ms (960 samples/channel), which divides
 * cleanly by 3 -> 320 mono samples at 16kHz. Sending each frame immediately
 * keeps input buffering around 20ms.
 */
function discordPcm48StereoToGemini16Mono(pcm: Buffer): Buffer {
  const frames = Math.floor(pcm.byteLength / 4);
  const outputFrames = Math.floor(frames / 3);
  const out = Buffer.allocUnsafe(outputFrames * 2);

  let outOffset = 0;
  for (let frame = 0; frame + 2 < frames; frame += 3) {
    const byteOffset = frame * 4;
    const left = pcm.readInt16LE(byteOffset);
    const right = pcm.readInt16LE(byteOffset + 2);
    const mono = Math.max(-32768, Math.min(32767, Math.round((left + right) / 2)));
    out.writeInt16LE(mono, outOffset);
    outOffset += 2;
  }

  return outOffset === out.byteLength ? out : out.subarray(0, outOffset);
}

/**
 * Gemini Live returns raw signed 16-bit PCM at 24kHz mono.
 * @discordjs/voice StreamType.Raw expects signed 16-bit 48kHz stereo.
 *
 * Nearest-neighbour 2x upsample is intentionally cheap: Live voice prioritizes
 * latency, and Discord/Opus will encode the resulting stream afterward.
 */
function geminiPcm24MonoToDiscord48Stereo(pcm: Buffer): Buffer {
  const samples = Math.floor(pcm.byteLength / 2);
  const out = Buffer.allocUnsafe(samples * 8);

  let offset = 0;
  for (let i = 0; i < samples; i += 1) {
    const sample = pcm.readInt16LE(i * 2);

    // 24k -> 48k: duplicate in time, and duplicate mono into L/R.
    out.writeInt16LE(sample, offset);
    out.writeInt16LE(sample, offset + 2);
    out.writeInt16LE(sample, offset + 4);
    out.writeInt16LE(sample, offset + 6);
    offset += 8;
  }

  return out;
}

function stopPlayback(session: VoiceAiSession): void {
  const stream = session.outputStream;
  session.outputStream = undefined;

  if (stream) {
    stream.removeAllListeners();
    stream.destroy();
  }

  session.player.stop(true);
}

function ensureLivePlayback(session: VoiceAiSession): PassThrough {
  if (session.outputStream && !session.outputStream.destroyed) {
    return session.outputStream;
  }

  const stream = new PassThrough();
  const resource = createAudioResource(stream, {
    inputType: StreamType.Raw
  });

  session.outputStream = stream;
  session.player.play(resource);
  return stream;
}

function finishLivePlayback(session: VoiceAiSession): void {
  const stream = session.outputStream;
  session.outputStream = undefined;
  if (stream && !stream.destroyed) stream.end();
}

function handleLiveMessage(session: VoiceAiSession, message: LiveServerMessage): void {
  const content = message.serverContent;
  if (!content) return;

  if (content.interrupted) {
    // User started talking while TD AI was speaking.
    stopPlayback(session);
    session.busy = false;
  }

  const inputText = content.inputTranscription?.text?.trim();
  if (inputText) session.inputTranscript = inputText;

  const outputText = content.outputTranscription?.text?.trim();
  if (outputText) session.outputTranscript = outputText;

  const parts = content.modelTurn?.parts ?? [];
  for (const part of parts) {
    const data = part.inlineData?.data;
    if (!data) continue;

    session.busy = true;
    const pcm24Mono = Buffer.from(data, 'base64');
    if (pcm24Mono.byteLength === 0) continue;

    const discordPcm = geminiPcm24MonoToDiscord48Stereo(pcm24Mono);
    ensureLivePlayback(session).write(discordPcm);
  }

  if (content.turnComplete) {
    finishLivePlayback(session);
    session.busy = false;
    session.turns += 1;
  }
}

async function connectGeminiLive(session: VoiceAiSession): Promise<void> {
  const apiKey = liveApiKey();
  if (!apiKey) {
    throw new Error('Gemini Live requires GEMINI_LIVE_API_KEY or AI_API_KEY.');
  }

  const ai = new GoogleGenAI({ apiKey });

  const live = await ai.live.connect({
    model: env.GEMINI_LIVE_MODEL,
    callbacks: {
      onopen: () => {
        console.log(`Gemini Live connected for guild ${session.guildId}.`);
      },
      onmessage: (message) => {
        try {
          handleLiveMessage(session, message);
        } catch (error) {
          console.error('Gemini Live message handling error:', error);
        }
      },
      onerror: (event) => {
        console.error('Gemini Live socket error:', event.message);
        void notifyUser(
          session.userId,
          `❌ **TD AI Live Voice:** ${event.message || 'Live API socket error.'}`
        );
      },
      onclose: (event) => {
        console.log(`Gemini Live closed (${event.code}): ${event.reason}`);
      }
    },
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: {
        parts: [{ text: languageSystemInstruction(session.language) }]
      },
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: env.GEMINI_LIVE_VOICE
          }
        }
      },
      thinkingConfig: {
        thinkingLevel: env.GEMINI_LIVE_THINKING_LEVEL
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      // Discord already tells us when the owner starts/stops speaking. Using
      // explicit VAD avoids waiting for a second independent server-side VAD.
      explicitVadSignal: true,
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: true
        }
      }
    }
  });

  session.live = live;
}

function attachLiveReceiver(session: VoiceAiSession): void {
  const receiver = session.connection.receiver;

  receiver.speaking.on('start', (speakerId) => {
    const current = sessions.get(session.guildId);
    if (!current || current !== session) return;
    if (speakerId !== session.userId || session.capturing || !session.live) return;

    // Barge-in: immediately stop local playback before streaming the new turn.
    if (session.player.state.status !== AudioPlayerStatus.Idle) {
      stopPlayback(session);
    }

    session.capturing = true;
    session.busy = false;
    session.inputTranscript = '';
    session.outputTranscript = '';

    try {
      session.live.sendRealtimeInput({ activityStart: {} });
    } catch (error) {
      session.capturing = false;
      console.error('Gemini Live activityStart error:', error);
      return;
    }

    const opusStream = receiver.subscribe(speakerId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: env.VOICE_AI_SILENCE_MS
      }
    });

    const decoder = new OpusScript(48_000, 2, OpusScript.Application.AUDIO);
    let finalized = false;

    const maxDurationTimer = setTimeout(() => {
      opusStream.destroy();
    }, env.VOICE_AI_MAX_UTTERANCE_SECONDS * 1000);

    const finalize = () => {
      if (finalized) return;
      finalized = true;
      clearTimeout(maxDurationTimer);
      session.capturing = false;

      try { decoder.delete(); } catch { /* no-op */ }

      try {
        session.live?.sendRealtimeInput({ activityEnd: {} });
        session.busy = true;
      } catch (error) {
        console.error('Gemini Live activityEnd error:', error);
      }
    };

    opusStream.on('data', (packet: Buffer) => {
      try {
        const decoded = Buffer.from(decoder.decode(packet));
        const pcm16 = discordPcm48StereoToGemini16Mono(decoded);
        if (pcm16.byteLength === 0) return;

        session.live?.sendRealtimeInput({
          audio: {
            data: pcm16.toString('base64'),
            mimeType: 'audio/pcm;rate=16000'
          }
        });
      } catch (error) {
        console.error('Live voice decode/send error:', error);
      }
    });

    opusStream.once('end', finalize);
    opusStream.once('close', finalize);
    opusStream.once('error', (error) => {
      console.error('Live voice receive stream error:', error.message);
      finalize();
    });
  });
}

// ---------- Cascade fallback (STT -> text model -> TTS) ----------

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

async function playCascadeSpeech(session: VoiceAiSession, text: string): Promise<void> {
  const language = inferSpeechLanguage(text, session.language);
  const audio = await generateGeminiSpeech(text, language);

  // TTS returns a complete audio file in cascade mode. Let ffmpeg probe it.
  const stream = new PassThrough();
  stream.end(Buffer.from(audio.data));
  const resource = createAudioResource(stream, { inputType: StreamType.Arbitrary });

  session.player.play(resource);
  await entersState(session.player, AudioPlayerStatus.Playing, 15_000);
  await entersState(session.player, AudioPlayerStatus.Idle, 180_000);
}

async function processCascadeUtterance(session: VoiceAiSession, pcmChunks: Buffer[]): Promise<void> {
  if (pcmChunks.length === 0) return;
  const pcm = Buffer.concat(pcmChunks);
  if (pcm.byteLength < 24_000) return;

  session.busy = true;
  try {
    const transcript = await transcribeAudioBytes(
      pcmToWav(pcm),
      'td-ai-voice.wav',
      'audio/wav'
    );

    const reply = await askAiChat(
      session.history,
      transcript.text,
      session.language,
      env.VOICE_AI_MODEL ?? env.AI_MODEL
    );

    session.inputTranscript = transcript.text;
    session.outputTranscript = reply;
    session.history = trimHistory([
      ...session.history,
      { role: 'user', content: transcript.text },
      { role: 'assistant', content: reply }
    ]);

    await playCascadeSpeech(session, reply);
    session.turns += 1;
  } catch (error) {
    const message = errorMessage(error);
    console.error('Cascade Voice AI error:', error);
    await notifyUser(session.userId, `❌ **TD AI Voice:** ${message}`);
  } finally {
    session.busy = false;
  }
}

function attachCascadeReceiver(session: VoiceAiSession): void {
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
    const chunks: Buffer[] = [];
    let finalized = false;

    const timer = setTimeout(() => opusStream.destroy(), env.VOICE_AI_MAX_UTTERANCE_SECONDS * 1000);

    const finalize = () => {
      if (finalized) return;
      finalized = true;
      clearTimeout(timer);
      session.capturing = false;
      try { decoder.delete(); } catch { /* no-op */ }
      void processCascadeUtterance(session, chunks);
    };

    opusStream.on('data', (packet: Buffer) => {
      try {
        const decoded = decoder.decode(packet);
        if (decoded?.byteLength) chunks.push(Buffer.from(decoded));
      } catch (error) {
        console.error('Cascade Opus decode error:', error);
      }
    });

    opusStream.once('end', finalize);
    opusStream.once('close', finalize);
    opusStream.once('error', (error) => {
      console.error('Cascade receive stream error:', error.message);
      finalize();
    });
  });
}

function liveConfigured(): boolean {
  return Boolean(env.DISCORD_BOT_TOKEN && liveApiKey() && env.GEMINI_LIVE_MODEL);
}

function cascadeConfigured(): boolean {
  return Boolean(
    env.DISCORD_BOT_TOKEN &&
    env.AI_API_URL &&
    env.AI_API_KEY &&
    env.AI_MODEL &&
    sttConfigured() &&
    geminiTtsConfigured()
  );
}

export function voiceAiConfigured(): boolean {
  return env.VOICE_AI_MODE === 'live' ? liveConfigured() : cascadeConfigured();
}

export async function joinVoiceAi(
  guildId: string,
  userId: string,
  language: ChatResponseLanguage = 'auto'
): Promise<{ channelName: string; mode: VoiceMode }> {
  if (!voiceAiConfigured()) {
    throw new Error(
      env.VOICE_AI_MODE === 'live'
        ? 'Live Voice AI is not configured. Set DISCORD_BOT_TOKEN and GEMINI_LIVE_API_KEY (or AI_API_KEY).'
        : 'Cascade Voice AI needs AI chat, STT, Gemini TTS and DISCORD_BOT_TOKEN.'
    );
  }

  await waitForGatewayReady();
  const client = getGatewayClient();
  const guild = await client.guilds.fetch(guildId);
  const voiceState = guild.voiceStates.cache.get(userId);
  const channel = voiceState?.channel as VoiceBasedChannel | null | undefined;

  if (!channel) {
    throw new Error('Join a Discord voice channel first, then run `/voicechat join`.');
  }

  const existing = sessions.get(guildId);
  if (existing) {
    stopPlayback(existing);
    existing.live?.close();
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
    mode: env.VOICE_AI_MODE,
    connection,
    player,
    inputTranscript: '',
    outputTranscript: '',
    turns: 0,
    history: [],
    busy: false,
    capturing: false,
    startedAt: Date.now()
  };

  sessions.set(guildId, session);

  try {
    if (session.mode === 'live') {
      await connectGeminiLive(session);
      attachLiveReceiver(session);
    } else {
      attachCascadeReceiver(session);
    }
  } catch (error) {
    sessions.delete(guildId);
    stopPlayback(session);
    session.live?.close();
    session.connection.destroy();
    throw error;
  }

  connection.on('stateChange', (_oldState, newState) => {
    if (newState.status !== VoiceConnectionStatus.Destroyed) return;
    const current = sessions.get(guildId);
    if (current === session) {
      sessions.delete(guildId);
      session.live?.close();
      stopPlayback(session);
    }
  });

  return { channelName: channel.name, mode: session.mode };
}

export function leaveVoiceAi(guildId: string, requesterId?: string): boolean {
  const session = sessions.get(guildId);
  if (!session) return false;

  if (requesterId && requesterId !== session.userId) {
    throw new Error('Only the user who started this voice session can close it.');
  }

  sessions.delete(guildId);
  stopPlayback(session);
  session.live?.close();
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
  mode?: VoiceMode;
  inputTranscript?: string;
  outputTranscript?: string;
} {
  const session = sessions.get(guildId);
  if (!session) return { active: false };

  return {
    active: true,
    userId: session.userId,
    channelId: session.channelId,
    language: session.language,
    busy: session.busy,
    turns: session.turns * 2,
    mode: session.mode,
    inputTranscript: session.inputTranscript || undefined,
    outputTranscript: session.outputTranscript || undefined
  };
}
