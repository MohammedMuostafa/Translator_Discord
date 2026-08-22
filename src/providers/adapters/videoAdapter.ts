import { GoogleGenAI } from '@google/genai';
import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ProviderKind } from '../../services/runtimeConfigTypes.js';
import type { VideoQuality } from '../../services/modelCatalog.js';

export type GeneratedVideoResult = {
  filename: string;
  contentType: string;
  data: Uint8Array<ArrayBufferLike>;
  quality: string;
  model: string;
};

export type VideoExecutionInput = {
  providerKind: ProviderKind;
  providerName: string;
  apiUrl?: string;
  apiKey: string;
  model: string;
  prompt: string;
  quality: VideoQuality;
  aspectRatio: '16:9' | '9:16';
};

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

async function generateVeoVideo(input: VideoExecutionInput): Promise<GeneratedVideoResult> {
  const ai = new GoogleGenAI({ apiKey: input.apiKey });
  const mediaClient = ai as unknown as MediaClient;

  let operation = await mediaClient.models.generateVideos({
    model: input.model,
    prompt: input.prompt,
    config: {
      aspectRatio: input.aspectRatio,
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
  if (!video) throw new Error(`${input.model} finished without a video file.`);

  const tempName = `td-ai-${randomUUID()}.mp4`;
  const filePath = path.join(os.tmpdir(), tempName);

  try {
    await mediaClient.files.download({ file: video, downloadPath: filePath });
    const data = new Uint8Array(await readFile(filePath));
    return {
      filename: 'td-ai-video.mp4',
      contentType: 'video/mp4',
      data,
      quality: input.quality,
      model: input.model
    };
  } finally {
    await unlink(filePath).catch(() => undefined);
  }
}

export async function executeVideoAdapter(input: VideoExecutionInput): Promise<GeneratedVideoResult> {
  if (input.providerKind !== 'gemini-native') {
    throw new Error(`Video generation is only supported by Gemini-native providers at this time.`);
  }
  return generateVeoVideo(input);
}
