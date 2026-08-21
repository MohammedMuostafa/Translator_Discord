import { env } from '../config.js';
import type { TranslationResult } from './translator.js';

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export async function translateGoogle(text: string, target: string): Promise<TranslationResult> {
  if (!env.GOOGLE_TRANSLATE_API_KEY) throw new Error('GOOGLE_TRANSLATE_API_KEY is missing.');

  const response = await fetch(
    `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(env.GOOGLE_TRANSLATE_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: text, target, format: 'text' }),
      signal: AbortSignal.timeout(20_000)
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Translate error ${response.status}: ${body.slice(0, 250)}`);
  }

  const data = (await response.json()) as {
    data?: { translations?: Array<{ translatedText?: string; detectedSourceLanguage?: string }> };
  };
  const item = data.data?.translations?.[0];
  if (!item?.translatedText) throw new Error('Google Translate returned no translation.');

  return {
    text: decodeHtml(item.translatedText),
    detectedSourceLanguage: item.detectedSourceLanguage
  };
}
