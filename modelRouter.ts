import {
  getTextTaskRoute,
  normalizeModelId,
  type TextTask,
  type TextTransport
} from './runtimeConfig.js';

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
  // Gemini 3.6+ / 3.7 deprecate legacy sampling controls.
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
    const parsed = JSON.parse(body) as {
      error?: { message?: string; status?: string };
    };
    message = parsed.error?.message ?? body;
  } catch {
    // Keep provider text.
  }

  if (status === 429) {
    return `${provider}/${model} is rate-limited right now.`;
  }

  if (status === 503) {
    return `${provider}/${model} is temporarily busy.`;
  }

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
  contents: Array<{
    role: 'user' | 'model';
    parts: Array<{ text: string }>;
  }>;
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

  if (!contents.length) {
    contents.push({
      role: 'user',
      parts: [{ text: 'Continue.' }]
    });
  }

  return {
    ...(system
      ? {
          systemInstruction: {
            parts: [{ text: system }]
          }
        }
      : {}),
    contents
  };
}

function extractGeminiText(raw: string): string {
  const data = JSON.parse(raw) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
    promptFeedback?: {
      blockReason?: string;
    };
  };

  const text = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? '')
    .join('')
    .trim();

  if (text) return text;

  if (data.promptFeedback?.blockReason) {
    throw new Error(
      `Gemini blocked the request: ${data.promptFeedback.blockReason}`
    );
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
  const request: Record<string, unknown> = {
    model,
    messages
  };

  if (temperature !== undefined && supportsTemperature(model)) {
    request.temperature = temperature;
  }

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
  if (!text) {
    throw new Error(
      `${providerName}/${model} returned an empty response for ${task}.`
    );
  }

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

  // Force machine-readable output for the two features that parse JSON.
  // This fixes translation / Smart Answer becoming malformed after model changes.
  if (task === 'translation' || task === 'smart_reply') {
    generationConfig.responseMimeType = 'application/json';
  }

  if (
    temperature !== undefined &&
    supportsTemperature(cleanModel)
  ) {
    generationConfig.temperature = temperature;
  }

  const body = {
    ...geminiContents(messages),
    ...(Object.keys(generationConfig).length
      ? { generationConfig }
      : {})
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
      new Error(
        providerError(
          response.status,
          raw,
          providerName,
          cleanModel
        )
      ),
      { status: response.status }
    );
  }

  const text = extractGeminiText(raw);
  if (!text) {
    throw new Error(
      `${providerName}/${cleanModel} returned an empty response for ${task}.`
    );
  }

  return text;
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
  const model = normalizeModelId(
    options.modelOverride?.trim() || route.model
  );
  const timeoutMs = options.timeoutMs ?? 60_000;

  let lastError = 'AI request failed.';

  for (
    let attempt = 0;
    attempt <= BACKOFF_MS.length;
    attempt += 1
  ) {
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

      return {
        text,
        model,
        provider: route.providerName,
        transport: route.transport
      };
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : lastError;

      const status =
        typeof error === 'object' &&
        error !== null &&
        'status' in error
          ? Number((error as { status?: unknown }).status)
          : undefined;

      // 400/401/403/404 are configuration/input problems.
      // Retrying them only creates delay and duplicate cost.
      if (
        status &&
        !RETRYABLE_STATUS.has(status)
      ) {
        break;
      }

      if (attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt] ?? 2800);
      }
    }
  }

  throw new Error(lastError);
}
