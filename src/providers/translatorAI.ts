import { env } from '../config.js';
import { isKnownLanguageCode, languageInstruction, normalizeLanguage } from '../languages.js';
import type { TranslationResult, TranslationStyle } from './translator.js';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const BACKOFF_MS = [700, 1600, 3200];

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

function parseAIContent(content: string, source: string): TranslationResult {
  try {
    const parsed = JSON.parse(cleanJsonCandidate(content)) as {
      translation?: unknown;
      detectedSource?: unknown;
    };
    const translation = typeof parsed.translation === 'string' ? parsed.translation.trim() : '';
    if (!translation) throw new Error('missing translation');

    const detectedRaw = typeof parsed.detectedSource === 'string' ? normalizeLanguage(parsed.detectedSource, true) : undefined;
    const detected = detectedRaw && isKnownLanguageCode(detectedRaw) && detectedRaw !== 'auto' ? detectedRaw : undefined;
    return {
      text: translation,
      detectedSourceLanguage: source !== 'auto' ? source : detected
    };
  } catch {
    // Graceful compatibility path if a model ignores the requested JSON format.
    return {
      text: content.trim(),
      ...(source !== 'auto' ? { detectedSourceLanguage: source } : {})
    };
  }
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
      {
        role: 'system',
        content: [
          'You are a production translation engine specialized in conversational language and Arabic dialects.',
          'Detect the source language automatically unless explicitly provided.',
          'For Arabic detection, classify natural Egyptian dialect as ar-eg and Modern Standard Arabic as ar-msa.',
          'Translate into the requested target dialect exactly: ar-eg means natural Egyptian Arabic; ar-msa means clear Modern Standard Arabic.',
          'Preserve meaning, names, URLs, emojis, line breaks, slang intent and tone. Do not add facts.',
          'Return translation text as plain readable text. Do not add Markdown formatting, headings, code fences, commentary, or explanations.',
          'For Arabic or Persian output, keep the natural right-to-left sentence order. Keep embedded English product names, URLs, model names and acronyms exactly as written and in their natural left-to-right order.',
          'Return ONLY valid JSON with exactly two keys: {"detectedSource":"<code>","translation":"<translated text>"}.',
          'Supported detection codes include en, ar-eg, ar-msa, fa, fr, de, es, it, pt, ru, tr, nl, pl, zh, ja, ko, hi, id, vi, he.'
        ].join(' ')
      },
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
        signal: AbortSignal.timeout(30_000)
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
      return parseAIContent(content, source);
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
