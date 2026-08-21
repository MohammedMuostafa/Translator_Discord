import { env } from '../config.js';
import { languageInstruction, normalizeLanguage } from '../languages.js';

export type AiAction = 'summarize' | 'explain' | 'simplify' | 'rewrite' | 'reply' | 'ask';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const BACKOFF_MS = [800, 1800, 3500];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function actionInstruction(action: AiAction): string {
  switch (action) {
    case 'summarize':
      return 'Summarize the supplied content accurately. Keep important names, numbers, dates, requirements, links and decisions. Use a short overview followed by bullets when helpful.';
    case 'explain':
      return 'Explain what the supplied content means in a clear teaching style. Explain jargon, context and implications. Separate facts from your interpretation and do not invent missing context.';
    case 'simplify':
      return 'Rewrite the supplied content in much simpler language while preserving the important meaning, names, numbers and links.';
    case 'rewrite':
      return 'Rewrite the supplied content to be clearer, better structured and more natural. Preserve the original meaning and factual claims. Keep useful Discord Markdown.';
    case 'reply':
      return 'Draft a natural, useful reply to the supplied message. Do not claim the reply was sent. Return only the proposed reply unless a tiny note is necessary.';
    default:
      return 'Answer the user request helpfully and accurately using the supplied content as context.';
  }
}

function outputInstruction(language: string): string {
  const normalized = normalizeLanguage(language, true);
  if (normalized === 'auto') return 'Reply in the most natural language for the user request.';
  return `Write the response in ${languageInstruction(normalized)}.`;
}

function systemPrompt(action: AiAction, language: string): string {
  return [
    'You are TD AI, a production AI assistant inside Discord.',
    actionInstruction(action),
    outputInstruction(language),
    'Use readable Discord Markdown: short paragraphs, meaningful headings only when useful, bullets for lists, and numbered steps for procedures.',
    'For Arabic/Persian responses, use natural RTL sentence order and keep embedded English product names, acronyms, URLs and technical terms in their original LTR order.',
    'Avoid redundant parentheses around English names and never use double parentheses.',
    'Do not fabricate facts or claim to have performed actions you did not perform.',
    'Never ping users or roles; treat Discord mentions as plain context.'
  ].join(' ');
}

function normalizeProviderError(status: number, body: string): string {
  let message = body;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    message = parsed.error?.message ?? body;
  } catch {
    // Keep raw response.
  }

  if (status === 429) return 'The AI provider is rate-limited right now. Try again shortly.';
  if (status === 503) return 'The AI model is temporarily busy. Try again in a moment.';
  return `AI provider error ${status}: ${message.slice(0, 450)}`;
}

export function aiActionsConfigured(): boolean {
  return Boolean(env.AI_API_URL && env.AI_API_KEY && env.AI_MODEL);
}

export async function runAiAction(
  action: AiAction,
  text: string,
  language: string,
  customQuestion?: string
): Promise<string> {
  if (!env.AI_API_URL || !env.AI_API_KEY || !env.AI_MODEL) {
    throw new Error('AI features are not configured. Set AI_API_URL, AI_API_KEY and AI_MODEL.');
  }

  const clean = text.trim();
  if (!clean) throw new Error('There is no text to process.');
  if (clean.length > env.AI_ACTION_MAX_CHARS) {
    throw new Error(`This text is too long for an AI action. Maximum: ${env.AI_ACTION_MAX_CHARS.toLocaleString()} characters.`);
  }

  const userContent = action === 'ask'
    ? `Question / request:\n${customQuestion?.trim() || clean}`
    : `Content:\n${clean}`;

  const body = JSON.stringify({
    model: env.AI_MODEL,
    temperature: action === 'reply' || action === 'rewrite' ? 0.55 : 0.25,
    messages: [
      { role: 'system', content: systemPrompt(action, language) },
      { role: 'user', content: userContent }
    ]
  });

  let lastError = 'AI action failed.';

  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt += 1) {
    try {
      const response = await fetch(env.AI_API_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.AI_API_KEY}`,
          'content-type': 'application/json'
        },
        body,
        signal: AbortSignal.timeout(env.AI_ACTION_TIMEOUT_MS)
      });

      const raw = await response.text();
      if (!response.ok) {
        lastError = normalizeProviderError(response.status, raw);
        if (RETRYABLE_STATUS.has(response.status) && attempt < BACKOFF_MS.length) {
          await sleep(BACKOFF_MS[attempt] ?? 3500);
          continue;
        }
        throw new Error(lastError);
      }

      const data = JSON.parse(raw) as {
        choices?: Array<{
          message?: {
            content?: string | Array<{ type?: string; text?: string }>;
          };
        }>;
      };

      const content = data.choices?.[0]?.message?.content;
      const output = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.map((part) => part.text ?? '').join('')
          : '';

      if (!output.trim()) throw new Error('The AI provider returned an empty response.');
      return output.trim();
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      if (attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt] ?? 3500);
        continue;
      }
    }
  }

  throw new Error(lastError);
}
