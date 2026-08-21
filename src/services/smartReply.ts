import { env } from '../config.js';
import {
  languageInstruction,
  normalizeLanguage
} from '../languages.js';
import { callTextModel } from './modelRouter.js';

export type SmartReplyMode =
  | 'normal'
  | 'alternative'
  | 'shorter'
  | 'detailed';

export type SmartReplyResult = {
  isQuestion: boolean;
  sourceLanguage: string;
  sourceLanguageCode: string;
  translatedMessage: string;
  answer: string;
  answerArabic: string;
};

function cleanJsonCandidate(content: string): string {
  const clean = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  if (clean.startsWith('{') && clean.endsWith('}')) {
    return clean;
  }

  const first = clean.indexOf('{');
  const last = clean.lastIndexOf('}');

  return first >= 0 && last > first
    ? clean.slice(first, last + 1)
    : clean;
}

function modeInstruction(
  mode: SmartReplyMode
): string {
  switch (mode) {
    case 'alternative':
      return 'Create a meaningfully different alternative reply from the previous one.';
    case 'shorter':
      return 'Make the proposed reply short, direct, and natural while preserving the useful answer.';
    case 'detailed':
      return 'Make the proposed reply more helpful and detailed, but still natural for Discord.';
    default:
      return 'Create the most natural, useful reply for the message.';
  }
}

function parseResult(
  content: string
): SmartReplyResult {
  const parsed = JSON.parse(
    cleanJsonCandidate(content)
  ) as Partial<SmartReplyResult>;

  const result: SmartReplyResult = {
    isQuestion: parsed.isQuestion === true,
    sourceLanguage:
      typeof parsed.sourceLanguage === 'string'
        ? parsed.sourceLanguage.trim()
        : 'Detected language',
    sourceLanguageCode:
      typeof parsed.sourceLanguageCode === 'string'
        ? parsed.sourceLanguageCode.trim()
        : 'auto',
    translatedMessage:
      typeof parsed.translatedMessage === 'string'
        ? parsed.translatedMessage.trim()
        : '',
    answer:
      typeof parsed.answer === 'string'
        ? parsed.answer.trim()
        : '',
    answerArabic:
      typeof parsed.answerArabic === 'string'
        ? parsed.answerArabic.trim()
        : ''
  };

  if (
    !result.translatedMessage ||
    !result.answer ||
    !result.answerArabic
  ) {
    throw new Error(
      'AI returned an incomplete smart reply.'
    );
  }

  return result;
}

export function smartReplyConfigured(): boolean {
  return Boolean(
    env.AI_API_KEY &&
    env.AI_MODEL
  );
}

export async function createSmartReply(
  sourceMessage: string,
  outputLanguage: string,
  mode: SmartReplyMode = 'normal',
  previousAnswer?: string
): Promise<SmartReplyResult> {
  const clean = sourceMessage.trim();

  if (!clean) {
    throw new Error(
      'There is no message text to answer.'
    );
  }

  if (
    clean.length >
    env.AI_ACTION_MAX_CHARS
  ) {
    throw new Error(
      `This message is too long. Maximum: ${env.AI_ACTION_MAX_CHARS.toLocaleString()} characters.`
    );
  }

  const normalizedLanguage =
    normalizeLanguage(outputLanguage, true);
  const arabicLanguage =
    languageInstruction(normalizedLanguage);

  const previous =
    previousAnswer?.trim()
      ? `\nPrevious proposed reply in the sender's language:\n${previousAnswer.trim()}`
      : '';

  const response =
    await callTextModel(
      'smart_reply',
      [
        {
          role: 'system',
          content: [
            'You are TD AI Smart Answer.',
            'First detect the exact source language and locale of the selected Discord message.',
            `Translate the source message into ${arabicLanguage} so the current user understands it.`,
            'Then create the ACTUAL reply in the SAME language and natural locale as the original sender.',
            'English sender -> English answer. Persian sender -> Persian answer. Egyptian Arabic sender -> Egyptian Arabic answer. Apply the same rule to every other language.',
            `Also translate your proposed reply into ${arabicLanguage} for the current user.`,
            'If the source is a real question, answer it directly and usefully. If it is not a question, draft a natural contextual response.',
            'Never accidentally answer the sender in Arabic merely because the current user wants an Arabic explanation.',
            'Preserve names, numbers, links, emojis, technical terms, and intent.',
            'Do not invent private facts or actions the current user did not take.',
            modeInstruction(mode),
            'Return JSON only with exactly these keys:',
            '{"isQuestion":true,"sourceLanguage":"English","sourceLanguageCode":"en","translatedMessage":"Arabic translation of the source message","answer":"reply in the sender language","answerArabic":"Arabic meaning of the proposed reply"}'
          ].join(' ')
        },
        {
          role: 'user',
          content:
            `Source message:\n${clean}${previous}`
        }
      ],
      {
        temperature:
          mode === 'alternative'
            ? 0.75
            : 0.35,
        timeoutMs:
          env.AI_ACTION_TIMEOUT_MS
      }
    );

  try {
    return parseResult(response.text);
  } catch (error) {
    console.error(
      `Smart reply parse failed from ${response.provider}/${response.model}:`,
      error
    );
    throw new Error(
      'The Smart Answer model returned an invalid structured result. Try again or select another model in AI Routing.'
    );
  }
}

export async function translateEditedReplyToArabic(
  answer: string,
  outputLanguage: string
): Promise<string> {
  const target = languageInstruction(
    normalizeLanguage(
      outputLanguage,
      true
    )
  );

  const response =
    await callTextModel(
      'smart_reply',
      [
        {
          role: 'system',
          content:
            `Translate the user's edited reply into ${target}. Preserve meaning, names, emojis, links and tone. Return JSON only: {"translation":"..."}.`
        },
        {
          role: 'user',
          content: answer.trim()
        }
      ],
      {
        temperature: 0.1,
        timeoutMs:
          env.AI_ACTION_TIMEOUT_MS
      }
    );

  try {
    const parsed = JSON.parse(
      cleanJsonCandidate(response.text)
    ) as { translation?: unknown };

    if (
      typeof parsed.translation !== 'string' ||
      !parsed.translation.trim()
    ) {
      throw new Error('missing translation');
    }

    return parsed.translation.trim();
  } catch {
    // Keep edit-answer usable even if a non-JSON OpenAI-compatible
    // provider ignores the JSON instruction.
    return response.text.trim();
  }
}
