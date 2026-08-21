import { env } from '../config.js';
import { languageInstruction, normalizeLanguage } from '../languages.js';

export type SmartReplyMode = 'normal' | 'alternative' | 'shorter' | 'detailed';

export type SmartReplyResult = {
  isQuestion: boolean;
  sourceLanguage: string;
  sourceLanguageCode: string;
  translatedMessage: string;
  answer: string;
  answerArabic: string;
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

function supportsTemperature(model: string): boolean {
  return !/^gemini-3(?:\.|[-])/i.test(model);
}

function parseResult(content: string): SmartReplyResult {
  const parsed = JSON.parse(cleanJsonCandidate(content)) as {
    isQuestion?: unknown;
    sourceLanguage?: unknown;
    sourceLanguageCode?: unknown;
    translatedMessage?: unknown;
    answer?: unknown;
    answerArabic?: unknown;
  };

  const sourceLanguage = typeof parsed.sourceLanguage === 'string'
    ? parsed.sourceLanguage.trim()
    : 'Detected language';
  const sourceLanguageCode = typeof parsed.sourceLanguageCode === 'string'
    ? parsed.sourceLanguageCode.trim()
    : 'auto';
  const translatedMessage = typeof parsed.translatedMessage === 'string'
    ? parsed.translatedMessage.trim()
    : '';
  const answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : '';
  const answerArabic = typeof parsed.answerArabic === 'string'
    ? parsed.answerArabic.trim()
    : '';

  if (!translatedMessage || !answer || !answerArabic) {
    throw new Error('AI returned an incomplete smart reply.');
  }

  return {
    isQuestion: parsed.isQuestion === true,
    sourceLanguage,
    sourceLanguageCode,
    translatedMessage,
    answer,
    answerArabic
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
  const arabicLanguage = languageInstruction(normalizedLanguage);
  const previous = previousAnswer?.trim()
    ? `\nPrevious proposed reply in the sender's language:\n${previousAnswer.trim()}`
    : '';

  const request: Record<string, unknown> = {
    model: env.AI_MODEL,
    messages: [
      {
        role: 'system',
        content: [
          'You are TD AI, an assistant that helps Discord users understand and answer messages.',
          'Detect the exact language/locale of the source message first.',
          `Translate the SOURCE MESSAGE into ${arabicLanguage} for the current TD AI user.`,
          'The proposed answer MUST be written in the SAME language and natural locale/style as the sender/source message.',
          `Also translate the proposed answer into ${arabicLanguage} so the current user can understand what they are about to send.`,
          'If the source is English, answer must be English. If Persian, answer must be Persian. If Egyptian Arabic, answer naturally in Egyptian Arabic. Apply the same rule to other languages.',
          'First decide whether the source message is a real question or request that expects an answer.',
          'If it is a question, answer it directly and usefully. If not, draft a natural contextual reply.',
          'Preserve names, links, numbers, emojis, technical terms, and the original intent.',
          'Do not invent private facts, current facts you cannot know, or actions the user did not take.',
          modeInstruction(mode),
          'Return ONLY valid JSON with exactly these keys:',
          '{"isQuestion":true|false,"sourceLanguage":"English","sourceLanguageCode":"en","translatedMessage":"Arabic translation","answer":"reply in sender language","answerArabic":"Arabic meaning of reply"}.'
        ].join(' ')
      },
      {
        role: 'user',
        content: `Source message:\n${clean}${previous}`
      }
    ]
  };

  if (supportsTemperature(env.AI_MODEL)) {
    request.temperature = mode === 'alternative' ? 0.75 : 0.35;
  }

  const body = JSON.stringify(request);
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
