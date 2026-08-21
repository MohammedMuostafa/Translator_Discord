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
  handleSay,
  handleSettings,
  handleStatus,
  handleTranslateMessagePicker,
  handleTranslateMessageSelection,
  handleTranslateText,
  handleVoice
} from './handlers.js';
import type { DiscordInteraction } from './types.js';
import { registerGlobalCommands } from './registerCommands.js';
import { aiConfigured } from './providers/translator.js';

const app = express();
app.disable('x-powered-by');

const statusPayload = () => ({
  ok: true,
  service: 'discord-user-translator',
  version: '3.2.0',
  interactionEndpoint: '/interactions',
  translationProvider: env.TRANSLATION_PROVIDER,
  aiConfigured: aiConfigured(),
  voiceConfigured: Boolean(env.STT_URL && env.STT_API_KEY),
  sourceDetection: 'automatic',
  arabicDialectDetection: aiConfigured() ? 'egyptian-vs-msa' : 'generic'
});

app.get('/', (_req, res) => res.json(statusPayload()));
app.get('/health', (_req, res) => res.json(statusPayload()));

app.post('/interactions', verifyKeyMiddleware(env.DISCORD_PUBLIC_KEY), async (req, res) => {
  const interaction = req.body as DiscordInteraction;

  if (interaction.type === InteractionType.Ping) {
    return res.json({ type: InteractionResponseType.Pong });
  }

  if (interaction.type === InteractionType.MessageComponent) {
    const customId = interaction.data?.custom_id ?? '';
    if (!customId.startsWith('translate_target:')) {
      return res.status(400).json({ error: 'Unsupported component interaction.' });
    }

    res.json({ type: InteractionResponseType.DeferredUpdateMessage });
    handleTranslateMessageSelection(interaction);
    return;
  }

  if (interaction.type !== InteractionType.ApplicationCommand || !interaction.data) {
    return res.status(400).json({ error: 'Unsupported interaction type.' });
  }

  const commandType = interaction.data.type;
  const name = interaction.data.name;

  if (commandType === ApplicationCommandType.Message && name === 'Translate') {
    try {
      const payload = await handleTranslateMessagePicker(interaction);
      return res.json({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: { ...payload, flags: MessageFlags.Ephemeral }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error.';
      return res.json({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: { content: `❌ ${message}`, flags: MessageFlags.Ephemeral }
      });
    }
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
      return res.json({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: { content: `❌ ${message}`, flags: MessageFlags.Ephemeral }
      });
    }
  }

  if (name === 'status') {
    const payload = handleStatus();
    return res.json({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: { ...payload, flags: MessageFlags.Ephemeral }
    });
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

  return res.json({
    type: InteractionResponseType.ChannelMessageWithSource,
    data: { content: 'Unknown command.', flags: MessageFlags.Ephemeral }
  });
});

app.listen(env.PORT, env.HOST, () => {
  console.log(`Discord User Translator v3.2 listening on ${env.HOST}:${env.PORT}`);
  console.log('Interactions endpoint: /interactions');

  if (env.REGISTER_COMMANDS_ON_START && env.DISCORD_BOT_TOKEN) {
    void registerGlobalCommands(env.DISCORD_APP_ID, env.DISCORD_BOT_TOKEN).catch((error) => {
      console.error(error instanceof Error ? error.message : error);
    });
  } else {
    console.log('Automatic command registration is disabled or DISCORD_BOT_TOKEN is missing.');
  }
});
