import { env } from '../config.js';
import { languageInstruction, normalizeLanguage } from '../languages.js';
import {
  getGeminiTaskRoute,
  getVoiceRuntimeSettings,
  parseModelChain
} from './runtimeConfig.js';
import { getVoiceControlSettings } from './voiceControl.js';
import { currentUsageUserId } from './usageContext.js';
import { getUserPersonalization } from './userPersonalization.js';
import { estimateAudioCredits, recordUsage } from './billingStore.js';

export type GeneratedSpeech = {
  filename: string;
  contentType: string;
  data: Uint8Array<ArrayBufferLike>;
  model?: string;
};

export function geminiTtsConfigured(): boolean {
  return Boolean(
    env.GEMINI_TTS_API_KEY ??
    env.GEMINI_LIVE_API_KEY ??
    env.AI_API_KEY
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

function statusOf(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'status' in error) {
    const value = Number((error as { status?: unknown }).status);
    if (Number.isFinite(value)) return value;
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/(?:^|\D)(4\d\d|5\d\d)(?:\D|$)/);
  return match?.[1] ? Number(match[1]) : undefined;
}

function extractAudio(raw: string): {
  data: Buffer;
  mimeType: string;
} | undefined {
  const parsed = JSON.parse(raw) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: {
            data?: string;
            mimeType?: string;
          };
        }>;
      };
    }>;
  };

  for (const candidate of parsed.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.inlineData?.data) {
        return {
          data: Buffer.from(part.inlineData.data, 'base64'),
          mimeType: part.inlineData.mimeType ?? 'audio/L16;codec=pcm;rate=24000'
        };
      }
    }
  }

  return undefined;
}

async function requestSpeech(
  apiKey: string,
  model: string,
  text: string,
  voiceName: string
): Promise<{ data: Buffer; mimeType: string }> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text }]
        }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName
              }
            }
          }
        }
      }),
      signal: AbortSignal.timeout(env.TTS_REQUEST_TIMEOUT_MS)
    }
  );

  const raw = await response.text();
  if (!response.ok) {
    throw Object.assign(
      new Error(`Gemini TTS ${response.status}: ${raw.slice(0, 450)}`),
      { status: response.status }
    );
  }

  const audio = extractAudio(raw);
  if (!audio?.data.byteLength) {
    throw new Error(`${model} returned no audio data.`);
  }
  return audio;
}

export async function generateGeminiSpeech(
  text: string,
  language: string
): Promise<GeneratedSpeech> {
  const route = await getGeminiTaskRoute('tts');
  const voice = await getVoiceRuntimeSettings();
  const control = await getVoiceControlSettings();
  const usageUserId = currentUsageUserId();
  const personal = usageUserId
    ? await getUserPersonalization(usageUserId)
    : undefined;
  const selectedVoice = personal?.voiceName ?? voice.ttsVoice;
  const cleanText = text.trim();

  if (!cleanText) throw new Error('There is no text to read aloud.');
  if (cleanText.length > env.TTS_MAX_CHARS) {
    throw new Error(
      `This text is too long for Listen. Maximum: ${env.TTS_MAX_CHARS.toLocaleString()} characters.`
    );
  }

  const input = `${pronunciationInstruction(language, control.humanLikeMode)}\n\nText to read:\n${cleanText}`;
  const models = parseModelChain(route.model);
  const errors: string[] = [];

  for (const model of models) {
    try {
      const audio = await requestSpeech(
        route.apiKey,
        model,
        input,
        selectedVoice
      );

      const approximateSeconds = Math.max(0.5, audio.data.byteLength / (24_000 * 2));
      await recordUsage(
        usageUserId,
        'tts',
        estimateAudioCredits(approximateSeconds, 5)
      ).catch(() => undefined);

      // Gemini TTS generateContent returns raw PCM L16. Wrap it in WAV so
      // Discord/ffmpeg can decode it consistently.
      if (/audio\/(?:l16|pcm)/i.test(audio.mimeType)) {
        return {
          filename: 'td-ai-listen.wav',
          contentType: 'audio/wav',
          data: pcm16ToWav(audio.data),
          model
        };
      }

      const extension = audio.mimeType.includes('mpeg') ? 'mp3' : 'wav';
      return {
        filename: `td-ai-listen.${extension}`,
        contentType: audio.mimeType,
        data: new Uint8Array(audio.data),
        model
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = statusOf(error);
      errors.push(`${model}: ${message}`);
      console.warn(`TTS model failed (${model}); trying fallback.`, error);
      if (status === 401) break;
    }
  }

  if (errors.some((entry) => /429|RESOURCE_EXHAUSTED|quota/i.test(entry))) {
    throw new Error('Gemini TTS quota is temporarily exhausted. TD AI tried the configured TTS fallback models.');
  }

  if (errors.some((entry) => /AbortError|timeout|timed out|aborted/i.test(entry))) {
    throw new Error('Gemini TTS timed out after trying the configured fallback models. Try a shorter response.');
  }

  throw new Error(
    `Gemini TTS failed on all configured models. ${errors.slice(-2).join(' | ')}`
  );
}
