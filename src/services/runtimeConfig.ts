import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config.js';

export type TextTask = 'translation' | 'chat' | 'ai_tools' | 'smart_reply';
export type GeminiTask = 'voice_live' | 'stt' | 'tts';
export type RuntimeTask = TextTask | GeminiTask;
export type ProviderKind = 'openai-compatible' | 'gemini-native';
export type ThinkingLevelName = 'minimal' | 'low' | 'medium' | 'high';

export type ProviderProfile = {
  id: string;
  name: string;
  kind: ProviderKind;
  apiUrl?: string;
  encryptedApiKey: string;
  apiKeyHint: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TaskRoute = {
  providerId: string;
  model: string;
};

export type VoiceRuntimeSettings = {
  thinkingLevel: ThinkingLevelName;
  silenceMs: number;
  liveVoice: string;
  ttsVoice: string;
};

type RuntimeConfigFile = {
  version: 1;
  providers: ProviderProfile[];
  routes: Partial<Record<RuntimeTask, TaskRoute>>;
  voice: Partial<VoiceRuntimeSettings>;
  updatedAt: string;
};

const CONFIG_FILE = path.join(env.DATA_DIR, 'runtime-config.json');
const TEXT_TASKS = new Set<TextTask>(['translation', 'chat', 'ai_tools', 'smart_reply']);

let cached: RuntimeConfigFile | undefined;
let writeChain = Promise.resolve();

function defaultConfig(): RuntimeConfigFile {
  return {
    version: 1,
    providers: [],
    routes: {},
    voice: {},
    updatedAt: new Date().toISOString()
  };
}

function encryptionKey(): Buffer {
  if (!env.DASHBOARD_ENCRYPTION_KEY) {
    throw new Error('DASHBOARD_ENCRYPTION_KEY is required before API keys can be saved from the dashboard.');
  }
  return createHash('sha256').update(env.DASHBOARD_ENCRYPTION_KEY, 'utf8').digest();
}

function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function decryptSecret(value: string): string {
  const [version, ivRaw, tagRaw, ciphertextRaw] = value.split('.');
  if (version !== 'v1' || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error('Stored provider secret has an unsupported format.');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

async function load(): Promise<RuntimeConfigFile> {
  if (cached) return cached;
  try {
    const raw = await readFile(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw) as RuntimeConfigFile;
    cached = {
      ...defaultConfig(),
      ...parsed,
      providers: Array.isArray(parsed.providers) ? parsed.providers : [],
      routes: parsed.routes ?? {},
      voice: parsed.voice ?? {}
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') console.error('Could not read runtime config:', error);
    cached = defaultConfig();
  }
  return cached;
}

async function persist(next: RuntimeConfigFile): Promise<void> {
  cached = next;
  writeChain = writeChain.then(async () => {
    await mkdir(env.DATA_DIR, { recursive: true });
    const temp = `${CONFIG_FILE}.tmp`;
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temp, CONFIG_FILE);
  });
  await writeChain;
}

function providerById(config: RuntimeConfigFile, id: string): ProviderProfile | undefined {
  return config.providers.find((provider) => provider.id === id && provider.enabled);
}

export async function getAdminRuntimeSnapshot() {
  const config = await load();
  const envGeminiKey = env.GEMINI_LIVE_API_KEY ?? env.GEMINI_TTS_API_KEY ?? env.AI_API_KEY;

  return {
    providers: [
      {
        id: 'env-text',
        name: 'Environment Text AI',
        kind: 'openai-compatible' as const,
        apiUrl: env.AI_API_URL,
        apiKeyHint: env.AI_API_KEY ? `••••${env.AI_API_KEY.slice(-4)}` : 'Not configured',
        enabled: Boolean(env.AI_API_URL && env.AI_API_KEY),
        builtIn: true
      },
      {
        id: 'env-gemini',
        name: 'Environment Gemini',
        kind: 'gemini-native' as const,
        apiKeyHint: envGeminiKey ? `••••${envGeminiKey.slice(-4)}` : 'Not configured',
        enabled: Boolean(envGeminiKey),
        builtIn: true
      },
      ...config.providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        kind: provider.kind,
        apiUrl: provider.apiUrl,
        apiKeyHint: provider.apiKeyHint,
        enabled: provider.enabled
      }))
    ],
    routes: config.routes,
    voice: {
      thinkingLevel: config.voice.thinkingLevel ?? env.GEMINI_LIVE_THINKING_LEVEL,
      silenceMs: config.voice.silenceMs ?? env.VOICE_AI_SILENCE_MS,
      liveVoice: config.voice.liveVoice ?? env.GEMINI_LIVE_VOICE,
      ttsVoice: config.voice.ttsVoice ?? env.GEMINI_TTS_VOICE
    },
    tasks: [
      { id: 'translation', kind: 'openai-compatible', label: 'Translation' },
      { id: 'chat', kind: 'openai-compatible', label: 'AI Chat' },
      { id: 'ai_tools', kind: 'openai-compatible', label: 'Summarize / Explain / Rewrite' },
      { id: 'smart_reply', kind: 'openai-compatible', label: 'Smart Answer' },
      { id: 'voice_live', kind: 'gemini-native', label: 'Live Voice' },
      { id: 'stt', kind: 'gemini-native', label: 'Speech Recognition' },
      { id: 'tts', kind: 'gemini-native', label: 'Listen / TTS' }
    ],
    storageFile: CONFIG_FILE
  };
}

