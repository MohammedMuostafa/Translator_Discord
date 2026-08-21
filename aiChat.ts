import { env } from '../config.js';
import { callTextModel } from './modelRouter.js';

export type ChatResponseLanguage = 'auto' | 'ar-eg' | 'ar-msa' | 'en' | 'fa';
export interface ChatTurn { role: 'user' | 'assistant'; content: string; }

function languageInstruction(language: ChatResponseLanguage): string {
  switch (language) {
    case 'ar-eg': return 'Reply in natural Egyptian Arabic unless the user explicitly asks for another language.';
    case 'ar-msa': return 'Reply in clear Modern Standard Arabic unless the user explicitly asks for another language.';
    case 'en': return 'Reply in English unless the user explicitly asks for another language.';
    case 'fa': return 'Reply in Persian (Farsi) unless the user explicitly asks for another language.';
    default: return 'Automatically detect the user language and normally reply in the same language. If the user switches language, follow them naturally.';
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

export function aiChatConfigured(): boolean {
  return Boolean(env.AI_API_URL && env.AI_API_KEY && env.AI_MODEL);
}

export async function askAiChat(
  history: ChatTurn[],
  userMessage: string,
  responseLanguage: ChatResponseLanguage,
  modelOverride?: string
): Promise<string> {
  const response = await callTextModel(
    'chat',
    [
      { role: 'system', content: systemPrompt(responseLanguage) },
      ...history,
      { role: 'user', content: userMessage }
    ],
    {
      temperature: 0.55,
      timeoutMs: env.AI_ACTION_TIMEOUT_MS,
      modelOverride
    }
  );
  return response.text;
}
