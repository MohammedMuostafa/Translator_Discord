import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config.js';

export type UserHeadingSize = 'small' | 'medium' | 'large';
export type UserDensity = 'compact' | 'comfortable' | 'relaxed';
export type ResultDestination = 'channel' | 'dm' | 'both';
export type TranslationStyle = 'natural' | 'casual' | 'formal' | 'literal';
export type TranslationProvider = 'default' | 'ai' | 'google' | 'deepl' | 'libretranslate';
export type ImageQuality = 'draft' | 'standard' | 'premium';
export type VideoQuality = 'lite' | 'fast' | 'cinematic';

export type UserPersonalization = {
  // Voice & Wake
  wakeName: string;
  followupWindowMs: number;
  voiceName: string;
  responseDelayMs: number;

  // Translation & Language
  myLanguage: string;
  autoTranslateToMyLanguage: boolean;
  outgoingLanguage: string;
  translationStyle: TranslationStyle;
  translationProvider: TranslationProvider;

  // Assistant & Media
  resultDestination: ResultDestination;
  defaultReplyLanguage: string;
  defaultImageAspect: string;
  imageQuality: ImageQuality;
  defaultVideoAspect: string;
  videoQuality: VideoQuality;

  // Formatting
  headingSize: UserHeadingSize;
  density: UserDensity;
  showEmojis: boolean;
  showOriginal: boolean;
};

type Store = {
  version: 2;
  users: Record<string, UserPersonalization>;
  updatedAt: string;
};

const FILE = path.join(env.DATA_DIR, 'user-personalization.json');
let cached: Store | undefined;
let writeChain = Promise.resolve();

export const ALLOWED_VOICES = [
  'Kore',
  'Puck',
  'Charon',
  'Aoede',
  'Fenrir',
  'Leda',
  'Achird',
  'Sulafat',
  'Gacrux',
  'Vindemiatrix'
] as const;

export const defaults: UserPersonalization = {
  wakeName: 'TD',
  followupWindowMs: 5000,
  voiceName: 'Kore',
  responseDelayMs: 250,

  myLanguage: env.DEFAULT_INCOMING_LANGUAGE || 'ar-eg',
  autoTranslateToMyLanguage: true,
  outgoingLanguage: env.DEFAULT_OUTGOING_LANGUAGE || 'en',
  translationStyle: 'natural',
  translationProvider: 'default',

  resultDestination: 'channel',
  defaultReplyLanguage: 'auto',
  defaultImageAspect: '1:1',
  imageQuality: 'standard',
  defaultVideoAspect: '16:9',
  videoQuality: 'fast',

  headingSize: 'medium',
  density: 'comfortable',
  showEmojis: true,
  showOriginal: true
};

function cleanVoice(value: unknown): string {
  const raw = String(value ?? '').trim();
  return ALLOWED_VOICES.includes(raw as typeof ALLOWED_VOICES[number])
    ? raw
    : defaults.voiceName;
}

function sanitize(input: Partial<UserPersonalization> | undefined): UserPersonalization {
  const headingSize: UserHeadingSize =
    input?.headingSize === 'small' || input?.headingSize === 'large'
      ? input.headingSize
      : 'medium';

  const density: UserDensity =
    input?.density === 'compact' || input?.density === 'relaxed'
      ? input.density
      : 'comfortable';

  const resultDestination: ResultDestination =
    input?.resultDestination === 'dm' || input?.resultDestination === 'both'
      ? input.resultDestination
      : 'channel';

  const translationStyle: TranslationStyle =
    input?.translationStyle && ['natural', 'casual', 'formal', 'literal'].includes(input.translationStyle)
      ? input.translationStyle
      : 'natural';

  const translationProvider: TranslationProvider =
    input?.translationProvider && ['default', 'ai', 'google', 'deepl', 'libretranslate'].includes(input.translationProvider)
      ? input.translationProvider
      : 'default';

  const imageQuality: ImageQuality =
    input?.imageQuality && ['draft', 'standard', 'premium'].includes(input.imageQuality)
      ? input.imageQuality
      : 'standard';

  const videoQuality: VideoQuality =
    input?.videoQuality && ['lite', 'fast', 'cinematic'].includes(input.videoQuality)
      ? input.videoQuality
      : 'fast';

  const wakeName = String(input?.wakeName ?? defaults.wakeName).trim() || defaults.wakeName;

  return {
    wakeName,
    followupWindowMs: Math.min(
      30_000,
      Math.max(1_000, Math.round(Number(input?.followupWindowMs ?? defaults.followupWindowMs)))
    ),
    voiceName: cleanVoice(input?.voiceName),
    responseDelayMs: Math.min(
      3000,
      Math.max(0, Math.round(Number(input?.responseDelayMs ?? defaults.responseDelayMs)))
    ),

    myLanguage: String(input?.myLanguage ?? defaults.myLanguage).trim() || defaults.myLanguage,
    autoTranslateToMyLanguage: input?.autoTranslateToMyLanguage !== false,
    outgoingLanguage: String(input?.outgoingLanguage ?? defaults.outgoingLanguage).trim() || defaults.outgoingLanguage,
    translationStyle,
    translationProvider,

    resultDestination,
    defaultReplyLanguage: String(input?.defaultReplyLanguage ?? defaults.defaultReplyLanguage).trim() || defaults.defaultReplyLanguage,
    defaultImageAspect: String(input?.defaultImageAspect ?? defaults.defaultImageAspect).trim() || defaults.defaultImageAspect,
    imageQuality,
    defaultVideoAspect: String(input?.defaultVideoAspect ?? defaults.defaultVideoAspect).trim() || defaults.defaultVideoAspect,
    videoQuality,

    headingSize,
    density,
    showEmojis: input?.showEmojis !== false,
    showOriginal: input?.showOriginal !== false
  };
}

function emptyStore(): Store {
  return {
    version: 2,
    users: {},
    updatedAt: new Date().toISOString()
  };
}

async function load(): Promise<Store> {
  if (cached) return cached;
  try {
    const raw = await readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Store>;
    cached = {
      ...emptyStore(),
      ...parsed,
      users: parsed.users ?? {}
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Could not load user personalization:', error);
    }
    cached = emptyStore();
  }
  return cached;
}

async function persist(store: Store): Promise<void> {
  store.updatedAt = new Date().toISOString();
  cached = store;

  writeChain = writeChain.then(async () => {
    await mkdir(env.DATA_DIR, { recursive: true });
    const temp = `${FILE}.tmp`;
    await writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    await rename(temp, FILE);
  });

  await writeChain;
}

export async function getUserPersonalization(userId: string): Promise<UserPersonalization> {
  const store = await load();
  return sanitize(store.users[userId]);
}

export async function setUserPersonalization(
  userId: string,
  patch: Partial<UserPersonalization>
): Promise<UserPersonalization> {
  const store = await load();
  const current = sanitize(store.users[userId]);
  const next = sanitize({ ...current, ...patch });
  store.users[userId] = next;
  await persist(store);
  return next;
}
