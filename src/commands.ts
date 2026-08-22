const GUILD_INSTALL = 0;
const USER_INSTALL = 1;
const GUILD = 0;
const BOT_DM = 1;
const PRIVATE_CHANNEL = 2;

const common = {
  integration_types: [USER_INSTALL, GUILD_INSTALL],
  contexts: [GUILD, BOT_DM, PRIVATE_CHANNEL]
};

const guildOnly = {
  integration_types: [GUILD_INSTALL],
  contexts: [GUILD]
};

export const commands = [
  {
    ...common,
    name: 'Translate',
    type: 3
  },
  {
    ...common,
    name: 'TD AI',
    type: 3
  },
  {
    ...guildOnly,
    name: 'join',
    description: 'Join your voice channel as your TD AI voice assistant',
    type: 1
  },
  {
    ...guildOnly,
    name: 'leave',
    description: 'Disconnect TD AI from the current voice channel',
    type: 1
  }
] as const;
