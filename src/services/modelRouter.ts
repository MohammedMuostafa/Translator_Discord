import {
  getTextTaskRoute,
  normalizeModelId,
  type TextTask,
  type TextTransport
} from './runtimeConfig.js';
import {
  assertFeatureAccess,
  estimateTextCredits,
  getUserAccount,
  recordProviderHealth,
  recordUsage
} from './billingStore.js';
import { currentUsageUserId } from './usageContext.js';
import { filterTextModelsForPlan } from './modelCatalog.js';

export type ModelMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

const SAME_MODEL_RETRY_MS = 450;
const MODEL_COOLDOWNS = new Map<string, number>();

function cooldownKey(provider: string, model: string): string {
  return `${provider}::${model}`;
}

function modelCoolingDown(provider: string, model: string): boolean {
  const key = cooldownKey(provider, model);
  const until = MODEL_COOLDOWNS.get(key) ?? 0;
  if (until <= Date.now()) {
    if (until) MODEL_COOLDOWNS.delete(key);
    return false;
  }
  return true;
}

function coolDownModel(provider: string, model: string, status?: number): void {
  const ms = status === 429 ? 60_000 : status === 503 ? 20_000 : status === 404 ? 10 * 60_000 : 0;
  if (ms > 0) MODEL_COOLDOWNS.set(cooldownKey(provider, model), Date.now() + ms);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseModelChain(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/\s*(?:\||,|\n)\s*/)
        .map((model) => normalizeModelId(model.trim()))
        .filter(Boolean)
    )
  ];
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = Number((error as { status?: unknown }).status);
    return Number.isFinite(status) ? status : undefined;
  }
  return undefined;
}

function supportsTemperature(model: string): boolean {
  return !/^gemini-3(?:\.|[-])/i.test(model);
}

function providerError(
  status: number,
  body: string,
  provider: string,
  model: string
): string {
  let message = body;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    message = parsed.error?.message ?? body;
  } catch {
    // Keep provider text.
  }

  if (status === 429) return `${provider}/${model} is rate-limited right now.`;
  if (status === 503) return `${provider}/${model} is temporarily busy.`;
  if (status === 404) {
    return `${provider}/${model} was not found by the provider. Check the exact model ID in TD AI Control Center. Provider said: ${message.slice(0, 300)}`;
  }
  return `${provider}/${model} error (${status}): ${message.slice(0, 450)}`;
}

function extractOpenAiText(raw: string): string {
  const data = JSON.parse(raw) as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string }>;
      };
    }>;
  };
  const content = data.choices?.[0]?.message?.content;
  return (
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((part) => part.text ?? '').join('')
        : ''
  ).trim();
}

function geminiContents(messages: ModelMessage[]): {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
} {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n');

  const contents = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' as const : 'user' as const,
      parts: [{ text: message.content }]
    }));

  if (!contents.length) contents.push({ role: 'user', parts: [{ text: 'Continue.' }] });

  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents
  };
}

