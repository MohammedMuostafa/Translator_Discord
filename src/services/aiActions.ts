import { env } from '../config.js';
import { languageInstruction, normalizeLanguage } from '../languages.js';
import { callTextModel } from './modelRouter.js';

export type AiAction = 'summarize' | 'explain' | 'simplify' | 'rewrite' | 'reply' | 'code' | 'ask';

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
    case 'code':
      return 'You are an expert software engineer. Write, review, optimize, debug, or explain code. Always use proper Markdown fenced code blocks with language identifiers. Provide concise, clean, production-grade solutions.';
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

export function aiActionsConfigured(): boolean {
  return Boolean(env.AI_API_URL && env.AI_API_KEY && env.AI_MODEL);
}

export async function runAiAction(
  action: AiAction,
  text: string,
  language: string,
  customQuestion?: string
): Promise<string> {
  const clean = text.trim();
  if (!clean) throw new Error('There is no text to process.');
  if (clean.length > env.AI_ACTION_MAX_CHARS) {
    throw new Error(
      `This text is too long for an AI action. Maximum: ${env.AI_ACTION_MAX_CHARS.toLocaleString()} characters.`
    );
  }

  const userContent =
    action === 'ask' || action === 'code'
      ? `Request:\n${customQuestion?.trim() || clean}`
      : `Content:\n${clean}`;

  const taskName = action === 'code' ? 'code' : 'ai_tools';

  const response = await callTextModel(
    taskName,
    [
      { role: 'system', content: systemPrompt(action, language) },
      { role: 'user', content: userContent }
    ],
    {
      temperature: action === 'reply' || action === 'rewrite' ? 0.55 : action === 'code' ? 0.2 : 0.25,
      timeoutMs: env.AI_ACTION_TIMEOUT_MS
    }
  );
  return response.text;
}
