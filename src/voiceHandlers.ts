import type { DiscordInteraction } from './types.js';
import { clipDiscord, editOriginalResponse } from './discord.js';
import {
  joinVoiceAi,
  leaveVoiceAi
} from './services/voiceAi.js';
import { getUserPersonalization } from './services/userPersonalization.js';

function userIdOf(interaction: DiscordInteraction): string {
  const id = interaction.member?.user?.id ?? interaction.user?.id;
  if (!id) throw new Error('Could not resolve the invoking Discord user.');
  return id;
}

export function handleJoinCommand(interaction: DiscordInteraction): void {
  void (async () => {
    try {
      const guildId = interaction.guild_id;
      if (!guildId) {
        throw new Error('Voice chat can only be used inside a server with TD AI installed as a bot.');
      }

      const userId = userIdOf(interaction);
      const personal = await getUserPersonalization(userId);
      const joined = await joinVoiceAi(guildId, userId, 'auto');

      await editOriginalResponse(interaction.application_id, interaction.token, {
        content: [
          '🎙️ **TD AI joined your voice channel.**',
          `Channel: **${joined.channelName}**`,
          `Wake Name: **${personal.wakeName || 'TD'}** (aliases: *يا TD, تي دي, Hey TD*)`,
          `Follow-up Window: **${Math.round((personal.followupWindowMs || 5000) / 1000)}s**`,
          'Status: **Sleeping** (background conversation is ignored)',
          '',
          '✨ **Speak naturally after saying the wake name:**',
          '• `"يا TD عامل إيه؟"`',
          '• `"TD شغل أغنية Lose Yourself"`',
          '• `"علي الصوت"` / `"خلي الصوت 80%"`',
          '• `"TD شغل الترجمة بين العربي والإنجليزي"`',
          '• `"TD اعملي صورة عربية في الفضاء"`',
          '',
          '💡 *After TD finishes speaking, you have 5 seconds to reply without saying the wake word.*'
        ].join('\n'),
        allowed_mentions: { parse: [] }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected voice chat error.';
      await editOriginalResponse(interaction.application_id, interaction.token, {
        content: clipDiscord(`❌ ${message}`, 1900),
        allowed_mentions: { parse: [] }
      }).catch(console.error);
    }
  })();
}

export function handleLeaveCommand(interaction: DiscordInteraction): void {
  void (async () => {
    try {
      const guildId = interaction.guild_id;
      if (!guildId) {
        throw new Error('Voice chat can only be used inside a server with TD AI installed as a bot.');
      }

      const userId = userIdOf(interaction);
      const left = leaveVoiceAi(guildId, userId);

      await editOriginalResponse(interaction.application_id, interaction.token, {
        content: left
          ? '✅ **TD AI disconnected from the voice channel.**'
          : 'ℹ️ TD AI is not currently connected to a voice channel in this server.',
        allowed_mentions: { parse: [] }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected voice chat error.';
      await editOriginalResponse(interaction.application_id, interaction.token, {
        content: clipDiscord(`❌ ${message}`, 1900),
        allowed_mentions: { parse: [] }
      }).catch(console.error);
    }
  })();
}
