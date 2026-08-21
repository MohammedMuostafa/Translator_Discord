import express from 'express';
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
  handleSmartReplyButton
} from './aiActionHandlers.js';
import { handleVoiceChatCommand } from './voiceHandlers.js';
import type { DiscordInteraction } from './types.js';
import { registerGlobalCommands } from './registerCommands.js';
import { aiConfigured } from './providers/translator.js';
import { gatewayChatConfigured, startGatewayChat } from './services/gatewayChat.js';
import { aiActionsConfigured } from './services/aiActions.js';
import { smartReplyConfigured } from './services/smartReply.js';
import { voiceAiConfigured } from './services/voiceAi.js';

const app = express();
app.disable('x-powered-by');

const statusPayload = () => ({
  ok: true,
  service: 'td-ai',
  version: '3.7.0',
  interactionEndpoint: '/interactions',
  translationProvider: env.TRANSLATION_PROVIDER,
  aiConfigured: aiConfigured(),
  aiActions: aiActionsConfigured(),
  smartReply: smartReplyConfigured(),
  interactiveDmChat: gatewayChatConfigured(),
  chatSessionTtlMinutes: env.CHAT_SESSION_TTL_MINUTES,
  voiceFileTranslation: Boolean(env.STT_URL && env.STT_API_KEY),
  liveVoiceAi: voiceAiConfigured(),
  guildVoiceCommandEnabled: env.ENABLE_GUILD_VOICE_AI,
  listenTts: Boolean((env.GEMINI_TTS_API_KEY ?? env.AI_API_KEY) && env.GEMINI_TTS_MODEL),
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

app.post('/interactions', verifyKeyMiddleware(env.DISCORD_PUBLIC_KEY), async (req, res) => {
  const interaction = req.body as DiscordInteraction;

  if (interaction.type === InteractionType.Ping) {
    return res.json({ type: InteractionResponseType.Pong });
  }

  if (interaction.type === InteractionType.MessageComponent) {
    const customId = interaction.data?.custom_id ?? '';

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

  if (interaction.type !== InteractionType.ApplicationCommand || !interaction.data) {
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
          data: { ...payload, flags: MessageFlags.Ephemeral }
        });
      }

      if (name === 'TD AI') {
        const payload = await handleAiMessagePicker(interaction);
        return res.json({
          type: InteractionResponseType.ChannelMessageWithSource,
          data: { ...payload, flags: MessageFlags.Ephemeral }
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error.';
      return res.json(ephemeralError(message));
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
        data: { ...payload, flags: MessageFlags.Ephemeral }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error.';
      return res.json(ephemeralError(message));
    }
  }

  if (name === 'status') {
    const payload = handleStatus();
    return res.json({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: { ...payload, flags: MessageFlags.Ephemeral }
    });
  }

  if (name === 'help') {
    const payload = handleHelp();
    return res.json({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: { ...payload, flags: MessageFlags.Ephemeral }
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
});

app.listen(env.PORT, env.HOST, () => {
  console.log(`TD AI / Translator Discord v3.7 listening on ${env.HOST}:${env.PORT}`);
  console.log('Interactions endpoint: /interactions');

  void startGatewayChat().catch((error) => {
    console.error('Could not start Discord gateway:', error instanceof Error ? error.message : error);
  });

  if (env.REGISTER_COMMANDS_ON_START && env.DISCORD_BOT_TOKEN) {
    void registerGlobalCommands(env.DISCORD_APP_ID, env.DISCORD_BOT_TOKEN).catch((error) => {
      console.error(error instanceof Error ? error.message : error);
    });
  } else {
    console.log('Automatic command registration is disabled or DISCORD_BOT_TOKEN is missing.');
  }
});
