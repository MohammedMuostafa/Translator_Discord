import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID
} from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config.js';
import type {
  DisplayDensity,
  DisplayDivider,
  DisplayHeadingSize,
  DisplayRuntimeSettings,
  GeminiTask,
  MediaTask,
  ModelRegistration,
  ProviderKind,
  ProviderProfile,
  RuntimeTask,
  TaskRoute,
  TextTask,
  TextTransport,
  ThinkingLevelName,
  VoiceRuntimeSettings,
  VoiceSpeakerAccess
} from './runtimeConfigTypes.js';

export type {
  DisplayDensity,
  DisplayDivider,
  DisplayHeadingSize,
  DisplayRuntimeSettings,
  GeminiTask,
  MediaTask,
  ModelRegistration,
  ProviderKind,
  ProviderProfile,
  RuntimeTask,
  TaskRoute,
  TextTask,
  TextTransport,
  ThinkingLevelName,
  VoiceRuntimeSettings,
  VoiceSpeakerAccess
};

export type RuntimeConfigFile = {
  version: 3;
  providers: ProviderProfile[];
  models: ModelRegistration[];
  routes: Partial<Record<RuntimeTask, TaskRoute>>;
  voice: Partial<VoiceRuntimeSettings>;
  display: Partial<DisplayRuntimeSettings>;
  updatedAt: string;
};

const CONFIG_FILE = path.join(env.DATA_DIR, 'runtime-config.json');

export const TEXT_TASKS = new Set<TextTask>([
  'translation',
  'chat',
  'code',
  'ai_tools',
  'smart_reply'
]);

export const MEDIA_TASKS = new Set<MediaTask>([
  'image_generate',
  'image_edit',
  'video_generate'
]);

export const GEMINI_TASKS = new Set<GeminiTask>([
  'voice_live',
  'voice_translate',
  'stt',
  'tts'
]);

export const ALL_TASKS: RuntimeTask[] = [
  'translation',
  'chat',
  'code',
  'ai_tools',
  'smart_reply',
  'image_generate',
  'image_edit',
  'video_generate',
  'voice_live',
  'voice_translate',
  'stt',
  'tts'
];

export const PROVIDER_KIND_CAPABILITIES: Record<ProviderKind, RuntimeTask[]> = {
  'gemini-native': [
    'translation',
    'chat',
    'code',
    'ai_tools',
    'smart_reply',
    'image_generate',
    'image_edit',
    'video_generate',
    'voice_live',
    'voice_translate',
    'stt',
    'tts'
  ],
  'openai-native': [
    'translation',
    'chat',
    'code',
    'ai_tools',
    'smart_reply',
    'image_generate',
    'image_edit',
    'stt',
    'tts'
  ],
  'openai-compatible': [
    'translation',
    'chat',
    'code',
    'ai_tools',
    'smart_reply',
    'image_generate',
    'image_edit'
  ],
  'anthropic-native': [
    'translation',
    'chat',
    'code',
    'ai_tools',
    'smart_reply'
  ],
  'openrouter': [
    'translation',
    'chat',
    'code',
    'ai_tools',
    'smart_reply',
    'image_generate'
  ]
};

export const TASK_DEFINITIONS: Array<{ id: RuntimeTask; label: string; category: 'text' | 'media' | 'voice' }> = [
  { id: 'translation', label: 'Translation', category: 'text' },
  { id: 'chat', label: 'AI Chat', category: 'text' },
  { id: 'code', label: 'Code & Dev Tasks', category: 'text' },
  { id: 'ai_tools', label: 'Summarize / Explain / Rewrite', category: 'text' },
  { id: 'smart_reply', label: 'Smart Answer', category: 'text' },
  { id: 'image_generate', label: 'Image Generation', category: 'media' },
  { id: 'image_edit', label: 'Image Editing', category: 'media' },
  { id: 'video_generate', label: 'Video Generation', category: 'media' },
  { id: 'voice_live', label: 'Live Voice AI', category: 'voice' },
  { id: 'voice_translate', label: 'Live Voice Translation', category: 'voice' },
  { id: 'stt', label: 'Speech Recognition (STT)', category: 'voice' },
  { id: 'tts', label: 'Listen / Speech (TTS)', category: 'voice' }
];

/**
 * Managed Gemini model chains.
 * Walked automatically upon rate-limits or failover.
 */
