import { env } from '../config.js';
import { isKnownLanguageCode, languageInstruction, normalizeLanguage } from '../languages.js';
import type { TranslationResult, TranslationStyle } from './translator.js';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const BACKOFF_MS = [700, 1600, 3200];
const LRI = '\u2066';
const PDI = '\u2069';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanJsonCandidate(content: string): string {
  return content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function isRtlTarget(code: string): boolean {
  const normalized = normalizeLanguage(code, true);
  return normalized === 'ar-eg' || normalized === 'ar-msa' || normalized === 'fa' || normalized === 'he';
}

/**
 * Discord's bidi renderer can visually move neutral punctuation such as
 * parentheses when an Arabic/Persian sentence contains English product names.
 * Isolate the whole parenthesized Latin phrase, not only the words inside it.
 * This keeps `(Personal Spaces)` and similar terms visually intact.
 */
function stabilizeMixedRtlPunctuation(text: string, target: string): string {
  if (!isRtlTarget(target)) return text;

  return text
    // Remove accidental nested parentheses frequently produced around technical names.
    .replace(/\(\s*\(([^()\n]*[A-Za-z][^()\n]*)\)\s*\)/g, '($1)')
    // Isolate the complete neutral-punctuation group so the brackets stay together.
    .replace(/\(([^()\n]*[A-Za-z][^()\n]*)\)/g, `${LRI}($1)${PDI}`)
    .replace(/\[([^\[\]\n]*[A-Za-z][^\[\]\n]*)\]/g, `${LRI}[$1]${PDI}`)
    // Avoid model-generated whitespace before Arabic punctuation.
    .replace(/\s+([،؛؟])/g, '$1');
}

function parseAIContent(content: string, source: string, target: string): TranslationResult {
  try {
    const parsed = JSON.parse(cleanJsonCandidate(content)) as {
      translation?: unknown;
      detectedSource?: unknown;
    };
    const rawTranslation = typeof parsed.translation === 'string' ? parsed.translation.trim() : '';
    if (!rawTranslation) throw new Error('missing translation');

    const detectedRaw = typeof parsed.detectedSource === 'string'
      ? normalizeLanguage(parsed.detectedSource, true)
      : undefined;
    const detected = detectedRaw && isKnownLanguageCode(detectedRaw) && detectedRaw !== 'auto'
      ? detectedRaw
      : undefined;

    return {
      text: stabilizeMixedRtlPunctuation(rawTranslation, target),
      detectedSourceLanguage: source !== 'auto' ? source : detected
    };
  } catch {
    return {
      text: stabilizeMixedRtlPunctuation(content.trim(), target),
      ...(source !== 'auto' ? { detectedSourceLanguage: source } : {})
    };
  }
}

function systemPrompt(): string {
  return [
    'You are a production translation engine specialized in conversational language, Discord content, and Arabic dialects.',
    'Detect the source language automatically unless explicitly provided.',
    'For Arabic detection, classify natural Egyptian dialect as ar-eg and Modern Standard Arabic as ar-msa.',
    'Translate into the requested target dialect exactly: ar-eg means natural Egyptian Arabic; ar-msa means clear Modern Standard Arabic.',
    'Preserve meaning, names, URLs, emojis, mentions, custom emojis, line breaks, slang intent and tone. Never add facts.',
    'Preserve Discord Markdown and the visual structure: headings remain headings, bullet lists remain bullet lists, numbered steps remain numbered steps, quotes remain quotes, code remains code, and section spacing remains readable.',
    'For long messages, make the result easy to scan with sensible blank lines and short paragraphs. Do not turn every line into a heading and do not invent new sections that do not exist in the source.',
    'Do not translate URLs, code, Discord mentions, channel references, custom emoji markup, product names, model names, filenames, acronyms, or technical identifiers unless they are ordinary prose.',
    'For Arabic or Persian output, use natural RTL sentence order. Keep embedded English names in their original LTR order.',
    'IMPORTANT RTL rule: do not create redundant parentheses around English words. If the source already contains parentheses, keep exactly one pair. Never output double parentheses such as ((Name)).',
    'When Arabic prose contains an English multi-word name, keep the English phrase together exactly as written and place punctuation naturally around the complete phrase.',
    'Use natural Arabic punctuation when the target is Arabic. Do not put random punctuation or Markdown markers in the middle of Arabic words.',
    'Return ONLY valid JSON with exactly two keys: {"detectedSource":"<code>","translation":"<translated text>"}.',
    'Supported detection codes include en, ar-eg, ar-msa, fa, fr, de, es, it, pt, ru, tr, nl, pl, zh, ja, ko, hi, id, vi, he.'
  ].join(' ');
}

export async function translateAI(
  text: string,
  target: string,
  source = 'auto',
  style: TranslationStyle = 'natural'
): Promise<TranslationResult> {
  if (!env.AI_API_URL || !env.AI_API_KEY || !env.AI_MODEL) {
    throw new Error('AI translation is not configured. Set AI_API_URL, AI_API_KEY and AI_MODEL.');
  }

  const sourceInstruction = source === 'auto'
    ? 'Detect the source automatically. IMPORTANT: if it is Arabic, distinguish Egyptian Arabic (ar-eg) from Modern Standard Arabic (ar-msa).'
    : languageInstruction(source);
  const targetInstruction = languageInstruction(target);

  const body = JSON.stringify({
    model: env.AI_MODEL,
    temperature: 0.1,
    messages: [
      { role: 'system', content: systemPrompt() },
      {
        role: 'user',
        content: `Source: ${sourceInstruction}\nTarget: ${targetInstruction}\nStyle: ${style}\n\nText:\n${text}`
      }
    ]
  });

  let lastError = 'AI translation failed.';

  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt += 1) {
    try {
      const response = await fetch(env.AI_API_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.AI_API_KEY}`,
          'content-type': 'application/json'
        },
        body,
        signal: AbortSignal.timeout(45_000)
      });

      if (!response.ok) {
        const errorBody = await response.text();
        lastError = `AI translation error ${response.status}: ${errorBody.slice(0, 300)}`;
        if (RETRYABLE_STATUS.has(response.status) && attempt < BACKOFF_MS.length) {
          await sleep(BACKOFF_MS[attempt] ?? 3200);
          continue;
        }
        throw new Error(lastError);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error('AI provider returned no translation.');
      return parseAIContent(content, source, target);
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      if (attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt] ?? 3200);
        continue;
      }
    }
  }

  throw new Error(lastError);
}