export async function upsertRuntimeProvider(input: {
  id?: string;
  name: string;
  kind: ProviderKind;
  apiUrl?: string;
  apiKey?: string;
  enabled?: boolean;
}): Promise<string> {
  if (!input.name.trim()) throw new Error('Provider name is required.');
  if (input.kind === 'openai-compatible') {
    if (!input.apiUrl?.trim()) throw new Error('OpenAI-compatible providers need a Chat Completions URL.');
    new URL(input.apiUrl);
  }

  const config = await load();
  const existing = input.id ? config.providers.find((provider) => provider.id === input.id) : undefined;
  const apiKey = input.apiKey?.trim();
  if (!existing && !apiKey) throw new Error('API key is required for a new provider.');

  const now = new Date().toISOString();
  const provider: ProviderProfile = {
    id: existing?.id ?? randomUUID(),
    name: input.name.trim(),
    kind: input.kind,
    apiUrl: input.kind === 'openai-compatible' ? input.apiUrl?.trim() : undefined,
    encryptedApiKey: apiKey ? encryptSecret(apiKey) : existing!.encryptedApiKey,
    apiKeyHint: apiKey ? `••••${apiKey.slice(-4)}` : existing!.apiKeyHint,
    enabled: input.enabled ?? existing?.enabled ?? true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  const providers = existing
    ? config.providers.map((item) => item.id === provider.id ? provider : item)
    : [...config.providers, provider];

  await persist({ ...config, providers, updatedAt: now });
  return provider.id;
}

export async function deleteRuntimeProvider(id: string): Promise<void> {
  if (id === 'env-text' || id === 'env-gemini') throw new Error('Built-in environment providers cannot be deleted.');
  const config = await load();
  const routes = { ...config.routes };
  for (const [task, route] of Object.entries(routes)) {
    if (route?.providerId === id) delete routes[task as RuntimeTask];
  }
  await persist({
    ...config,
    providers: config.providers.filter((provider) => provider.id !== id),
    routes,
    updatedAt: new Date().toISOString()
  });
}

export async function setRuntimeRoute(task: RuntimeTask, route: TaskRoute): Promise<void> {
  const config = await load();
  const expectedKind: ProviderKind = TEXT_TASKS.has(task as TextTask) ? 'openai-compatible' : 'gemini-native';
  if (!route.model.trim()) throw new Error('Model name is required.');

  if (route.providerId === 'env-text' && expectedKind !== 'openai-compatible') {
    throw new Error('This task needs a Gemini-native provider.');
  }
  if (route.providerId === 'env-gemini' && expectedKind !== 'gemini-native') {
    throw new Error('This task needs an OpenAI-compatible provider.');
  }

  if (!['env-text', 'env-gemini'].includes(route.providerId)) {
    const provider = providerById(config, route.providerId);
    if (!provider) throw new Error('Selected provider is missing or disabled.');
    if (provider.kind !== expectedKind) throw new Error(`Task '${task}' requires provider kind '${expectedKind}'.`);
  }

  await persist({
    ...config,
    routes: { ...config.routes, [task]: { providerId: route.providerId, model: route.model.trim() } },
    updatedAt: new Date().toISOString()
  });
}

export async function setVoiceRuntimeSettings(input: Partial<VoiceRuntimeSettings>): Promise<void> {
  const config = await load();
  const voice = { ...config.voice, ...input };
  if (voice.silenceMs !== undefined && (voice.silenceMs < 200 || voice.silenceMs > 5000)) {
    throw new Error('Voice silence must be between 200ms and 5000ms.');
  }
  await persist({ ...config, voice, updatedAt: new Date().toISOString() });
}

export async function getTextTaskRoute(task: TextTask): Promise<{
  apiUrl: string;
  apiKey: string;
  model: string;
  providerName: string;
}> {
  const config = await load();
  const route = config.routes[task];
  if (!route || route.providerId === 'env-text') {
    if (!env.AI_API_URL || !env.AI_API_KEY || !env.AI_MODEL) throw new Error(`Text AI route '${task}' is not configured.`);
    return {
      apiUrl: env.AI_API_URL,
      apiKey: env.AI_API_KEY,
      model: route?.model || env.AI_MODEL,
      providerName: 'Environment Text AI'
    };
  }

  const provider = providerById(config, route.providerId);
  if (!provider || provider.kind !== 'openai-compatible' || !provider.apiUrl) {
    throw new Error(`Text AI provider for '${task}' is unavailable.`);
  }
  return {
    apiUrl: provider.apiUrl,
    apiKey: decryptSecret(provider.encryptedApiKey),
    model: route.model,
    providerName: provider.name
  };
}

export async function getGeminiTaskRoute(task: GeminiTask): Promise<{
  apiKey: string;
  model: string;
  providerName: string;
}> {
  const config = await load();
  const route = config.routes[task];
  const fallbackModel = task === 'voice_live' ? env.GEMINI_LIVE_MODEL : task === 'stt' ? env.GEMINI_STT_MODEL : env.GEMINI_TTS_MODEL;

  if (!route || route.providerId === 'env-gemini') {
    const apiKey = task === 'voice_live'
      ? env.GEMINI_LIVE_API_KEY ?? env.AI_API_KEY
      : task === 'stt'
        ? env.GEMINI_STT_API_KEY ?? env.GEMINI_TTS_API_KEY ?? env.AI_API_KEY
        : env.GEMINI_TTS_API_KEY ?? env.AI_API_KEY;
    if (!apiKey || !fallbackModel) throw new Error(`Gemini route '${task}' is not configured.`);
    return { apiKey, model: route?.model || fallbackModel, providerName: 'Environment Gemini' };
  }

  const provider = providerById(config, route.providerId);
  if (!provider || provider.kind !== 'gemini-native') throw new Error(`Gemini provider for '${task}' is unavailable.`);
  return { apiKey: decryptSecret(provider.encryptedApiKey), model: route.model, providerName: provider.name };
}

export async function getVoiceRuntimeSettings(): Promise<VoiceRuntimeSettings> {
  const config = await load();
  return {
    thinkingLevel: config.voice.thinkingLevel ?? env.GEMINI_LIVE_THINKING_LEVEL,
    silenceMs: config.voice.silenceMs ?? env.VOICE_AI_SILENCE_MS,
    liveVoice: config.voice.liveVoice ?? env.GEMINI_LIVE_VOICE,
    ttsVoice: config.voice.ttsVoice ?? env.GEMINI_TTS_VOICE
  };
}
