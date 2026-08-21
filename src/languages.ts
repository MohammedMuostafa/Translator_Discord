export type LanguageCode =
  | 'auto'
  | 'en'
  | 'ar-msa'
  | 'ar-eg'
  | 'fa'
  | 'fr'
  | 'de'
  | 'es'
  | 'it'
  | 'pt'
  | 'ru'
  | 'tr'
  | 'nl'
  | 'pl'
  | 'zh'
  | 'ja'
  | 'ko'
  | 'hi'
  | 'id'
  | 'vi'
  | 'he';

type LanguageDefinition = {
  code: LanguageCode;
  name: string;
  providerCode: string;
  instruction: string;
  dialect?: boolean;
};

const LANGUAGES: LanguageDefinition[] = [
  { code: 'auto', name: 'Auto detect', providerCode: 'auto', instruction: 'Automatically detect the source language and dialect.' },
  { code: 'en', name: 'English', providerCode: 'en', instruction: 'natural English' },
  { code: 'ar-eg', name: 'Arabic — Egyptian (مصري)', providerCode: 'ar', instruction: 'natural Egyptian Arabic dialect (العامية المصرية), not Modern Standard Arabic', dialect: true },
  { code: 'ar-msa', name: 'Arabic — Modern Standard (الفصحى)', providerCode: 'ar', instruction: 'Modern Standard Arabic (العربية الفصحى), clear and natural', dialect: true },
  { code: 'fa', name: 'Persian / Farsi (فارسی)', providerCode: 'fa', instruction: 'natural Persian (Farsi)' },
  { code: 'fr', name: 'French', providerCode: 'fr', instruction: 'natural French' },
  { code: 'de', name: 'German', providerCode: 'de', instruction: 'natural German' },
  { code: 'es', name: 'Spanish', providerCode: 'es', instruction: 'natural Spanish' },
  { code: 'it', name: 'Italian', providerCode: 'it', instruction: 'natural Italian' },
  { code: 'pt', name: 'Portuguese', providerCode: 'pt', instruction: 'natural Portuguese' },
  { code: 'ru', name: 'Russian', providerCode: 'ru', instruction: 'natural Russian' },
  { code: 'tr', name: 'Turkish', providerCode: 'tr', instruction: 'natural Turkish' },
  { code: 'nl', name: 'Dutch', providerCode: 'nl', instruction: 'natural Dutch' },
  { code: 'pl', name: 'Polish', providerCode: 'pl', instruction: 'natural Polish' },
  { code: 'zh', name: 'Chinese', providerCode: 'zh', instruction: 'natural Simplified Chinese' },
  { code: 'ja', name: 'Japanese', providerCode: 'ja', instruction: 'natural Japanese' },
  { code: 'ko', name: 'Korean', providerCode: 'ko', instruction: 'natural Korean' },
  { code: 'hi', name: 'Hindi', providerCode: 'hi', instruction: 'natural Hindi' },
  { code: 'id', name: 'Indonesian', providerCode: 'id', instruction: 'natural Indonesian' },
  { code: 'vi', name: 'Vietnamese', providerCode: 'vi', instruction: 'natural Vietnamese' },
  { code: 'he', name: 'Hebrew', providerCode: 'he', instruction: 'natural Hebrew' }
];

const BY_CODE = new Map(LANGUAGES.map((language) => [language.code, language]));

