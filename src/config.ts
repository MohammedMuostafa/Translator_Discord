import 'dotenv/config';
import { z } from 'zod';

const optionalUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().url().optional()
);

const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional()
);

const schema = z.object({
  DISCORD_APP_ID: z.string().min(1),
  DISCORD_PUBLIC_KEY: z.string().min(1),
  DISCORD_BOT_TOKEN: optionalString,
  REGISTER_COMMANDS_ON_START: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),

  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(8080),
  PUBLIC_BASE_URL: optionalUrl,

  TRANSLATION_PROVIDER: z.enum(['libretranslate', 'google', 'deepl', 'ai']).default('libretranslate'),
  LIBRETRANSLATE_URL: optionalUrl,
  LIBRETRANSLATE_API_KEY: optionalString,
  GOOGLE_TRANSLATE_API_KEY: optionalString,
  DEEPL_API_KEY: optionalString,
  DEEPL_API_URL: z.string().url().default('https://api-free.deepl.com/v2/translate'),

  // Generic OpenAI-compatible endpoint used by translation, /ai and DM chat.
  AI_API_URL: optionalUrl,
  AI_API_KEY: optionalString,
  AI_MODEL: optionalString,
  AI_ACTION_MAX_CHARS: z.coerce.number().int().min(500).max(20000).default(8000),
  AI_ACTION_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(180_000).default(60_000),

  // Private interactive DM AI chat. Memory is RAM-only and auto-expires.
  CHAT_SESSION_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(120),
  CHAT_MAX_HISTORY: z.coerce.number().int().min(2).max(100).default(20),
  CHAT_MAX_INPUT_CHARS: z.coerce.number().int().min(200).max(20000).default(6000),

  // Gemini TTS. Streaming avoids the previous 45-second long-text timeout.
  // If GEMINI_TTS_API_KEY is omitted, AI_API_KEY is reused.
  GEMINI_TTS_API_KEY: optionalString,
  GEMINI_TTS_MODEL: z.string().min(1).default('gemini-3.1-flash-tts-preview'),
  GEMINI_TTS_VOICE: z.string().min(1).default('Kore'),
  TTS_MAX_CHARS: z.coerce.number().int().min(100).max(10000).default(4000),
  TTS_CHUNK_CHARS: z.coerce.number().int().min(250).max(2000).default(900),
  TTS_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(30_000).max(300_000).default(120_000),

  STT_URL: optionalUrl,
  STT_API_KEY: optionalString,
  MAX_AUDIO_BYTES: z.coerce.number().int().positive().default(15 * 1024 * 1024),

  DATA_DIR: z.string().default('./data'),
  DEFAULT_INCOMING_LANGUAGE: z.string().min(2).max(16).default('ar-msa'),
  DEFAULT_OUTGOING_LANGUAGE: z.string().min(2).max(16).default('en')
});

export const env = schema.parse(process.env);
