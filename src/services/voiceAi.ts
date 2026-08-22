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
import { GoogleGenAI, Modality, ThinkingLevel, type LiveServerMessage } from '@google/genai';
import type { VoiceBasedChannel } from 'discord.js';
import { env } from '../config.js';
import { aiChatConfigured, askAiChat, type ChatResponseLanguage, type ChatTurn } from './aiChat.js';
import { generateGeminiSpeech, geminiTtsConfigured } from './geminiTts.js';
import { getGatewayClient, waitForGatewayReady } from './gatewayChat.js';
import { sttConfigured, transcribeAudioBytes } from './stt.js';
import {
  getGeminiTaskRoute,
  getVoiceRuntimeSettings,
  type ThinkingLevelName,
  type VoiceSpeakerAccess
} from './runtimeConfig.js';
import {
  assertFeatureAccess,
  recordUsage,
  userUsageSummary
} from './billingStore.js';
import {
  getVoiceControlSettings,
  type TranslationOutput,
  type TranslationQuality
} from './voiceControl.js';
import { runWithUsageUser } from './usageContext.js';
import { getUserPersonalization } from './userPersonalization.js';
import { translateText } from '../providers/translator.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const OpusScript: any = require('opusscript');

type LiveSessionLike = {
  sendRealtimeInput(params: {
    audio?: { data: string; mimeType: string };
    audioStreamEnd?: boolean;
  }): void;
  sendClientContent(params: {
    turns?: string | Array<{
      role: 'user';
      parts: Array<{ text: string }>;
    }>;
    turnComplete?: boolean;
  }): void;
  close(): void;
};

type VoiceEngine = 'live' | 'cascade';
type SessionPurpose = 'conversation' | 'translation';

export type VoiceTranslationOptions = {
  languageA: string;
  languageB: string;
  quality: TranslationQuality;
  output: TranslationOutput;
};

interface VoiceAiSession {
  guildId: string;
  channelId: string;
  userId: string;
  language: ChatResponseLanguage;
  engine: VoiceEngine;
  purpose: SessionPurpose;
  translation?: VoiceTranslationOptions;
  connection: VoiceConnection;
  player: AudioPlayer;
  live?: LiveSessionLike;
  outputStream?: PassThrough;
  inputTranscript: string;
  outputTranscript: string;
  turns: number;
  history: ChatTurn[];
  busy: boolean;
  capturing: boolean;
  startedAt: number;
  silenceMs: number;
  speakerAccess: VoiceSpeakerAccess;
  activeSpeakerId?: string;
  lastSpeakerId?: string;
  participantIds: Set<string>;
  awakeUntil: number;
  awakeSpeakerId?: string;
  lastTextActionKey?: string;
  lastTextActionAt?: number;
  voiceName: string;
  responseDelayMs: number;
}

const sessions = new Map<string, VoiceAiSession>();

