import type { DiscordInteraction } from './types.js';
import { clipDiscord, editOriginalResponse } from './discord.js';
import {
  pauseVoiceMusic,
  playVoiceMusic,
  resumeVoiceMusic,
  skipVoiceMusic,
  stopVoiceMusic,
  voiceMusicQueue
} from './services/voiceAi.js';

function userIdOf(interaction: DiscordInteraction): string {
  const id = interaction.member?.user?.id ?? interaction.user?.id;
  if (!id) throw new Error('Could not resolve the Discord user.');
  return id;
}

function guildIdOf(interaction: DiscordInteraction): string {
  const id = interaction.guild_id;
  if (!id) throw new Error('Music playback is available only inside a Discord server.');
  return id;
}

function subcommand(interaction: DiscordInteraction): any {
  return interaction.data?.options?.[0];
}

function optionString(interaction: DiscordInteraction, name: string): string | undefined {
  const option = subcommand(interaction)?.options?.find((item: any) => item.name === name);
  return typeof option?.value === 'string' ? option.value : undefined;
}

function durationLabel(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return '';
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function queueText(guildId: string): string {
  const snapshot = voiceMusicQueue(guildId);
  const lines: string[] = ['🎵 **TD Music**'];

  if (snapshot.current) {
    lines.push(
      `Now: **${snapshot.current.title}**${snapshot.paused ? ' ⏸️' : ''}` +
      (durationLabel(snapshot.current.durationSeconds)
        ? ` — ${durationLabel(snapshot.current.durationSeconds)}`
        : '')
    );
  } else {
    lines.push('Nothing is playing right now.');
  }

  if (snapshot.queued.length) {
    lines.push('', '**Queue**');
    snapshot.queued.slice(0, 10).forEach((track, index) => {
      lines.push(`${index + 1}. ${track.title}`);
    });
    if (snapshot.queued.length > 10) {
      lines.push(`…and ${snapshot.queued.length - 10} more.`);
    }
  }

  return lines.join('\n');
}

export function handleMusicCommand(interaction: DiscordInteraction): void {
  void (async () => {
    try {
      const guildId = guildIdOf(interaction);
      const userId = userIdOf(interaction);
      const action = subcommand(interaction)?.name ?? 'queue';

      if (action === 'play') {
        const query = optionString(interaction, 'query')?.trim();
        if (!query) throw new Error('Song name or link is required.');

        const result = await playVoiceMusic(guildId, userId, query);
        await editOriginalResponse(
          interaction.application_id,
          interaction.token,
          {
            content: result.started
              ? `▶️ **Playing:** ${result.track.title}`
              : `➕ **Queued:** ${result.track.title} — position ${result.position}`,
            allowed_mentions: { parse: [] }
          }
        );
        return;
      }

      if (action === 'pause') {
        const ok = pauseVoiceMusic(guildId);
        if (!ok) throw new Error('There is no playing track to pause.');
        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: '⏸️ Music paused.',
          allowed_mentions: { parse: [] }
        });
        return;
      }

      if (action === 'resume') {
        const ok = resumeVoiceMusic(guildId);
        if (!ok) throw new Error('There is no paused track to resume.');
        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: '▶️ Music resumed.',
          allowed_mentions: { parse: [] }
        });
        return;
      }

      if (action === 'skip') {
        const ok = skipVoiceMusic(guildId);
        if (!ok) throw new Error('There is no track to skip.');
        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: '⏭️ Skipped.',
          allowed_mentions: { parse: [] }
        });
        return;
      }

      if (action === 'stop') {
        const ok = stopVoiceMusic(guildId);
        if (!ok) throw new Error('There is no active music session.');
        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: '⏹️ Music stopped and queue cleared.',
          allowed_mentions: { parse: [] }
        });
        return;
      }

      if (action === 'now' || action === 'queue') {
        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: queueText(guildId),
          allowed_mentions: { parse: [] }
        });
        return;
      }

      throw new Error('Unknown music command.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected music error.';
      await editOriginalResponse(
        interaction.application_id,
        interaction.token,
        {
          content: clipDiscord(`❌ **TD Music:** ${message}`, 1900),
          allowed_mentions: { parse: [] }
        }
      ).catch(console.error);
    }
  })();
}
