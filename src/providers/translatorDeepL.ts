import { env } from '../config.js';
import { providerLanguageCode } from '../languages.js';
import type { TranslationResult } from './translator.js';

export async function translateDeepL(text: string, target: string, source = 'auto'): Promise<TranslationResult> {
  if (!env.DEEPL_API_KEY) throw new Error('DEEPL_API_KEY is missing.');

  const body = new URLSearchParams();
  body.set('text', text);
  body.set('target_lang', providerLanguageCode(target).replace('-', '_').toUpperCase());
  if (source !== 'auto') {
    body.set('source_lang', providerLanguageCode(source).replace('-', '_').toUpperCase());
  }

  const response = await fetch(env.DEEPL_API_URL, {
    method: 'POST',
    headers: {
      authorization: `DeepL-Auth-Key ${env.DEEPL_API_KEY}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body,
    signal: AbortSignal.timeout(20_000)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`DeepL error ${response.status}: ${errorBody.slice(0, 250)}`);
  }

  const data = (await response.json()) as {
    translations?: Array<{ text?: string; detected_source_language?: string }>;
  };
  const item = data.translations?.[0];
  if (!item?.text) throw new Error('DeepL returned no translation.');

  return {
    text: item.text,
    detectedSourceLanguage: item.detected_source_language?.toLowerCase() ?? (source !== 'auto' ? source : undefined)
  };
}