function thinkingLevel(value: ThinkingLevelName): ThinkingLevel {
  switch (value) {
    case 'low': return ThinkingLevel.LOW;
    case 'medium': return ThinkingLevel.MEDIUM;
    case 'high': return ThinkingLevel.HIGH;
    case 'minimal':
    default: return ThinkingLevel.MINIMAL;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function discordPcm48StereoToGemini16Mono(pcm: Buffer): Buffer {
  const frames = Math.floor(pcm.byteLength / 4);
  const out = Buffer.allocUnsafe(Math.floor(frames / 3) * 2);
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

function geminiPcm24MonoToDiscord48Stereo(pcm: Buffer): Buffer {
  const samples = Math.floor(pcm.byteLength / 2);
  const out = Buffer.allocUnsafe(samples * 8);
  let offset = 0;

  for (let i = 0; i < samples; i += 1) {
    const sample = pcm.readInt16LE(i * 2);
    out.writeInt16LE(sample, offset);
    out.writeInt16LE(sample, offset + 2);
    out.writeInt16LE(sample, offset + 4);
    out.writeInt16LE(sample, offset + 6);
    offset += 8;
  }

  return out;
}

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

function pcm48StereoSeconds(pcm: Buffer): number {
  return pcm.byteLength / (48_000 * 2 * 2);
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
  if (session.outputStream && !session.outputStream.destroyed) return session.outputStream;
  const stream = new PassThrough();
  session.outputStream = stream;
  session.player.play(createAudioResource(stream, { inputType: StreamType.Raw }));
  return stream;
}

function finishLivePlayback(session: VoiceAiSession): void {
  const stream = session.outputStream;
  session.outputStream = undefined;
  if (stream && !stream.destroyed) stream.end();
}

async function armFollowupWindowAfterPlayback(
  session: VoiceAiSession
): Promise<void> {
  const control =
    await getVoiceControlSettings();

  if (
    session.purpose !== 'conversation' ||
    control.activationMode !== 'wake-word' ||
    !session.awakeSpeakerId
  ) {
    return;
  }

  const arm = () => {
    // Only arm the follow-up window for the still-active session.
    if (
      sessions.get(
        session.guildId
      ) !== session
    ) {
      return;
    }

    session.awakeUntil =
      Date.now() +
      control.followupWindowMs;
  };

  // If Discord has already drained the buffered reply, start now.
  if (
    session.player.state.status ===
    AudioPlayerStatus.Idle
  ) {
    arm();
    return;
  }

  // Gemini's turnComplete means generation finished, NOT that Discord
  // finished playing the buffered audio. Wait for actual playback Idle.
  const onStateChange = (
    _oldState: unknown,
    newState: {
      status: string;
    }
  ) => {
    if (
      newState.status !==
      AudioPlayerStatus.Idle
    ) {
      return;
    }

    session.player.off(
      'stateChange',
      onStateChange
    );

    arm();
  };

  session.player.on(
    'stateChange',
    onStateChange
  );
}

function mergeTranscript(current: string, incoming: string): string {
  const clean = incoming.trim();
  if (!clean) return current;
  if (!current) return clean;
  if (clean.startsWith(current)) return clean;
  if (current.endsWith(clean)) return current;
  return `${current} ${clean}`.trim();
}

function trimHistory(history: ChatTurn[]): ChatTurn[] {
  return history.slice(-Math.max(2, env.VOICE_AI_MAX_HISTORY));
}

function inferSpeechLanguage(reply: string, preferred: ChatResponseLanguage | string): string {
  if (preferred && preferred !== 'auto') return preferred;
  if (/[پچژگک]/u.test(reply)) return 'fa';
  if (/\p{Script=Arabic}/u.test(reply)) return 'ar-eg';
  return 'en';
}

function languageSystemInstruction(
  language: ChatResponseLanguage,
  wakeRequired = false,
  wakeWords: string[] = []
): string {
  const base = [
    'You are TD AI in a Discord group voice channel.',
    'Multiple human speakers may talk to you.',
    'Answer only the current speaker.',
    'Keep responses fast and natural.',
    'Prefer one to three short sentences unless detail is requested.',
    'Never claim an external action was completed unless the host runtime actually completed it.',
    'Inputs beginning with [TD_WAKE] are trusted host wake events. Reply only with a very short acknowledgement in the speaker language.',
    'Inputs beginning with [TD_HOST] are trusted host action results. Speak only the requested acknowledgement or usage result and do not question whether the action happened.',
    'The host may send text transcripts instead of raw audio when wake-word mode is enabled. Treat that transcript exactly as the current speaker turn.',
    'Inputs beginning with [TD_ACCEPTED] are already authorized by the host wake gate. Answer them normally and ignore the marker.',
    'If interrupted, stop speaking and listen.'
  ];

  if (wakeRequired) {
    base.push(
      `Wake mode is ON. For raw microphone audio, stay completely silent unless the speaker clearly calls TD first. Accepted wake names include: ${[
        ...wakeWords,
        'TD',
        'TD AI',
        'Hey TD',
        'يا TD',
        'تي دي',
        'تيدي',
        'يا تي دي'
      ].filter(Boolean).join(', ')}.`
    );
    base.push(
      'If raw audio is ordinary conversation that does not call TD, output no spoken response at all.'
    );
    base.push(
      'After a clear TD wake call, answer the request naturally. A host-tagged [TD_ACCEPTED], [TD_WAKE], or [TD_HOST] turn is always authorized.'
    );
  } else {
    base.push(
      'Wake mode is OFF. Respond normally to the current speaker.'
    );
  }

  switch (language) {
    case 'ar-eg':
      base.push('Answer in natural Egyptian Arabic unless another language is requested.');
      break;
    case 'ar-msa':
      base.push('Answer in clear Modern Standard Arabic unless another language is requested.');
      break;
    case 'en':
      base.push('Answer in English unless another language is requested.');
      break;
    case 'fa':
      base.push('Answer in natural Persian unless another language is requested.');
      break;
    default:
      base.push('Follow the language of the current speaker.');
  }

  return base.join(' ');
}

function canListenToSpeaker(session: VoiceAiSession, speakerId: string): boolean {
  const client = getGatewayClient();
  if (speakerId === client.user?.id) return false;

  if (session.speakerAccess === 'owner-only' && speakerId !== session.userId) {
    return false;
  }

  const guild = client.guilds.cache.get(session.guildId);
  const voiceState = guild?.voiceStates.cache.get(speakerId);
  if (!voiceState || voiceState.channelId !== session.channelId) return false;

  const member = voiceState.member ?? guild?.members.cache.get(speakerId);
  if (member?.user.bot) return false;
  return true;
}

async function postToVoiceTextChannel(session: VoiceAiSession, content: string): Promise<void> {
  const client = getGatewayClient();
  const channel = await client.channels.fetch(session.channelId);

  if (!channel || !channel.isSendable()) {
    throw new Error('The current voice channel does not expose a sendable text chat.');
  }

  await channel.send({
    content: content.slice(0, 1900),
    allowedMentions: { parse: [] }
  });
}

function normalizeWake(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wakeFromTranscript(
  transcript: string,
  wakeWords: string[]
): { woke: boolean; remainder: string } {
  const raw = transcript.trim();
  const normalized = normalizeWake(raw);

  const aliases = [
    ...wakeWords,
    'td',
    'td ai',
    'hey td',
    'okay td',
    'ok td',
    'يا td',
    'تي دي',
    'تيدي',
    'يا تي دي',
    'تي دي اي',
    'translator'
  ];

  for (const word of aliases) {
    const cleanWake = normalizeWake(word);
    if (!cleanWake) continue;

    if (normalized === cleanWake) {
      return { woke: true, remainder: '' };
    }

    if (normalized.startsWith(`${cleanWake} `)) {
      const wakeParts = cleanWake.split(' ').length;
      const originalParts = raw.split(/\s+/);
      return {
        woke: true,
        remainder: originalParts.slice(wakeParts).join(' ').trim()
      };
    }
  }

  return { woke: false, remainder: raw };
}

function extractWriteCommand(text: string): string | undefined {
  const patterns = [
    /^(?:write|send|post)\s+(?:this\s+)?(?:in|to)\s+(?:the\s+)?(?:voice\s+)?(?:text\s+)?chat\s*[:：,\-]?\s+([\s\S]+)/iu,
    /^(?:اكتب(?:لي| ليا| لنا)?|ابعت|ابعث|ارسل|أرسل|رسل)\s+(?:في|على|بال|ب)\s*(?:الشات|التشات|chat)\s*[:：،,\-]?\s+([\s\S]+)/iu,
    /^(?:في|على|بال)\s*(?:الشات|التشات|chat)\s+(?:اكتب|ابعت|ابعث|ارسل|أرسل|رسل)\s*[:：،,\-]?\s+([\s\S]+)/iu
  ];

  for (const pattern of patterns) {
    const match = text.trim().match(pattern);
    const payload = match?.[1]?.trim().replace(/^["“”'`]+|["“”'`]+$/g, '').trim();
    if (payload) return payload.slice(0, 1800);
  }

  return undefined;
}

function isSkipCommand(text: string): boolean {
  return /^(?:skip|stop|shut up|اسكت|وقف|توقف|ستوب)\b/iu.test(text.trim());
}

function isReconnectCommand(text: string): boolean {
  return /^(?:reconnect|connect again|اعمل ريكونكت|اتصل تاني|وصل تاني)\b/iu.test(text.trim());
}

function isUsageCommand(text: string): boolean {
  return /^(?:usage|credits|limit|quota|فاضلي كام|استهلكت كام|الليميت|الرصيد)\b/iu.test(text.trim());
}

function shortUsageReply(summary: Awaited<ReturnType<typeof userUsageSummary>>, language: string): string {
  if (/\p{Script=Arabic}/u.test(language)) {
    return `استخدمت ${summary.used.toLocaleString()} كريدت، وفاضلك ${summary.remaining.toLocaleString()} من ${summary.allowance.toLocaleString()} في خطة ${summary.plan.name}.`;
  }
  return `You used ${summary.used.toLocaleString()} credits and have ${summary.remaining.toLocaleString()} of ${summary.allowance.toLocaleString()} left on ${summary.plan.name}.`;
}

async function playGeneratedSpeech(
  session: VoiceAiSession,
  text: string,
  language: string,
  userIdForUsage: string
): Promise<void> {
  const audio = await runWithUsageUser(
    userIdForUsage,
    () => generateGeminiSpeech(text, language)
  );

  const stream = new PassThrough();
  stream.end(Buffer.from(audio.data));
  session.player.play(createAudioResource(stream, { inputType: StreamType.Arbitrary }));
  await entersState(session.player, AudioPlayerStatus.Playing, 15_000);
  await entersState(session.player, AudioPlayerStatus.Idle, 180_000);
}

async function handleConversationText(
  session: VoiceAiSession,
  speakerId: string,
  transcript: string
): Promise<void> {
  const control = await getVoiceControlSettings();
  let commandText = transcript.trim();

  if (control.activationMode === 'wake-word') {
    const wake = wakeFromTranscript(commandText, control.wakeWords);
    const now = Date.now();

    if (wake.woke) {
      session.awakeUntil = now + control.wakeWindowMs;
      session.awakeSpeakerId = speakerId;
      commandText = wake.remainder;

      if (!commandText) {
        session.inputTranscript = transcript;
        session.outputTranscript = control.wakeResponse;
        if (control.wakeResponse.trim()) {
          await playGeneratedSpeech(
            session,
            control.wakeResponse,
            session.language,
            speakerId
          );
        }
        session.awakeUntil = Date.now() + control.wakeWindowMs;
        session.awakeSpeakerId = speakerId;
        return;
      }
    } else {
      const awake =
        session.awakeUntil > now &&
        (control.followupSpeaker === 'anyone' || session.awakeSpeakerId === speakerId);

      if (!awake) {
        session.inputTranscript = transcript;
        session.outputTranscript = '';
        return;
      }
    }
  }

  if (!commandText) return;

  if (isSkipCommand(commandText)) {
    stopPlayback(session);
    session.outputTranscript = '';
    return;
  }

  const writeText = extractWriteCommand(commandText);
  if (writeText) {
    const now = Date.now();
    const key = `${speakerId}:${writeText.toLocaleLowerCase()}`;

    if (!(session.lastTextActionKey === key && session.lastTextActionAt && now - session.lastTextActionAt < 8_000)) {
      await postToVoiceTextChannel(session, writeText);
      session.lastTextActionKey = key;
      session.lastTextActionAt = now;
    }

    const reply = /\p{Script=Arabic}/u.test(commandText)
      ? 'تمام، كتبتها في الشات.'
      : 'Done. I posted it in the chat.';

    session.outputTranscript = reply;
    await playGeneratedSpeech(session, reply, inferSpeechLanguage(reply, session.language), speakerId);

    if (control.activationMode === 'wake-word') {
      session.awakeUntil = Date.now() + control.followupWindowMs;
      session.awakeSpeakerId = speakerId;
    }
    return;
  }

  if (isUsageCommand(commandText)) {
    const summary = await userUsageSummary(speakerId);
    const reply = shortUsageReply(summary, commandText);
    session.outputTranscript = reply;
    await playGeneratedSpeech(session, reply, inferSpeechLanguage(reply, session.language), speakerId);

    if (control.activationMode === 'wake-word') {
      session.awakeUntil = Date.now() + control.followupWindowMs;
      session.awakeSpeakerId = speakerId;
    }
    return;
  }

  if (isReconnectCommand(commandText)) {
    const reply = /\p{Script=Arabic}/u.test(commandText)
      ? 'تمام، هعمل إعادة اتصال.'
      : 'Okay, reconnecting.';
    session.outputTranscript = reply;
    await playGeneratedSpeech(session, reply, inferSpeechLanguage(reply, session.language), speakerId);
    setTimeout(() => {
      void reconnectVoiceAi(session.guildId, session.userId).catch((error) => {
        console.error('Voice reconnect command failed:', error);
      });
    }, 250);
    return;
  }

  await assertFeatureAccess(speakerId, 'voice_ai');

  const reply = await runWithUsageUser(
    speakerId,
    () => askAiChat(
      session.history,
      commandText,
      session.language,
      env.VOICE_AI_MODEL ?? env.AI_MODEL
    )
  );

  session.inputTranscript = transcript;
  session.outputTranscript = reply;
  session.history = trimHistory([
    ...session.history,
    { role: 'user', content: commandText },
    { role: 'assistant', content: reply }
  ]);

  await playGeneratedSpeech(
    session,
    reply,
    inferSpeechLanguage(reply, session.language),
    speakerId
  );

  await recordUsage(speakerId, 'voice_ai', Math.max(1, Math.ceil(reply.length / 8)));

  if (control.activationMode === 'wake-word') {
    session.awakeUntil = Date.now() + control.followupWindowMs;
    session.awakeSpeakerId = speakerId;
  }
}

function languageMatches(detected: string | undefined, configured: string): boolean {
  if (!detected) return false;
  const d = detected.toLowerCase();
  const c = configured.toLowerCase();
  if (c.startsWith('ar')) return d.startsWith('ar');
  if (c.startsWith('fa')) return d.startsWith('fa') || d.startsWith('per');
  const base = c.split('-')[0] ?? c;
  return d.startsWith(base);
}

async function processTranslationText(
  session: VoiceAiSession,
  speakerId: string,
  transcript: string,
  detectedLanguage?: string
): Promise<void> {
  const options = session.translation;
  if (!options) throw new Error('Live Translation is not configured for this session.');

  await assertFeatureAccess(speakerId, 'live_translation');

  const target = languageMatches(detectedLanguage, options.languageA)
    ? options.languageB
    : languageMatches(detectedLanguage, options.languageB)
      ? options.languageA
      : options.languageB;

  const result = await runWithUsageUser(
    speakerId,
    () => translateText(transcript, target, {
      source: 'auto',
      provider: 'default',
      style: 'natural'
    })
  );

  const translated = result.text.trim();
  session.inputTranscript = transcript;
  session.outputTranscript = translated;

  if (options.output === 'captions' || options.output === 'both') {
    const sourceLabel = detectedLanguage ?? result.detectedSourceLanguage ?? 'auto';
    await postToVoiceTextChannel(
      session,
      [
        `🎙️ <@${speakerId}> — **${sourceLabel}**`,
        transcript.slice(0, 850),
        '',
        `🌐 **${target}**`,
        translated.slice(0, 850)
      ].join('\n')
    ).catch((error) => console.error('Live translation caption failed:', error));
  }

  if (options.output === 'voice' || options.output === 'both') {
    await playGeneratedSpeech(session, translated, target, speakerId);
  }

  await recordUsage(
    speakerId,
    'live_translation',
    Math.max(1, Math.ceil((transcript.length + translated.length) / 8))
  );

  session.turns += 1;
}

async function processCascadeUtterance(session: VoiceAiSession, speakerId: string, chunks: Buffer[]): Promise<void> {
  if (!chunks.length) return;

  const pcm = Buffer.concat(chunks);
  if (pcm.byteLength < 24_000) return;

  session.busy = true;

  try {
    const transcript = await runWithUsageUser(
      speakerId,
      () => transcribeAudioBytes(pcmToWav(pcm), 'td-ai-voice.wav', 'audio/wav')
    );

    if (session.purpose === 'translation') {
      await processTranslationText(session, speakerId, transcript.text, transcript.language);
    } else {
      await handleConversationText(session, speakerId, transcript.text);
      session.turns += 1;
    }
  } catch (error) {
    console.error('Cascade Voice AI error:', error);
    await notifyUser(session.userId, `❌ **TD AI Voice:** ${errorMessage(error)}`);
  } finally {
    session.busy = false;
  }
}

function attachCascadeReceiver(session: VoiceAiSession): void {
  const receiver = session.connection.receiver;

  receiver.speaking.on('start', (speakerId) => {
    const current = sessions.get(session.guildId);
    if (
      !current ||
      current !== session ||
      !canListenToSpeaker(session, speakerId) ||
      session.capturing
    ) {
      return;
    }

    if (session.player.state.status !== AudioPlayerStatus.Idle) {
      stopPlayback(session);
      session.busy = false;
    }

    if (session.busy) return;

    session.capturing = true;
    session.activeSpeakerId = speakerId;
    session.lastSpeakerId = speakerId;
    session.participantIds.add(speakerId);

    const opusStream = receiver.subscribe(speakerId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: session.silenceMs
      }
    });

    const decoder = new OpusScript(48_000, 2, OpusScript.Application.AUDIO);
    const chunks: Buffer[] = [];
    let finalized = false;

    const timer = setTimeout(
      () => opusStream.destroy(),
      env.VOICE_AI_MAX_UTTERANCE_SECONDS * 1000
    );

    const finalize = () => {
      if (finalized) return;
      finalized = true;
      clearTimeout(timer);
      session.capturing = false;
      session.activeSpeakerId = undefined;
      try { decoder.delete(); } catch { /* no-op */ }
      void processCascadeUtterance(session, speakerId, chunks);
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


async function sendRawPcmToLive(
  session: VoiceAiSession,
  speakerId: string,
  pcm48Stereo: Buffer
): Promise<void> {
  if (!session.live) {
    throw new Error('Gemini Live is not connected.');
  }

  const pcm16Mono =
    discordPcm48StereoToGemini16Mono(
      pcm48Stereo
    );

  if (!pcm16Mono.byteLength) {
    throw new Error(
      'Discord voice capture contained no usable PCM audio.'
    );
  }

  session.lastSpeakerId =
    speakerId;

  session.inputTranscript =
    '';

  session.outputTranscript =
    '';

  session.busy =
    true;

  session.live.sendRealtimeInput({
    audio: {
      data:
        pcm16Mono.toString(
          'base64'
        ),
      mimeType:
        'audio/pcm;rate=16000'
    }
  });

  session.live.sendRealtimeInput({
    audioStreamEnd: true
  });
}

async function sendLiveText(
  session: VoiceAiSession,
  speakerId: string,
  text: string
): Promise<void> {
  if (!session.live) {
    throw new Error('Gemini Live is not connected.');
  }

  await sleep(session.responseDelayMs);

  session.lastSpeakerId = speakerId;
  session.inputTranscript = text;
  session.outputTranscript = '';
  session.busy = true;

  session.live.sendClientContent({
    turns: [{
      role: 'user',
      parts: [{ text }]
    }],
    turnComplete: true
  });
}

async function processWakeGatedLiveUtterance(
  session: VoiceAiSession,
  speakerId: string,
  chunks: Buffer[]
): Promise<void> {
  if (!chunks.length) return;

  const pcm = Buffer.concat(chunks);
  if (pcm.byteLength < 24_000) return;

  session.busy = true;
  let handedToLive = false;

  try {
    // Wake detection runs without the user billing context so normal
    // background conversation is not charged to the speaker's TD AI plan.
    const transcript = await transcribeAudioBytes(
      pcmToWav(pcm),
      'td-ai-wake.wav',
      'audio/wav'
    );

    const control = await getVoiceControlSettings();
    const spoken = transcript.text.trim();
    if (!spoken) return;

    let commandText = spoken;
    const now = Date.now();
    const wake = wakeFromTranscript(spoken, control.wakeWords);

    if (wake.woke) {
      session.awakeSpeakerId = speakerId;
      session.awakeUntil = now + control.wakeWindowMs;
      commandText = wake.remainder;

      if (!commandText) {
        handedToLive = true;
        await sendLiveText(
          session,
          speakerId,
          [
            '[TD_WAKE]',
            'A speaker just called your wake name.',
            'Reply with ONLY a very short acknowledgement in the same language as the speaker.',
            'Examples: "أيوه؟" or "Yes?"'
          ].join('\n')
        );
        return;
      }
    } else {
      const stillAwake =
        session.awakeUntil > now &&
        (
          control.followupSpeaker === 'anyone' ||
          session.awakeSpeakerId === speakerId
        );

      if (!stillAwake) {
        session.inputTranscript = spoken;
        session.outputTranscript = '';
        return;
      }
    }

    // Only accepted TD turns count toward the user's STT usage.
    await recordUsage(
      speakerId,
      'stt',
      Math.max(
        1,
        Math.ceil(pcm.byteLength / 48_000) * 4
      )
    ).catch(() => undefined);

    if (isSkipCommand(commandText)) {
      stopPlayback(session);
      session.outputTranscript = '';
      return;
    }

    const writeText = extractWriteCommand(commandText);
    if (writeText) {
      const actionKey = `${speakerId}:${writeText.toLocaleLowerCase()}`;
      const actionNow = Date.now();

      if (
        !(
          session.lastTextActionKey === actionKey &&
          session.lastTextActionAt &&
          actionNow - session.lastTextActionAt < 8_000
        )
      ) {
        await postToVoiceTextChannel(session, writeText);
        session.lastTextActionKey = actionKey;
        session.lastTextActionAt = actionNow;
      }

      handedToLive = true;
      await sendLiveText(
        session,
        speakerId,
        /\p{Script=Arabic}/u.test(commandText)
          ? '[TD_HOST]\nتم تنفيذ أمر الكتابة بنجاح. قل فقط: تمام، كتبتها في الشات.'
          : '[TD_HOST]\nThe write action succeeded. Say only: Done, I posted it in the chat.'
      );
      return;
    }

    if (isUsageCommand(commandText)) {
      const summary = await userUsageSummary(speakerId);
      const usage = shortUsageReply(summary, commandText);

      handedToLive = true;
      await sendLiveText(
        session,
        speakerId,
        `[TD_HOST]\nRead this usage result naturally and briefly in the same language:\n${usage}`
      );
      return;
    }

    if (isReconnectCommand(commandText)) {
      session.busy = false;
      setTimeout(() => {
        void reconnectVoiceAi(
          session.guildId,
          session.userId
        ).catch((error) => {
          console.error(
            'Voice reconnect command failed:',
            error
          );
        });
      }, 100);
      return;
    }

    await assertFeatureAccess(
      speakerId,
      'voice_ai'
    );

    handedToLive = true;
    await sendLiveText(
      session,
      speakerId,
      `[TD_ACCEPTED]\n${commandText}`
    );
  } catch (error) {
    console.warn(
      'Wake STT failed; trying direct Gemini Live audio fallback:',
      error
    );

    if (session.live) {
      try {
        handedToLive = true;

        await sendRawPcmToLive(
          session,
          speakerId,
          pcm
        );

        return;
      } catch (fallbackError) {
        handedToLive = false;

        console.error(
          'Direct Gemini Live audio fallback failed:',
          fallbackError
        );

        await notifyUser(
          session.userId,
          `❌ **TD AI Voice:** ${errorMessage(fallbackError)}`
        );
      }
    } else {
      await notifyUser(
        session.userId,
        `❌ **TD AI Voice:** ${errorMessage(error)}`
      );
    }
  } finally {
    if (!handedToLive) {
      session.busy = false;
    }
  }
}

function attachWakeGatedLiveReceiver(
  session: VoiceAiSession
): void {
  const receiver = session.connection.receiver;

  receiver.speaking.on(
    'start',
    (speakerId) => {
      const current =
        sessions.get(session.guildId);

      if (
        !current ||
        current !== session ||
        !session.live ||
        !canListenToSpeaker(
          session,
          speakerId
        ) ||
        session.capturing
      ) {
        return;
      }

      if (
        session.player.state.status !==
        AudioPlayerStatus.Idle
      ) {
        stopPlayback(session);
        session.busy = false;
      }

      if (session.busy) return;

      session.capturing = true;
      session.activeSpeakerId = speakerId;
      session.lastSpeakerId = speakerId;
      session.participantIds.add(speakerId);

      const opusStream =
        receiver.subscribe(
          speakerId,
          {
            end: {
              behavior:
                EndBehaviorType.AfterSilence,
              duration:
                Math.max(
                  session.silenceMs,
                  650
                )
            }
          }
        );

      const decoder =
        new OpusScript(
          48_000,
          2,
          OpusScript.Application.AUDIO
        );

      const chunks: Buffer[] = [];
      let finalized = false;

      const timer =
        setTimeout(
          () => opusStream.destroy(),
          env.VOICE_AI_MAX_UTTERANCE_SECONDS *
            1000
        );

      const finalize = () => {
        if (finalized) return;
        finalized = true;

        clearTimeout(timer);
        session.capturing = false;
        session.activeSpeakerId =
          undefined;

        try {
          decoder.delete();
        } catch {
          // no-op
        }

        void processWakeGatedLiveUtterance(
          session,
          speakerId,
          chunks
        );
      };

      opusStream.on(
        'data',
        (packet: Buffer) => {
          try {
            const decoded =
              decoder.decode(packet);

            if (decoded?.byteLength) {
              chunks.push(
                Buffer.from(decoded)
              );
            }
          } catch (error) {
            console.error(
              'Wake-gated Opus decode error:',
              error
            );
          }
        }
      );

      opusStream.once(
        'end',
        finalize
      );

      opusStream.once(
        'close',
        finalize
      );

      opusStream.once(
        'error',
        (error) => {
          console.error(
            'Wake-gated receive stream error:',
            error.message
          );
          finalize();
        }
      );
    }
  );
}

function handleLiveMessage(session: VoiceAiSession, message: LiveServerMessage): void {
  const content = message.serverContent;
  if (!content) return;

  if (content.interrupted) {
    stopPlayback(session);
    session.busy = false;
  }

  const inputText = content.inputTranscription?.text?.trim();
  if (inputText) session.inputTranscript = mergeTranscript(session.inputTranscript, inputText);

  const outputText = content.outputTranscription?.text?.trim();
  if (outputText) session.outputTranscript = outputText;

  for (const part of content.modelTurn?.parts ?? []) {
    const data = part.inlineData?.data;
    if (!data) continue;
    session.busy = true;
    const pcm24 = Buffer.from(data, 'base64');
    if (pcm24.byteLength) {
      ensureLivePlayback(session).write(geminiPcm24MonoToDiscord48Stereo(pcm24));
    }
  }

  if (content.turnComplete) {
    finishLivePlayback(session);
    session.busy = false;
    session.turns += 1;

    // Start the follow-up timer only AFTER the reply has actually
    // finished playing in Discord, not when Gemini finishes generating it.
    void armFollowupWindowAfterPlayback(
      session
    ).catch(
      (error) => {
        console.error(
          'Could not arm voice follow-up window:',
          error
        );
      }
    );

    const speakerId = session.lastSpeakerId ?? session.userId;
    const writeText = extractWriteCommand(session.inputTranscript);
    if (writeText) {
      void postToVoiceTextChannel(session, writeText).catch((error) => {
        console.error('Live voice write-to-chat action failed:', error);
      });
    }

    void recordUsage(
      speakerId,
      'voice_ai',
      Math.max(1, Math.ceil((session.inputTranscript.length + session.outputTranscript.length) / 8))
    ).catch(() => undefined);
  }
}

async function connectGeminiLive(session: VoiceAiSession): Promise<void> {
  const route = await getGeminiTaskRoute('voice_live');
  const voice = await getVoiceRuntimeSettings();
  const control = await getVoiceControlSettings();
  const ai = new GoogleGenAI({ apiKey: route.apiKey });

  const live = await ai.live.connect({
    model: route.model,
    callbacks: {
      onopen: () => {
        console.log(`Gemini Live connected for guild ${session.guildId} via ${route.providerName}/${route.model}.`);
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
        parts: [{
          text: languageSystemInstruction(
            session.language,
            control.activationMode === 'wake-word',
            control.wakeWords
          )
        }]
      },
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: session.voiceName || voice.liveVoice
          }
        }
      },
      thinkingConfig: {
        thinkingLevel: thinkingLevel(voice.thinkingLevel)
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: false,
          prefixPaddingMs: 20,
          silenceDurationMs: Math.max(100, session.silenceMs)
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

    if (
      !current ||
      current !== session ||
      !session.live ||
      !canListenToSpeaker(session, speakerId)
    ) {
      return;
    }

    if (session.capturing) return;

    if (session.player.state.status !== AudioPlayerStatus.Idle) {
      stopPlayback(session);
    }

    session.capturing = true;
    session.activeSpeakerId = speakerId;
    session.lastSpeakerId = speakerId;
    session.participantIds.add(speakerId);
    session.busy = false;
    session.inputTranscript = '';
    session.outputTranscript = '';

    const opusStream = receiver.subscribe(speakerId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: session.silenceMs
      }
    });

    const decoder = new OpusScript(48_000, 2, OpusScript.Application.AUDIO);
    let finalized = false;
    const timer = setTimeout(
      () => opusStream.destroy(),
      env.VOICE_AI_MAX_UTTERANCE_SECONDS * 1000
    );

    const finalize = () => {
      if (finalized) return;
      finalized = true;
      clearTimeout(timer);
      session.capturing = false;
      session.activeSpeakerId = undefined;
      try { decoder.delete(); } catch { /* no-op */ }
      try {
        session.live?.sendRealtimeInput({ audioStreamEnd: true });
        session.busy = true;
      } catch (error) {
        console.error('Gemini Live audioStreamEnd error:', error);
      }
    };

    opusStream.on('data', (packet: Buffer) => {
      try {
        const pcm = discordPcm48StereoToGemini16Mono(Buffer.from(decoder.decode(packet)));
        if (!pcm.byteLength) return;

        session.live?.sendRealtimeInput({
          audio: {
            data: pcm.toString('base64'),
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

async function resolveVoiceChannel(guildId: string, userId: string): Promise<VoiceBasedChannel> {
  const client = getGatewayClient();
  const guild = await client.guilds.fetch(guildId);
  const channel = guild.voiceStates.cache.get(userId)?.channel as VoiceBasedChannel | null | undefined;
  if (!channel) throw new Error('Join a Discord voice channel first.');
  return channel;
}

async function createSession(
  guildId: string,
  userId: string,
  channel: VoiceBasedChannel,
  language: ChatResponseLanguage,
  purpose: SessionPurpose,
  translation?: VoiceTranslationOptions
): Promise<VoiceAiSession> {
  const client = getGatewayClient();
  const guild = await client.guilds.fetch(guildId);

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
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Pause
    }
  });

  connection.subscribe(player);
  player.on('error', (error) => console.error('Voice player error:', error.message));

  const runtimeVoice = await getVoiceRuntimeSettings();
  const control = await getVoiceControlSettings();

  // Conversation stays on Gemini Live whenever Live mode is enabled.
  // Wake-word mode now gates INPUT locally with STT, but Gemini Live still
  // produces the actual spoken response. This avoids the fragile
  // STT -> text model -> separate TTS chain for normal conversation.
  const engine: VoiceEngine =
    purpose === 'conversation' &&
    env.VOICE_AI_MODE === 'live'
      ? 'live'
      : 'cascade';

  if (
    purpose === 'conversation' &&
    engine === 'live' &&
    control.activationMode === 'wake-word' &&
    !sttConfigured()
  ) {
    connection.destroy();
    throw new Error(
      'Wake-word mode needs Speech Recognition (STT) to detect TD before forwarding a turn to Gemini Live.'
    );
  }

  if (
    purpose === 'conversation' &&
    engine === 'cascade' &&
    (
      !sttConfigured() ||
      !aiChatConfigured() ||
      !geminiTtsConfigured()
    )
  ) {
    connection.destroy();
    throw new Error(
      'Cascade conversation requires STT + AI Chat + TTS.'
    );
  }

  if (
    purpose === 'translation' &&
    translation &&
    (translation.output === 'voice' || translation.output === 'both') &&
    !geminiTtsConfigured()
  ) {
    connection.destroy();
    throw new Error(
      'Voice output for Live Translation requires Gemini TTS. Use Captions only or configure TTS.'
    );
  }

  const personal =
    await getUserPersonalization(userId);

  const session: VoiceAiSession = {
    guildId,
    channelId: channel.id,
    userId,
    language,
    engine,
    purpose,
    translation,
    connection,
    player,
    inputTranscript: '',
    outputTranscript: '',
    turns: 0,
    history: [],
    busy: false,
    capturing: false,
    startedAt: Date.now(),
    silenceMs:
      purpose === 'translation' && translation?.quality === 'fast'
        ? Math.min(runtimeVoice.silenceMs, 220)
        : purpose === 'translation' && translation?.quality === 'accurate'
          ? Math.max(runtimeVoice.silenceMs, 450)
          : runtimeVoice.silenceMs,
    speakerAccess: runtimeVoice.speakerAccess,
    participantIds: new Set<string>(),
    awakeUntil: 0,
    voiceName: personal.voiceName,
    responseDelayMs: personal.responseDelayMs
  };

  sessions.set(guildId, session);

  try {
    if (engine === 'live') {
      await connectGeminiLive(session);

      if (
        control.activationMode ===
        'wake-word'
      ) {
        attachWakeGatedLiveReceiver(
          session
        );
      } else {
        attachLiveReceiver(session);
      }
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

  return session;
}

export function voiceAiConfigured(): boolean {
  if (!env.DISCORD_BOT_TOKEN) return false;
  if (env.VOICE_AI_MODE === 'live') {
    return Boolean(env.GEMINI_LIVE_API_KEY ?? env.AI_API_KEY);
  }
  return Boolean(
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
): Promise<{ channelName: string; mode: VoiceEngine; purpose: SessionPurpose }> {
  await assertFeatureAccess(userId, 'voice_ai');
  await waitForGatewayReady();
  const channel = await resolveVoiceChannel(guildId, userId);
  const session = await createSession(
    guildId,
    userId,
    channel,
    language,
    'conversation'
  );

  return {
    channelName: channel.name,
    mode: session.engine,
    purpose: session.purpose
  };
}

export async function startVoiceTranslation(
  guildId: string,
  userId: string,
  input?: Partial<VoiceTranslationOptions>
): Promise<{ channelName: string; mode: VoiceEngine; translation: VoiceTranslationOptions }> {
  await assertFeatureAccess(userId, 'live_translation');
  await waitForGatewayReady();

  const control = await getVoiceControlSettings();
  const channel = await resolveVoiceChannel(guildId, userId);

  const translation: VoiceTranslationOptions = {
    languageA: input?.languageA?.trim() || control.translationLanguageA,
    languageB: input?.languageB?.trim() || control.translationLanguageB,
    quality: input?.quality ?? control.translationQuality,
    output: input?.output ?? control.translationOutput
  };

  const session = await createSession(
    guildId,
    userId,
    channel,
    'auto',
    'translation',
    translation
  );

  return {
    channelName: channel.name,
    mode: session.engine,
    translation
  };
}

export async function stopVoiceTranslation(
  guildId: string,
  requesterId: string
): Promise<boolean> {
  const session = sessions.get(guildId);
  if (!session || session.purpose !== 'translation') return false;
  if (requesterId !== session.userId) {
    throw new Error('Only the user who started this session can change its mode.');
  }

  const client = getGatewayClient();
  const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId);
  const channel = guild.channels.cache.get(session.channelId) as VoiceBasedChannel | undefined;
  if (!channel) throw new Error('The current voice channel is no longer available.');

  await createSession(guildId, requesterId, channel, 'auto', 'conversation');
  return true;
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

export async function reconnectVoiceAi(
  guildId: string,
  requesterId: string
): Promise<{ channelName: string; mode: VoiceEngine; purpose: SessionPurpose }> {
  const session = sessions.get(guildId);
  if (!session) throw new Error('TD AI is not currently in a voice session.');
  if (requesterId !== session.userId) {
    throw new Error('Only the session owner can reconnect TD AI.');
  }

  const client = getGatewayClient();
  const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId);
  const channel = guild.channels.cache.get(session.channelId) as VoiceBasedChannel | undefined;
  if (!channel) throw new Error('The current voice channel is unavailable.');

  const next = await createSession(
    guildId,
    requesterId,
    channel,
    session.language,
    session.purpose,
    session.translation
  );

  return {
    channelName: channel.name,
    mode: next.engine,
    purpose: next.purpose
  };
}

export function skipVoiceAi(guildId: string): boolean {
  const session = sessions.get(guildId);
  if (!session) return false;
  stopPlayback(session);
  session.busy = false;
  return true;
}

export async function writeVoiceChat(
  guildId: string,
  requesterId: string,
  content: string
): Promise<void> {
  const session = sessions.get(guildId);
  if (!session) throw new Error('TD AI is not currently in a voice session.');
  if (!canListenToSpeaker(session, requesterId)) {
    throw new Error('Join the same voice channel as TD AI first.');
  }

  const clean = content.trim();
  if (!clean) throw new Error('Message text is required.');
  await postToVoiceTextChannel(session, clean);
}

export async function voiceAiUsage(userId: string) {
  return userUsageSummary(userId);
}

export function voiceAiStatus(guildId: string) {
  const session = sessions.get(guildId);
  if (!session) return { active: false as const };

  return {
    active: true as const,
    userId: session.userId,
    channelId: session.channelId,
    language: session.language,
    busy: session.busy,
    turns: session.turns,
    mode: session.engine,
    purpose: session.purpose,
    translation: session.translation,
    inputTranscript: session.inputTranscript || undefined,
    outputTranscript: session.outputTranscript || undefined,
    silenceMs: session.silenceMs,
    speakerAccess: session.speakerAccess,
    activeSpeakerId: session.activeSpeakerId,
    participantCount: session.participantIds.size,
    awake: session.awakeUntil > Date.now(),
    awakeUntil: session.awakeUntil || undefined,
    awakeSpeakerId: session.awakeSpeakerId,
    voiceName: session.voiceName,
    responseDelayMs: session.responseDelayMs
  };
}
