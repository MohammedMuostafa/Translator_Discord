import { isKnownLanguageCode, languageInstruction, normalizeLanguage } from '../languages.js';
import { callTextModel } from '../services/modelRouter.js';
import type { TranslationResult, TranslationStyle } from './translator.js';

const LRI = '\u2066';
const PDI = '\u2069';

function cleanJsonCandidate(content: string): string {
  return content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function isRtlTarget(code: string): boolean {
  const normalized = normalizeLanguage(code, true);
  return normalized === 'ar-eg' || normalized === 'ar-msa' || normalized === 'fa' || normalized === 'he';
}

function stabilizeMixedRtlPunctuation(text: string, target: string): string {
  if (!isRtlTarget(target)) return text;
  return text
    .replace(/\(\s*\(([^()\n]*[A-Za-z][^()\n]*)\)\s*\)/g, '($1)')
    .replace(/\(([^()\n]*[A-Za-z][^()\n]*)\)/g, `${LRI}($1)${PDI}`)
    .replace(/\[([^\[\]\n]*[A-Za-z][^\[\]\n]*)\]/g, `${LRI}[$1]${PDI}`)
    .replace(/\s+([،؛؟])/g, '$1');
}

function parseAIContent(content: string, source: string, target: string): TranslationResult {
  try {
    const parsed = JSON.parse(cleanJsonCandidate(content)) as { translation?: unknown; detectedSource?: unknown };
    const rawTranslation = typeof parsed.translation === 'string' ? parsed.translation.trim() : '';
    if (!rawTranslation) throw new Error('missing translation');
    const detectedRaw = typeof parsed.detectedSource === 'string' ? normalizeLanguage(parsed.detectedSource, true) : undefined;
    const detected = detectedRaw && isKnownLanguageCode(detectedRaw) && detectedRaw !== 'auto' ? detectedRaw : undefined;
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
    'For long messages, keep paragraphs readable and do not invent sections.',
    'Do not translate URLs, code, Discord mentions, channel references, product names, model names, filenames, acronyms, or technical identifiers unless they are ordinary prose.',
    'For Arabic or Persian output, use natural RTL sentence order. Keep embedded English names in their original LTR order.',
    'Never create double parentheses around English names.',
    'Use natural Arabic punctuation when the target is Arabic.',
    'Return ONLY valid JSON with exactly two keys: {"detectedSource":"<code>","translation":"<translated text>"}.'
  ].join(' ');
}

export async function translateAI(
  text: string,
  target: string,
  source = 'auto',
  style: TranslationStyle = 'natural'
): Promise<TranslationResult> {
  const sourceInstruction = source === 'auto'
    ? 'Detect the source automatically. IMPORTANT: if it is Arabic, distinguish Egyptian Arabic (ar-eg) from Modern Standard Arabic (ar-msa).'
    : languageInstruction(source);
  const targetInstruction = languageInstruction(target);

  const response = await callTextModel(
    'translation',
    [
      { role: 'system', content: systemPrompt() },
      {
        role: 'user',
        content: `Source: ${sourceInstruction}\nTarget: ${targetInstruction}\nStyle: ${style}\n\nText:\n${text}`
      }
    ],
    { temperature: 0.1, timeoutMs: 45_000 }
  );
  return parseAIContent(response.text, source, target);
}
