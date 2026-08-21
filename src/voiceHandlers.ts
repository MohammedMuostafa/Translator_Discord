import type { DiscordInteraction, DiscordInteractionOption } from './types.js';
import { clipDiscord, editOriginalResponse } from './discord.js';
import type { ChatResponseLanguage } from './services/aiChat.js';
import { chatLanguageLabel } from './services/gatewayChat.js';
import { joinVoiceAi, leaveVoiceAi, voiceAiStatus } from './services/voiceAi.js';

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

export function handleVoiceChatCommand(interaction: DiscordInteraction): void {
  void (async () => {
    try {
      const guildId = interaction.guild_id;
      if (!guildId) throw new Error('Voice chat can only be used inside a server with TD AI installed as a bot.');

      const userId = userIdOf(interaction);
      const subcommand = firstSubcommand(interaction);
      const action = subcommand?.name ?? 'status';

      if (action === 'join') {
        const language = (nestedString(subcommand, 'language') ?? 'auto') as ChatResponseLanguage;
        const joined = await joinVoiceAi(guildId, userId, language);
        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: [
            '🎙️ **TD AI joined your voice channel.**',
            `Channel: **${joined.channelName}**`,
            `Language: **${chatLanguageLabel(language)}**`,
            '',
            'Talk normally. TD AI listens only to **you**, converts your speech to text, asks the AI, then answers by voice.',
            'Audio is processed temporarily in memory and is not intentionally stored by this bot.'
          ].join('\n'),
          allowed_mentions: { parse: [] }
        });
        return;
      }

      if (action === 'leave') {
        const left = leaveVoiceAi(guildId, userId);
        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: left
            ? '✅ **TD AI left the voice channel.** Temporary voice conversation memory was cleared.'
            : 'ℹ️ TD AI is not currently in a voice session on this server.',
          allowed_mentions: { parse: [] }
        });
        return;
      }

      if (action === 'status') {
        const status = voiceAiStatus(guildId);
        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: status.active
            ? [
                '🎙️ **TD AI Voice Chat**',
                'Status: **Active**',
                `Channel: <#${status.channelId}>`,
                `Owner: <@${status.userId}>`,
                `Language: **${chatLanguageLabel(status.language ?? 'auto')}**`,
                `State: **${status.busy ? 'Thinking / speaking' : 'Listening'}**`,
                `Context turns: **${status.turns ?? 0}**`
              ].join('\n')
            : '🎙️ **TD AI Voice Chat**\nStatus: **Closed**\nJoin a voice channel and use `/voicechat join`.',
          allowed_mentions: { parse: [] }
        });
        return;
      }

      throw new Error('Unknown voice chat action.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected voice chat error.';
      await editOriginalResponse(interaction.application_id, interaction.token, {
        content: clipDiscord(`❌ ${message}`, 1900),
        allowed_mentions: { parse: [] }
      }).catch(console.error);
    }
  })();
}
