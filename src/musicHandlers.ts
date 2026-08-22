import type { DiscordInteraction } from './types.js';
import { clipDiscord, editOriginalResponse } from './discord.js';
import {
  adjustVoiceMusicVolume,
  getVoiceMusicVolume,
  pauseVoiceMusic,
  playVoiceMusic,
  resumeVoiceMusic,
  setVoiceMusicVolume,
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

function optionNumber(interaction: DiscordInteraction, name: string): number | undefined {
  const option = subcommand(interaction)?.options?.find((item: any) => item.name === name);
  return typeof option?.value === 'number' ? option.value : undefined;
}

function durationLabel(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return '';
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function musicPlayerMessage(guildId: string): { content: string; components: any[] } {
  const snapshot = voiceMusicQueue(guildId);
  const volume = getVoiceMusicVolume(guildId);
  const lines: string[] = ['🎵 **TD AI Music Player**'];

  if (snapshot.current) {
    const dur = durationLabel(snapshot.current.durationSeconds);
    lines.push(
      `**Track:** [${snapshot.current.title}](${snapshot.current.url})`,
      `**Status:** ${snapshot.paused ? '⏸️ Paused' : '▶️ Playing'}${dur ? ` • \`${dur}\`` : ''}`,
      `**Volume:** \`${volume}%\` • **Requested by:** <@${snapshot.current.requestedBy}>`
    );
  } else {
    lines.push('Nothing is playing right now.', `**Volume:** \`${volume}%\``);
  }

  if (snapshot.queued.length) {
    lines.push('', `**Up Next (${snapshot.queued.length})**`);
    snapshot.queued.slice(0, 5).forEach((t, i) => {
      lines.push(`\`${i + 1}.\` ${t.title}`);
    });
    if (snapshot.queued.length > 5) {
      lines.push(`…and ${snapshot.queued.length - 5} more.`);
    }
  }

  const isPlaying = Boolean(snapshot.current);
  const isPaused = snapshot.paused;

  const components = [
    {
      type: 1,
      components: [
        {
          type: 2,
          custom_id: `music:toggle:${guildId}`,
          label: isPaused ? 'Resume' : 'Pause',
          style: isPaused ? 3 : 2,
          emoji: { name: isPaused ? '▶️' : '⏸️' },
          disabled: !isPlaying
        },
        {
          type: 2,
          custom_id: `music:skip:${guildId}`,
          label: 'Skip',
          style: 2,
          emoji: { name: '⏭️' },
          disabled: !isPlaying
        },
        {
          type: 2,
          custom_id: `music:stop:${guildId}`,
          label: 'Stop',
          style: 4,
          emoji: { name: '⏹️' },
          disabled: !isPlaying && snapshot.queued.length === 0
        },
        {
          type: 2,
          custom_id: `music:voldown:${guildId}`,
          label: 'Vol -',
          style: 2,
          emoji: { name: '🔉' }
        },
        {
          type: 2,
          custom_id: `music:volup:${guildId}`,
          label: 'Vol +',
          style: 2,
          emoji: { name: '🔊' }
        }
      ]
    },
    {
      type: 1,
      components: [
        {
          type: 2,
          custom_id: `music:queue:${guildId}`,
          label: 'Queue / Refresh',
          style: 2,
          emoji: { name: '📜' }
        }
      ]
    }
  ];

  return {
    content: lines.join('\n'),
    components
  };
}

export function handleMusicCommand(interaction: DiscordInteraction): void {
  void (async () => {
    try {
      const guildId = guildIdOf(interaction);
      const userId = userIdOf(interaction);
      const action = subcommand(interaction)?.name ?? 'now';

      if (action === 'play') {
        const query = optionString(interaction, 'query')?.trim();
        if (!query) throw new Error('Song name or link is required.');

        await playVoiceMusic(guildId, userId, query);
        const player = musicPlayerMessage(guildId);
        await editOriginalResponse(
          interaction.application_id,
          interaction.token,
          {
            content: player.content,
            components: player.components,
            allowed_mentions: { parse: [] }
          }
        );
        return;
      }

      if (action === 'pause') {
        const ok = pauseVoiceMusic(guildId);
        if (!ok) throw new Error('There is no playing track to pause.');
        const player = musicPlayerMessage(guildId);
        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: player.content,
          components: player.components,
          allowed_mentions: { parse: [] }
        });
        return;
      }

      if (action === 'resume') {
        const ok = resumeVoiceMusic(guildId);
        if (!ok) throw new Error('There is no paused track to resume.');
        const player = musicPlayerMessage(guildId);
        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: player.content,
          components: player.components,
          allowed_mentions: { parse: [] }
        });
        return;
      }

      if (action === 'skip') {
        const ok = skipVoiceMusic(guildId);
        if (!ok) throw new Error('There is no track to skip.');
        const player = musicPlayerMessage(guildId);
        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: player.content,
          components: player.components,
          allowed_mentions: { parse: [] }
        });
        return;
      }

      if (action === 'stop') {
        const ok = stopVoiceMusic(guildId);
        if (!ok) throw new Error('There is no active music session.');
        const player = musicPlayerMessage(guildId);
        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: player.content,
          components: player.components,
          allowed_mentions: { parse: [] }
        });
        return;
      }

      if (action === 'volume') {
        const level = optionNumber(interaction, 'level');
        if (level === undefined || Number.isNaN(level)) {
          throw new Error('Please specify a volume level between 0 and 200.');
        }
        setVoiceMusicVolume(guildId, level);
        const player = musicPlayerMessage(guildId);
        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: player.content,
          components: player.components,
          allowed_mentions: { parse: [] }
        });
        return;
      }

      if (action === 'volume-up' || action === 'volup') {
        adjustVoiceMusicVolume(guildId, 10);
        const player = musicPlayerMessage(guildId);
        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: player.content,
          components: player.components,
          allowed_mentions: { parse: [] }
        });
        return;
      }

      if (action === 'volume-down' || action === 'voldown') {
        adjustVoiceMusicVolume(guildId, -10);
        const player = musicPlayerMessage(guildId);
        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: player.content,
          components: player.components,
          allowed_mentions: { parse: [] }
        });
        return;
      }

      if (action === 'now' || action === 'queue') {
        const player = musicPlayerMessage(guildId);
        await editOriginalResponse(interaction.application_id, interaction.token, {
          content: player.content,
          components: player.components,
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

export function handleMusicButton(interaction: DiscordInteraction): void {
  void (async () => {
    try {
      const customId = interaction.data?.custom_id ?? '';
      const parts = customId.split(':');
      const action = parts[1];
      const guildId = parts[2] || guildIdOf(interaction);

      const snapshot = voiceMusicQueue(guildId);

      if (action === 'toggle') {
        if (snapshot.paused) {
          resumeVoiceMusic(guildId);
        } else {
          pauseVoiceMusic(guildId);
        }
      } else if (action === 'skip') {
        skipVoiceMusic(guildId);
      } else if (action === 'stop') {
        stopVoiceMusic(guildId);
      } else if (action === 'volup') {
        adjustVoiceMusicVolume(guildId, 10);
      } else if (action === 'voldown') {
        adjustVoiceMusicVolume(guildId, -10);
      } else if (action === 'queue') {
        // Refresh player
      }

      const player = musicPlayerMessage(guildId);
      await editOriginalResponse(
        interaction.application_id,
        interaction.token,
        {
          content: player.content,
          components: player.components,
          allowed_mentions: { parse: [] }
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Music control error.';
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
