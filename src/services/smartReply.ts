import { env } from '../config.js';
import { languageInstruction, normalizeLanguage } from '../languages.js';

export type SmartReplyMode = 'normal' | 'alternative' | 'shorter' | 'detailed';

export type SmartReplyResult = {
  isQuestion: boolean;
  translatedMessage: string;
  answer: string;
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const BACKOFF_MS = [800, 1800, 3500];

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

function modeInstruction(mode: SmartReplyMode): string {
  switch (mode) {
    case 'alternative':
      return 'Create a meaningfully different alternative reply from the previous one. Do not merely rephrase a few words.';
    case 'shorter':
      return 'Make the proposed reply short, direct, and natural while preserving the useful answer.';
    case 'detailed':
      return 'Make the proposed reply more helpful and detailed, but still natural for Discord and not unnecessarily long.';
    default:
      return 'Create the most natural, useful reply for the message.';
  }
}

function normalizeProviderError(status: number, body: string): string {
  let message = body;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    message = parsed.error?.message ?? body;
  } catch {
    // Keep provider response.
  }

  if (status === 429) return 'The AI provider is rate-limited right now. Try again shortly.';
  if (status === 503) return 'The AI model is temporarily busy. Try again in a moment.';
  return `AI provider error ${status}: ${message.slice(0, 450)}`;
}

function parseResult(content: string): SmartReplyResult {
  const parsed = JSON.parse(cleanJsonCandidate(content)) as {
    isQuestion?: unknown;
    translatedMessage?: unknown;
    answer?: unknown;
  };

  const translatedMessage = typeof parsed.translatedMessage === 'string'
    ? parsed.translatedMessage.trim()
    : '';
  const answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : '';

  if (!translatedMessage || !answer) {
    throw new Error('AI returned an incomplete smart reply.');
  }

  return {
    isQuestion: parsed.isQuestion === true,
    translatedMessage,
    answer
  };
}

export function smartReplyConfigured(): boolean {
  return Boolean(env.AI_API_URL && env.AI_API_KEY && env.AI_MODEL);
}

export async function createSmartReply(
  sourceMessage: string,
  outputLanguage: string,
  mode: SmartReplyMode = 'normal',
  previousAnswer?: string
): Promise<SmartReplyResult> {
  if (!env.AI_API_URL || !env.AI_API_KEY || !env.AI_MODEL) {
    throw new Error('AI features are not configured. Set AI_API_URL, AI_API_KEY and AI_MODEL.');
  }

  const clean = sourceMessage.trim();
  if (!clean) throw new Error('There is no message text to answer.');
  if (clean.length > env.AI_ACTION_MAX_CHARS) {
    throw new Error(`This message is too long. Maximum: ${env.AI_ACTION_MAX_CHARS.toLocaleString()} characters.`);
  }

  const normalizedLanguage = normalizeLanguage(outputLanguage, true);
  const language = languageInstruction(normalizedLanguage);
  const previous = previousAnswer?.trim()
    ? `\nPrevious proposed reply:\n${previousAnswer.trim()}`
    : '';

  const body = JSON.stringify({
    model: env.AI_MODEL,
    temperature: mode === 'alternative' ? 0.75 : 0.35,
    messages: [
      {
        role: 'system',
        content: [
          'You are TD AI, an assistant that helps Discord users understand and answer messages.',
          `Write BOTH the translation and the proposed answer in ${language}.`,
          'First decide whether the source message is a real question or request that expects an answer.',
          'Translate the source faithfully into the requested language while preserving names, links, numbers, emojis, and technical terms.',
          'If it is a question, answer the question directly and usefully.',
          'If it is not a question, draft a natural contextual reply instead of pretending it is a question.',
          'Do not invent private facts, current facts you cannot know, or actions the user did not take.',
          'For Arabic output, use natural right-to-left sentence order and keep English names/acronyms intact.',
          'Avoid redundant parentheses and never output double parentheses around English names.',
          modeInstruction(mode),
          'Return ONLY valid JSON with exactly these keys: {"isQuestion":true|false,"translatedMessage":"...","answer":"..."}.'
        ].join(' ')
      },
      {
        role: 'user',
        content: `Source message:\n${clean}${previous}`
      }
    ]
  });

  let lastError = 'Smart reply failed.';

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
          message?: { content?: string | Array<{ text?: string }> };
        }>;
      };
      const content = data.choices?.[0]?.message?.content;
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.map((part) => part.text ?? '').join('')
          : '';

      if (!text.trim()) throw new Error('AI provider returned an empty smart reply.');
      return parseResult(text);
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
