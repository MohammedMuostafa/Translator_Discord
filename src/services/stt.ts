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

export async function transcribeDiscordAttachment(
  attachment: DiscordAttachment
): Promise<TranscriptionResult> {
  if (!looksLikeAudio(attachment)) throw new Error('The selected attachment is not an audio file.');
  if ((attachment.size ?? 0) > env.MAX_AUDIO_BYTES) {
    throw new Error(`Audio is too large. Maximum is ${Math.floor(env.MAX_AUDIO_BYTES / 1024 / 1024)} MB.`);
  }

  const audioResponse = await fetch(attachment.url, { signal: AbortSignal.timeout(20_000) });
  if (!audioResponse.ok) throw new Error('Could not download the Discord audio attachment.');

  const bytes = await audioResponse.arrayBuffer();
  if (bytes.byteLength > env.MAX_AUDIO_BYTES) throw new Error('Audio exceeds the configured size limit.');

  const form = new FormData();
  const type = attachment.content_type ?? 'application/octet-stream';
  form.set('file', new Blob([bytes], { type }), attachment.filename);

  if (!env.STT_URL || !env.STT_API_KEY) {
    throw new Error('Voice translation is not configured yet. Add the STT service first.');
  }

  const response = await fetch(`${env.STT_URL.replace(/\/$/, '')}/transcribe`, {
    method: 'POST',
    headers: { 'x-api-key': env.STT_API_KEY },
    body: form,
    signal: AbortSignal.timeout(120_000)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Speech-to-text error ${response.status}: ${errorBody.slice(0, 250)}`);
  }

  const data = (await response.json()) as TranscriptionResult;
  if (!data.text?.trim()) throw new Error('No speech was detected in the audio.');
  return { text: data.text.trim(), language: data.language };
}
