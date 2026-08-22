import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config.js';

export type UserHeadingSize = 'small' | 'medium' | 'large';
export type UserDensity = 'compact' | 'comfortable' | 'relaxed';

export type UserPersonalization = {
  headingSize: UserHeadingSize;
  density: UserDensity;
  showEmojis: boolean;
  showOriginal: boolean;
  voiceName: string;
  responseDelayMs: number;
};

type Store = {
  version: 1;
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

const defaults: UserPersonalization = {
  headingSize: 'medium',
  density: 'comfortable',
  showEmojis: true,
  showOriginal: true,
  voiceName: 'Kore',
  responseDelayMs: 250
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

  return {
    headingSize,
    density,
    showEmojis: input?.showEmojis !== false,
    showOriginal: input?.showOriginal !== false,
    voiceName: cleanVoice(input?.voiceName),
    responseDelayMs: Math.min(
      3000,
      Math.max(0, Math.round(Number(input?.responseDelayMs ?? defaults.responseDelayMs)))
    )
  };
}

function emptyStore(): Store {
  return {
    version: 1,
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

