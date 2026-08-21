import { getTextTaskRoute, type TextTask } from './runtimeConfig.js';

export type ModelMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const BACKOFF_MS = [650, 1400, 2800];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function supportsTemperature(model: string): boolean {
  return !/^gemini-3(?:\.|[-])/i.test(model);
}

function providerError(status: number, body: string): string {
  let message = body;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    message = parsed.error?.message ?? body;
  } catch {
    // Keep provider text.
  }
  if (status === 429) return 'The selected AI provider is rate-limited right now.';
  if (status === 503) return 'The selected AI model is temporarily busy.';
  return `AI provider error (${status}): ${message.slice(0, 450)}`;
}

export async function callTextModel(
  task: TextTask,
  messages: ModelMessage[],
  options: { temperature?: number; timeoutMs?: number; modelOverride?: string } = {}
): Promise<{ text: string; model: string; provider: string }> {
  const route = await getTextTaskRoute(task);
  const model = options.modelOverride?.trim() || route.model;
  const request: Record<string, unknown> = { model, messages };
  if (options.temperature !== undefined && supportsTemperature(model)) request.temperature = options.temperature;

  let lastError = 'AI request failed.';
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt += 1) {
    try {
      const response = await fetch(route.apiUrl, {
        method: 'POST',
        headers: { authorization: `Bearer ${route.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(options.timeoutMs ?? 60_000)
      });
      const raw = await response.text();
      if (!response.ok) {
        lastError = providerError(response.status, raw);
        if (RETRYABLE_STATUS.has(response.status) && attempt < BACKOFF_MS.length) {
          await sleep(BACKOFF_MS[attempt] ?? 2800);
          continue;
        }
        throw new Error(lastError);
      }
      const data = JSON.parse(raw) as {
        choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.map((part) => part.text ?? '').join('')
          : '';
      if (!text.trim()) throw new Error('The AI provider returned an empty response.');
      return { text: text.trim(), model, provider: route.providerName };
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      if (attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt] ?? 2800);
        continue;
      }
    }
  }
  throw new Error(lastError);
}
