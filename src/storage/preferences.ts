import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { env } from '../config.js';
import { normalizeLanguage } from '../languages.js';

type Preference = {
  incoming: string;
  outgoing: string;
};

type PreferenceFile = Record<string, Preference>;

const path = resolve(env.DATA_DIR, 'preferences.json');
let cache: PreferenceFile | null = null;
let writeQueue = Promise.resolve();

async function load(): Promise<PreferenceFile> {
  if (cache) return cache;
  try {
    const raw = await readFile(path, 'utf8');
    cache = JSON.parse(raw) as PreferenceFile;
  } catch {
    cache = {};
  }
  return cache;
}

async function persist(data: PreferenceFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmp, path);
}

export async function getPreference(userId: string): Promise<Preference> {
  const data = await load();
  return data[userId] ?? {
    incoming: env.DEFAULT_INCOMING_LANGUAGE,
    outgoing: env.DEFAULT_OUTGOING_LANGUAGE
  };
}

export async function updatePreference(
  userId: string,
  updates: Partial<Preference>
): Promise<Preference> {
  const data = await load();
  const current = await getPreference(userId);
  const next: Preference = {
    incoming: updates.incoming ? normalizeLanguage(updates.incoming) : current.incoming,
    outgoing: updates.outgoing ? normalizeLanguage(updates.outgoing) : current.outgoing
  };
  data[userId] = next;

  writeQueue = writeQueue.then(() => persist(data));
  await writeQueue;
  return next;
}
