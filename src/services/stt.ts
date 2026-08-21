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

async function callStt(
  bytes: ArrayBuffer | Uint8Array<ArrayBufferLike>,
  filename: string,
  contentType: string
): Promise<TranscriptionResult> {
  const size = bytes instanceof ArrayBuffer ? bytes.byteLength : bytes.byteLength;
  if (size > env.MAX_AUDIO_BYTES) {
    throw new Error(`Audio is too large. Maximum is ${Math.floor(env.MAX_AUDIO_BYTES / 1024 / 1024)} MB.`);
  }

  if (!env.STT_URL || !env.STT_API_KEY) {
    throw new Error('Speech-to-text is not configured yet. Add the STT service first.');
  }

  const form = new FormData();
  const data = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : Uint8Array.from(bytes);
  form.set('file', new Blob([data], { type: contentType }), filename);

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

  const result = (await response.json()) as TranscriptionResult;
  if (!result.text?.trim()) throw new Error('No speech was detected in the audio.');
  return { text: result.text.trim(), language: result.language };
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

  const audioResponse = await fetch(attachment.url, { signal: AbortSignal.timeout(20_000) });
  if (!audioResponse.ok) throw new Error('Could not download the Discord audio attachment.');

  const bytes = await audioResponse.arrayBuffer();
  const type = attachment.content_type ?? 'application/octet-stream';
  return callStt(bytes, attachment.filename, type);
}
