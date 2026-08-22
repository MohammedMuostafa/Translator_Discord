import { GoogleGenAI } from '@google/genai';
import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { env } from '../config.js';
import {
  assertCreditsAvailable,
  assertMediaAccess,
  getUserAccount,
  recordMediaJob,
  recordUsage
} from './billingStore.js';
import {
  imageModelsForPlan,
  videoModelsForPlan,
  type ImageQuality,
  type VideoQuality
} from './modelCatalog.js';

export type MediaAspectRatio =
  | '1:1'
  | '3:2'
  | '2:3'
  | '4:3'
  | '3:4'
  | '16:9'
  | '9:16';

export type GeneratedMedia = {
  filename: string;
  contentType: string;
  data: Uint8Array<ArrayBufferLike>;
  quality: string;
  model?: string;
};

const IMAGE_CREDITS: Record<ImageQuality, number> = {
  draft: 800,
  standard: 1600,
  premium: 3000
};

const IMAGE_EDIT_CREDITS: Record<ImageQuality, number> = {
  draft: 600,
  standard: 1200,
  premium: 2500
};

const VIDEO_CREDITS: Record<VideoQuality, number> = {
  lite: 8000,
  fast: 15_000,
  cinematic: 30_000
};

function mediaApiKey(): string {
  const key =
    env.GEMINI_LIVE_API_KEY ??
    env.GEMINI_TTS_API_KEY ??
    env.GEMINI_STT_API_KEY ??
    env.AI_API_KEY;

  if (!key) {
    throw new Error('Gemini media generation is not configured on this deployment.');
  }

  return key;
}

function statusOf(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'status' in error) {
    const value = Number((error as { status?: unknown }).status);
    if (Number.isFinite(value)) return value;
  }

  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/(?:^|\D)(4\d\d|5\d\d)(?:\D|$)/);
  return match?.[1] ? Number(match[1]) : undefined;
}

function providerMessage(error: unknown, kind: 'image' | 'video'): string {
  const raw = error instanceof Error ? error.message : String(error);
  const status = statusOf(error);
  const lower = raw.toLowerCase();

  if (
    status === 429 ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota')
  ) {
    return kind === 'video'
      ? 'Google Veo quota is unavailable or exhausted for this API project. TD AI did not charge product credits. Veo requires an eligible paid Gemini API project; check billing/quota, then try again.'
      : 'Google image-generation quota is unavailable or exhausted for this API project. TD AI did not charge product credits. Gemini image-generation API models require an eligible paid tier; check billing/quota, then try again.';
  }

  if (status === 403) {
    return `Google ${kind} generation is not enabled for this API project or billing tier. TD AI did not charge product credits.`;
  }

  return raw.length > 700 ? `${raw.slice(0, 700)}…` : raw;
}

