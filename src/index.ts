import express, { type Response } from 'express';
import { verifyKeyMiddleware } from 'discord-interactions';
import { env } from './config.js';
import {
  ApplicationCommandType,
  InteractionResponseType,
  InteractionType,
  MessageFlags
} from './discord.js';
import {
  handleListenTts,
  handleSay,
  handleSettings,
  handleStatus,
  handleTranslateMessagePicker,
  handleTranslateMessageSelection,
  handleTranslateText,
  handleVoice
} from './handlers.js';
import { handleChatCommand } from './chatHandlers.js';
import {
  handleAiActionButton,
  handleAiMessagePicker,
  handleAiSlash,
  handleAiTranslateTarget,
  handleHelp,
  handleSmartReplyButton,
  handleSmartReplyEditModal,
  handleSmartReplyEditSubmit
} from './aiActionHandlers.js';
import { handleVoiceChatCommand } from './voiceHandlers.js';
import { handleImageCommand, handleVideoCommand } from './mediaHandlers.js';
import type { DiscordInteraction } from './types.js';
import { registerGlobalCommands } from './registerCommands.js';
import { aiConfigured } from './providers/translator.js';
import {
  gatewayChatConfigured,
  startGatewayChat
} from './services/gatewayChat.js';
import { aiActionsConfigured } from './services/aiActions.js';
import { smartReplyConfigured } from './services/smartReply.js';
import { voiceAiConfigured } from './services/voiceAi.js';
import { registerAdminDashboard } from './adminDashboard.js';
import { runWithUsageUser } from './services/usageContext.js';
import { getUserAccount } from './services/billingStore.js';

const app = express();
app.disable('x-powered-by');
registerAdminDashboard(app);

const statusPayload = () => ({
  ok: true,
  service: 'td-ai',
  version: '3.14.0',
  interactionEndpoint: '/interactions',
  adminDashboard: '/admin',
  translationProvider: env.TRANSLATION_PROVIDER,
  aiConfigured: aiConfigured(),
  aiActions: aiActionsConfigured(),
  smartReply: smartReplyConfigured(),
  smartReplyEdit: true,
  modelRouting: true,
  modelFailover: true,
  interactiveDmChat: gatewayChatConfigured(),
  chatSessionTtlMinutes: env.CHAT_SESSION_TTL_MINUTES,
  liveVoiceAi: voiceAiConfigured(),
  voiceWakeMode: true,
  wakeGatedGeminiLive: true,
  perUserPersonalization: true,
  separatedUserAdminDashboard: true,
  liveVoiceTranslation: true,
  voiceChatWrite: true,
  voiceSkip: true,
  voiceReconnect: true,
  usageCredits: true,
  plans: true,
  imageGeneration: true,
  imageEditing: true,
  videoGeneration: true,
  planModelEntitlements: true,
  guildVoiceCommandEnabled: env.ENABLE_GUILD_VOICE_AI,
  listenTts: Boolean(
    (env.GEMINI_TTS_API_KEY ?? env.AI_API_KEY) &&
    env.GEMINI_TTS_MODEL
  ),
  sourceDetection: 'automatic',
  arabicDialectDetection: aiConfigured() ? 'egyptian-vs-msa' : 'generic',
  mixedRtlFormatting: true
});

app.get('/', (_req, res) => res.json(statusPayload()));
app.get('/health', (_req, res) => res.json(statusPayload()));

function ephemeralError(message: string) {
  return {
    type: InteractionResponseType.ChannelMessageWithSource,
    data: {
      content: `❌ ${message}`,
      flags: MessageFlags.Ephemeral,
      allowed_mentions: { parse: [] }
    }
  };
}

function interactionUserId(interaction: DiscordInteraction): string | undefined {
  return interaction.member?.user?.id ?? interaction.user?.id;
}