export const MANAGED_MODEL_CHAINS: Record<RuntimeTask, string> = {
  translation: [
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash'
  ].join(' | '),
  chat: [
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash'
  ].join(' | '),
  code: [
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite'
  ].join(' | '),
  ai_tools: [
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite'
  ].join(' | '),
  smart_reply: [
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash'
  ].join(' | '),
  image_generate: [
    'gemini-3.1-flash-image',
    'gemini-3.1-flash-lite-image',
    'gemini-2.5-flash-image',
    'gemini-3-pro-image'
  ].join(' | '),
  image_edit: [
    'gemini-3.1-flash-image',
    'gemini-2.5-flash-image',
    'gemini-3.1-flash-lite-image'
  ].join(' | '),
  video_generate: [
    'veo-3.1-lite-generate-preview',
    'veo-3.1-fast-generate-preview',
    'veo-3.1-generate-preview'
  ].join(' | '),
  voice_live: [
    'gemini-3.1-flash-live-preview',
    'gemini-2.5-flash-native-audio-preview-12-2025'
  ].join(' | '),
  voice_translate: 'gemini-3.5-live-translate-preview',
  stt: [
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-2.5-flash'
  ].join(' | '),
  tts: [
    'gemini-3.1-flash-tts-preview',
    'gemini-2.5-flash-preview-tts'
  ].join(' | ')
};

let cached: RuntimeConfigFile | undefined;
let writeChain = Promise.resolve();

export function normalizeModelId(value: string): string {
  const model = value.trim().replace(/^models\//i, '');
  const aliases: Record<string, string> = {
    'gemini-3.7': 'gemini-3.7-flash',
    'gemini-3.6': 'gemini-3.6-flash',
    'gemini-3.5': 'gemini-3.5-flash',
    'gemini-3.1-lite': 'gemini-3.1-flash-lite',
    'gemini-3.1-live': 'gemini-3.1-flash-live-preview',
    'gemini-3.1-tts': 'gemini-3.1-flash-tts-preview',
    'gemini-3.5-live-translate': 'gemini-3.5-live-translate-preview',
    'veo-3.1-fast': 'veo-3.1-fast-generate-preview',
    'veo-3.1-lite': 'veo-3.1-lite-generate-preview',
    'veo-3.1': 'veo-3.1-generate-preview'
  };
  return aliases[model.toLowerCase()] ?? model;
}

export function parseModelChain(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/\s*(?:\||,|\n)\s*/)
        .map((model) => normalizeModelId(model.trim()))
        .filter(Boolean)
    )
  ];
}

export function normalizeChain(value: string): string {
  return parseModelChain(value).join(' | ');
}

function defaultModels(): ModelRegistration[] {
  return [
    // Built-in Gemini Models
    {
      id: 'gemini-3.7-flash',
      providerId: 'env-gemini',
      label: 'Gemini 3.7 Flash',
      capabilities: ['translation', 'chat', 'code', 'ai_tools', 'smart_reply'],
      enabled: true,
      priority: 100
    },
    {
      id: 'gemini-3.6-flash',
      providerId: 'env-gemini',
      label: 'Gemini 3.6 Flash',
      capabilities: ['translation', 'chat', 'code', 'ai_tools', 'smart_reply'],
      enabled: true,
      priority: 90
    },
    {
      id: 'gemini-3.5-flash',
      providerId: 'env-gemini',
      label: 'Gemini 3.5 Flash',
      capabilities: ['translation', 'chat', 'code', 'ai_tools', 'smart_reply'],
      enabled: true,
      priority: 80
    },
    {
      id: 'gemini-3.1-flash-lite',
      providerId: 'env-gemini',
      label: 'Gemini 3.1 Flash Lite',
      capabilities: ['translation', 'chat', 'code', 'ai_tools', 'smart_reply', 'stt'],
      enabled: true,
      priority: 70
    },
    {
      id: 'gemini-2.5-flash',
      providerId: 'env-gemini',
      label: 'Gemini 2.5 Flash',
      capabilities: ['translation', 'chat', 'code', 'ai_tools', 'smart_reply', 'stt'],
      enabled: true,
      priority: 60
    },
    {
      id: 'gemini-3.1-flash-image',
      providerId: 'env-gemini',
      label: 'Nano Banana 2 (Gemini 3.1 Image)',
      capabilities: ['image_generate', 'image_edit'],
      enabled: true,
      priority: 100
    },
    {
      id: 'gemini-3.1-flash-lite-image',
      providerId: 'env-gemini',
      label: 'Nano Banana 2 Lite',
      capabilities: ['image_generate', 'image_edit'],
      enabled: true,
      priority: 90
    },
    {
      id: 'gemini-3-pro-image',
      providerId: 'env-gemini',
      label: 'Nano Banana Pro',
      capabilities: ['image_generate', 'image_edit'],
      enabled: true,
      priority: 80
    },
    {
      id: 'gemini-2.5-flash-image',
      providerId: 'env-gemini',
      label: 'Nano Banana (Gemini 2.5 Image)',
      capabilities: ['image_generate', 'image_edit'],
      enabled: true,
      priority: 70
    },
    {
      id: 'veo-3.1-lite-generate-preview',
      providerId: 'env-gemini',
      label: 'Veo 3.1 Lite',
      capabilities: ['video_generate'],
      enabled: true,
      priority: 100
    },
    {
      id: 'veo-3.1-fast-generate-preview',
      providerId: 'env-gemini',
      label: 'Veo 3.1 Fast',
      capabilities: ['video_generate'],
      enabled: true,
      priority: 90
    },
    {
      id: 'veo-3.1-generate-preview',
      providerId: 'env-gemini',
      label: 'Veo 3.1 Cinematic',
      capabilities: ['video_generate'],
      enabled: true,
      priority: 80
    },
    {
      id: 'gemini-omni-flash',
      providerId: 'env-gemini',
      label: 'Gemini Omni Flash (Video)',
      capabilities: ['video_generate'],
      enabled: true,
      priority: 85
    },
    {
      id: 'gemini-3.1-flash-live-preview',
      providerId: 'env-gemini',
      label: 'Gemini 3.1 Flash Live',
      capabilities: ['voice_live'],
      enabled: true,
      priority: 100
    },
    {
      id: 'gemini-2.5-flash-native-audio-preview-12-2025',
      providerId: 'env-gemini',
      label: 'Gemini 2.5 Flash Live',
      capabilities: ['voice_live'],
      enabled: true,
      priority: 90
    },
    {
      id: 'gemini-3.5-live-translate-preview',
      providerId: 'env-gemini',
      label: 'Gemini 3.5 Live Translate',
      capabilities: ['voice_translate'],
      enabled: true,
      priority: 100
    },
    {
      id: 'gemini-3.1-flash-tts-preview',
      providerId: 'env-gemini',
      label: 'Gemini 3.1 Flash TTS',
      capabilities: ['tts'],
      enabled: true,
      priority: 100
    },
    {
      id: 'gemini-2.5-flash-preview-tts',
      providerId: 'env-gemini',
      label: 'Gemini 2.5 Flash TTS',
      capabilities: ['tts'],
      enabled: true,
      priority: 90
    }
  ];
}