const ALIASES: Record<string, LanguageCode> = {
  auto: 'auto', detect: 'auto', automatic: 'auto', تلقائي: 'auto', تلقائى: 'auto',
  english: 'en', en: 'en', انجليزي: 'en', إنجليزي: 'en', الانجليزية: 'en', الإنجليزية: 'en',
  arabic: 'ar-msa', ar: 'ar-msa', 'ar-msa': 'ar-msa', msa: 'ar-msa', عربي: 'ar-msa', العربية: 'ar-msa', فصحى: 'ar-msa', الفصحى: 'ar-msa',
  'ar-eg': 'ar-eg', egyptian: 'ar-eg', egyptianarabic: 'ar-eg', مصري: 'ar-eg', مصرى: 'ar-eg', المصرية: 'ar-eg', عامية: 'ar-eg', عاميه: 'ar-eg',
  persian: 'fa', farsi: 'fa', fa: 'fa', فارسي: 'fa', فارسى: 'fa', فارسی: 'fa', الفارسية: 'fa', الفارسيه: 'fa',
  french: 'fr', fr: 'fr', فرنسي: 'fr', الفرنسية: 'fr',
  german: 'de', de: 'de', المانية: 'de', ألماني: 'de', الالمانية: 'de', الألمانية: 'de',
  spanish: 'es', es: 'es', اسباني: 'es', إسباني: 'es',
  italian: 'it', it: 'it', ايطالي: 'it', إيطالي: 'it',
  portuguese: 'pt', pt: 'pt', برتغالي: 'pt',
  russian: 'ru', ru: 'ru', روسي: 'ru',
  turkish: 'tr', tr: 'tr', تركي: 'tr',
  dutch: 'nl', nl: 'nl', هولندي: 'nl',
  polish: 'pl', pl: 'pl', بولندي: 'pl',
  chinese: 'zh', zh: 'zh', صيني: 'zh',
  japanese: 'ja', ja: 'ja', ياباني: 'ja',
  korean: 'ko', ko: 'ko', كوري: 'ko',
  hindi: 'hi', hi: 'hi', هندي: 'hi',
  indonesian: 'id', id: 'id', اندونيسي: 'id', إندونيسي: 'id',
  vietnamese: 'vi', vi: 'vi', فيتنامي: 'vi',
  hebrew: 'he', he: 'he', عبري: 'he'
};

export const sourceLanguageChoices = LANGUAGES.map(({ name, code }) => ({ name, value: code }));
export const targetLanguageChoices = LANGUAGES
  .filter((language) => language.code !== 'auto')
  .map(({ name, code }) => ({ name, value: code }));

export function targetLanguageChoicesWithDefault(label = 'My language (default)') {
  return [{ name: label, value: 'my' }, ...targetLanguageChoices];
}

export function targetSelectOptions(defaultLanguage: string) {
  const defaultLabel = languageLabel(defaultLanguage);
  return [
    { label: `My language — ${defaultLabel}`.slice(0, 100), value: 'my', description: 'Use your saved incoming language' },
    ...LANGUAGES.filter((language) => language.code !== 'auto').map((language) => ({
      label: language.name.slice(0, 100),
      value: language.code,
      ...(language.code === 'ar-eg'
        ? { description: 'Natural Egyptian Arabic / العامية المصرية' }
        : language.code === 'ar-msa'
          ? { description: 'Modern Standard Arabic / العربية الفصحى' }
          : {})
    }))
  ];
}

export function normalizeLanguage(input: string, allowAuto = false): string {
  const clean = input.trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '');
  const normalized = ALIASES[clean] ?? clean;
  if (!allowAuto && normalized === 'auto') return 'en';
  return normalized.slice(0, 16);
}

export function languageLabel(code: string): string {
  const normalized = normalizeLanguage(code, true) as LanguageCode;
  return BY_CODE.get(normalized)?.name ?? code.toUpperCase();
}

export function providerLanguageCode(code: string): string {
  const normalized = normalizeLanguage(code, true) as LanguageCode;
  return BY_CODE.get(normalized)?.providerCode ?? normalized;
}

export function languageInstruction(code: string): string {
  const normalized = normalizeLanguage(code, true) as LanguageCode;
  return BY_CODE.get(normalized)?.instruction ?? code;
}

export function isDialectLanguage(code: string): boolean {
  const normalized = normalizeLanguage(code, true) as LanguageCode;
  return Boolean(BY_CODE.get(normalized)?.dialect);
}

export function isKnownLanguageCode(code: string): code is LanguageCode {
  return BY_CODE.has(code as LanguageCode);
}
