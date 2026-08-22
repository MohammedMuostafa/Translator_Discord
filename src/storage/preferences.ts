import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { env } from '../config.js';
import { normalizeLanguage } from '../languages.js';
import type { TranslationProvider, TranslationStyle } from '../providers/translator.js';
import { getUserPersonalization } from '../services/userPersonalization.js';

export type Preference = {
  incoming: string;
  outgoing: string;
  provider: TranslationProvider | 'default';
  style: TranslationStyle;
  quick_translate: boolean;
  translate_target: string;
  autoTranslateToMyLanguage: boolean;
  myLanguage: string;
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
  const [data, personal] = await Promise.all([
    load(),
    getUserPersonalization(userId).catch(() => undefined)
  ]);
  const stored = data[userId] ?? {};

  const myLanguage = personal?.myLanguage
    ? normalizeLanguage(personal.myLanguage)
    : stored.myLanguage
      ? normalizeLanguage(stored.myLanguage)
      : stored.incoming
        ? normalizeLanguage(stored.incoming)
        : normalizeLanguage(env.DEFAULT_INCOMING_LANGUAGE || 'ar-eg');

  const incoming = myLanguage;

  const outgoing = personal?.outgoingLanguage
    ? normalizeLanguage(personal.outgoingLanguage)
    : stored.outgoing
      ? normalizeLanguage(stored.outgoing)
      : normalizeLanguage(env.DEFAULT_OUTGOING_LANGUAGE || 'en');

  const autoTranslateToMyLanguage = personal?.autoTranslateToMyLanguage !== undefined
    ? personal.autoTranslateToMyLanguage
    : stored.autoTranslateToMyLanguage !== undefined
      ? Boolean(stored.autoTranslateToMyLanguage)
      : stored.quick_translate !== undefined
        ? Boolean(stored.quick_translate)
        : true;

  const quick_translate = autoTranslateToMyLanguage;
  const translate_target = myLanguage;

  const provider = (personal?.translationProvider || stored.provider || 'default') as TranslationProvider | 'default';
  const style = (personal?.translationStyle || stored.style || 'natural') as TranslationStyle;

  return {
    incoming,
    outgoing,
    provider,
    style,
    quick_translate,
    translate_target,
    autoTranslateToMyLanguage,
    myLanguage
  };
}

export async function updatePreference(
  userId: string,
  updates: Partial<Preference>
): Promise<Preference> {
  const data = await load();
  const current = await getPreference(userId);
  const next: Preference = {
    incoming: updates.incoming ? normalizeLanguage(updates.incoming) : (updates.myLanguage ? normalizeLanguage(updates.myLanguage) : current.incoming),
    outgoing: updates.outgoing ? normalizeLanguage(updates.outgoing) : current.outgoing,
    provider: updates.provider ?? current.provider,
    style: updates.style ?? current.style,
    quick_translate: updates.autoTranslateToMyLanguage !== undefined
      ? Boolean(updates.autoTranslateToMyLanguage)
      : updates.quick_translate !== undefined
        ? Boolean(updates.quick_translate)
        : current.quick_translate,
    translate_target: updates.translate_target ? normalizeLanguage(updates.translate_target) : current.translate_target,
    autoTranslateToMyLanguage: updates.autoTranslateToMyLanguage !== undefined
      ? Boolean(updates.autoTranslateToMyLanguage)
      : updates.quick_translate !== undefined
        ? Boolean(updates.quick_translate)
        : current.autoTranslateToMyLanguage,
    myLanguage: updates.myLanguage ? normalizeLanguage(updates.myLanguage) : (updates.incoming ? normalizeLanguage(updates.incoming) : current.myLanguage)
  };
  data[userId] = next;

  writeQueue = writeQueue.then(() => persist(data));
  await writeQueue;
  return next;
}
