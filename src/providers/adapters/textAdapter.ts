import type { ProviderKind, TextTask } from '../../services/runtimeConfigTypes.js';

export type TextMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type TextExecutionInput = {
  providerKind: ProviderKind;
  providerName: string;
  apiUrl?: string;
  apiKey: string;
  model: string;
  messages: TextMessage[];
  task: TextTask;
  temperature?: number;
  timeoutMs?: number;
};

function supportsTemperature(model: string): boolean {
  return !/^gemini-3(?:\.|[-])/i.test(model);
}

function normalizeModelId(value: string): string {
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

function formatProviderError(
  status: number,
  body: string,
  provider: string,
  model: string
): string {
  let message = body;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    if (typeof parsed.error === 'object' && parsed.error?.message) {
      message = parsed.error.message;
    } else if (typeof parsed.error === 'string') {
      message = parsed.error;
    } else if (parsed.message) {
      message = parsed.message;
    }
  } catch {
    // Keep raw body
  }

  if (status === 429) return `${provider}/${model} is rate-limited right now.`;
  if (status === 503) return `${provider}/${model} is temporarily busy.`;
  if (status === 404) {
    return `${provider}/${model} was not found by the provider. Check the exact model ID in TD AI Control Center. Provider said: ${message.slice(0, 300)}`;
  }
  return `${provider}/${model} error (${status}): ${message.slice(0, 450)}`;
}

// ---------------------------------------------------------------------------
// Gemini Native
// ---------------------------------------------------------------------------
function geminiContents(messages: TextMessage[]): {
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
      role: message.role === 'assistant' ? ('model' as const) : ('user' as const),
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

async function requestGeminiNative(input: TextExecutionInput): Promise<string> {
  const cleanModel = normalizeModelId(input.model);
  const generationConfig: Record<string, unknown> = {};

  if (input.task === 'translation' || input.task === 'smart_reply') {
    generationConfig.responseMimeType = 'application/json';
  }
  if (input.temperature !== undefined && supportsTemperature(cleanModel)) {
    generationConfig.temperature = input.temperature;
  }

  const body = {
    ...geminiContents(input.messages),
    ...(Object.keys(generationConfig).length ? { generationConfig } : {})
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cleanModel)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': input.apiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(input.timeoutMs ?? 60_000)
    }
  );

  const raw = await response.text();
  if (!response.ok) {
    throw Object.assign(
      new Error(formatProviderError(response.status, raw, input.providerName, cleanModel)),
      { status: response.status }
    );
  }

  const text = extractGeminiText(raw);
  if (!text) throw new Error(`${input.providerName}/${cleanModel} returned an empty response for ${input.task}.`);
  return text;
}

// ---------------------------------------------------------------------------
// OpenAI Native & Compatible & OpenRouter
// ---------------------------------------------------------------------------
function extractOpenAiText(raw: string): string {
  const data = JSON.parse(raw) as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string }>;
        reasoning_content?: string;
      };
      text?: string;
    }>;
  };
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === 'string' && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const text = content.map((part) => part.text ?? '').join('').trim();
    if (text) return text;
  }
  if (typeof choice?.message?.reasoning_content === 'string' && choice.message.reasoning_content.trim()) {
    return choice.message.reasoning_content.trim();
  }
  if (typeof choice?.text === 'string' && choice.text.trim()) {
    return choice.text.trim();
  }
  return '';
}

async function requestOpenAiLike(
  input: TextExecutionInput,
  endpointUrl: string,
  extraHeaders: Record<string, string> = {}
): Promise<string> {
  const request: Record<string, unknown> = {
    model: input.model,
    messages: input.messages
  };

  if (input.temperature !== undefined && supportsTemperature(input.model)) {
    request.temperature = input.temperature;
  }

  // Format request URL: append /chat/completions if the user provided base url
  let url = endpointUrl;
  if (!url.endsWith('/chat/completions') && !url.includes('/chat/completions?')) {
    url = `${url.replace(/\/+$/, '')}/chat/completions`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      'content-type': 'application/json',
      ...extraHeaders
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(input.timeoutMs ?? 60_000)
  });

  const raw = await response.text();
  if (!response.ok) {
    throw Object.assign(
      new Error(formatProviderError(response.status, raw, input.providerName, input.model)),
      { status: response.status }
    );
  }

  const text = extractOpenAiText(raw);
  if (!text) throw new Error(`${input.providerName}/${input.model} returned an empty response for ${input.task}.`);
  return text;
}

// ---------------------------------------------------------------------------
// Anthropic Native
// ---------------------------------------------------------------------------
function extractAnthropicText(raw: string): string {
  const data = JSON.parse(raw) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = (data.content ?? [])
    .filter((item) => item.type === 'text' && item.text)
    .map((item) => item.text)
    .join('')
    .trim();
  return text;
}

async function requestAnthropicNative(input: TextExecutionInput): Promise<string> {
  const base = input.apiUrl?.trim() || 'https://api.anthropic.com/v1';
  let url = base;
  if (!url.endsWith('/messages')) {
    url = `${url.replace(/\/+$/, '')}/messages`;
  }

  const system = input.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content.trim())
    .filter(Boolean)
    .join('\n\n');

  const messages = input.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }));

  if (!messages.length) {
    messages.push({ role: 'user', content: 'Continue.' });
  }

  const request: Record<string, unknown> = {
    model: input.model,
    max_tokens: 4096,
    messages
  };

  if (system) {
    request.system = system;
  }
  if (input.temperature !== undefined) {
    request.temperature = input.temperature;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': input.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(input.timeoutMs ?? 60_000)
  });

  const raw = await response.text();
  if (!response.ok) {
    throw Object.assign(
      new Error(formatProviderError(response.status, raw, input.providerName, input.model)),
      { status: response.status }
    );
  }

  const text = extractAnthropicText(raw);
  if (!text) throw new Error(`${input.providerName}/${input.model} returned an empty response for ${input.task}.`);
  return text;
}

// ---------------------------------------------------------------------------
// Main Text Execution Dispatcher
// ---------------------------------------------------------------------------
export async function executeTextAdapter(input: TextExecutionInput): Promise<string> {
  switch (input.providerKind) {
    case 'gemini-native':
      return requestGeminiNative(input);

    case 'openai-native':
      return requestOpenAiLike(
        input,
        input.apiUrl?.trim() || 'https://api.openai.com/v1'
      );

    case 'anthropic-native':
      return requestAnthropicNative(input);

    case 'openrouter':
      return requestOpenAiLike(
        input,
        input.apiUrl?.trim() || 'https://openrouter.ai/api/v1',
        {
          'HTTP-Referer': 'https://td.ai',
          'X-Title': 'TD AI Discord'
        }
      );

    case 'openai-compatible':
    default:
      if (!input.apiUrl?.trim()) {
        throw new Error(`OpenAI-compatible provider '${input.providerName}' has no API URL configured.`);
      }
      return requestOpenAiLike(input, input.apiUrl.trim());
  }
}
