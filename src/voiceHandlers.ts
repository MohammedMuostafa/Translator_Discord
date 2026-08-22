import type { DiscordInteraction, DiscordInteractionOption } from './types.js';
import { clipDiscord, editOriginalResponse } from './discord.js';
import type { ChatResponseLanguage } from './services/aiChat.js';
import { chatLanguageLabel } from './services/gatewayChat.js';
import {
  joinVoiceAi,
  leaveVoiceAi,
  reconnectVoiceAi,
  skipVoiceAi,
  voiceAiStatus,
  voiceAiUsage,
  writeVoiceChat
} from './services/voiceAi.js';

function userIdOf(interaction: DiscordInteraction): string {
  const id = interaction.member?.user?.id ?? interaction.user?.id;
  if (!id) throw new Error('Could not resolve the invoking Discord user.');
  return id;
}

function firstSubcommand(interaction: DiscordInteraction): DiscordInteractionOption | undefined {
  return interaction.data?.options?.[0];
}

function nestedString(
  option: DiscordInteractionOption | undefined,
  name: string
): string | undefined {
  return option?.options?.find((item) => item.name === name)?.value as string | undefined;
}

export function handleVoiceChatCommand(interaction: DiscordInteraction): void {
  void (async () => {
    try {
      const guildId = interaction.guild_id;
      if (!guildId) {
        throw new Error('Voice chat can only be used inside a server with TD AI installed as a bot.');
      }

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
            `Engine: **${joined.mode === 'live' ? 'Gemini Live' : 'Cascade fallback'}**`,
            'Activation: **Always listening**',
            '',
            'Talk normally. No wake word is required; TD AI responds to allowed human speakers in the channel.',
            '',
            '👥 Human members in the same voice channel can talk to TD AI.',
            'Use `/voicechat write`, `/voicechat skip`, `/voicechat reconnect`, or `/voicechat usage` for deterministic controls.'
          ].join('\n'),
          allowed_mentions: { parse: [] }
        });
        return;
      }


      if (action === 'write') {
        const text = nestedString(subcommand, 'text') ?? '';
        await writeVoiceChat(guildId, userId, text);
        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: '✅ **Posted in the current voice-channel chat.**',
          allowed_mentions: { parse: [] }
        });
        return;
      }

      if (action === 'skip') {
        const skipped = skipVoiceAi(guildId);
        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: skipped
            ? '⏭️ **Skipped the current TD AI voice response.**'
            : 'ℹ️ TD AI is not currently in a voice session.',
          allowed_mentions: { parse: [] }
        });
        return;
      }

      if (action === 'reconnect') {
        const reconnected = await reconnectVoiceAi(guildId, userId);
        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: [
            '🔄 **TD AI reconnected.**',
            `Channel: **${reconnected.channelName}**`,
            'Mode: **conversation**',
            `Engine: **${reconnected.mode}**`
          ].join('\n'),
          allowed_mentions: { parse: [] }
        });
        return;
      }

      if (action === 'usage') {
        const usage = await voiceAiUsage(userId);
        const featureLines = Object.entries(usage.byFeature)
          .sort((a, b) => Number(b[1]) - Number(a[1]))
          .slice(0, 8)
          .map(([feature, credits]) => `• ${feature}: **${Number(credits).toLocaleString()}**`);

        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: [
            '📊 **TD AI Usage**',
            `Plan: **${usage.plan.name}**`,
            `Used: **${usage.used.toLocaleString()} / ${usage.allowance.toLocaleString()} credits**`,
            `Remaining: **${usage.remaining.toLocaleString()} credits**`,
            `Reset: **${new Date(usage.account.periodEnd).toLocaleDateString('en-US')}**`,
            '',
            ...(featureLines.length ? featureLines : ['No metered usage yet.'])
          ].join('\n'),
          allowed_mentions: { parse: [] }
        });
        return;
      }

      if (action === 'leave') {
        const left = leaveVoiceAi(guildId, userId);
        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: left
            ? '✅ **TD AI left the voice channel.** Temporary voice conversation state was cleared.'
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
                `Mode: **${status.purpose}**`,
                `Engine: **${status.mode}**`,
                `Channel: <#${status.channelId}>`,
                `Owner: <@${status.userId}>`,
                `Speaker access: **${status.speakerAccess === 'everyone' ? 'Everyone in channel' : 'Owner only'}**`,
                `Participants heard: **${status.participantCount ?? 0}**`,
                'Activation: **Always listening**',
                status.activeSpeakerId ? `Current speaker: <@${status.activeSpeakerId}>` : '',
                `Language: **${chatLanguageLabel(status.language ?? 'auto')}**`,
                status.voiceName ? `Voice: **${status.voiceName}**` : '',
                status.responseDelayMs !== undefined ? `Response delay: **${status.responseDelayMs} ms**` : '',
                `State: **${status.busy ? 'Responding' : 'Listening'}**`,
                `Context turns: **${status.turns ?? 0}**`,
                status.inputTranscript ? `Heard: ${status.inputTranscript.slice(0, 250)}` : '',
                status.outputTranscript ? `Last reply: ${status.outputTranscript.slice(0, 250)}` : ''
              ].filter(Boolean).join('\n')
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
