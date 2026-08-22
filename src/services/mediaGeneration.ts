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
  imageModelForPlan,
  videoModelForPlan,
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
};

const IMAGE_CREDITS: Record<
  ImageQuality,
  number
> = {
  draft: 800,
  standard: 1600,
  premium: 3000
};

const IMAGE_EDIT_CREDITS: Record<
  ImageQuality,
  number
> = {
  draft: 600,
  standard: 1200,
  premium: 2500
};

const VIDEO_CREDITS: Record<
  VideoQuality,
  number
> = {
  lite: 8000,
  fast: 15_000,
  cinematic: 30_000
};

function mediaApiKey(): string {
  const key =
    env.GEMINI_LIVE_API_KEY ??
    env.GEMINI_TTS_API_KEY ??
    env.AI_API_KEY;

  if (!key) {
    throw new Error(
      'Gemini media generation is not configured on this deployment.'
    );
  }

  return key;
}

function imageSize(
  model: string,
  quality: ImageQuality
): '1K' | '2K' | '4K' {
  // Keep the Lite model conservative for broad compatibility.
  if (
    model.includes('flash-lite-image') ||
    model.includes('2.5-flash-image')
  ) {
    return '1K';
  }

  if (
    model.includes('3-pro-image') &&
    quality === 'premium'
  ) {
    return '4K';
  }

  if (
    quality === 'standard' ||
    quality === 'premium'
  ) {
    return '2K';
  }

  return '1K';
}

function imageInput(
  prompt: string,
  source?: {
    data: Uint8Array<ArrayBufferLike>;
    contentType: string;
  }
): string | Array<Record<string, string>> {
  if (!source) {
    return prompt;
  }

  return [
    {
      type: 'text',
      text: prompt
    },
    {
      type: 'image',
      mime_type:
        source.contentType,
      data:
        Buffer
          .from(source.data)
          .toString('base64')
    }
  ];
}

function outputImage(
  interaction: unknown
): {
  data?: string;
  mime_type?: string;
  mimeType?: string;
} | undefined {
  if (
    !interaction ||
    typeof interaction !==
      'object'
  ) {
    return undefined;
  }

  const value =
    interaction as {
      output_image?: {
        data?: string;
        mime_type?: string;
        mimeType?: string;
      };
      outputImage?: {
        data?: string;
        mime_type?: string;
        mimeType?: string;
      };
    };

  return (
    value.output_image ??
    value.outputImage
  );
}

function imageFilename(
  contentType: string
): string {
  if (
    contentType.includes(
      'jpeg'
    )
  ) {
    return 'td-ai-image.jpg';
  }

  if (
    contentType.includes(
      'webp'
    )
  ) {
    return 'td-ai-image.webp';
  }

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
  const cleanPrompt =
    prompt.trim();

  if (!cleanPrompt) {
    throw new Error(
      'Image prompt is required.'
    );
  }

  const kind =
    source
      ? 'image_edit'
      : 'image_generate';

  await assertMediaAccess(
    userId,
    kind
  );

  const account =
    await getUserAccount(
      userId
    );

  const model =
    imageModelForPlan(
      account.planId,
      quality
    );

  if (!model) {
    throw new Error(
      `${quality} image quality is not available on your ${account.planId} plan.`
    );
  }

  const credits =
    source
      ? IMAGE_EDIT_CREDITS[
          quality
        ]
      : IMAGE_CREDITS[
          quality
        ];

  await assertCreditsAvailable(
    userId,
    credits
  );

  const ai =
    new GoogleGenAI({
      apiKey:
        mediaApiKey()
    });

  const interaction =
    await (
      ai as unknown as {
        interactions: {
          create(
            input: Record<
              string,
              unknown
            >
          ): Promise<unknown>;
        };
      }
    ).interactions.create({
      model,
      input:
        imageInput(
          cleanPrompt,
          source
        ),
      response_format: {
        type: 'image',
        mime_type:
          'image/png',
        aspect_ratio:
          aspectRatio,
        image_size:
          imageSize(
            model,
            quality
          )
      }
    });

  const generated =
    outputImage(
      interaction
    );

  if (!generated?.data) {
    throw new Error(
      'Gemini returned no generated image.'
    );
  }

  const contentType =
    generated.mime_type ??
    generated.mimeType ??
    'image/png';

  const bytes =
    Buffer.from(
      generated.data,
      'base64'
    );

  await recordUsage(
    userId,
    kind,
    credits
  );

  await recordMediaJob(
    userId,
    kind
  );

  return {
    filename:
      imageFilename(
        contentType
      ),
    contentType,
    data:
      new Uint8Array(
        bytes
      ),
    quality
  };
}

