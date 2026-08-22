import { env } from '../config.js';
import type { DiscordAttachment } from '../types.js';
import { getGeminiTaskRoute } from './runtimeConfig.js';
import { currentUsageUserId } from './usageContext.js';
import { recordUsage } from './billingStore.js';

export type TranscriptionResult = {
  text: string;
  language?: string;
};

function looksLikeAudio(attachment: DiscordAttachment): boolean {
  if (attachment.content_type?.startsWith('audio/')) return true;
  return /\.(ogg|oga|opus|mp3|m4a|wav|webm|aac|flac)$/i.test(attachment.filename);
}

export function sttConfigured(): boolean {
  const service = Boolean(env.STT_URL && env.STT_API_KEY);
  const gemini = Boolean(
    env.GEMINI_STT_API_KEY ??
    env.GEMINI_TTS_API_KEY ??
    env.AI_API_KEY
  );

  if (env.STT_PROVIDER === 'service') return service;
  if (env.STT_PROVIDER === 'gemini') return gemini;
  return service || gemini;
}

async function meterStt(bytes: ArrayBuffer | Uint8Array<ArrayBufferLike>): Promise<void> {
  const size = bytes.byteLength;
  // Product credits only. Compressed formats vary, so use a conservative size-based approximation.
  const credits = Math.max(1, Math.ceil(size / 48_000) * 4);
  await recordUsage(currentUsageUserId(), 'stt', credits).catch(() => undefined);
}

async function callSttService(
  bytes: ArrayBuffer | Uint8Array<ArrayBufferLike>,
  filename: string,
  contentType: string
): Promise<TranscriptionResult> {
  if (!env.STT_URL || !env.STT_API_KEY) {
    throw new Error('STT service is not configured.');
  }

  const data = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : Uint8Array.from(bytes);
  const form = new FormData();
  form.set('file', new Blob([data], { type: contentType }), filename);

  const response = await fetch(`${env.STT_URL.replace(/\/$/, '')}/transcribe`, {
    method: 'POST',
    headers: { 'x-api-key': env.STT_API_KEY },
    body: form,
    signal: AbortSignal.timeout(120_000)
  });

  if (!response.ok) {
    throw new Error(`STT service ${response.status}: ${(await response.text()).slice(0, 250)}`);
  }

  const result = (await response.json()) as TranscriptionResult;
  if (!result.text?.trim()) throw new Error('No speech was detected in the audio.');
  await meterStt(bytes);
  return { text: result.text.trim(), language: result.language };
}

function cleanJsonCandidate(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

async function callGeminiStt(
  bytes: ArrayBuffer | Uint8Array<ArrayBufferLike>,
  contentType: string
): Promise<TranscriptionResult> {
  const route = await getGeminiTaskRoute('stt');
  const data = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : Uint8Array.from(bytes);
  const base64 = Buffer.from(data).toString('base64');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(route.model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': route.apiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            {
              text: 'Transcribe the spoken audio accurately. This audio may be extremely short and may contain only a wake phrase such as "TD", "TD AI", "تي دي", "تيدي", or "يا تي دي". Do not summarize, translate, explain, or answer it. Preserve the speaker language and wording. If human speech is audible, return the closest faithful transcription instead of an empty string. Return JSON only with keys "text" and "language". The language value should be a short code such as en, fa, ar-eg, ar-msa, fr, de, es, etc.'
            },
            {
              inlineData: {
                mimeType: contentType || 'audio/wav',
                data: base64
              }
            }
          ]
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              text: { type: 'STRING' },
              language: { type: 'STRING' }
            },
            required: ['text', 'language']
          }
        }
      }),
      signal: AbortSignal.timeout(120_000)
    }
  );

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Gemini STT ${response.status}: ${raw.slice(0, 300)}`);
  }

  const parsed = JSON.parse(raw) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  const output = parsed.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? '')
    .join('')
    .trim();

  if (!output) throw new Error('Gemini STT returned an empty transcript.');

  const result = JSON.parse(cleanJsonCandidate(output)) as {
    text?: string;
    language?: string;
  };

  if (!result.text?.trim()) {
    throw new Error(
      'Gemini STT detected no speech; Live audio fallback should be used.'
    );
  }
  await meterStt(bytes);

  return {
    text: result.text.trim(),
    language: result.language?.trim() || undefined
  };
}

async function callStt(
  bytes: ArrayBuffer | Uint8Array<ArrayBufferLike>,
  filename: string,
  contentType: string
): Promise<TranscriptionResult> {
  const size = bytes.byteLength;

  if (size > env.MAX_AUDIO_BYTES) {
    throw new Error(
      `Audio is too large. Maximum is ${Math.floor(env.MAX_AUDIO_BYTES / 1024 / 1024)} MB.`
    );
  }

  if (!sttConfigured()) throw new Error('Speech-to-text is not configured.');
  if (env.STT_PROVIDER === 'service') return callSttService(bytes, filename, contentType);
  if (env.STT_PROVIDER === 'gemini') return callGeminiStt(bytes, contentType);

  if (env.STT_URL && env.STT_API_KEY) {
    try {
      return await callSttService(bytes, filename, contentType);
    } catch (error) {
      console.warn(
        'STT service failed; trying Gemini fallback:',
        error instanceof Error ? error.message : error
      );
    }
  }

  return callGeminiStt(bytes, contentType);
}

export async function transcribeAudioBytes(
  bytes: Uint8Array<ArrayBufferLike>,
  filename = 'voice.wav',
  contentType = 'audio/wav'
) {
  return callStt(bytes, filename, contentType);
}

export async function transcribeDiscordAttachment(
  attachment: DiscordAttachment
): Promise<TranscriptionResult> {
  if (!looksLikeAudio(attachment)) {
    throw new Error('The selected attachment is not an audio file.');
  }

  if ((attachment.size ?? 0) > env.MAX_AUDIO_BYTES) {
    throw new Error(
      `Audio is too large. Maximum is ${Math.floor(env.MAX_AUDIO_BYTES / 1024 / 1024)} MB.`
    );
  }

  const audioResponse = await fetch(attachment.url, {
    signal: AbortSignal.timeout(20_000)
  });

  if (!audioResponse.ok) {
    throw new Error(`Could not download the Discord audio attachment (${audioResponse.status}).`);
  }

  return callStt(
    await audioResponse.arrayBuffer(),
    attachment.filename,
    attachment.content_type ?? 'application/octet-stream'
  );
}
