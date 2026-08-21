import { env } from '../config.js';
import { translateDeepL } from './translatorDeepL.js';
import { translateGoogle } from './translatorGoogle.js';
import { translateLibre } from './translatorLibre.js';

export type TranslationResult = {
  text: string;
  detectedSourceLanguage?: string;
};

export function translationConfiguration(): { provider: string; configured: boolean } {
  switch (env.TRANSLATION_PROVIDER) {
    case 'google':
      return { provider: 'google', configured: Boolean(env.GOOGLE_TRANSLATE_API_KEY) };
    case 'deepl':
      return { provider: 'deepl', configured: Boolean(env.DEEPL_API_KEY) };
    case 'libretranslate':
      return { provider: 'libretranslate', configured: Boolean(env.LIBRETRANSLATE_URL) };
    default:
      throw new Error('Unsupported translation provider.');
  }
}

export async function translateText(text: string, target: string): Promise<TranslationResult> {
  const clean = text.trim();
  if (!clean) throw new Error('Nothing to translate.');

  const config = translationConfiguration();
  if (!config.configured) {
    throw new Error(`Translation provider '${config.provider}' is not configured yet.`);
  }

  switch (env.TRANSLATION_PROVIDER) {
    case 'google':
      return translateGoogle(clean, target);
    case 'deepl':
      return translateDeepL(clean, target);
    case 'libretranslate':
      return translateLibre(clean, target);
    default:
      throw new Error('Unsupported translation provider.');
  }
}
