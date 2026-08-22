import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config.js';

export type VoiceActivationMode = 'wake-word' | 'always';
export type FollowupSpeaker = 'same' | 'anyone';
export type VoiceProductMode = 'conversation' | 'translation' | 'hybrid';
export type TranslationQuality = 'fast' | 'balanced' | 'accurate';
export type TranslationOutput = 'voice' | 'captions' | 'both';

export type VoiceControlSettings = {
  activationMode: VoiceActivationMode;
  wakeWords: string[];
  wakeResponse: string;
  wakeWindowMs: number;
  followupWindowMs: number;
  followupSpeaker: FollowupSpeaker;
  productMode: VoiceProductMode;
  translationLanguageA: string;
  translationLanguageB: string;
  translationQuality: TranslationQuality;
  translationOutput: TranslationOutput;
  captions: boolean;
  humanLikeMode: boolean;
};

const FILE = path.join(env.DATA_DIR, 'voice-control.json');
let cached: VoiceControlSettings | undefined;
let writeChain = Promise.resolve();

const defaults: VoiceControlSettings = {
  activationMode: 'always',
  wakeWords: ['td', 'td ai', 'translator', 'تي دي', 'يا تي دي'],
  wakeResponse: 'Yes?',
  wakeWindowMs: 3_000,
  followupWindowMs: 3_000,
  followupSpeaker: 'same',
  productMode: 'conversation',
  translationLanguageA: 'en',
  translationLanguageB: 'ar-eg',
  translationQuality: 'balanced',
  translationOutput: 'both',
  captions: true,
  humanLikeMode: true
};

function sanitize(value: Partial<VoiceControlSettings>): VoiceControlSettings {
  const wakeWords = Array.isArray(value.wakeWords)
    ? value.wakeWords.map((item) => String(item).trim()).filter(Boolean).slice(0, 12)
    : defaults.wakeWords;

  return {
    activationMode: 'always',
    wakeWords: wakeWords.length ? wakeWords : defaults.wakeWords,
    wakeResponse: String(value.wakeResponse ?? defaults.wakeResponse).slice(0, 120),
    wakeWindowMs: Math.min(
      15_000,
      Math.max(
        2_000,
        Number(
          value.wakeWindowMs ??
          defaults.wakeWindowMs
        )
      )
    ),
    followupWindowMs: Math.min(
      15_000,
      Math.max(
        3_000,
        Number(
          value.followupWindowMs ??
          defaults.followupWindowMs
        )
      )
    ),
    followupSpeaker: value.followupSpeaker === 'anyone' ? 'anyone' : 'same',
    productMode: ['conversation', 'translation', 'hybrid'].includes(String(value.productMode))
      ? value.productMode as VoiceProductMode
      : defaults.productMode,
    translationLanguageA: String(value.translationLanguageA ?? defaults.translationLanguageA).trim() || defaults.translationLanguageA,
    translationLanguageB: String(value.translationLanguageB ?? defaults.translationLanguageB).trim() || defaults.translationLanguageB,
    translationQuality: ['fast', 'balanced', 'accurate'].includes(String(value.translationQuality))
      ? value.translationQuality as TranslationQuality
      : defaults.translationQuality,
    translationOutput: ['voice', 'captions', 'both'].includes(String(value.translationOutput))
      ? value.translationOutput as TranslationOutput
      : defaults.translationOutput,
    captions: value.captions !== false,
    humanLikeMode: value.humanLikeMode !== false
  };
}

export async function getVoiceControlSettings(): Promise<VoiceControlSettings> {
  if (cached) return cached;
  try {
    cached = sanitize(JSON.parse(await readFile(FILE, 'utf8')) as Partial<VoiceControlSettings>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Could not load voice-control settings:', error);
    }
    cached = { ...defaults };
  }
  return cached;
}

export async function setVoiceControlSettings(
  patch: Partial<VoiceControlSettings>
): Promise<VoiceControlSettings> {
  const next = sanitize({ ...(await getVoiceControlSettings()), ...patch });
  cached = next;
  writeChain = writeChain.then(async () => {
    await mkdir(env.DATA_DIR, { recursive: true });
    const temp = `${FILE}.tmp`;
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temp, FILE);
  });
  await writeChain;
  return next;
}

export function voiceControlDefaults(): VoiceControlSettings {
  return { ...defaults, wakeWords: [...defaults.wakeWords] };
}
