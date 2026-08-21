import type { DiscordInteraction, DiscordInteractionOption } from './types.js';
import { clipDiscord, editOriginalResponse } from './discord.js';
import {
  aiDmChatStatus,
  chatLanguageLabel,
  closeAiDmChat,
  openAiDmChat,
  resetAiDmChat,
} from './services/gatewayChat.js';
import type { ChatResponseLanguage } from './services/aiChat.js';

function userIdOf(interaction: DiscordInteraction): string {
  const id = interaction.member?.user?.id ?? interaction.user?.id;
  if (!id) throw new Error('Could not resolve the invoking Discord user.');
  return id;
}

function firstSubcommand(interaction: DiscordInteraction): DiscordInteractionOption | undefined {
  return interaction.data?.options?.[0];
}

function nestedString(option: DiscordInteractionOption | undefined, name: string): string | undefined {
  return option?.options?.find((item) => item.name === name)?.value as string | undefined;
}

export function handleChatCommand(interaction: DiscordInteraction): void {
  void (async () => {
    try {
      const userId = userIdOf(interaction);
      const subcommand = firstSubcommand(interaction);
      const action = subcommand?.name ?? 'open';

      if (action === 'open') {
        const language = (nestedString(subcommand, 'language') ?? 'auto') as ChatResponseLanguage;
        await openAiDmChat(userId, language);
        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: [
            '✅ **TD AI chat opened.**',
            'I sent you a private DM. Continue there by typing normal messages — no more slash commands are needed.',
            `Language: **${chatLanguageLabel(language)}**`
          ].join('\n'),
          allowed_mentions: { parse: [] }
        });
        return;
      }

      if (action === 'close') {
        const existed = closeAiDmChat(userId);
        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: existed
            ? '✅ **TD AI chat closed.** Temporary conversation memory was deleted.'
            : 'ℹ️ No active TD AI chat session was open.',
          allowed_mentions: { parse: [] }
        });
        return;
      }

      if (action === 'reset') {
        const reset = resetAiDmChat(userId);
        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: reset
            ? '🧹 **Chat context cleared.** You can keep typing in the same DM with a fresh conversation.'
            : 'ℹ️ No active chat session. Use `/chat open` first.',
          allowed_mentions: { parse: [] }
        });
        return;
      }

      if (action === 'status') {
        const status = aiDmChatStatus(userId);
        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: status.active
            ? [
                '🤖 **TD AI Chat**',
                'Status: **Active**',
                `Language: **${chatLanguageLabel(status.language ?? 'auto')}**`,
                `Context turns: **${status.turns ?? 0}**`,
                `Auto-expiry: **~${status.expiresInMinutes ?? 0} min**`
              ].join('\n')
            : '🤖 **TD AI Chat**\nStatus: **Closed**\nUse `/chat open` to start.',
          allowed_mentions: { parse: [] }
        });
        return;
      }

      throw new Error('Unknown chat action.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected chat error.';
      await editOriginalResponse(interaction.application_id, interaction.token, {
        content: clipDiscord(`❌ ${message}`, 1900),
        allowed_mentions: { parse: [] }
      }).catch(console.error);
    }
  })();
}
