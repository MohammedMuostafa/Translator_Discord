import { env } from '../config.js';
import { languageInstruction, normalizeLanguage } from '../languages.js';
import { getGeminiTaskRoute, getVoiceRuntimeSettings } from './runtimeConfig.js';
import { getVoiceControlSettings } from './voiceControl.js';
import { currentUsageUserId } from './usageContext.js';
import { estimateAudioCredits, recordUsage } from './billingStore.js';

export type GeneratedSpeech = {
  filename: string;
  contentType: string;
  data: Uint8Array<ArrayBufferLike>;
};

type StreamAudioDelta = {
  type?: string;
  data?: string;
  mime_type?: string;
  sample_rate?: number;
  channels?: number;
};

type StreamEvent = {
  event_type?: string;
  delta?: StreamAudioDelta;
};

export function geminiTtsConfigured(): boolean {
  return Boolean(
    (env.GEMINI_TTS_API_KEY ?? env.AI_API_KEY) &&
    env.GEMINI_TTS_MODEL &&
    env.GEMINI_TTS_VOICE
  );
}

function pronunciationInstruction(language: string, humanLike: boolean): string {
  const normalized = normalizeLanguage(language, true);
  const delivery = humanLike
    ? 'Sound warm, human, conversational and natural. Avoid robotic pacing. Use natural pauses and emphasis while preserving the text exactly.'
    : 'Use clear neutral pacing and preserve the text exactly.';

  if (normalized === 'ar-eg') {
    return `Read the text exactly in natural Egyptian Arabic with a clear conversational Egyptian accent. Keep English names readable. Do not translate, summarize, or paraphrase it. ${delivery}`;
  }

  if (normalized === 'ar-msa') {
    return `Read the text exactly in clear Modern Standard Arabic with natural neutral Arabic pronunciation. Keep English names readable. Do not translate, summarize, or paraphrase it. ${delivery}`;
  }

  if (normalized === 'fa') {
    return `Read the text exactly in natural Persian (Farsi) with clear pronunciation. Do not translate, summarize, or paraphrase it. ${delivery}`;
  }

  return `Read the text exactly in ${languageInstruction(language)} with clear natural pronunciation. Do not translate, summarize, or paraphrase it. ${delivery}`;
}

function pcm16ToWav(
  pcm: Uint8Array<ArrayBufferLike>,
  sampleRate = 24_000,
  channels = 1
): Uint8Array<ArrayBufferLike> {
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

  return new Uint8Array(Buffer.concat([header, Buffer.from(pcm)]));
}

function parseSseLine(line: string): StreamEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return undefined;
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === '[DONE]') return undefined;

  try {
    return JSON.parse(payload) as StreamEvent;
  } catch {
    return undefined;
  }
}

function audioFileInfo(mimeType: string) {
  switch (mimeType) {
    case 'audio/mp3':
    case 'audio/mpeg':
      return { filename: 'td-ai-listen.mp3', contentType: 'audio/mpeg' };
    case 'audio/ogg':
    case 'audio/ogg_opus':
    case 'audio/opus':
      return { filename: 'td-ai-listen.ogg', contentType: 'audio/ogg' };
    case 'audio/aac':
      return { filename: 'td-ai-listen.aac', contentType: 'audio/aac' };
    case 'audio/flac':
      return { filename: 'td-ai-listen.flac', contentType: 'audio/flac' };
    case 'audio/m4a':
      return { filename: 'td-ai-listen.m4a', contentType: 'audio/mp4' };
    default:
      return { filename: 'td-ai-listen.wav', contentType: 'audio/wav' };
  }
}

export async function generateGeminiSpeech(
  text: string,
  language: string
): Promise<GeneratedSpeech> {
  const route = await getGeminiTaskRoute('tts');
  const voice = await getVoiceRuntimeSettings();
  const control = await getVoiceControlSettings();
  const cleanText = text.trim();

  if (!cleanText) throw new Error('There is no text to read aloud.');
  if (cleanText.length > env.TTS_MAX_CHARS) {
    throw new Error(
      `This text is too long for Listen. Maximum: ${env.TTS_MAX_CHARS.toLocaleString()} characters.`
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.TTS_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/interactions',
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': route.apiKey,
          'content-type': 'application/json',
          accept: 'text/event-stream',
          'Api-Revision': '2026-05-20'
        },
        body: JSON.stringify({
          model: route.model,
          input: `${pronunciationInstruction(language, control.humanLikeMode)}\n\nText to read:\n${cleanText}`,
          response_format: { type: 'audio' },
          generation_config: {
            speech_config: [{ voice: voice.ttsVoice }]
          },
          stream: true
        }),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error(
        `Gemini TTS error ${response.status}: ${(await response.text()).slice(0, 500)}`
      );
    }

    if (!response.body) {
      throw new Error('Gemini TTS returned an empty streaming response.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    const chunks: Buffer[] = [];
    let mimeType = 'audio/l16';
    let sampleRate = 24_000;
    let channels = 1;

    const consume = (line: string) => {
      const event = parseSseLine(line);
      const delta = event?.delta;
      if (event?.event_type !== 'step.delta' || delta?.type !== 'audio' || !delta.data) return;
      chunks.push(Buffer.from(delta.data, 'base64'));
      mimeType = delta.mime_type ?? mimeType;
      sampleRate = delta.sample_rate ?? sampleRate;
      channels = delta.channels ?? channels;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) consume(line);
    }

    if (pending.trim()) consume(pending);
    if (!chunks.length) throw new Error('Gemini TTS returned no audio chunks.');

    const data = Buffer.concat(chunks);
    const approximateSeconds = mimeType === 'audio/l16'
      ? data.byteLength / Math.max(1, sampleRate * channels * 2)
      : Math.max(0.5, cleanText.length / 14);

    await recordUsage(
      currentUsageUserId(),
      'tts',
      estimateAudioCredits(approximateSeconds, 5)
    ).catch(() => undefined);

    if (mimeType === 'audio/l16') {
      return {
        filename: 'td-ai-listen.wav',
        contentType: 'audio/wav',
        data: pcm16ToWav(data, sampleRate, channels)
      };
    }

    return {
      ...audioFileInfo(mimeType),
      data: new Uint8Array(data)
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Gemini TTS took too long. Try again or use a shorter selection.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
