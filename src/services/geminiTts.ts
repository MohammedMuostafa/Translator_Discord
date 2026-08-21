import { env } from '../config.js';
import { languageInstruction, normalizeLanguage } from '../languages.js';

export type GeneratedSpeech = {
  filename: string;
  contentType: string;
  data: Uint8Array;
};

type AudioContent = {
  type?: string;
  data?: string;
  mime_type?: string;
  sample_rate?: number;
  channels?: number;
};

type InteractionResponse = {
  steps?: Array<{
    type?: string;
    content?: AudioContent[];
  }>;
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
    return 'Read the text exactly in natural Egyptian Arabic with a clear conversational Egyptian accent. Do not translate, summarize, or paraphrase it.';
  }
  if (normalized === 'ar-msa') {
    return 'Read the text exactly in clear Modern Standard Arabic with natural neutral Arabic pronunciation. Do not translate, summarize, or paraphrase it.';
  }
  if (normalized === 'fa') {
    return 'Read the text exactly in natural Persian (Farsi) with clear pronunciation. Do not translate, summarize, or paraphrase it.';
  }
  return `Read the text exactly in ${languageInstruction(language)} with clear natural pronunciation. Do not translate, summarize, or paraphrase it.`;
}

function pcm16ToWav(pcm: Uint8Array, sampleRate = 24_000, channels = 1): Uint8Array {
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

function looksLikeWav(data: Uint8Array): boolean {
  if (data.byteLength < 12) return false;
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE';
}

function findAudio(response: InteractionResponse): AudioContent | undefined {
  const steps = response.steps ?? [];
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const content = steps[i]?.content ?? [];
    for (let j = content.length - 1; j >= 0; j -= 1) {
      if (content[j]?.type === 'audio' && content[j]?.data) return content[j];
    }
  }
  return undefined;
}

export async function generateGeminiSpeech(text: string, language: string): Promise<GeneratedSpeech> {
  const apiKey = geminiTtsKey();
  if (!apiKey) {
    throw new Error('Listening is not configured. Set GEMINI_TTS_API_KEY, or use the same Gemini key in AI_API_KEY.');
  }

  const cleanText = text.trim();
  if (!cleanText) throw new Error('There is no translated text to read aloud.');
  if (cleanText.length > env.TTS_MAX_CHARS) {
    throw new Error(`This translation is too long for Listen. Maximum: ${env.TTS_MAX_CHARS} characters.`);
  }

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: env.GEMINI_TTS_MODEL,
      input: `${pronunciationInstruction(language)}\n\nText to read:\n${cleanText}`,
      response_format: {
        type: 'audio',
        mime_type: 'audio/mp3'
      },
      generation_config: {
        speech_config: [
          { voice: env.GEMINI_TTS_VOICE }
        ]
      }
    }),
    signal: AbortSignal.timeout(45_000)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini TTS error ${response.status}: ${body.slice(0, 300)}`);
  }

  const json = (await response.json()) as InteractionResponse;
  const audio = findAudio(json);
  if (!audio?.data) throw new Error('Gemini TTS returned no audio.');

  let data = new Uint8Array(Buffer.from(audio.data, 'base64'));
  const mime = audio.mime_type ?? 'audio/mp3';

  // Prefer compressed MP3 to keep Discord attachments small. If Gemini returns
  // PCM/L16 (or raw PCM labelled as WAV), normalize it to a playable WAV file.
  if (mime === 'audio/l16' || (mime === 'audio/wav' && !looksLikeWav(data))) {
    data = pcm16ToWav(data, audio.sample_rate ?? 24_000, audio.channels ?? 1);
    return { filename: 'translation.wav', contentType: 'audio/wav', data };
  }

  if (mime === 'audio/mp3' || mime === 'audio/mpeg') {
    return { filename: 'translation.mp3', contentType: 'audio/mpeg', data };
  }

  if (mime === 'audio/wav') {
    return { filename: 'translation.wav', contentType: 'audio/wav', data };
  }

  return { filename: 'translation-audio.bin', contentType: mime, data };
}