export async function generateVideoForUser(
  userId: string,
  prompt: string,
  quality: VideoQuality,
  aspectRatio: '16:9' | '9:16'
): Promise<GeneratedMedia> {
  const cleanPrompt =
    prompt.trim();

  if (!cleanPrompt) {
    throw new Error(
      'Video prompt is required.'
    );
  }

  await assertMediaAccess(
    userId,
    'video_generate'
  );

  const account =
    await getUserAccount(
      userId
    );

  const model =
    videoModelForPlan(
      account.planId,
      quality
    );

  if (!model) {
    throw new Error(
      `${quality} video quality is not available on your ${account.planId} plan.`
    );
  }

  const credits =
    VIDEO_CREDITS[
      quality
    ];

  await assertCreditsAvailable(
    userId,
    credits
  );

  const ai =
    new GoogleGenAI({
      apiKey:
        mediaApiKey()
    });

  type VideoOperationLike = {
    done?: boolean;
    response?: {
      generatedVideos?: Array<{
        video?: unknown;
      }>;
    };
  };

  const mediaClient =
    ai as unknown as {
      models: {
        generateVideos(
          input: Record<
            string,
            unknown
          >
        ): Promise<VideoOperationLike>;
      };
      operations: {
        getVideosOperation(
          input: {
            operation:
              VideoOperationLike;
          }
        ): Promise<VideoOperationLike>;
      };
      files: {
        download(
          input: {
            file: unknown;
            downloadPath: string;
          }
        ): Promise<unknown>;
      };
    };

  let operation =
    await mediaClient
      .models
      .generateVideos({
        model,
        prompt:
          cleanPrompt,
        config: {
          aspectRatio,
          numberOfVideos: 1
        }
      });

  const deadline =
    Date.now() +
    14 * 60_000;

  while (
    !operation.done
  ) {
    if (
      Date.now() >
      deadline
    ) {
      throw new Error(
        'Video generation took too long. Try again with a shorter prompt.'
      );
    }

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          10_000
        )
    );

    operation =
      await mediaClient
        .operations
        .getVideosOperation({
          operation
        });
  }

  const video =
    operation.response
      ?.generatedVideos?.[0]
      ?.video;

  if (!video) {
    throw new Error(
      'Veo finished without a video file.'
    );
  }

  const filename =
    `td-ai-${randomUUID()}.mp4`;

  const filePath =
    path.join(
      os.tmpdir(),
      filename
    );

  try {
    await mediaClient
      .files
      .download({
        file: video,
        downloadPath:
          filePath
      });

    const bytes =
      await readFile(
        filePath
      );

    await recordUsage(
      userId,
      'video_generate',
      credits
    );

    await recordMediaJob(
      userId,
      'video_generate'
    );

    return {
      filename:
        'td-ai-video.mp4',
      contentType:
        'video/mp4',
      data:
        new Uint8Array(
          bytes
        ),
      quality
    };
  } finally {
    await unlink(
      filePath
    ).catch(
      () => undefined
    );
  }
}

export function mediaCreditCosts() {
  return {
    image:
      IMAGE_CREDITS,
    imageEdit:
      IMAGE_EDIT_CREDITS,
    video:
      VIDEO_CREDITS
  };
}
