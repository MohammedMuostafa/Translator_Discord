import { GoogleGenAI } from '@google/genai';
import type { ProviderKind } from '../../services/runtimeConfigTypes.js';
import type { ImageQuality } from '../../services/modelCatalog.js';

export type MediaAspectRatio =
  | '1:1'
  | '3:2'
  | '2:3'
  | '4:3'
  | '3:4'
  | '16:9'
  | '9:16';

export type GeneratedImageResult = {
  filename: string;
  contentType: string;
  data: Uint8Array<ArrayBufferLike>;
  quality: string;
  model: string;
};

export type ImageExecutionInput = {
  providerKind: ProviderKind;
  providerName: string;
  apiUrl?: string;
  apiKey: string;
  model: string;
  prompt: string;
  quality: ImageQuality;
  aspectRatio: MediaAspectRatio;
  source?: {
    data: Uint8Array<ArrayBufferLike>;
    contentType: string;
  };
};

function imageSize(
  model: string,
  quality: ImageQuality
): '1K' | '2K' | '4K' | undefined {
  if (model === 'gemini-2.5-flash-image') return undefined;
  if (model.includes('flash-lite-image')) return '1K';
  if (model === 'gemini-3-pro-image' && quality === 'premium') return '4K';
  if (quality === 'standard' || quality === 'premium') return '2K';
  return '1K';
}

function imageContents(
  prompt: string,
  source?: {
    data: Uint8Array<ArrayBufferLike>;
    contentType: string;
  }
): Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> {
  const parts: Array<{
    text?: string;
    inlineData?: { mimeType: string; data: string };
  }> = [{ text: prompt }];

  if (source) {
    parts.push({
      inlineData: {
        mimeType: source.contentType,
        data: Buffer.from(source.data).toString('base64')
      }
    });
  }

  return parts;
}

function firstGeneratedImage(response: unknown): {
  data: string;
  mimeType: string;
} | undefined {
  const typed = response as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: {
            data?: string;
            mimeType?: string;
          };
        }>;
      };
    }>;
  };

  for (const candidate of typed.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.inlineData?.data) {
        return {
          data: part.inlineData.data,
          mimeType: part.inlineData.mimeType ?? 'image/png'
        };
      }
    }
  }

  return undefined;
}

function imageFilename(contentType: string): string {
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'td-ai-image.jpg';
  if (contentType.includes('webp')) return 'td-ai-image.webp';
  return 'td-ai-image.png';
}

function openAiSize(aspect: MediaAspectRatio): string {
  if (aspect === '16:9' || aspect === '3:2') return '1792x1024';
  if (aspect === '9:16' || aspect === '2:3' || aspect === '3:4') return '1024x1792';
  return '1024x1024';
}

// ---------------------------------------------------------------------------
// Gemini Native Image
// ---------------------------------------------------------------------------
async function generateGeminiImage(input: ImageExecutionInput): Promise<GeneratedImageResult> {
  const ai = new GoogleGenAI({ apiKey: input.apiKey });
  const size = imageSize(input.model, input.quality);

  const response = await (
    ai as unknown as { models: { generateContent(input: unknown): Promise<unknown> } }
  ).models.generateContent({
    model: input.model,
    contents: [
      {
        role: 'user',
        parts: imageContents(input.prompt, input.source)
      }
    ],
    config: {
      responseModalities: ['IMAGE'],
      responseFormat: {
        image: {
          aspectRatio: input.aspectRatio,
          ...(size ? { imageSize: size } : {})
        }
      }
    }
  } as never);

  const generated = firstGeneratedImage(response);
  if (!generated?.data) {
    throw new Error(`${input.providerName}/${input.model} returned no image data.`);
  }

  const bytes = Buffer.from(generated.data, 'base64');
  return {
    filename: imageFilename(generated.mimeType),
    contentType: generated.mimeType,
    data: new Uint8Array(bytes),
    quality: input.quality,
    model: input.model
  };
}

// ---------------------------------------------------------------------------
// OpenAI Image Generation
// ---------------------------------------------------------------------------
async function generateOpenAiImage(input: ImageExecutionInput): Promise<GeneratedImageResult> {
  const base = input.apiUrl?.trim() || 'https://api.openai.com/v1';
  const url = `${base.replace(/\/+$/, '')}/images/generations`;

  const model = input.model.toLowerCase().includes('dall-e') ? input.model : 'dall-e-3';
  const body: Record<string, unknown> = {
    model,
    prompt: input.prompt,
    n: 1,
    size: openAiSize(input.aspectRatio),
    response_format: 'b64_json'
  };

  if (model === 'dall-e-3' && input.quality === 'premium') {
    body.quality = 'hd';
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000)
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI image error (${response.status}): ${raw.slice(0, 400)}`);
  }

  const parsed = JSON.parse(raw) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };

  const b64 = parsed.data?.[0]?.b64_json;
  if (b64) {
    const bytes = Buffer.from(b64, 'base64');
    return {
      filename: 'td-ai-image.png',
      contentType: 'image/png',
      data: new Uint8Array(bytes),
      quality: input.quality,
      model: input.model
    };
  }

  const imgUrl = parsed.data?.[0]?.url;
  if (imgUrl) {
    const imgRes = await fetch(imgUrl);
    const bytes = new Uint8Array(await imgRes.arrayBuffer());
    return {
      filename: 'td-ai-image.png',
      contentType: 'image/png',
      data: bytes,
      quality: input.quality,
      model: input.model
    };
  }

  throw new Error(`${input.providerName}/${input.model} returned no image.`);
}

// ---------------------------------------------------------------------------
// Image Dispatcher
// ---------------------------------------------------------------------------
export async function executeImageAdapter(input: ImageExecutionInput): Promise<GeneratedImageResult> {
  switch (input.providerKind) {
    case 'gemini-native':
      return generateGeminiImage(input);

    case 'openai-native':
    case 'openai-compatible':
    case 'openrouter':
      return generateOpenAiImage(input);

    default:
      throw new Error(`Provider kind '${input.providerKind}' does not support image tasks.`);
  }
}
