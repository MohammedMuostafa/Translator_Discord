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

  // Only needed by `npm run register`, not by the running HTTP service.
  DISCORD_BOT_TOKEN: optionalString,
  REGISTER_COMMANDS_ON_START: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),

  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(8080),
  PUBLIC_BASE_URL: optionalUrl,

  TRANSLATION_PROVIDER: z.enum(['libretranslate', 'google', 'deepl']).default('libretranslate'),
  LIBRETRANSLATE_URL: optionalUrl,
  LIBRETRANSLATE_API_KEY: optionalString,
  GOOGLE_TRANSLATE_API_KEY: optionalString,
  DEEPL_API_KEY: optionalString,
  DEEPL_API_URL: z.string().url().default('https://api-free.deepl.com/v2/translate'),

  // Voice is optional. The app still boots and text translation still works without STT.
  STT_URL: optionalUrl,
  STT_API_KEY: optionalString,
  MAX_AUDIO_BYTES: z.coerce.number().int().positive().default(15 * 1024 * 1024),

  DATA_DIR: z.string().default('./data'),
  DEFAULT_INCOMING_LANGUAGE: z.string().min(2).max(16).default('ar'),
  DEFAULT_OUTGOING_LANGUAGE: z.string().min(2).max(16).default('en')
});

export const env = schema.parse(process.env);
