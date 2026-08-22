import {
  getResolvedTaskRoute,
  normalizeModelId,
  parseModelChain,
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
import {
  executeTextAdapter,
  type TextMessage
} from '../providers/adapters/textAdapter.js';

export type ModelMessage = TextMessage;

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
  const ms =
    status === 429 ? 60_000 : status === 503 ? 20_000 : status === 404 ? 10 * 60_000 : 0;
  if (ms > 0) MODEL_COOLDOWNS.set(cooldownKey(provider, model), Date.now() + ms);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = Number((error as { status?: unknown }).status);
    return Number.isFinite(status) ? status : undefined;
  }
  return undefined;
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
  const route = await getResolvedTaskRoute(task);
  const userId = currentUsageUserId();

  if (userId) {
    await assertFeatureAccess(userId, taskFeature(task));
  }

  const timeoutMs = options.timeoutMs ?? 60_000;
  const inputChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  const errors: string[] = [];

  // Determine user account plan if applicable for filtering
  const userAccount = userId ? await getUserAccount(userId) : undefined;

  // Build execution attempts: Primary provider route first, then Fallback route if present
  const routeAttempts = [
    {
      providerName: route.providerName,
      providerKind: route.transport,
      apiUrl: route.apiUrl,
      apiKey: route.apiKey,
      rawModels: options.modelOverride?.trim() || route.model
    },
    ...(route.fallback
      ? [
          {
            providerName: route.fallback.providerName,
            providerKind: route.fallback.transport,
            apiUrl: route.fallback.apiUrl,
            apiKey: route.fallback.apiKey,
            rawModels: route.fallback.model
          }
        ]
      : [])
  ];

  for (const attempt of routeAttempts) {
    const configuredModels = parseModelChain(attempt.rawModels);
    const models = (userAccount && attempt.providerKind === 'gemini-native')
      ? filterTextModelsForPlan(userAccount.planId, configuredModels)
      : configuredModels;

    for (const model of models) {
      if (modelCoolingDown(attempt.providerName, model)) {
        console.log(`AI model cooldown skip: ${task} -> ${attempt.providerName}/${model}`);
        continue;
      }

      let transientRetries = 0;

      while (true) {
        try {
          const text = await executeTextAdapter({
            providerKind: attempt.providerKind,
            providerName: attempt.providerName,
            apiUrl: attempt.apiUrl,
            apiKey: attempt.apiKey,
            model,
            messages,
            task,
            temperature: options.temperature,
            timeoutMs
          });

          await recordProviderHealth({
            provider: attempt.providerName,
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

          if (model !== models[0] || attempt !== routeAttempts[0]) {
            console.log(`AI failover successful: ${task} -> ${attempt.providerName}/${model}`);
          }

          return {
            text,
            model,
            provider: attempt.providerName,
            transport: attempt.providerKind
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown AI error.';
          const status = getErrorStatus(error);
          errors.push(`${attempt.providerName}/${model}: ${message}`);

          await recordProviderHealth({
            provider: attempt.providerName,
            model,
            ok: false,
            status,
            message
          }).catch(() => undefined);

          coolDownModel(attempt.providerName, model, status);

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
  }

  throw new Error(
    ['All configured AI models are currently unavailable.', ...errors.slice(-3)].join(' | ')
  );
}

export async function callCodeModel(
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
  return callTextModel('code', messages, options);
}
