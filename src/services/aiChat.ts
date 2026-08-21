import { env } from '../config.js';

export type ChatResponseLanguage = 'auto' | 'ar-eg' | 'ar-msa' | 'en' | 'fa';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const BACKOFF_MS = [800, 1800, 3500];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function languageInstruction(language: ChatResponseLanguage): string {
  switch (language) {
    case 'ar-eg':
      return 'Reply in natural Egyptian Arabic unless the user explicitly asks for another language.';
    case 'ar-msa':
      return 'Reply in clear Modern Standard Arabic unless the user explicitly asks for another language.';
    case 'en':
      return 'Reply in English unless the user explicitly asks for another language.';
    case 'fa':
      return 'Reply in Persian (Farsi) unless the user explicitly asks for another language.';
    default:
      return 'Automatically detect the user language and normally reply in the same language. If the user switches language, follow them naturally.';
  }
}

function systemPrompt(language: ChatResponseLanguage): string {
  return [
    'You are TD AI, a helpful production AI assistant running inside Discord.',
    'Be accurate, useful, natural, and concise by default, while giving more detail when asked.',
    'You can summarize, explain, simplify, rewrite, brainstorm, draft replies, help with code, and answer general questions.',
    'Use readable Discord Markdown with short paragraphs and lists when useful.',
    'Preserve code blocks, URLs, technical names, product names, and useful formatting.',
    'For Arabic/Persian text, use natural RTL order. Keep English names and acronyms in their original LTR order and avoid redundant/double parentheses around them.',
    'Do not claim you performed actions outside the tools and context you actually have.',
    languageInstruction(language)
  ].join(' ');
}

function normalizeApiError(status: number, body: string): string {
  let message = body;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    message = parsed.error?.message ?? body;
  } catch {
    // Keep raw provider response.
  }

  if (status === 429) return 'The AI provider is rate-limited right now. Try again shortly.';
  if (status === 503) return 'The AI model is temporarily busy. Try again in a moment.';
  return `AI provider error (${status}): ${message.slice(0, 500)}`;
}

function supportsTemperature(model: string): boolean {
  // Gemini 3.x OpenAI-compatible endpoints no longer accept legacy sampling
  // parameters such as temperature/top_p/top_k.
  return !/^gemini-3(?:\.|[-])/i.test(model);
}

export function aiChatConfigured(): boolean {
  return Boolean(env.AI_API_URL && env.AI_API_KEY && env.AI_MODEL);
}

export async function askAiChat(
  history: ChatTurn[],
  userMessage: string,
  responseLanguage: ChatResponseLanguage,
  modelOverride?: string
): Promise<string> {
  const model = modelOverride?.trim() || env.AI_MODEL;
  if (!env.AI_API_URL || !env.AI_API_KEY || !model) {
    throw new Error('AI chat is not configured. Set AI_API_URL, AI_API_KEY and AI_MODEL.');
  }

  const request: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt(responseLanguage) },
      ...history,
      { role: 'user', content: userMessage }
    ]
  };

  if (supportsTemperature(model)) {
    request.temperature = 0.55;
  }

  const body = JSON.stringify(request);
  let lastError = 'AI chat failed.';

  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt += 1) {
    try {
      const response = await fetch(env.AI_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.AI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body,
        signal: AbortSignal.timeout(env.AI_ACTION_TIMEOUT_MS)
      });

      const raw = await response.text();
      if (!response.ok) {
        lastError = normalizeApiError(response.status, raw);
        if (RETRYABLE_STATUS.has(response.status) && attempt < BACKOFF_MS.length) {
          await sleep(BACKOFF_MS[attempt] ?? 3500);
          continue;
        }
        throw new Error(lastError);
      }

      const parsed = JSON.parse(raw) as {
        choices?: Array<{
          message?: {
            content?: string | Array<{ type?: string; text?: string }>;
          };
        }>;
      };

      const content = parsed.choices?.[0]?.message?.content;
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.map((part) => part.text ?? '').join('')
          : '';

      if (!text.trim()) throw new Error('The AI provider returned an empty response.');
      return text.trim();
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
