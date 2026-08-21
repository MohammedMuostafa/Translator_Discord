const ALIASES: Record<string, string> = {
  arabic: 'ar', عربي: 'ar', العربية: 'ar',
  english: 'en', انجليزي: 'en', إنجليزي: 'en', الانجليزية: 'en', الإنجليزية: 'en',
  french: 'fr', فرنسي: 'fr', الفرنسية: 'fr',
  german: 'de', المانية: 'de', ألماني: 'de', الالمانية: 'de', الألمانية: 'de',
  spanish: 'es', اسباني: 'es', إسباني: 'es',
  italian: 'it', ايطالي: 'it', إيطالي: 'it',
  portuguese: 'pt', برتغالي: 'pt',
  russian: 'ru', روسي: 'ru',
  ukrainian: 'uk', اوكراني: 'uk', أوكراني: 'uk',
  turkish: 'tr', تركي: 'tr',
  dutch: 'nl', هولندي: 'nl',
  polish: 'pl', بولندي: 'pl',
  chinese: 'zh', صيني: 'zh',
  japanese: 'ja', ياباني: 'ja',
  korean: 'ko', كوري: 'ko',
  hindi: 'hi', هندي: 'hi',
  indonesian: 'id', اندونيسي: 'id', إندونيسي: 'id',
  vietnamese: 'vi', فيتنامي: 'vi',
  thai: 'th', تايلاندي: 'th',
  swedish: 'sv', سويدي: 'sv',
  greek: 'el', يوناني: 'el',
  romanian: 'ro', روماني: 'ro',
  czech: 'cs', تشيكي: 'cs',
  hebrew: 'he', عبري: 'he'
};

export function normalizeLanguage(input: string): string {
  const clean = input.trim().toLowerCase().replace('_', '-');
  return (ALIASES[clean] ?? clean).slice(0, 16);
}
