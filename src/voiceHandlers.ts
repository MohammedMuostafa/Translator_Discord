import type { DiscordInteraction, DiscordInteractionOption } from './types.js';
import { clipDiscord, editOriginalResponse } from './discord.js';
import type { ChatResponseLanguage } from './services/aiChat.js';
import { chatLanguageLabel } from './services/gatewayChat.js';
import {
  joinVoiceAi,
  leaveVoiceAi,
  reconnectVoiceAi,
  skipVoiceAi,
  startVoiceTranslation,
  stopVoiceTranslation,
  voiceAiStatus,
  voiceAiUsage,
  writeVoiceChat
} from './services/voiceAi.js';
import {
  getVoiceControlSettings,
  type TranslationOutput,
  type TranslationQuality
} from './services/voiceControl.js';

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
        const control = await getVoiceControlSettings();

        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: [
            '🎙️ **TD AI joined your voice channel.**',
            `Channel: **${joined.channelName}**`,
            `Language: **${chatLanguageLabel(language)}**`,
            `Engine: **${joined.mode === 'live' ? 'Gemini Live' : 'Wake-gated Cascade'}**`,
            `Activation: **${control.activationMode === 'wake-word' ? `Wake word — ${control.wakeWords.join(', ')}` : 'Always listening'}**`,
            '',
            control.activationMode === 'wake-word'
              ? `Say **${control.wakeWords[0] ?? 'TD'}** before your request. After each answer you have about ${Math.round(control.followupWindowMs / 1000)} seconds for a follow-up without saying the wake word again.`
              : 'Talk normally. TD AI responds to the current speaker.',
            '',
            '👥 Human members in the same voice channel can talk to TD AI.',
            'Use `/voicechat write`, `/voicechat skip`, `/voicechat reconnect`, `/voicechat translate`, or `/voicechat usage` for deterministic controls.'
          ].join('\n'),
          allowed_mentions: { parse: [] }
        });
        return;
      }

      if (action === 'translate') {
        const languageA = nestedString(subcommand, 'language_a') ?? 'en';
        const languageB = nestedString(subcommand, 'language_b') ?? 'ar-eg';
        const output = (nestedString(subcommand, 'output') ?? 'both') as TranslationOutput;
        const quality = (nestedString(subcommand, 'quality') ?? 'balanced') as TranslationQuality;

        const started = await startVoiceTranslation(guildId, userId, {
          languageA,
          languageB,
          output,
          quality
        });

        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: [
            '🌐 **TD AI Live Translation started.**',
            `Channel: **${started.channelName}**`,
            `Languages: **${started.translation.languageA} ⇄ ${started.translation.languageB}**`,
            `Output: **${started.translation.output}**`,
            `Quality: **${started.translation.quality}**`,
            '',
            'Wake word is disabled while Live Translation is active so both sides can speak naturally.',
            'Use `/voicechat translate-stop` to return to AI conversation mode.'
          ].join('\n'),
          allowed_mentions: { parse: [] }
        });
        return;
      }

      if (action === 'translate-stop') {
        const stopped = await stopVoiceTranslation(guildId, userId);
        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: stopped
            ? '✅ **Live Translation stopped.** TD AI returned to conversation mode.'
            : 'ℹ️ Live Translation is not active in this server.',
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
            `Mode: **${reconnected.purpose}**`,
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
        const control = await getVoiceControlSettings();

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
                `Activation: **${status.purpose === 'translation' ? 'Continuous translation' : control.activationMode}**`,
                status.purpose === 'conversation'
                  ? `Wake state: **${status.awake ? 'Awake / follow-up window' : 'Sleeping'}**`
                  : '',
                status.translation
                  ? `Translation: **${status.translation.languageA} ⇄ ${status.translation.languageB} (${status.translation.output})**`
                  : '',
                status.activeSpeakerId ? `Current speaker: <@${status.activeSpeakerId}>` : '',
                `Language: **${chatLanguageLabel(status.language ?? 'auto')}**`,
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
