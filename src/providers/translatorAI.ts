import { env } from '../config.js';
import { languageInstruction } from '../languages.js';
import type { TranslationResult, TranslationStyle } from './translator.js';

export async function translateAI(
  text: string,
  target: string,
  source = 'auto',
  style: TranslationStyle = 'natural'
): Promise<TranslationResult> {
  if (!env.AI_API_URL || !env.AI_API_KEY || !env.AI_MODEL) {
    throw new Error('AI translation is not configured. Set AI_API_URL, AI_API_KEY and AI_MODEL.');
  }

  const sourceInstruction = source === 'auto' ? 'detect automatically' : languageInstruction(source);
  const targetInstruction = languageInstruction(target);

  const response = await fetch(env.AI_API_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.AI_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: env.AI_MODEL,
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: [
            'You are a high-quality translation engine.',
            'Return ONLY the translated text, with no explanation, labels, markdown, or quotation marks.',
            'Preserve meaning, names, URLs, emojis, line breaks, and conversational intent.',
            'Do not add facts that are not in the source.'
          ].join(' ')
        },
        {
          role: 'user',
          content: `Source language: ${sourceInstruction}\nTarget language: ${targetInstruction}\nStyle: ${style}\n\nText:\n${text}`
        }
      ]
    }),
    signal: AbortSignal.timeout(30_000)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AI translation error ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const translated = data.choices?.[0]?.message?.content?.trim();
  if (!translated) throw new Error('AI provider returned no translation.');

  return {
    text: translated,
    ...(source !== 'auto' ? { detectedSourceLanguage: source } : {})
  };
}
