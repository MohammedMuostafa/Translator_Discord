import type {
  DiscordAttachment,
  DiscordInteraction,
  DiscordInteractionOption
} from './types.js';
import {
  clipDiscord,
  editOriginalResponse,
  editOriginalResponseWithFile
} from './discord.js';
import {
  generateImageForUser,
  generateVideoForUser,
  type MediaAspectRatio
} from './services/mediaGeneration.js';
import {
  userUsageSummary
} from './services/billingStore.js';
import type {
  ImageQuality,
  VideoQuality
} from './services/modelCatalog.js';

function userIdOf(
  interaction: DiscordInteraction
): string {
  const id =
    interaction.member?.user?.id ??
    interaction.user?.id;

  if (!id) {
    throw new Error(
      'Could not resolve the invoking Discord user.'
    );
  }

  return id;
}

function firstSubcommand(
  interaction: DiscordInteraction
): DiscordInteractionOption | undefined {
  return interaction
    .data
    ?.options?.[0];
}

function nestedString(
  option: DiscordInteractionOption | undefined,
  name: string
): string | undefined {
  return option
    ?.options
    ?.find(
      (item) =>
        item.name === name
    )
    ?.value as
      | string
      | undefined;
}

function nestedAttachment(
  interaction: DiscordInteraction,
  option: DiscordInteractionOption | undefined,
  name: string
): DiscordAttachment | undefined {
  const id =
    nestedString(
      option,
      name
    );

  if (!id) {
    return undefined;
  }

  return interaction
    .data
    ?.resolved
    ?.attachments?.[id];
}

async function downloadImage(
  attachment: DiscordAttachment
): Promise<{
  data: Uint8Array<ArrayBufferLike>;
  contentType: string;
}> {
  const contentType =
    attachment.content_type ??
    '';

  if (
    !contentType
      .toLowerCase()
      .startsWith('image/')
  ) {
    throw new Error(
      'Upload an image file.'
    );
  }

  if (
    (attachment.size ?? 0) >
    15 * 1024 * 1024
  ) {
    throw new Error(
      'Image is too large. Maximum source image size is 15 MB.'
    );
  }

  const response =
    await fetch(
      attachment.url,
      {
        signal:
          AbortSignal.timeout(
            25_000
          )
      }
    );

  if (!response.ok) {
    throw new Error(
      `Could not download the image (${response.status}).`
    );
  }

  return {
    data:
      new Uint8Array(
        await response
          .arrayBuffer()
      ),
    contentType
  };
}

function usageLine(
  summary: Awaited<
    ReturnType<
      typeof userUsageSummary
    >
  >
): string {
  return (
    `${summary.remaining.toLocaleString()} ` +
    `credits remaining`
  );
}

export function handleImageCommand(
  interaction: DiscordInteraction
): void {
  void (async () => {
    try {
      const userId =
        userIdOf(
          interaction
        );

      const subcommand =
        firstSubcommand(
          interaction
        );

      const action =
        subcommand?.name ??
        'generate';

      const prompt =
        nestedString(
          subcommand,
          'prompt'
        ) ?? '';

      const quality =
        (
          nestedString(
            subcommand,
            'quality'
          ) ??
          'standard'
        ) as ImageQuality;

      const aspect =
        (
          nestedString(
            subcommand,
            'aspect'
          ) ??
          '1:1'
        ) as MediaAspectRatio;

      const source =
        action === 'edit'
          ? await downloadImage(
              nestedAttachment(
                interaction,
                subcommand,
                'image'
              ) ?? (() => {
                throw new Error(
                  'Choose an image to edit.'
                );
              })()
            )
          : undefined;

      const generated =
        await generateImageForUser(
          userId,
          prompt,
          quality,
          aspect,
          source
        );

      const usage =
        await userUsageSummary(
          userId
        );

      await editOriginalResponseWithFile(
        interaction.application_id,
        interaction.token,
        {
          content: [
            action === 'edit'
              ? '✨ **TD Image Edit complete**'
              : '✨ **TD Image complete**',
            `Quality: **${quality}**`,
            `Aspect: **${aspect}**`,
            `Plan: **${usage.plan.name}**`,
            `Usage: **${usageLine(usage)}**`
          ].join('\n'),
          allowed_mentions: {
            parse: []
          }
        },
        generated
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unexpected image generation error.';

      await editOriginalResponse(
        interaction.application_id,
        interaction.token,
        {
          content:
            clipDiscord(
              `❌ ${message}`,
              1900
            ),
          components: [],
          allowed_mentions: {
            parse: []
          }
        }
      ).catch(console.error);
    }
  })();
}

export function handleVideoCommand(
  interaction: DiscordInteraction
): void {
  void (async () => {
    try {
      const userId =
        userIdOf(
          interaction
        );

      const subcommand =
        firstSubcommand(
          interaction
        );

      const prompt =
        nestedString(
          subcommand,
          'prompt'
        ) ?? '';

      const quality =
        (
          nestedString(
            subcommand,
            'quality'
          ) ??
          'lite'
        ) as VideoQuality;

      const aspect =
        (
          nestedString(
            subcommand,
            'aspect'
          ) ??
          '16:9'
        ) as
          | '16:9'
          | '9:16';

      const generated =
        await generateVideoForUser(
          userId,
          prompt,
          quality,
          aspect
        );

      const usage =
        await userUsageSummary(
          userId
        );

      await editOriginalResponseWithFile(
        interaction.application_id,
        interaction.token,
        {
          content: [
            '🎬 **TD Video complete**',
            `Quality: **${quality}**`,
            `Aspect: **${aspect}**`,
            `Plan: **${usage.plan.name}**`,
            `Usage: **${usageLine(usage)}**`
          ].join('\n'),
          allowed_mentions: {
            parse: []
          }
        },
        generated
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unexpected video generation error.';

      await editOriginalResponse(
        interaction.application_id,
        interaction.token,
        {
          content:
            clipDiscord(
              `❌ ${message}`,
              1900
            ),
          components: [],
          allowed_mentions: {
            parse: []
          }
        }
      ).catch(console.error);
    }
  })();
}