function extractGeminiText(raw: string): string {
  const data = JSON.parse(raw) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    promptFeedback?: { blockReason?: string };
  };
  const text = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? '')
    .join('')
    .trim();

  if (text) return text;
  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the request: ${data.promptFeedback.blockReason}`);
  }
  return '';
}

async function requestOpenAiCompatible(
  apiUrl: string,
  apiKey: string,
  model: string,
  messages: ModelMessage[],
  task: TextTask,
  temperature: number | undefined,
  timeoutMs: number,
  providerName: string
): Promise<string> {
  const request: Record<string, unknown> = { model, messages };
  if (temperature !== undefined && supportsTemperature(model)) request.temperature = temperature;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(timeoutMs)
  });

  const raw = await response.text();
  if (!response.ok) {
    throw Object.assign(
      new Error(providerError(response.status, raw, providerName, model)),
      { status: response.status }
    );
  }

  const text = extractOpenAiText(raw);
  if (!text) throw new Error(`${providerName}/${model} returned an empty response for ${task}.`);
  return text;
}

async function requestGeminiNative(
  apiKey: string,
  model: string,
  messages: ModelMessage[],
  task: TextTask,
  temperature: number | undefined,
  timeoutMs: number,
  providerName: string
): Promise<string> {
  const cleanModel = normalizeModelId(model);
  const generationConfig: Record<string, unknown> = {};

  if (task === 'translation' || task === 'smart_reply') {
    generationConfig.responseMimeType = 'application/json';
  }
  if (temperature !== undefined && supportsTemperature(cleanModel)) {
    generationConfig.temperature = temperature;
  }

  const body = {
    ...geminiContents(messages),
    ...(Object.keys(generationConfig).length ? { generationConfig } : {})
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cleanModel)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    }
  );

  const raw = await response.text();
  if (!response.ok) {
    throw Object.assign(
      new Error(providerError(response.status, raw, providerName, cleanModel)),
      { status: response.status }
    );
  }

  const text = extractGeminiText(raw);
  if (!text) throw new Error(`${providerName}/${cleanModel} returned an empty response for ${task}.`);
  return text;
}

function taskFeature(task: TextTask) {
  return task;
}

export async function callTextModel(
  task: TextTask,
  messages: ModelMessage[],
  options: {
    temperature?: number;
    timeoutMs?: number;
    modelOverride?: string;
  } = {}
): Promise<{
  text: string;
  model: string;
  provider: string;
  transport: TextTransport;
}> {
  const route = await getTextTaskRoute(task);
  const userId = currentUsageUserId();

  if (userId) {
    await assertFeatureAccess(
      userId,
      taskFeature(task)
    );
  }

  const configuredModels =
    parseModelChain(
      options.modelOverride?.trim() ||
      route.model
    );

  const models =
    userId
      ? filterTextModelsForPlan(
          (
            await getUserAccount(
              userId
            )
          ).planId,
          configuredModels
        )
      : configuredModels;

  const timeoutMs =
    options.timeoutMs ??
    60_000;

  if (!models.length) throw new Error(`No AI models are configured for '${task}'.`);

  const errors: string[] = [];
  const inputChars = messages.reduce((sum, message) => sum + message.content.length, 0);

  for (const model of models) {
    if (modelCoolingDown(route.providerName, model)) {
      console.log(`AI model cooldown skip: ${task} -> ${route.providerName}/${model}`);
      continue;
    }

    let transientRetries = 0;

    while (true) {
      try {
        const text =
          route.transport === 'gemini-native'
            ? await requestGeminiNative(
                route.apiKey,
                model,
                messages,
                task,
                options.temperature,
                timeoutMs,
                route.providerName
              )
            : await requestOpenAiCompatible(
                route.apiUrl!,
                route.apiKey,
                model,
                messages,
                task,
                options.temperature,
                timeoutMs,
                route.providerName
              );

        await recordProviderHealth({
          provider: route.providerName,
          model,
          ok: true
        }).catch(() => undefined);

        if (userId) {
          await recordUsage(
            userId,
            taskFeature(task),
            estimateTextCredits(inputChars, text.length)
          ).catch((error) => console.error('Could not meter text usage:', error));
        }

        if (model !== models[0]) {
          console.log(`AI failover successful: ${task} -> ${route.providerName}/${model}`);
        }

        return {
          text,
          model,
          provider: route.providerName,
          transport: route.transport
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown AI error.';
        const status = getErrorStatus(error);
        errors.push(`${model}: ${message}`);

        await recordProviderHealth({
          provider: route.providerName,
          model,
          ok: false,
          status,
          message
        }).catch(() => undefined);

        coolDownModel(route.providerName, model, status);

        if (status === 429 || status === 503) {
          console.warn(`AI model unavailable (${status}): ${model}. Trying fallback model...`);
          break;
        }

        if (status === 400 || status === 401 || status === 403 || status === 404) {
          console.warn(`AI model failed (${status}): ${model}. Trying fallback model...`);
          break;
        }

        if (
          status !== undefined &&
          [500, 502, 504].includes(status) &&
          transientRetries < 1
        ) {
          transientRetries += 1;
          await sleep(SAME_MODEL_RETRY_MS);
          continue;
        }

        console.warn(`AI model failed: ${model}. Trying fallback model...`);
        break;
      }
    }
  }

  throw new Error(
    ['All configured AI models are currently unavailable.', ...errors.slice(-3)].join(' | ')
  );
}
