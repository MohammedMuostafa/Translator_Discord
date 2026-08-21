import { env } from '../config.js';
import { languageInstruction, normalizeLanguage } from '../languages.js';

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

type CollectedAudio = {
  data: Buffer;
  mimeType: string;
  sampleRate: number;
  channels: number;
};

function geminiTtsKey(): string | undefined {
  return env.GEMINI_TTS_API_KEY ?? env.AI_API_KEY;
}

export function geminiTtsConfigured(): boolean {
  return Boolean(geminiTtsKey() && env.GEMINI_TTS_MODEL && env.GEMINI_TTS_VOICE);
}

function pronunciationInstruction(language: string): string {
  const normalized = normalizeLanguage(language, true);

  if (normalized === 'ar-eg') {
    return 'Read the text exactly in natural Egyptian Arabic with a clear conversational Egyptian accent. Keep English product names readable and natural. Do not translate, summarize, or paraphrase it.';
  }

  if (normalized === 'ar-msa') {
    return 'Read the text exactly in clear Modern Standard Arabic with natural neutral Arabic pronunciation. Keep English product names readable and natural. Do not translate, summarize, or paraphrase it.';
  }

  if (normalized === 'fa') {
    return 'Read the text exactly in natural Persian (Farsi) with clear pronunciation. Do not translate, summarize, or paraphrase it.';
  }

  return `Read the text exactly in ${languageInstruction(language)} with clear natural pronunciation. Do not translate, summarize, or paraphrase it.`;
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

function splitForSpeech(text: string, maxChars: number): string[] {
  const clean = text.trim();
  if (clean.length <= maxChars) return [clean];

  const chunks: string[] = [];
  let remaining = clean;

  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars + 1);
    const candidates = [
      window.lastIndexOf('\n\n'),
      window.lastIndexOf('. '),
      window.lastIndexOf('؟ '),
      window.lastIndexOf('! '),
      window.lastIndexOf('، '),
      window.lastIndexOf('\n'),
      window.lastIndexOf(' ')
    ];

    let splitAt = Math.max(...candidates);
    if (splitAt < Math.floor(maxChars * 0.45)) splitAt = maxChars;

    const part = remaining.slice(0, splitAt).trim();
    if (part) chunks.push(part);
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
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

async function requestAudioStream(
  input: string,
  forceL16: boolean
): Promise<CollectedAudio> {
  const apiKey = geminiTtsKey();
  if (!apiKey) throw new Error('Gemini TTS API key is missing.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.TTS_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'content-type': 'application/json',
        'accept': 'text/event-stream',
        'Api-Revision': '2026-05-20'
      },
      body: JSON.stringify({
        model: env.GEMINI_TTS_MODEL,
        input,
        response_format: forceL16
          ? {
              type: 'audio',
              mime_type: 'audio/l16',
              sample_rate: 24000,
              delivery: 'inline'
            }
          : { type: 'audio' },
        generation_config: {
          speech_config: [{ voice: env.GEMINI_TTS_VOICE }]
        },
        stream: true
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text();
      const error = new Error(`Gemini TTS error ${response.status}: ${body.slice(0, 500)}`);
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }

    if (!response.body) throw new Error('Gemini TTS returned an empty streaming response.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    const chunks: Buffer[] = [];
    let mimeType = forceL16 ? 'audio/l16' : 'audio/l16';
    let sampleRate = 24_000;
    let channels = 1;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';

      for (const line of lines) {
        const event = parseSseLine(line);
        const delta = event?.delta;
        if (event?.event_type !== 'step.delta' || delta?.type !== 'audio' || !delta.data) continue;

        chunks.push(Buffer.from(delta.data, 'base64'));
        mimeType = delta.mime_type ?? mimeType;
        sampleRate = delta.sample_rate ?? sampleRate;
        channels = delta.channels ?? channels;
      }
    }

    if (pending.trim()) {
      const event = parseSseLine(pending);
      const delta = event?.delta;
      if (event?.event_type === 'step.delta' && delta?.type === 'audio' && delta.data) {
        chunks.push(Buffer.from(delta.data, 'base64'));
        mimeType = delta.mime_type ?? mimeType;
        sampleRate = delta.sample_rate ?? sampleRate;
        channels = delta.channels ?? channels;
      }
    }

    if (chunks.length === 0) throw new Error('Gemini TTS returned no audio chunks.');

    return {
      data: Buffer.concat(chunks),
      mimeType,
      sampleRate,
      channels
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Gemini TTS took too long. Try a shorter selection or try again in a moment.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function generateChunk(text: string, language: string): Promise<CollectedAudio> {
  const input = `${pronunciationInstruction(language)}\n\nText to read:\n${text}`;

  try {
    return await requestAudioStream(input, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    // Compatibility fallback for deployments/models that reject explicit audio format.
    if (message.includes('400') && /mime_type|response_format|invalid_request/i.test(message)) {
      return requestAudioStream(input, false);
    }
    throw error;
  }
}

export async function generateGeminiSpeech(text: string, language: string): Promise<GeneratedSpeech> {
  const apiKey = geminiTtsKey();
  if (!apiKey) {
    throw new Error('Listening is not configured. Set GEMINI_TTS_API_KEY, or use the same Gemini key in AI_API_KEY.');
  }

  const cleanText = text.trim();
  if (!cleanText) throw new Error('There is no text to read aloud.');
  if (cleanText.length > env.TTS_MAX_CHARS) {
    throw new Error(`This text is too long for Listen. Maximum: ${env.TTS_MAX_CHARS.toLocaleString()} characters.`);
  }

  const parts = splitForSpeech(cleanText, env.TTS_CHUNK_CHARS);
  const generated: CollectedAudio[] = [];

  // Sequential generation avoids burst-rate limits and is more stable on Railway.
  for (const part of parts) {
    generated.push(await generateChunk(part, language));
  }

  const first = generated[0];
  if (!first) throw new Error('Gemini TTS returned no audio.');

  // The current Gemini TTS stream normally returns L16. Concatenate raw PCM
  // chunks and wrap them once as a valid WAV file for Discord playback.
  const allL16 = generated.every((item) => item.mimeType === 'audio/l16');
  const sameFormat = generated.every(
    (item) => item.sampleRate === first.sampleRate && item.channels === first.channels
  );

  if (allL16 && sameFormat) {
    const pcm = Buffer.concat(generated.map((item) => item.data));
    return {
      filename: 'td-ai-listen.wav',
      contentType: 'audio/wav',
      data: pcm16ToWav(pcm, first.sampleRate, first.channels)
    };
  }

  // Compressed audio cannot safely be byte-concatenated. For a single chunk,
  // return it directly; multi-chunk responses should normally take the L16 path.
  if (generated.length === 1) {
    const mime = first.mimeType;
    if (mime === 'audio/mp3' || mime === 'audio/mpeg') {
      return { filename: 'td-ai-listen.mp3', contentType: 'audio/mpeg', data: first.data };
    }
    if (mime === 'audio/wav') {
      return { filename: 'td-ai-listen.wav', contentType: 'audio/wav', data: first.data };
    }
    if (mime === 'audio/ogg' || mime === 'audio/ogg_opus' || mime === 'audio/opus') {
      return { filename: 'td-ai-listen.ogg', contentType: 'audio/ogg', data: first.data };
    }
  }

  throw new Error('Gemini returned incompatible audio chunks. Please try Listen again.');
}
