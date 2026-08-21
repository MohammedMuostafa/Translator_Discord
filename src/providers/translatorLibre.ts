import { env } from '../config.js';
import { providerLanguageCode } from '../languages.js';
import type { TranslationResult } from './translator.js';

export async function translateLibre(text: string, target: string, source = 'auto'): Promise<TranslationResult> {
  const response = await fetch(`${env.LIBRETRANSLATE_URL!.replace(/\/$/, '')}/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      q: text,
      source: source === 'auto' ? 'auto' : providerLanguageCode(source),
      target: providerLanguageCode(target),
      format: 'text',
      ...(env.LIBRETRANSLATE_API_KEY ? { api_key: env.LIBRETRANSLATE_API_KEY } : {})
    }),
    signal: AbortSignal.timeout(30_000)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LibreTranslate error ${response.status}: ${body.slice(0, 250)}`);
  }

  const data = (await response.json()) as {
    translatedText?: string;
    detectedLanguage?: { language?: string };
  };

  if (!data.translatedText) throw new Error('LibreTranslate returned no translation.');
  return {
    text: data.translatedText,
    detectedSourceLanguage: data.detectedLanguage?.language ?? (source !== 'auto' ? source : undefined)
  };
}
