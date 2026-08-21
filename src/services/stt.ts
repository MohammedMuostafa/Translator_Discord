import { env } from '../config.js';
import type { DiscordAttachment } from '../types.js';

export type TranscriptionResult = {
  text: string;
  language?: string;
};

function looksLikeAudio(attachment: DiscordAttachment): boolean {
  if (attachment.content_type?.startsWith('audio/')) return true;
  return /\.(ogg|oga|opus|mp3|m4a|wav|webm|aac|flac)$/i.test(attachment.filename);
}

function geminiSttKey(): string | undefined {
  return env.GEMINI_STT_API_KEY ?? env.GEMINI_TTS_API_KEY ?? env.AI_API_KEY;
}

export function sttConfigured(): boolean {
  const service = Boolean(env.STT_URL && env.STT_API_KEY);
  const gemini = Boolean(geminiSttKey() && env.GEMINI_STT_MODEL);

  if (env.STT_PROVIDER === 'service') return service;
  if (env.STT_PROVIDER === 'gemini') return gemini;
  return service || gemini;
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
    const errorBody = await response.text();
    throw new Error(`STT service ${response.status}: ${errorBody.slice(0, 250)}`);
  }

  const result = (await response.json()) as TranscriptionResult;
  if (!result.text?.trim()) throw new Error('No speech was detected in the audio.');
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
  const apiKey = geminiSttKey();
  if (!apiKey) throw new Error('Gemini STT API key is not configured.');

  const data = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : Uint8Array.from(bytes);
  const base64 = Buffer.from(data).toString('base64');
  const model = env.GEMINI_STT_MODEL;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: [
                  'Transcribe the spoken audio accurately.',
                  'Do not summarize, translate, explain, or answer it.',
                  'Preserve the speaker language and wording.',
                  'Return JSON only with keys "text" and "language".',
                  'The language value should be a short code such as en, fa, ar-eg, ar-msa, fr, de, es, etc.'
                ].join(' ')
              },
              {
                inlineData: {
                  mimeType: contentType || 'audio/wav',
                  data: base64
                }
              }
            ]
          }
        ],
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

  if (!result.text?.trim()) throw new Error('Gemini STT detected no speech.');
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
  const size = bytes instanceof ArrayBuffer ? bytes.byteLength : bytes.byteLength;
  if (size > env.MAX_AUDIO_BYTES) {
    throw new Error(`Audio is too large. Maximum is ${Math.floor(env.MAX_AUDIO_BYTES / 1024 / 1024)} MB.`);
  }

  if (!sttConfigured()) {
    throw new Error(
      'Speech-to-text is not configured. Configure STT_URL/STT_API_KEY or Gemini STT.'
    );
  }

  if (env.STT_PROVIDER === 'service') {
    return callSttService(bytes, filename, contentType);
  }

  if (env.STT_PROVIDER === 'gemini') {
    return callGeminiStt(bytes, contentType);
  }

  // Auto: keep the private Whisper service as the first choice, but do not let
  // an unavailable Railway service kill the whole voice conversation.
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
): Promise<TranscriptionResult> {
  return callStt(bytes, filename, contentType);
}

export async function transcribeDiscordAttachment(
  attachment: DiscordAttachment
): Promise<TranscriptionResult> {
  if (!looksLikeAudio(attachment)) throw new Error('The selected attachment is not an audio file.');
  if ((attachment.size ?? 0) > env.MAX_AUDIO_BYTES) {
    throw new Error(`Audio is too large. Maximum is ${Math.floor(env.MAX_AUDIO_BYTES / 1024 / 1024)} MB.`);
  }

  const audioResponse = await fetch(attachment.url, {
    signal: AbortSignal.timeout(20_000)
  });

  if (!audioResponse.ok) {
    throw new Error(`Could not download the Discord audio attachment (${audioResponse.status}).`);
  }

  const bytes = await audioResponse.arrayBuffer();
  const type = attachment.content_type ?? 'application/octet-stream';
  return callStt(bytes, attachment.filename, type);
}
