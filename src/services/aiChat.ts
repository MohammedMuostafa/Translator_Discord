import { env } from '../config.js';

export type ChatResponseLanguage = 'auto' | 'ar-eg' | 'ar-msa' | 'en' | 'fa';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
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
    'You are TD AI, a helpful AI assistant running inside Discord.',
    'Be accurate, useful, natural, and concise by default, while giving more detail when the user asks for it.',
    'Preserve code blocks, URLs, technical names, and useful formatting.',
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
    // Keep the raw provider response when it is not JSON.
  }

  if (status === 429) return 'The AI provider is rate-limited right now. Try again shortly.';
  if (status === 503) return 'The AI model is temporarily busy. Try again in a moment.';
  return `AI provider error (${status}): ${message.slice(0, 500)}`;
}

export function aiChatConfigured(): boolean {
  return Boolean(env.AI_API_URL && env.AI_API_KEY && env.AI_MODEL);
}

export async function askAiChat(
  history: ChatTurn[],
  userMessage: string,
  responseLanguage: ChatResponseLanguage
): Promise<string> {
  if (!env.AI_API_URL || !env.AI_API_KEY || !env.AI_MODEL) {
    throw new Error('AI chat is not configured. Set AI_API_URL, AI_API_KEY and AI_MODEL.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  try {
    const response = await fetch(env.AI_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.AI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: env.AI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt(responseLanguage) },
          ...history,
          { role: 'user', content: userMessage }
        ],
        temperature: 0.6
      }),
      signal: controller.signal
    });

    const raw = await response.text();
    if (!response.ok) throw new Error(normalizeApiError(response.status, raw));

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
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('The AI request timed out. Try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