function defaultConfig(): RuntimeConfigFile {
  return {
    version: 3,
    providers: [],
    models: defaultModels(),
    routes: {},
    voice: {},
    display: {},
    updatedAt: new Date().toISOString()
  };
}

function normalizeRoutes(
  routes: Partial<Record<RuntimeTask, TaskRoute>>
): Partial<Record<RuntimeTask, TaskRoute>> {
  const normalized: Partial<Record<RuntimeTask, TaskRoute>> = {};
  for (const [task, route] of Object.entries(routes)) {
    if (!route?.providerId) continue;
    const typedTask = task as RuntimeTask;
    normalized[typedTask] = {
      providerId: route.providerId,
      model: route.model ? normalizeChain(route.model) : MANAGED_MODEL_CHAINS[typedTask] ?? '',
      fallbackProviderId: route.fallbackProviderId?.trim() || undefined,
      fallbackModel: route.fallbackModel ? normalizeChain(route.fallbackModel) : undefined
    };
  }
  return normalized;
}

function encryptionKey(): Buffer {
  if (!env.DASHBOARD_ENCRYPTION_KEY) {
    throw new Error(
      'DASHBOARD_ENCRYPTION_KEY is required before API keys can be saved from the dashboard.'
    );
  }
  return createHash('sha256')
    .update(env.DASHBOARD_ENCRYPTION_KEY, 'utf8')
    .digest();
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url')
  ].join('.');
}

export function decryptSecret(value: string): string {
  const [version, ivRaw, tagRaw, ciphertextRaw] = value.split('.');
  if (version !== 'v1' || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error('Stored provider secret has an unsupported format.');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivRaw, 'base64url')
  );
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
    const parsed = JSON.parse(raw) as Partial<RuntimeConfigFile> & { version?: number };
    
    // Migration: ensure models array exists and populate defaults if empty
    const existingModels = Array.isArray(parsed.models) && parsed.models.length > 0
      ? parsed.models
      : defaultModels();

    cached = {
      ...defaultConfig(),
      ...parsed,
      version: 3,
      providers: Array.isArray(parsed.providers) ? parsed.providers : [],
      models: existingModels,
      routes: normalizeRoutes(parsed.routes ?? {}),
      voice: parsed.voice ?? {},
      display: parsed.display ?? {}
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') console.error('Could not read runtime config:', error);
    cached = defaultConfig();
  }

  return cached;
}

