import { env } from '../config.js';
import { isDialectLanguage } from '../languages.js';
import { translateAI } from './translatorAI.js';
import { translateDeepL } from './translatorDeepL.js';
import { translateGoogle } from './translatorGoogle.js';
import { translateLibre } from './translatorLibre.js';

export type TranslationProvider = 'libretranslate' | 'google' | 'deepl' | 'ai';
export type TranslationStyle = 'natural' | 'literal' | 'casual' | 'formal';

export type TranslationResult = {
  text: string;
  detectedSourceLanguage?: string;
  provider?: TranslationProvider;
};

export type TranslationOptions = {
  source?: string;
  provider?: TranslationProvider | 'default';
  style?: TranslationStyle;
};

export function aiConfigured(): boolean {
  return Boolean(env.AI_API_URL && env.AI_API_KEY && env.AI_MODEL);
}

export function translationConfiguration(provider: TranslationProvider = env.TRANSLATION_PROVIDER): { provider: string; configured: boolean } {
  switch (provider) {
    case 'google':
      return { provider: 'google', configured: Boolean(env.GOOGLE_TRANSLATE_API_KEY) };
    case 'deepl':
      return { provider: 'deepl', configured: Boolean(env.DEEPL_API_KEY) };
    case 'ai':
      return { provider: 'ai', configured: aiConfigured() };
    case 'libretranslate':
      return { provider: 'libretranslate', configured: Boolean(env.LIBRETRANSLATE_URL) };
    default:
      throw new Error('Unsupported translation provider.');
  }
}

function resolveProvider(target: string, options: TranslationOptions): TranslationProvider {
  if (options.provider && options.provider !== 'default') return options.provider;

  // AI is automatically preferred for dialect control or non-default writing styles when configured.
  if (aiConfigured() && (isDialectLanguage(target) || isDialectLanguage(options.source ?? '') || (options.style && options.style !== 'natural'))) {
    return 'ai';
  }

  return env.TRANSLATION_PROVIDER;
}

export async function translateText(text: string, target: string, options: TranslationOptions = {}): Promise<TranslationResult> {
  const clean = text.trim();
  if (!clean) throw new Error('Nothing to translate.');

  const source = options.source ?? 'auto';
  const style = options.style ?? 'natural';
  const provider = resolveProvider(target, options);
  const config = translationConfiguration(provider);

  if (!config.configured) {
    throw new Error(`Translation provider '${provider}' is not configured yet.`);
  }

  if (provider !== 'ai' && (isDialectLanguage(target) || style !== 'natural')) {
    // Traditional MT engines use generic Arabic codes and cannot reliably guarantee Egyptian/MSA style.
    // Keep the request functional, but make the limitation explicit by using the base language code.
    console.warn(`Provider '${provider}' cannot guarantee dialect/style '${target}/${style}'.`);
  }

  let result: TranslationResult;
  switch (provider) {
    case 'google':
      result = await translateGoogle(clean, target, source);
      break;
    case 'deepl':
      result = await translateDeepL(clean, target, source);
      break;
    case 'ai':
      result = await translateAI(clean, target, source, style);
      break;
    case 'libretranslate':
      result = await translateLibre(clean, target, source);
      break;
    default:
      throw new Error('Unsupported translation provider.');
  }

  return { ...result, provider };
}
