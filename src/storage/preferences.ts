import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { env } from '../config.js';
import { normalizeLanguage } from '../languages.js';
import type { TranslationProvider, TranslationStyle } from '../providers/translator.js';

export type Preference = {
  incoming: string;
  outgoing: string;
  provider: TranslationProvider | 'default';
  style: TranslationStyle;
  quick_translate: boolean;
  translate_target: string;
};

type PreferenceFile = Record<string, Partial<Preference>>;

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
  const stored = data[userId] ?? {};
  const incoming = stored.incoming ? normalizeLanguage(stored.incoming) : normalizeLanguage(env.DEFAULT_INCOMING_LANGUAGE);
  const outgoing = stored.outgoing ? normalizeLanguage(stored.outgoing) : normalizeLanguage(env.DEFAULT_OUTGOING_LANGUAGE);
  const translate_target = stored.translate_target ? normalizeLanguage(stored.translate_target) : incoming;
  const quick_translate = stored.quick_translate !== undefined ? Boolean(stored.quick_translate) : true;

  return {
    incoming,
    outgoing,
    provider: stored.provider ?? 'default',
    style: stored.style ?? 'natural',
    quick_translate,
    translate_target
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
    outgoing: updates.outgoing ? normalizeLanguage(updates.outgoing) : current.outgoing,
    provider: updates.provider ?? current.provider,
    style: updates.style ?? current.style,
    quick_translate: updates.quick_translate !== undefined ? Boolean(updates.quick_translate) : current.quick_translate,
    translate_target: updates.translate_target ? normalizeLanguage(updates.translate_target) : current.translate_target
  };
  data[userId] = next;

  writeQueue = writeQueue.then(() => persist(data));
  await writeQueue;
  return next;
}