async function persist(next: RuntimeConfigFile): Promise<void> {
  const clean: RuntimeConfigFile = {
    ...next,
    version: 3,
    routes: normalizeRoutes(next.routes),
    updatedAt: new Date().toISOString()
  };

  cached = clean;
  writeChain = writeChain.then(async () => {
    await mkdir(env.DATA_DIR, { recursive: true });
    const temp = `${CONFIG_FILE}.tmp`;
    await writeFile(temp, `${JSON.stringify(clean, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    await rename(temp, CONFIG_FILE);
  });
  await writeChain;
}

export function providerById(config: RuntimeConfigFile, id: string): ProviderProfile | undefined {
  return config.providers.find((provider) => provider.id === id && provider.enabled);
}

function isGoogleGeminiUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname === 'generativelanguage.googleapis.com';
  } catch {
    return false;
  }
}

function fallbackProvider(task: RuntimeTask): string {
  if (TEXT_TASKS.has(task as TextTask)) {
    return env.AI_API_KEY && !isGoogleGeminiUrl(env.AI_API_URL) ? 'env-text' : 'env-gemini';
  }
  return 'env-gemini';
}

function managedChain(task: RuntimeTask): string {
  return MANAGED_MODEL_CHAINS[task] ?? '';
}

export function validateTaskCapability(kind: ProviderKind, task: RuntimeTask): boolean {
  const allowed = PROVIDER_KIND_CAPABILITIES[kind];
  return allowed?.includes(task) ?? false;
}

function effectiveRoutes(config: RuntimeConfigFile): Record<RuntimeTask, TaskRoute> {
  return Object.fromEntries(
    ALL_TASKS.map((task) => {
      const saved = config.routes[task];
      const providerId = saved?.providerId || fallbackProvider(task);
      const builtIn = providerId === 'env-text' || providerId === 'env-gemini';
      return [
        task,
        {
          providerId,
          model: builtIn
            ? managedChain(task)
            : normalizeChain(saved?.model || managedChain(task)),
          fallbackProviderId: saved?.fallbackProviderId,
          fallbackModel: saved?.fallbackModel ? normalizeChain(saved.fallbackModel) : undefined
        }
      ];
    })
  ) as Record<RuntimeTask, TaskRoute>;
}

// ---------------------------------------------------------------------------
// Public Admin Snapshot & Query Functions
// ---------------------------------------------------------------------------

export async function getAdminRuntimeSnapshot() {
  const config = await load();
  const envGeminiKey =
    env.GEMINI_LIVE_API_KEY ??
    env.GEMINI_TTS_API_KEY ??
    env.GEMINI_STT_API_KEY ??
    env.AI_API_KEY;

  return {
    providers: [
      {
        id: 'env-text',
        name: isGoogleGeminiUrl(env.AI_API_URL)
          ? 'Environment Gemini Text'
          : 'Environment Text AI',
        kind: 'openai-compatible' as const,
        apiUrl: env.AI_API_URL,
        apiKeyHint: env.AI_API_KEY
          ? `••••${env.AI_API_KEY.slice(-4)}`
          : 'Not configured',
        enabled: Boolean(env.AI_API_KEY),
        builtIn: true,
        notes: 'Loaded from environment variables AI_API_KEY & AI_API_URL'
      },
      {
        id: 'env-gemini',
        name: 'Environment Gemini Hub',
        kind: 'gemini-native' as const,
        apiKeyHint: envGeminiKey
          ? `••••${envGeminiKey.slice(-4)}`
          : 'Not configured',
        enabled: Boolean(envGeminiKey),
        builtIn: true,
        notes: 'Full multimodal Gemini engine for text, code, images, video, live voice'
      },
      ...config.providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        kind: provider.kind,
        apiUrl: provider.apiUrl,
        apiKeyHint: provider.apiKeyHint,
        enabled: provider.enabled,
        builtIn: false,
        notes: provider.notes
      }))
    ],
    models: config.models,
    routes: effectiveRoutes(config),
    savedRoutes: config.routes,
    managedModelChains: MANAGED_MODEL_CHAINS,
    providerKindCapabilities: PROVIDER_KIND_CAPABILITIES,
    voice: {
      thinkingLevel: config.voice.thinkingLevel ?? env.GEMINI_LIVE_THINKING_LEVEL,
      silenceMs: config.voice.silenceMs ?? env.VOICE_AI_SILENCE_MS,
      liveVoice: config.voice.liveVoice ?? env.GEMINI_LIVE_VOICE,
      ttsVoice: config.voice.ttsVoice ?? env.GEMINI_TTS_VOICE,
      speakerAccess: config.voice.speakerAccess ?? 'everyone'
    },
    display: await getDisplayRuntimeSettings(),
    tasks: TASK_DEFINITIONS,
    storageFile: CONFIG_FILE
  };
}

// ---------------------------------------------------------------------------
// Provider Management
// ---------------------------------------------------------------------------

export async function upsertRuntimeProvider(input: {
  id?: string;
  name: string;
  kind: ProviderKind;
  apiUrl?: string;
  apiKey?: string;
  enabled?: boolean;
  notes?: string;
}): Promise<string> {
  if (!input.name.trim()) throw new Error('Provider name is required.');

  if (input.kind === 'openai-compatible') {
    if (!input.apiUrl?.trim()) {
      throw new Error('OpenAI-compatible providers need an API URL.');
    }
    new URL(input.apiUrl);
  }

  const config = await load();
  const existing = input.id
    ? config.providers.find((provider) => provider.id === input.id)
    : undefined;
  const apiKey = input.apiKey?.trim();

  if (!existing && !apiKey) throw new Error('API key is required for a new provider.');

  const now = new Date().toISOString();
  const provider: ProviderProfile = {
    id: existing?.id ?? randomUUID(),
    name: input.name.trim(),
    kind: input.kind,
    apiUrl: input.apiUrl?.trim() || undefined,
    encryptedApiKey: apiKey ? encryptSecret(apiKey) : existing!.encryptedApiKey,
    apiKeyHint: apiKey ? `••••${apiKey.slice(-4)}` : existing!.apiKeyHint,
    enabled: input.enabled ?? existing?.enabled ?? true,
    notes: input.notes?.trim() || existing?.notes,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  const providers = existing
    ? config.providers.map((item) => (item.id === provider.id ? provider : item))
    : [...config.providers, provider];

  await persist({ ...config, providers, updatedAt: now });
  return provider.id;
}

export async function deleteRuntimeProvider(id: string): Promise<void> {
  if (id === 'env-text' || id === 'env-gemini') {
    throw new Error('Built-in environment providers cannot be deleted.');
  }

  const config = await load();
  const routes = { ...config.routes };
  for (const [task, route] of Object.entries(routes)) {
    if (route?.providerId === id || route?.fallbackProviderId === id) {
      delete routes[task as RuntimeTask];
    }
  }

  const models = config.models.filter((model) => model.providerId !== id);

  await persist({
    ...config,
    providers: config.providers.filter((provider) => provider.id !== id),
    models,
    routes,
    updatedAt: new Date().toISOString()
  });
}

export async function toggleRuntimeProvider(id: string, enabled?: boolean): Promise<boolean> {
  const config = await load();
  const provider = config.providers.find((p) => p.id === id);
  if (!provider) throw new Error(`Provider '${id}' not found.`);
  const nextEnabled = enabled !== undefined ? enabled : !provider.enabled;
  provider.enabled = nextEnabled;
  provider.updatedAt = new Date().toISOString();
  await persist({ ...config, updatedAt: new Date().toISOString() });
  return nextEnabled;
}

// ---------------------------------------------------------------------------
// Model Registry Management
// ---------------------------------------------------------------------------

export async function upsertRuntimeModel(input: {
  id: string;
  providerId: string;
  label: string;
  capabilities: RuntimeTask[];
  enabled?: boolean;
  priority?: number;
  taskAssignments?: RuntimeTask[];
  notes?: string;
}): Promise<string> {
  if (!input.id.trim()) throw new Error('Model ID is required.');
  if (!input.label.trim()) throw new Error('Model label is required.');
  if (!input.providerId.trim()) throw new Error('Provider ID is required.');
  if (!input.capabilities || input.capabilities.length === 0) {
    throw new Error('Select at least one capability for this model.');
  }

  const config = await load();
  const now = new Date().toISOString();

  // Validate provider exists or is built-in
  if (input.providerId !== 'env-text' && input.providerId !== 'env-gemini') {
    const provider = config.providers.find((p) => p.id === input.providerId);
    if (!provider) throw new Error('Selected provider does not exist.');

    // Validate that capabilities match provider kind
    for (const cap of input.capabilities) {
      if (!validateTaskCapability(provider.kind, cap)) {
        throw new Error(`Capability '${cap}' is not supported by provider kind '${provider.kind}'.`);
      }
    }
  }

  const existingIdx = config.models.findIndex(
    (m) => m.id === input.id && m.providerId === input.providerId
  );

  const modelEntry: ModelRegistration = {
    id: input.id.trim(),
    providerId: input.providerId.trim(),
    label: input.label.trim(),
    capabilities: [...new Set(input.capabilities)],
    enabled: input.enabled !== false,
    priority: input.priority ?? 50,
    taskAssignments: input.taskAssignments,
    notes: input.notes?.trim(),
    createdAt: existingIdx >= 0 && config.models[existingIdx] ? config.models[existingIdx].createdAt : now,
    updatedAt: now
  };

  const models = [...config.models];
  if (existingIdx >= 0) {
    models[existingIdx] = modelEntry;
  } else {
    models.push(modelEntry);
  }

  await persist({ ...config, models, updatedAt: now });
  return modelEntry.id;
}

export async function deleteRuntimeModel(providerId: string, modelId: string): Promise<void> {
  const config = await load();
  const models = config.models.filter(
    (m) => !(m.providerId === providerId && m.id === modelId)
  );

  await persist({ ...config, models, updatedAt: new Date().toISOString() });
}

export async function toggleRuntimeModel(
  providerId: string,
  modelId: string,
  enabled?: boolean
): Promise<boolean> {
  const config = await load();
  const model = config.models.find(
    (m) => m.providerId === providerId && m.id === modelId
  );
  if (!model) throw new Error(`Model '${modelId}' not found under provider '${providerId}'.`);
  const nextEnabled = enabled !== undefined ? enabled : !model.enabled;
  model.enabled = nextEnabled;
  model.updatedAt = new Date().toISOString();
  await persist({ ...config, updatedAt: new Date().toISOString() });
  return nextEnabled;
}

// ---------------------------------------------------------------------------
// Route Management
// ---------------------------------------------------------------------------

export async function setRuntimeRoute(task: RuntimeTask, route: TaskRoute): Promise<void> {
  const config = await load();
  if (!ALL_TASKS.includes(task)) throw new Error(`Unknown AI route '${task}'.`);

  // Provider kind resolution & capability check
  let kind: ProviderKind;
  if (route.providerId === 'env-gemini') {
    kind = 'gemini-native';
  } else if (route.providerId === 'env-text') {
    kind = isGoogleGeminiUrl(env.AI_API_URL) ? 'gemini-native' : 'openai-compatible';
  } else {
    const provider = providerById(config, route.providerId);
    if (!provider) throw new Error('Selected provider is missing or disabled.');
    kind = provider.kind;
  }

  if (!validateTaskCapability(kind, task)) {
    throw new Error(`Task '${task}' is not supported by provider kind '${kind}'.`);
  }

  // If fallback provider is specified, validate it too
  if (route.fallbackProviderId) {
    let fbKind: ProviderKind;
    if (route.fallbackProviderId === 'env-gemini') {
      fbKind = 'gemini-native';
    } else if (route.fallbackProviderId === 'env-text') {
      fbKind = isGoogleGeminiUrl(env.AI_API_URL) ? 'gemini-native' : 'openai-compatible';
    } else {
      const fbProvider = providerById(config, route.fallbackProviderId);
      if (!fbProvider) throw new Error('Selected fallback provider is missing or disabled.');
      fbKind = fbProvider.kind;
    }

    if (!validateTaskCapability(fbKind, task)) {
      throw new Error(`Task '${task}' is not supported by fallback provider kind '${fbKind}'.`);
    }
  }

  const builtIn = route.providerId === 'env-text' || route.providerId === 'env-gemini';
  const model = builtIn
    ? (route.model?.trim() ? normalizeChain(route.model) : managedChain(task))
    : normalizeChain(route.model || managedChain(task));

  await persist({
    ...config,
    routes: {
      ...config.routes,
      [task]: {
        providerId: route.providerId,
        model,
        fallbackProviderId: route.fallbackProviderId?.trim() || undefined,
        fallbackModel: route.fallbackModel ? normalizeChain(route.fallbackModel) : undefined
      }
    },
    updatedAt: new Date().toISOString()
  });
}

// ---------------------------------------------------------------------------
// Route Resolvers for Execution Engines
// ---------------------------------------------------------------------------

export type ResolvedTaskRoute = {
  transport: ProviderKind;
  apiUrl?: string;
  apiKey: string;
  model: string;
  providerName: string;
  fallback?: {
    transport: ProviderKind;
    apiUrl?: string;
    apiKey: string;
    model: string;
    providerName: string;
  };
};

function resolveCredentials(
  config: RuntimeConfigFile,
  providerId: string,
  task: RuntimeTask
): { transport: ProviderKind; apiUrl?: string; apiKey: string; providerName: string } {
  if (providerId === 'env-text') {
    if (!env.AI_API_KEY) throw new Error(`Text AI route '${task}' is not configured.`);
    const googleNative = isGoogleGeminiUrl(env.AI_API_URL);
    return {
      transport: googleNative ? 'gemini-native' : 'openai-compatible',
      apiUrl: googleNative ? undefined : env.AI_API_URL,
      apiKey: env.AI_API_KEY,
      providerName: googleNative ? 'Environment Gemini Text' : 'Environment Text AI'
    };
  }

  if (providerId === 'env-gemini') {
    const apiKey =
      task === 'voice_live' || task === 'voice_translate'
        ? env.GEMINI_LIVE_API_KEY ?? env.AI_API_KEY
        : task === 'stt'
          ? env.GEMINI_STT_API_KEY ?? env.GEMINI_TTS_API_KEY ?? env.GEMINI_LIVE_API_KEY ?? env.AI_API_KEY
          : task === 'tts'
            ? env.GEMINI_TTS_API_KEY ?? env.GEMINI_LIVE_API_KEY ?? env.AI_API_KEY
            : env.AI_API_KEY ?? env.GEMINI_LIVE_API_KEY;

    if (!apiKey) throw new Error(`Gemini route '${task}' is not configured in environment.`);
    return {
      transport: 'gemini-native',
      apiKey,
      providerName: 'Environment Gemini'
    };
  }

  const provider = providerById(config, providerId);
  if (!provider) throw new Error(`Provider '${providerId}' for '${task}' is unavailable or disabled.`);

  return {
    transport: provider.kind,
    apiUrl: provider.apiUrl,
    apiKey: decryptSecret(provider.encryptedApiKey),
    providerName: provider.name
  };
}

export async function getResolvedTaskRoute(task: RuntimeTask): Promise<ResolvedTaskRoute> {
  const config = await load();
  const saved = config.routes[task];
  const providerId = saved?.providerId ?? fallbackProvider(task);

  const creds = resolveCredentials(config, providerId, task);
  const model = saved?.model
    ? normalizeChain(saved.model)
    : managedChain(task);

  let fallback: ResolvedTaskRoute['fallback'] = undefined;
  if (saved?.fallbackProviderId) {
    try {
      const fbCreds = resolveCredentials(config, saved.fallbackProviderId, task);
      const fbModel = saved.fallbackModel
        ? normalizeChain(saved.fallbackModel)
        : managedChain(task);
      fallback = {
        ...fbCreds,
        model: fbModel
      };
    } catch (err) {
      console.warn(`Could not resolve fallback route for ${task}:`, err);
    }
  }

  return {
    ...creds,
    model,
    fallback
  };
}

export async function getTextTaskRoute(task: TextTask): Promise<{
  transport: TextTransport;
  apiUrl?: string;
  apiKey: string;
  model: string;
  providerName: string;
}> {
  const resolved = await getResolvedTaskRoute(task);
  return {
    transport: resolved.transport,
    apiUrl: resolved.apiUrl,
    apiKey: resolved.apiKey,
    model: resolved.model,
    providerName: resolved.providerName
  };
}

export async function getGeminiTaskRoute(task: GeminiTask): Promise<{
  apiKey: string;
  model: string;
  providerName: string;
}> {
  const resolved = await getResolvedTaskRoute(task);
  return {
    apiKey: resolved.apiKey,
    model: resolved.model,
    providerName: resolved.providerName
  };
}

export async function getMediaTaskRoute(task: MediaTask): Promise<ResolvedTaskRoute> {
  return getResolvedTaskRoute(task);
}

// ---------------------------------------------------------------------------
// Voice & Display Settings
// ---------------------------------------------------------------------------

export async function setVoiceRuntimeSettings(input: Partial<VoiceRuntimeSettings>): Promise<void> {
  const config = await load();
  const voice = { ...config.voice, ...input };

  if (voice.silenceMs !== undefined && (voice.silenceMs < 200 || voice.silenceMs > 5000)) {
    throw new Error('Voice silence must be between 200ms and 5000ms.');
  }

  if (voice.speakerAccess !== undefined && !['everyone', 'owner-only'].includes(voice.speakerAccess)) {
    throw new Error('Voice speaker access must be everyone or owner-only.');
  }

  await persist({ ...config, voice, updatedAt: new Date().toISOString() });
}

export async function getVoiceRuntimeSettings(): Promise<VoiceRuntimeSettings> {
  const config = await load();
  return {
    thinkingLevel: config.voice.thinkingLevel ?? env.GEMINI_LIVE_THINKING_LEVEL,
    silenceMs: config.voice.silenceMs ?? env.VOICE_AI_SILENCE_MS,
    liveVoice: config.voice.liveVoice ?? env.GEMINI_LIVE_VOICE,
    ttsVoice: config.voice.ttsVoice ?? env.GEMINI_TTS_VOICE,
    speakerAccess: config.voice.speakerAccess ?? 'everyone'
  };
}

export async function setDisplayRuntimeSettings(input: Partial<DisplayRuntimeSettings>): Promise<void> {
  const config = await load();
  const display = { ...config.display, ...input };

  if (display.headingSize && !['large', 'medium', 'small'].includes(display.headingSize)) {
    throw new Error('Heading size must be large, medium, or small.');
  }
  if (display.density && !['compact', 'comfortable', 'relaxed'].includes(display.density)) {
    throw new Error('Display density must be compact, comfortable, or relaxed.');
  }
  if (display.divider && !['none', 'line', 'spaced'].includes(display.divider)) {
    throw new Error('Divider must be none, line, or spaced.');
  }
  if (
    display.originalPreviewChars !== undefined &&
    (display.originalPreviewChars < 80 || display.originalPreviewChars > 1200)
  ) {
    throw new Error('Original preview length must be between 80 and 1200 characters.');
  }

  await persist({ ...config, display, updatedAt: new Date().toISOString() });
}

export async function getDisplayRuntimeSettings(): Promise<DisplayRuntimeSettings> {
  const config = await load();
  return {
    headingSize: config.display.headingSize ?? 'medium',
    density: config.display.density ?? 'comfortable',
    divider: config.display.divider ?? 'none',
    showEmojis: config.display.showEmojis ?? true,
    showDetectedLanguage: config.display.showDetectedLanguage ?? true,
    showProvider: config.display.showProvider ?? false,
    showOriginal: config.display.showOriginal ?? true,
    quoteArabic: config.display.quoteArabic ?? true,
    originalPreviewChars: config.display.originalPreviewChars ?? 420,
    smartAnswerArabicFirst: config.display.smartAnswerArabicFirst ?? true
  };
}

export async function testRuntimeProvider(
  providerId: string
): Promise<{ ok: boolean; latencyMs: number; message: string }> {
  const config = await load();
  const start = Date.now();

  let kind: ProviderKind;
  let apiUrl: string | undefined;
  let apiKey: string;
  let name: string;

  if (providerId === 'env-gemini') {
    kind = 'gemini-native';
    apiKey = env.AI_API_KEY ?? env.GEMINI_LIVE_API_KEY ?? '';
    name = 'Environment Gemini';
  } else if (providerId === 'env-text') {
    const googleNative = isGoogleGeminiUrl(env.AI_API_URL);
    kind = googleNative ? 'gemini-native' : 'openai-compatible';
    apiUrl = googleNative ? undefined : env.AI_API_URL;
    apiKey = env.AI_API_KEY ?? '';
    name = 'Environment Text AI';
  } else {
    const provider = config.providers.find((p) => p.id === providerId);
    if (!provider) throw new Error(`Provider '${providerId}' not found.`);
    kind = provider.kind;
    apiUrl = provider.apiUrl;
    apiKey = decryptSecret(provider.encryptedApiKey);
    name = provider.name;
  }

  if (!apiKey) throw new Error(`No API key configured for provider '${name}'.`);

  try {
    if (kind === 'gemini-native') {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
        { signal: AbortSignal.timeout(10_000) }
      );
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Gemini API returned status ${res.status}: ${text.slice(0, 200)}`);
      }
      return { ok: true, latencyMs, message: `Successfully connected to Gemini API (${latencyMs}ms)` };
    }

    if (kind === 'openai-native') {
      const url = apiUrl ? `${apiUrl.replace(/\/+$/, '')}/models` : 'https://api.openai.com/v1/models';
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000)
      });
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`OpenAI API returned status ${res.status}: ${text.slice(0, 200)}`);
      }
      return { ok: true, latencyMs, message: `Successfully connected to OpenAI API (${latencyMs}ms)` };
    }

    if (kind === 'anthropic-native') {
      const url = apiUrl ? `${apiUrl.replace(/\/+$/, '')}/messages` : 'https://api.anthropic.com/v1/messages';
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }]
        }),
        signal: AbortSignal.timeout(10_000)
      });
      const latencyMs = Date.now() - start;
      if (!res.ok && res.status !== 200 && res.status !== 400) {
        const text = await res.text().catch(() => '');
        throw new Error(`Anthropic API returned status ${res.status}: ${text.slice(0, 200)}`);
      }
      return { ok: true, latencyMs, message: `Successfully connected to Anthropic API (${latencyMs}ms)` };
    }

    if (kind === 'openrouter') {
      const url = apiUrl ? `${apiUrl.replace(/\/+$/, '')}/models` : 'https://openrouter.ai/api/v1/models';
      const res = await fetch(url, {
        headers: {
          authorization: `Bearer ${apiKey}`,
          'http-referer': 'https://github.com/MohammedMuostafa/Translator_Discord',
          'x-title': 'TD AI Hub'
        },
        signal: AbortSignal.timeout(10_000)
      });
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`OpenRouter API returned status ${res.status}: ${text.slice(0, 200)}`);
      }
      return { ok: true, latencyMs, message: `Successfully connected to OpenRouter API (${latencyMs}ms)` };
    }

    if (kind === 'openai-compatible') {
      if (!apiUrl) throw new Error('API Endpoint URL is required for OpenAI-Compatible providers.');
      const base = apiUrl.replace(/\/+$/, '');
      const url = base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`;
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000)
      }).catch(async () => {
        return fetch(base, {
          headers: { authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000)
        });
      });
      const latencyMs = Date.now() - start;
      if (!res.ok && res.status >= 500) {
        const text = await res.text().catch(() => '');
        throw new Error(`Endpoint returned status ${res.status}: ${text.slice(0, 200)}`);
      }
      return { ok: true, latencyMs, message: `Successfully reached custom API endpoint (${latencyMs}ms)` };
    }

    throw new Error(`Unsupported provider kind '${kind}'.`);
  } catch (error) {
    const latencyMs = Date.now() - start;
    throw new Error(
      `Connectivity test failed (${latencyMs}ms): ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
