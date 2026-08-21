import {
  isKnownLanguageCode,
  languageInstruction,
  normalizeLanguage
} from '../languages.js';
import { callTextModel } from '../services/modelRouter.js';
import type {
  TranslationResult,
  TranslationStyle
} from './translator.js';

const LRI = '\u2066';
const PDI = '\u2069';

function cleanJsonCandidate(content: string): string {
  const clean = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  if (clean.startsWith('{') && clean.endsWith('}')) {
    return clean;
  }

  const first = clean.indexOf('{');
  const last = clean.lastIndexOf('}');

  return first >= 0 && last > first
    ? clean.slice(first, last + 1)
    : clean;
}

function isRtlTarget(code: string): boolean {
  const normalized = normalizeLanguage(code, true);
  return (
    normalized === 'ar-eg' ||
    normalized === 'ar-msa' ||
    normalized === 'fa' ||
    normalized === 'he'
  );
}

function stabilizeMixedRtlPunctuation(
  text: string,
  target: string
): string {
  if (!isRtlTarget(target)) return text;

  return text
    .replace(
      /\(\s*\(([^()\n]*[A-Za-z][^()\n]*)\)\s*\)/g,
      '($1)'
    )
    .replace(
      /\(([^()\n]*[A-Za-z][^()\n]*)\)/g,
      `${LRI}($1)${PDI}`
    )
    .replace(
      /\[([^\[\]\n]*[A-Za-z][^\[\]\n]*)\]/g,
      `${LRI}[$1]${PDI}`
    )
    .replace(/\s+([،؛؟])/g, '$1');
}

function parseAIContent(
  content: string,
  source: string,
  target: string
): TranslationResult {
  const parsed = JSON.parse(
    cleanJsonCandidate(content)
  ) as {
    translation?: unknown;
    detectedSource?: unknown;
  };

  const rawTranslation =
    typeof parsed.translation === 'string'
      ? parsed.translation.trim()
      : '';

  if (!rawTranslation) {
    throw new Error(
      'AI translation returned JSON without a translation.'
    );
  }

  const detectedRaw =
    typeof parsed.detectedSource === 'string'
      ? normalizeLanguage(parsed.detectedSource, true)
      : undefined;

  const detected =
    detectedRaw &&
    isKnownLanguageCode(detectedRaw) &&
    detectedRaw !== 'auto'
      ? detectedRaw
      : undefined;

  return {
    text: stabilizeMixedRtlPunctuation(
      rawTranslation,
      target
    ),
    detectedSourceLanguage:
      source !== 'auto'
        ? source
        : detected
  };
}

function systemPrompt(): string {
  return [
    'You are TD AI Translation, a production translation engine specialized in conversational language, Discord content, and Arabic dialects.',
    'Detect the source language automatically unless explicitly provided.',
    'For Arabic detection, distinguish natural Egyptian Arabic (ar-eg) from Modern Standard Arabic (ar-msa).',
    'Translate faithfully into the requested target language/dialect. ar-eg means natural Egyptian Arabic. ar-msa means clear Modern Standard Arabic.',
    'Do not summarize, answer, explain, shorten, censor, or add information. Your task is translation only.',
    'Preserve names, URLs, emojis, Discord mentions, custom emojis, numbers, dates, links, slang intent, and tone.',
    'Preserve Discord Markdown and visual structure: headings, bullets, numbering, quotes, code blocks, line breaks, and section spacing.',
    'Do not translate URLs, code, product names, model names, filenames, acronyms, wallet addresses, hashes, or technical identifiers unless they are ordinary prose.',
    'For Arabic or Persian output, use natural RTL sentence order. Keep embedded English names and technical identifiers in their original order.',
    'Never create double parentheses around English terms.',
    'Return JSON only with exactly: {"detectedSource":"<language-code>","translation":"<translated text>"}'
  ].join(' ');
}

export async function translateAI(
  text: string,
  target: string,
  source = 'auto',
  style: TranslationStyle = 'natural'
): Promise<TranslationResult> {
  const sourceInstruction =
    source === 'auto'
      ? 'Detect automatically. If Arabic, distinguish Egyptian Arabic (ar-eg) from Modern Standard Arabic (ar-msa).'
      : languageInstruction(source);

  const targetInstruction =
    languageInstruction(target);

  const response = await callTextModel(
    'translation',
    [
      {
        role: 'system',
        content: systemPrompt()
      },
      {
        role: 'user',
        content: [
          `Source: ${sourceInstruction}`,
          `Target: ${targetInstruction}`,
          `Style: ${style}`,
          '',
          'Text:',
          text
        ].join('\n')
      }
    ],
    {
      temperature: 0.1,
      timeoutMs: 45_000
    }
  );

  try {
    return parseAIContent(
      response.text,
      source,
      target
    );
  } catch (error) {
    console.error(
      `Translation parse failed from ${response.provider}/${response.model}:`,
      error
    );
    throw new Error(
      'The translation model returned an invalid structured result. Try again or select another text model in AI Routing.'
    );
  }
}
