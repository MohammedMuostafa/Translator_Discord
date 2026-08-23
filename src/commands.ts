import { targetLanguageChoicesWithDefault } from './languages.js';

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

const styleChoices = [
  { name: 'Natural (Default)', value: 'natural' },
  { name: 'Casual / Slang', value: 'casual' },
  { name: 'Formal', value: 'formal' },
  { name: 'Literal', value: 'literal' }
];

export const commands = [
  // 1. Message Context Menu Actions (Type 3)
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

  // 2. Public Slash Commands (Type 1)
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
  },
  {
    ...guildOnly,
    name: 'music',
    description: 'Play music in your voice channel with interactive player controls',
    type: 1,
    options: [
      {
        name: 'query',
        description: 'Song name, artist + title, or public media URL to play',
        type: 3,
        required: true
      }
    ]
  },
  {
    ...common,
    name: 'translate',
    description: 'Translate text (auto-detects source including Egyptian Arabic / MSA)',
    type: 1,
    options: [
      {
        name: 'text',
        description: 'The text message to translate',
        type: 3,
        required: true,
        max_length: 4000
      },
      {
        name: 'target',
        description: 'Target language (optional, defaults to My Language setting)',
        type: 3,
        required: false,
        choices: targetLanguageChoicesWithDefault('My Language / Default')
      }
    ]
  },
  {
    ...common,
    name: 'say',
    description: 'Translate a sentence ready to send using your outgoing language',
    type: 1,
    options: [
      {
        name: 'text',
        description: 'Text to translate and format',
        type: 3,
        required: true,
        max_length: 4000
      },
      {
        name: 'target',
        description: 'Target language (optional, defaults to Outgoing language)',
        type: 3,
        required: false,
        choices: targetLanguageChoicesWithDefault('Outgoing language')
      }
    ]
  },
  {
    ...common,
    name: 'settings',
    description: 'View or update your translation and preferences',
    type: 1,
    options: [
      {
        name: 'auto_translate',
        description: 'ON: translate immediately. OFF: show language select menu when target is omitted.',
        type: 5,
        required: false
      },
      {
        name: 'my_language',
        description: 'Your primary incoming language for quick translation',
        type: 3,
        required: false,
        choices: targetLanguageChoicesWithDefault('Keep current').filter((item) => item.value !== 'my')
      },
      {
        name: 'outgoing',
        description: 'Default target language for /say and outgoing messages',
        type: 3,
        required: false,
        choices: targetLanguageChoicesWithDefault('Keep current').filter((item) => item.value !== 'my')
      },
      {
        name: 'style',
        description: 'Translation style preset',
        type: 3,
        required: false,
        choices: styleChoices
      }
    ]
  }
] as const;
