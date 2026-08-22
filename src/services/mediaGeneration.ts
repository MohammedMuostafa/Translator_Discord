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
import {
  getResolvedTaskRoute,
  parseModelChain
} from './runtimeConfig.js';
import {
  executeImageAdapter,
  type GeneratedImageResult,
  type MediaAspectRatio
} from '../providers/adapters/imageAdapter.js';
import {
  executeVideoAdapter,
  type GeneratedVideoResult
} from '../providers/adapters/videoAdapter.js';

export type { MediaAspectRatio };

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
      ? 'Video generation quota is unavailable or exhausted for this API project. TD AI did not charge product credits.'
      : 'Image generation quota is unavailable or exhausted for this API project. TD AI did not charge product credits.';
  }

  if (status === 403) {
    return `Provider ${kind} generation is not enabled for this API project or billing tier. TD AI did not charge product credits.`;
  }

  return raw.length > 700 ? `${raw.slice(0, 700)}…` : raw;
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
  const planModels = imageModelsForPlan(account.planId, quality);
  if (!planModels.length && account.planId === 'free' && quality === 'premium') {
    throw new Error(`${quality} image quality is not available on your ${account.planId} plan.`);
  }

  const credits = source ? IMAGE_EDIT_CREDITS[quality] : IMAGE_CREDITS[quality];
  await assertCreditsAvailable(userId, credits);

  const route = await getResolvedTaskRoute(kind);
  const configuredModels = parseModelChain(route.model);
  const modelsToTry =
    route.providerName.startsWith('Environment Gemini')
      ? planModels.length ? planModels : configuredModels
      : configuredModels.length ? configuredModels : planModels;

  const errors: string[] = [];

  for (const model of modelsToTry) {
    try {
      const generated: GeneratedImageResult = await executeImageAdapter({
        providerKind: route.transport,
        providerName: route.providerName,
        apiUrl: route.apiUrl,
        apiKey: route.apiKey,
        model,
        prompt: cleanPrompt,
        quality,
        aspectRatio,
        source
      });

      await recordUsage(userId, kind, credits);
      await recordMediaJob(userId, kind);

      return {
        filename: generated.filename,
        contentType: generated.contentType,
        data: generated.data,
        quality,
        model: generated.model
      };
    } catch (error) {
      errors.push(`${model}: ${providerMessage(error, 'image')}`);
      const status = statusOf(error);
      if (status === 401) break;
      console.warn(`Image model failed (${model}); trying next model.`, error);
    }
  }

  // If primary route failed and fallback exists, try fallback
  if (route.fallback) {
    const fbModels = parseModelChain(route.fallback.model);
    for (const model of fbModels) {
      try {
        const generated: GeneratedImageResult = await executeImageAdapter({
          providerKind: route.fallback.transport,
          providerName: route.fallback.providerName,
          apiUrl: route.fallback.apiUrl,
          apiKey: route.fallback.apiKey,
          model,
          prompt: cleanPrompt,
          quality,
          aspectRatio,
          source
        });

        await recordUsage(userId, kind, credits);
        await recordMediaJob(userId, kind);

        return {
          filename: generated.filename,
          contentType: generated.contentType,
          data: generated.data,
          quality,
          model: generated.model
        };
      } catch (error) {
        errors.push(`${route.fallback.providerName}/${model}: ${providerMessage(error, 'image')}`);
        console.warn(`Fallback image model failed (${model}); trying next model.`, error);
      }
    }
  }

  throw new Error(
    errors.at(-1)?.split(': ').slice(1).join(': ') ||
      'All configured image-generation models are currently unavailable.'
  );
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
  const planModels = videoModelsForPlan(account.planId, quality);
  if (!planModels.length) {
    throw new Error(`${quality} video quality is not available on your ${account.planId} plan.`);
  }

  const credits = VIDEO_CREDITS[quality];
  await assertCreditsAvailable(userId, credits);

  const route = await getResolvedTaskRoute('video_generate');
  const configuredModels = parseModelChain(route.model);
  const modelsToTry =
    route.providerName.startsWith('Environment Gemini')
      ? planModels
      : configuredModels.length ? configuredModels : planModels;

  const errors: string[] = [];

  for (const model of modelsToTry) {
    try {
      const generated: GeneratedVideoResult = await executeVideoAdapter({
        providerKind: route.transport,
        providerName: route.providerName,
        apiUrl: route.apiUrl,
        apiKey: route.apiKey,
        model,
        prompt: cleanPrompt,
        quality,
        aspectRatio
      });

      await recordUsage(userId, 'video_generate', credits);
      await recordMediaJob(userId, 'video_generate');

      return {
        filename: generated.filename,
        contentType: generated.contentType,
        data: generated.data,
        quality,
        model: generated.model
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