function imageSize(
  model: string,
  quality: ImageQuality
): '1K' | '2K' | '4K' | undefined {
  // Gemini 2.5 Flash Image accepts aspect ratio but not the newer imageSize field.
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

export async function generateImageForUser(
  userId: string,
  prompt: string,
  quality: ImageQuality,
  aspectRatio: MediaAspectRatio,
  source?: {
    data: Uint8Array<ArrayBufferLike>;
    contentType: string;
  }
): Promise<GeneratedMedia> {
  const cleanPrompt = prompt.trim();
  if (!cleanPrompt) throw new Error('Image prompt is required.');

  const kind = source ? 'image_edit' : 'image_generate';
  await assertMediaAccess(userId, kind);

  const account = await getUserAccount(userId);
  const models = imageModelsForPlan(account.planId, quality);
  if (!models.length) {
    throw new Error(`${quality} image quality is not available on your ${account.planId} plan.`);
  }

  const credits = source ? IMAGE_EDIT_CREDITS[quality] : IMAGE_CREDITS[quality];
  await assertCreditsAvailable(userId, credits);

  const ai = new GoogleGenAI({ apiKey: mediaApiKey() });
  const errors: string[] = [];

  for (const model of models) {
    try {
      const size = imageSize(model, quality);
      const response = await (ai as unknown as { models: { generateContent(input: unknown): Promise<unknown> } }).models.generateContent({
        model,
        contents: [{
          role: 'user',
          parts: imageContents(cleanPrompt, source)
        }],
        config: {
          responseModalities: ['IMAGE'],
          responseFormat: {
            image: {
              aspectRatio,
              ...(size ? { imageSize: size } : {})
            }
          }
        }
      } as never);

      const generated = firstGeneratedImage(response);
      if (!generated?.data) {
        throw new Error(`${model} returned no image data.`);
      }

      const bytes = Buffer.from(generated.data, 'base64');
      await recordUsage(userId, kind, credits);
      await recordMediaJob(userId, kind);

      return {
        filename: imageFilename(generated.mimeType),
        contentType: generated.mimeType,
        data: new Uint8Array(bytes),
        quality,
        model
      };
    } catch (error) {
      errors.push(`${model}: ${providerMessage(error, 'image')}`);
      const status = statusOf(error);
      if (status === 401) break;
      console.warn(`Image model failed (${model}); trying next model.`, error);
    }
  }

  throw new Error(
    errors.at(-1)?.split(': ').slice(1).join(': ') ||
      'All image-generation models are currently unavailable.'
  );
}

type VideoOperationLike = {
  done?: boolean;
  response?: {
    generatedVideos?: Array<{
      video?: unknown;
    }>;
  };
};

type MediaClient = {
  models: {
    generateVideos(input: Record<string, unknown>): Promise<VideoOperationLike>;
  };
  operations: {
    getVideosOperation(input: { operation: VideoOperationLike }): Promise<VideoOperationLike>;
  };
  files: {
    download(input: { file: unknown; downloadPath: string }): Promise<unknown>;
  };
};

async function generateVideoWithModel(
  mediaClient: MediaClient,
  model: string,
  prompt: string,
  aspectRatio: '16:9' | '9:16'
): Promise<Uint8Array<ArrayBufferLike>> {
  let operation = await mediaClient.models.generateVideos({
    model,
    prompt,
    config: {
      aspectRatio,
      numberOfVideos: 1
    }
  });

  const deadline = Date.now() + 14 * 60_000;
  while (!operation.done) {
    if (Date.now() > deadline) {
      throw new Error('Video generation took too long. Try again with a shorter prompt.');
    }

    await new Promise((resolve) => setTimeout(resolve, 10_000));
    operation = await mediaClient.operations.getVideosOperation({ operation });
  }

  const video = operation.response?.generatedVideos?.[0]?.video;
  if (!video) throw new Error(`${model} finished without a video file.`);

  const tempName = `td-ai-${randomUUID()}.mp4`;
  const filePath = path.join(os.tmpdir(), tempName);

  try {
    await mediaClient.files.download({ file: video, downloadPath: filePath });
    return new Uint8Array(await readFile(filePath));
  } finally {
    await unlink(filePath).catch(() => undefined);
  }
}

export async function generateVideoForUser(
  userId: string,
  prompt: string,
  quality: VideoQuality,
  aspectRatio: '16:9' | '9:16'
): Promise<GeneratedMedia> {
  const cleanPrompt = prompt.trim();
  if (!cleanPrompt) throw new Error('Video prompt is required.');

  await assertMediaAccess(userId, 'video_generate');
  const account = await getUserAccount(userId);
  const models = videoModelsForPlan(account.planId, quality);
  if (!models.length) {
    throw new Error(`${quality} video quality is not available on your ${account.planId} plan.`);
  }

  const credits = VIDEO_CREDITS[quality];
  await assertCreditsAvailable(userId, credits);

  const ai = new GoogleGenAI({ apiKey: mediaApiKey() });
  const mediaClient = ai as unknown as MediaClient;
  const errors: string[] = [];

  for (const model of models) {
    try {
      const bytes = await generateVideoWithModel(
        mediaClient,
        model,
        cleanPrompt,
        aspectRatio
      );

      await recordUsage(userId, 'video_generate', credits);
      await recordMediaJob(userId, 'video_generate');

      return {
        filename: 'td-ai-video.mp4',
        contentType: 'video/mp4',
        data: bytes,
        quality,
        model
      };
    } catch (error) {
      const message = providerMessage(error, 'video');
      errors.push(`${model}: ${message}`);
      const status = statusOf(error);
      console.warn(`Video model failed (${model}); trying next model.`, error);
      if (status === 401) break;
    }
  }

  throw new Error(
    errors.at(-1)?.split(': ').slice(1).join(': ') ||
      'All video-generation models are currently unavailable.'
  );
}

export function mediaCreditCosts() {
  return {
    image: IMAGE_CREDITS,
    imageEdit: IMAGE_EDIT_CREDITS,
    video: VIDEO_CREDITS
  };
}
