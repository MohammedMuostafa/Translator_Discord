import { env } from '../config.js';
import { languageInstruction, normalizeLanguage } from '../languages.js';
import { callTextModel } from './modelRouter.js';

export type SmartReplyMode = 'normal' | 'alternative' | 'shorter' | 'detailed';
export type SmartReplyResult = {
  isQuestion: boolean;
  sourceLanguage: string;
  sourceLanguageCode: string;
  translatedMessage: string;
  answer: string;
  answerArabic: string;
};

function cleanJsonCandidate(content: string): string {
  return content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function modeInstruction(mode: SmartReplyMode): string {
  switch (mode) {
    case 'alternative': return 'Create a meaningfully different alternative reply from the previous one. Do not merely rephrase a few words.';
    case 'shorter': return 'Make the proposed reply short, direct, and natural while preserving the useful answer.';
    case 'detailed': return 'Make the proposed reply more helpful and detailed, but still natural for Discord and not unnecessarily long.';
    default: return 'Create the most natural, useful reply for the message.';
  }
}

function parseResult(content: string): SmartReplyResult {
  const parsed = JSON.parse(cleanJsonCandidate(content)) as Partial<SmartReplyResult>;
  const result: SmartReplyResult = {
    isQuestion: parsed.isQuestion === true,
    sourceLanguage: typeof parsed.sourceLanguage === 'string' ? parsed.sourceLanguage.trim() : 'Detected language',
    sourceLanguageCode: typeof parsed.sourceLanguageCode === 'string' ? parsed.sourceLanguageCode.trim() : 'auto',
    translatedMessage: typeof parsed.translatedMessage === 'string' ? parsed.translatedMessage.trim() : '',
    answer: typeof parsed.answer === 'string' ? parsed.answer.trim() : '',
    answerArabic: typeof parsed.answerArabic === 'string' ? parsed.answerArabic.trim() : ''
  };
  if (!result.translatedMessage || !result.answer || !result.answerArabic) throw new Error('AI returned an incomplete smart reply.');
  return result;
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
  const clean = sourceMessage.trim();
  if (!clean) throw new Error('There is no message text to answer.');
  if (clean.length > env.AI_ACTION_MAX_CHARS) {
    throw new Error(`This message is too long. Maximum: ${env.AI_ACTION_MAX_CHARS.toLocaleString()} characters.`);
  }

  const normalizedLanguage = normalizeLanguage(outputLanguage, true);
  const arabicLanguage = languageInstruction(normalizedLanguage);
  const previous = previousAnswer?.trim() ? `\nPrevious proposed reply in the sender's language:\n${previousAnswer.trim()}` : '';

  const response = await callTextModel(
    'smart_reply',
    [
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
      { role: 'user', content: `Source message:\n${clean}${previous}` }
    ],
    {
      temperature: mode === 'alternative' ? 0.75 : 0.35,
      timeoutMs: env.AI_ACTION_TIMEOUT_MS
    }
  );
  return parseResult(response.text);
}

export async function translateEditedReplyToArabic(answer: string, outputLanguage: string): Promise<string> {
  const target = languageInstruction(normalizeLanguage(outputLanguage, true));
  const response = await callTextModel(
    'smart_reply',
    [
      {
        role: 'system',
        content: `Translate the user's edited reply into ${target}. Preserve meaning, names, emojis, links and tone. Return only the translation, with no commentary.`
      },
      { role: 'user', content: answer.trim() }
    ],
    { temperature: 0.1, timeoutMs: env.AI_ACTION_TIMEOUT_MS }
  );
  return response.text;
}
