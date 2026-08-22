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
import { askAiChat, type ChatResponseLanguage, type ChatTurn } from './aiChat.js';
import { generateGeminiSpeech, geminiTtsConfigured } from './geminiTts.js';
import { getGatewayClient, waitForGatewayReady } from './gatewayChat.js';
import { sttConfigured, transcribeAudioBytes } from './stt.js';
import { getGeminiTaskRoute, getVoiceRuntimeSettings, type ThinkingLevelName, type VoiceSpeakerAccess } from './runtimeConfig.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const OpusScript: any = require('opusscript');

type LiveSessionLike = {
  sendRealtimeInput(params: { audio?: { data: string; mimeType: string }; audioStreamEnd?: boolean }): void;
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
  lastTextActionKey?: string;
  lastTextActionAt?: number;
  participantIds: Set<string>;
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

async function notifyUser(userId: string, text: string): Promise<void> {
  const client = getGatewayClient();
  const user = await client.users.fetch(userId).catch(() => undefined);
  if (!user) return;
  await user.send({ content: text.slice(0, 1900), allowedMentions: { parse: [] } }).catch(() => undefined);
}

type VoiceTextActionResult = {
  handled: boolean;
  posted: boolean;
  content?: string;
  error?: string;
};

function extractVoiceTextCommand(transcript: string): string | undefined {
  const text = transcript.trim();
  const patterns = [
    // Arabic: اكتب في الشات صباح الخير / ابعت في الشات الاجتماع الساعة 8
    /(?:اكتب(?:لي| ليا| لنا)?|ابعت|ابعث|ارسل|أرسل|رسل)\s+(?:في|على|بال|ب)\s*(?:الشات|التشات|chat)\s*[:：،,\-]?\s+([\s\S]+)/iu,
    // Arabic reversed: في الشات اكتب صباح الخير
    /(?:في|على|بال)\s*(?:الشات|التشات|chat)\s+(?:اكتب|ابعت|ابعث|ارسل|أرسل|رسل)\s*[:：،,\-]?\s+([\s\S]+)/iu,
    // English: write in the chat hello / send to chat meeting at 8
    /(?:write|send|post)\s+(?:this\s+)?(?:in|to)\s+(?:the\s+)?(?:voice\s+)?(?:text\s+)?chat\s*[:：,\-]?\s+([\s\S]+)/iu
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const payload = match?.[1]
      ?.trim()
      .replace(/^["“”'`]+|["“”'`]+$/g, '')
      .trim();

    if (payload) return payload.slice(0, 1800);
  }

  return undefined;
}

async function handleVoiceTextAction(
  session: VoiceAiSession,
  transcript: string,
  speakerId: string
): Promise<VoiceTextActionResult> {
  const content = extractVoiceTextCommand(transcript);
  if (!content) return { handled: false, posted: false };

  // Gemini may emit the same final transcript more than once. Avoid duplicates.
  const now = Date.now();
  const actionKey = `${speakerId}:${content.toLocaleLowerCase()}`;
  if (
    session.lastTextActionKey === actionKey &&
    session.lastTextActionAt &&
    now - session.lastTextActionAt < 8_000
  ) {
    return { handled: true, posted: true, content };
  }

  try {
    const client = getGatewayClient();
    const channel = await client.channels.fetch(session.channelId);

    if (!channel || !channel.isSendable()) {
      throw new Error('This voice channel does not expose a text chat.');
    }

    await channel.send({
      content,
      // Voice commands must never be able to create @everyone / role pings.
      allowedMentions: { parse: [] }
    });

    session.lastTextActionKey = actionKey;
    session.lastTextActionAt = now;

    console.log(`Voice text action: ${speakerId} -> ${content}`);
    return { handled: true, posted: true, content };
  } catch (error) {
    const message = errorMessage(error);
    console.error('Voice text action failed:', error);
    return { handled: true, posted: false, content, error: message };
  }
}

function voiceTextActionReply(transcript: string, posted: boolean): string {
  if (/[پچژگک]/u.test(transcript)) {
    return posted
      ? 'انجام شد، توی چت نوشتم.'
      : 'نتونستم پیام رو توی چت بفرستم.';
  }

  if (/\p{Script=Arabic}/u.test(transcript)) {
    return posted
      ? 'تمام، كتبتها في الشات.'
      : 'ماقدرتش أكتب الرسالة في الشات.';
  }

  return posted
    ? 'Done. I posted it in the chat.'
    : 'I could not post that message in the chat.';
}

function mergeTranscript(current: string, incoming: string): string {
  const clean = incoming.trim();
  if (!clean) return current;
  if (!current) return clean;
  if (clean.startsWith(current)) return clean;
  if (current.endsWith(clean)) return current;
  return `${current} ${clean}`.trim();
}

function languageSystemInstruction(language: ChatResponseLanguage): string {
  const base = [
    'You are TD AI participating naturally in a GROUP Discord voice channel.',
    'Multiple different human speakers may talk to you during the same session.',
    'Answer the person who is currently speaking; do not assume consecutive turns belong to the same person.',
    'Every human in the connected voice channel is allowed to ask you questions unless the session is configured as owner-only.',
    'Be smart, practical, context-aware and conversational.',
    'Reply quickly. Prefer one to three short sentences unless the current speaker asks for detail.',
    'Do not announce internal processing steps.',
    'If a human starts speaking while you are talking, stop and listen.',
    'If a speaker explicitly asks you to write, send, or post a message in the Discord voice-channel text chat, the host runtime can perform that action.',
    'When the speaker asks for a chat post, acknowledge briefly and do not say that you cannot access the chat.',
    'Never claim you performed an external action unless you actually did.'
  ];
  switch (language) {
    case 'ar-eg': base.push('Always answer in natural Egyptian Arabic unless the user explicitly asks for another language.'); break;
    case 'ar-msa': base.push('Always answer in clear Modern Standard Arabic unless the user explicitly asks for another language.'); break;
    case 'en': base.push('Answer in English unless the user explicitly asks for another language.'); break;
    case 'fa': base.push('Answer in natural Persian (Farsi) unless the user explicitly asks for another language.'); break;
    default: base.push('Automatically follow the language the user is currently speaking. If they switch language, switch naturally.');
  }
  return base.join(' ');
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

function stopPlayback(session: VoiceAiSession): void {
  const stream = session.outputStream;
  session.outputStream = undefined;
  if (stream) { stream.removeAllListeners(); stream.destroy(); }
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

function handleLiveMessage(session: VoiceAiSession, message: LiveServerMessage): void {
  const content = message.serverContent;
  if (!content) return;
  if (content.interrupted) { stopPlayback(session); session.busy = false; }
  const inputText = content.inputTranscription?.text?.trim();
  if (inputText) session.inputTranscript = mergeTranscript(session.inputTranscript, inputText);
  const outputText = content.outputTranscription?.text?.trim();
  if (outputText) session.outputTranscript = outputText;

  for (const part of content.modelTurn?.parts ?? []) {
    const data = part.inlineData?.data;
    if (!data) continue;
    session.busy = true;
    const pcm24 = Buffer.from(data, 'base64');
    if (pcm24.byteLength) ensureLivePlayback(session).write(geminiPcm24MonoToDiscord48Stereo(pcm24));
  }

  if (content.turnComplete) {
    const spokenText = session.inputTranscript.trim();
    const speakerId = session.lastSpeakerId ?? session.userId;

    if (spokenText) {
      void handleVoiceTextAction(session, spokenText, speakerId).then((action) => {
        if (action.handled && !action.posted) {
          void notifyUser(
            session.userId,
            `❌ **Voice -> Chat:** ${action.error ?? 'Could not send the message.'}`
          );
        }
      });
    }

    finishLivePlayback(session);
    session.busy = false;
    session.turns += 1;
  }
}

async function connectGeminiLive(session: VoiceAiSession): Promise<void> {
  const route = await getGeminiTaskRoute('voice_live');
  const voice = await getVoiceRuntimeSettings();
  const ai = new GoogleGenAI({ apiKey: route.apiKey });

  const live = await ai.live.connect({
    model: route.model,
    callbacks: {
      onopen: () => console.log(`Gemini Live connected for guild ${session.guildId} via ${route.providerName}/${route.model}.`),
      onmessage: (message) => {
        try { handleLiveMessage(session, message); }
        catch (error) { console.error('Gemini Live message handling error:', error); }
      },
      onerror: (event) => {
        console.error('Gemini Live socket error:', event.message);
        void notifyUser(session.userId, `❌ **TD AI Live Voice:** ${event.message || 'Live API socket error.'}`);
      },
      onclose: (event) => console.log(`Gemini Live closed (${event.code}): ${event.reason}`)
    },
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: { parts: [{ text: languageSystemInstruction(session.language) }] },
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice.liveVoice } } },
      thinkingConfig: { thinkingLevel: thinkingLevel(voice.thinkingLevel) },
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

function attachLiveReceiver(session: VoiceAiSession): void {
  const receiver = session.connection.receiver;
  receiver.speaking.on('start', (speakerId) => {
    const current = sessions.get(session.guildId);
    if (!current || current !== session || !session.live || !canListenToSpeaker(session, speakerId)) return;

    // One spoken turn is processed at a time. Everyone in the channel can take
    // the next turn; overlapping speech is ignored until the active speaker
    // finishes so two PCM streams are never mixed into one Gemini turn.
    if (session.capturing && session.activeSpeakerId !== speakerId) return;
    if (session.capturing) return;

    if (session.player.state.status !== AudioPlayerStatus.Idle) stopPlayback(session);
    session.capturing = true;
    session.activeSpeakerId = speakerId;
    session.lastSpeakerId = speakerId;
    session.participantIds.add(speakerId);
    session.busy = false;
    session.inputTranscript = '';
    session.outputTranscript = '';

    const opusStream = receiver.subscribe(speakerId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: session.silenceMs }
    });
    const decoder = new OpusScript(48_000, 2, OpusScript.Application.AUDIO);
    let finalized = false;
    const timer = setTimeout(() => opusStream.destroy(), env.VOICE_AI_MAX_UTTERANCE_SECONDS * 1000);

    const finalize = () => {
      if (finalized) return;
      finalized = true;
      clearTimeout(timer);
      session.capturing = false;
      session.activeSpeakerId = undefined;
      try { decoder.delete(); } catch { /* no-op */ }
      try { session.live?.sendRealtimeInput({ audioStreamEnd: true }); session.busy = true; }
      catch (error) { console.error('Gemini Live audioStreamEnd error:', error); }
    };

    opusStream.on('data', (packet: Buffer) => {
      try {
        const pcm = discordPcm48StereoToGemini16Mono(Buffer.from(decoder.decode(packet)));
        if (!pcm.byteLength) return;
        session.live?.sendRealtimeInput({ audio: { data: pcm.toString('base64'), mimeType: 'audio/pcm;rate=16000' } });
      } catch (error) { console.error('Live voice decode/send error:', error); }
    });
    opusStream.once('end', finalize);
    opusStream.once('close', finalize);
    opusStream.once('error', (error) => { console.error('Live voice receive stream error:', error.message); finalize(); });
  });
}

function pcmToWav(pcm: Buffer, sampleRate = 48_000, channels = 2): Uint8Array<ArrayBufferLike> {
  const header = Buffer.alloc(44);
  const dataSize = pcm.byteLength;
  const blockAlign = channels * 2;
  const byteRate = sampleRate * blockAlign;
  header.write('RIFF', 0); header.writeUInt32LE(36 + dataSize, 4); header.write('WAVE', 8); header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22); header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28); header.writeUInt16LE(blockAlign, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(dataSize, 40);
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

async function processCascadeUtterance(session: VoiceAiSession, chunks: Buffer[]): Promise<void> {
  if (!chunks.length) return;
  const pcm = Buffer.concat(chunks);
  if (pcm.byteLength < 24_000) return;
  session.busy = true;
  try {
    const transcript = await transcribeAudioBytes(pcmToWav(pcm), 'td-ai-voice.wav', 'audio/wav');
    const textAction = await handleVoiceTextAction(
      session,
      transcript.text,
      session.lastSpeakerId ?? session.userId
    );
    const reply = textAction.handled
      ? voiceTextActionReply(transcript.text, textAction.posted)
      : await askAiChat(session.history, transcript.text, session.language, env.VOICE_AI_MODEL ?? env.AI_MODEL);
    session.inputTranscript = transcript.text;
    session.outputTranscript = reply;
    session.history = trimHistory([...session.history, { role: 'user', content: transcript.text }, { role: 'assistant', content: reply }]);
    const audio = await generateGeminiSpeech(reply, inferSpeechLanguage(reply, session.language));
    const stream = new PassThrough(); stream.end(Buffer.from(audio.data));
    session.player.play(createAudioResource(stream, { inputType: StreamType.Arbitrary }));
    await entersState(session.player, AudioPlayerStatus.Playing, 15_000);
    await entersState(session.player, AudioPlayerStatus.Idle, 180_000);
    session.turns += 1;
  } catch (error) {
    console.error('Cascade Voice AI error:', error);
    await notifyUser(session.userId, `❌ **TD AI Voice:** ${errorMessage(error)}`);
  } finally { session.busy = false; }
}

function attachCascadeReceiver(session: VoiceAiSession): void {
  const receiver = session.connection.receiver;
  receiver.speaking.on('start', (speakerId) => {
    const current = sessions.get(session.guildId);
    if (!current || current !== session || !canListenToSpeaker(session, speakerId) || session.busy || session.capturing) return;
    session.capturing = true;
    session.activeSpeakerId = speakerId;
    session.lastSpeakerId = speakerId;
    session.participantIds.add(speakerId);
    const opusStream = receiver.subscribe(speakerId, { end: { behavior: EndBehaviorType.AfterSilence, duration: session.silenceMs } });
    const decoder = new OpusScript(48_000, 2, OpusScript.Application.AUDIO);
    const chunks: Buffer[] = [];
    let finalized = false;
    const timer = setTimeout(() => opusStream.destroy(), env.VOICE_AI_MAX_UTTERANCE_SECONDS * 1000);
    const finalize = () => {
      if (finalized) return; finalized = true; clearTimeout(timer); session.capturing = false; session.activeSpeakerId = undefined;
      try { decoder.delete(); } catch { /* no-op */ }
      void processCascadeUtterance(session, chunks);
    };
    opusStream.on('data', (packet: Buffer) => {
      try { const decoded = decoder.decode(packet); if (decoded?.byteLength) chunks.push(Buffer.from(decoded)); }
      catch (error) { console.error('Cascade Opus decode error:', error); }
    });
    opusStream.once('end', finalize); opusStream.once('close', finalize);
    opusStream.once('error', (error) => { console.error('Cascade receive stream error:', error.message); finalize(); });
  });
}

export function voiceAiConfigured(): boolean {
  if (!env.DISCORD_BOT_TOKEN) return false;
  if (env.VOICE_AI_MODE === 'live') return Boolean(env.GEMINI_LIVE_API_KEY ?? env.AI_API_KEY);
  return Boolean(env.AI_API_URL && env.AI_API_KEY && env.AI_MODEL && sttConfigured() && geminiTtsConfigured());
}

export async function joinVoiceAi(
  guildId: string,
  userId: string,
  language: ChatResponseLanguage = 'auto'
): Promise<{ channelName: string; mode: VoiceMode }> {
  await waitForGatewayReady();
  const client = getGatewayClient();
  const guild = await client.guilds.fetch(guildId);
  const channel = guild.voiceStates.cache.get(userId)?.channel as VoiceBasedChannel | null | undefined;
  if (!channel) throw new Error('Join a Discord voice channel first, then run `/voicechat join`.');

  const existing = sessions.get(guildId);
  if (existing) { stopPlayback(existing); existing.live?.close(); existing.connection.destroy(); sessions.delete(guildId); }

  const connection = joinVoiceChannel({ channelId: channel.id, guildId, adapterCreator: guild.voiceAdapterCreator, selfDeaf: false, selfMute: false, daveEncryption: true });
  await entersState(connection, VoiceConnectionStatus.Ready, 25_000);
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  connection.subscribe(player);
  player.on('error', (error) => console.error('Voice player error:', error.message));

  const runtimeVoice = await getVoiceRuntimeSettings();
  const session: VoiceAiSession = {
    guildId, channelId: channel.id, userId, language, mode: env.VOICE_AI_MODE, connection, player,
    inputTranscript: '', outputTranscript: '', turns: 0, history: [], busy: false, capturing: false,
    startedAt: Date.now(), silenceMs: runtimeVoice.silenceMs, speakerAccess: runtimeVoice.speakerAccess,
    participantIds: new Set<string>()
  };
  sessions.set(guildId, session);

  try {
    if (session.mode === 'live') { await connectGeminiLive(session); attachLiveReceiver(session); }
    else attachCascadeReceiver(session);
  } catch (error) {
    sessions.delete(guildId); stopPlayback(session); session.live?.close(); session.connection.destroy(); throw error;
  }

  connection.on('stateChange', (_oldState, newState) => {
    if (newState.status !== VoiceConnectionStatus.Destroyed) return;
    const current = sessions.get(guildId);
    if (current === session) { sessions.delete(guildId); session.live?.close(); stopPlayback(session); }
  });

  return { channelName: channel.name, mode: session.mode };
}

export function leaveVoiceAi(guildId: string, requesterId?: string): boolean {
  const session = sessions.get(guildId);
  if (!session) return false;
  if (requesterId && requesterId !== session.userId) throw new Error('Only the user who started this voice session can close it.');
  sessions.delete(guildId); stopPlayback(session); session.live?.close(); session.history = []; session.connection.destroy();
  return true;
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
    turns: session.turns * 2,
    mode: session.mode,
    inputTranscript: session.inputTranscript || undefined,
    outputTranscript: session.outputTranscript || undefined,
    silenceMs: session.silenceMs,
    speakerAccess: session.speakerAccess,
    activeSpeakerId: session.activeSpeakerId,
    participantCount: session.participantIds.size
  };
}
