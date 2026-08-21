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

function resolveProvider(options: TranslationOptions): TranslationProvider {
  if (options.provider && options.provider !== 'default') return options.provider;
  // Auto mode is AI-first. This gives reliable auto-detection and Egyptian/MSA control.
  if (aiConfigured()) return 'ai';
  return env.TRANSLATION_PROVIDER;
}

async function runProvider(
  provider: TranslationProvider,
  clean: string,
  target: string,
  source: string,
  style: TranslationStyle
): Promise<TranslationResult> {
  switch (provider) {
    case 'google': return translateGoogle(clean, target, source);
    case 'deepl': return translateDeepL(clean, target, source);
    case 'ai': return translateAI(clean, target, source, style);
    case 'libretranslate': return translateLibre(clean, target, source);
  }
}

export async function translateText(text: string, target: string, options: TranslationOptions = {}): Promise<TranslationResult> {
  const clean = text.trim();
  if (!clean) throw new Error('Nothing to translate.');

  const source = options.source ?? 'auto';
  const style = options.style ?? 'natural';
  const provider = resolveProvider(options);
  const config = translationConfiguration(provider);

  if (!config.configured) throw new Error(`Translation provider '${provider}' is not configured yet.`);

  if (provider !== 'ai' && (isDialectLanguage(target) || style !== 'natural')) {
    console.warn(`Provider '${provider}' cannot guarantee dialect/style '${target}/${style}'.`);
  }

  try {
    const result = await runProvider(provider, clean, target, source, style);
    return { ...result, provider };
  } catch (error) {
    // Auto/default mode gets a practical free fallback when AI is temporarily overloaded.
    const explicitProvider = options.provider && options.provider !== 'default';
    if (!explicitProvider && provider === 'ai' && translationConfiguration('libretranslate').configured) {
      console.warn(`AI translation failed; falling back to LibreTranslate: ${error instanceof Error ? error.message : error}`);
      const fallback = await translateLibre(clean, target, source);
      return { ...fallback, provider: 'libretranslate' };
    }
    throw error;
  }
}