async function processInteraction(
  interaction: DiscordInteraction,
  res: Response
): Promise<unknown> {
  if (interaction.type === InteractionType.Ping) {
    return res.json({ type: InteractionResponseType.Pong });
  }

  const userId = interactionUserId(interaction);
  if (userId) {
    // Creates the Free account lazily and resets monthly periods if needed.
    await getUserAccount(userId).catch((error) => {
      console.error('Could not initialize TD AI account:', error);
    });
  }

  if (interaction.type === InteractionType.ModalSubmit) {
    const customId = interaction.data?.custom_id ?? '';

    if (customId.startsWith('smart_reply_edit:')) {
      res.json({ type: InteractionResponseType.DeferredUpdateMessage });
      handleSmartReplyEditSubmit(interaction);
      return;
    }

    return res.status(400).json({ error: 'Unsupported modal interaction.' });
  }

  if (interaction.type === InteractionType.MessageComponent) {
    const customId = interaction.data?.custom_id ?? '';

    if (customId.startsWith('smart_reply:edit:')) {
      try {
        return res.json({
          type: InteractionResponseType.Modal,
          data: handleSmartReplyEditModal(interaction)
        });
      } catch (error) {
        return res.json(
          ephemeralError(
            error instanceof Error
              ? error.message
              : 'Could not open answer editor.'
          )
        );
      }
    }

    if (customId.startsWith('translate_target:')) {
      res.json({ type: InteractionResponseType.DeferredUpdateMessage });
      handleTranslateMessageSelection(interaction);
      return;
    }

    if (customId.startsWith('ai_action:')) {
      res.json({ type: InteractionResponseType.DeferredUpdateMessage });
      handleAiActionButton(interaction);
      return;
    }

    if (customId.startsWith('smart_reply:')) {
      res.json({ type: InteractionResponseType.DeferredUpdateMessage });
      handleSmartReplyButton(interaction);
      return;
    }

    if (customId.startsWith('ai_translate_target:')) {
      res.json({ type: InteractionResponseType.DeferredUpdateMessage });
      handleAiTranslateTarget(interaction);
      return;
    }

    if (customId.startsWith('listen_tts:')) {
      res.json({
        type: InteractionResponseType.DeferredChannelMessageWithSource,
        data: { flags: MessageFlags.Ephemeral }
      });
      handleListenTts(interaction);
      return;
    }

    return res.status(400).json({ error: 'Unsupported component interaction.' });
  }

  if (
    interaction.type !== InteractionType.ApplicationCommand ||
    !interaction.data
  ) {
    return res.status(400).json({ error: 'Unsupported interaction type.' });
  }

  const commandType = interaction.data.type;
  const name = interaction.data.name;

  if (commandType === ApplicationCommandType.Message) {
    try {
      if (name === 'Translate') {
        const payload = await handleTranslateMessagePicker(interaction);
        return res.json({
          type: InteractionResponseType.ChannelMessageWithSource,
          data: {
            ...payload,
            flags: MessageFlags.Ephemeral
          }
        });
      }

      if (name === 'TD AI') {
        const payload = await handleAiMessagePicker(interaction);
        return res.json({
          type: InteractionResponseType.ChannelMessageWithSource,
          data: {
            ...payload,
            flags: MessageFlags.Ephemeral
          }
        });
      }
    } catch (error) {
      return res.json(
        ephemeralError(
          error instanceof Error ? error.message : 'Unexpected error.'
        )
      );
    }

    return res.json(ephemeralError('Unknown message action.'));
  }

  if (commandType !== ApplicationCommandType.ChatInput) {
    return res.status(400).json({ error: 'Unsupported command type.' });
  }

  if (name === 'settings') {
    try {
      const payload = await handleSettings(interaction);
      return res.json({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: {
          ...payload,
          flags: MessageFlags.Ephemeral
        }
      });
    } catch (error) {
      return res.json(
        ephemeralError(
          error instanceof Error ? error.message : 'Unexpected error.'
        )
      );
    }
  }

  if (name === 'status') {
    return res.json({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        ...handleStatus(),
        flags: MessageFlags.Ephemeral
      }
    });
  }

  if (name === 'help') {
    return res.json({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        ...handleHelp(),
        flags: MessageFlags.Ephemeral
      }
    });
  }

  if (name === 'chat') {
    res.json({
      type: InteractionResponseType.DeferredChannelMessageWithSource,
      data: { flags: MessageFlags.Ephemeral }
    });
    handleChatCommand(interaction);
    return;
  }

  if (name === 'voicechat') {
    res.json({
      type: InteractionResponseType.DeferredChannelMessageWithSource,
      data: { flags: MessageFlags.Ephemeral }
    });
    handleVoiceChatCommand(interaction);
    return;
  }

  if (name === 'image') {
    res.json({
      type: InteractionResponseType.DeferredChannelMessageWithSource,
      data: { flags: MessageFlags.Ephemeral }
    });
    handleImageCommand(interaction);
    return;
  }

  if (name === 'video') {
    res.json({
      type: InteractionResponseType.DeferredChannelMessageWithSource,
      data: { flags: MessageFlags.Ephemeral }
    });
    handleVideoCommand(interaction);
    return;
  }

  if (name === 'ai') {
    res.json({
      type: InteractionResponseType.DeferredChannelMessageWithSource,
      data: { flags: MessageFlags.Ephemeral }
    });
    handleAiSlash(interaction);
    return;
  }

  if (name === 'translate') {
    res.json({
      type: InteractionResponseType.DeferredChannelMessageWithSource,
      data: { flags: MessageFlags.Ephemeral }
    });
    handleTranslateText(interaction);
    return;
  }

  if (name === 'say') {
    res.json({
      type: InteractionResponseType.DeferredChannelMessageWithSource,
      data: { flags: MessageFlags.Ephemeral }
    });
    handleSay(interaction);
    return;
  }

  if (name === 'voice') {
    res.json({
      type: InteractionResponseType.DeferredChannelMessageWithSource,
      data: { flags: MessageFlags.Ephemeral }
    });
    handleVoice(interaction);
    return;
  }

  return res.json(ephemeralError('Unknown command.'));
}

app.post(
  '/interactions',
  verifyKeyMiddleware(env.DISCORD_PUBLIC_KEY),
  async (req, res) => {
    const interaction = req.body as DiscordInteraction;
    const userId = interactionUserId(interaction);

    return runWithUsageUser(
      userId,
      () => processInteraction(interaction, res)
    );
  }
);

app.listen(env.PORT, env.HOST, () => {
  console.log(`TD AI v3.14 listening on ${env.HOST}:${env.PORT}`);
  console.log('Interactions endpoint: /interactions');
  console.log('TD AI dashboard: /admin');

  void startGatewayChat().catch((error) => {
    console.error(
      'Could not start Discord gateway:',
      error instanceof Error ? error.message : error
    );
  });

  if (env.REGISTER_COMMANDS_ON_START && env.DISCORD_BOT_TOKEN) {
    void registerGlobalCommands(
      env.DISCORD_APP_ID,
      env.DISCORD_BOT_TOKEN
    ).catch((error) => {
      console.error(error instanceof Error ? error.message : error);
    });
  } else {
    console.log(
      'Automatic command registration is disabled or DISCORD_BOT_TOKEN is missing.'
    );
  }
});
