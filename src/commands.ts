import { targetLanguageChoicesWithDefault } from './languages.js';

const USER_INSTALL = 1;
const GUILD = 0;
const BOT_DM = 1;
const PRIVATE_CHANNEL = 2;

const common = {
  integration_types: [USER_INSTALL],
  contexts: [GUILD, BOT_DM, PRIVATE_CHANNEL]
};

const targetOption = (description: string, required = true) => ({
  name: 'target',
  description,
  type: 3,
  required,
  choices: targetLanguageChoicesWithDefault()
});

const providerOption = {
  name: 'provider',
  description: 'Auto prefers AI and falls back when possible',
  type: 3,
  required: false,
  choices: [
    { name: 'Auto — AI preferred', value: 'default' },
    { name: 'AI / Gemini', value: 'ai' },
    { name: 'LibreTranslate', value: 'libretranslate' },
    { name: 'Google Translate', value: 'google' },
    { name: 'DeepL', value: 'deepl' }
  ]
};

const styleOption = {
  name: 'style',
  description: 'Translation style; Natural is recommended',
  type: 3,
  required: false,
  choices: [
    { name: 'Natural', value: 'natural' },
    { name: 'Casual', value: 'casual' },
    { name: 'Formal', value: 'formal' },
    { name: 'Literal', value: 'literal' }
  ]
};

const textOption = {
  name: 'text',
  description: 'Type the text first — AI detects its language automatically',
  type: 3,
  required: true,
  max_length: 1800
};

const chatLanguageOption = {
  name: 'language',
  description: 'How TD AI should reply during this chat session',
  type: 3,
  required: false,
  choices: [
    { name: 'Auto — follow my language', value: 'auto' },
    { name: 'Egyptian Arabic', value: 'ar-eg' },
    { name: 'Modern Standard Arabic', value: 'ar-msa' },
    { name: 'English', value: 'en' },
    { name: 'Persian / Farsi', value: 'fa' }
  ]
};

export const commands = [
  {
    ...common,
    name: 'Translate',
    type: 3
  },
  {
    ...common,
    name: 'translate',
    description: 'Type text, choose only the target; source is detected automatically',
    type: 1,
    options: [
      textOption,
      targetOption('Translate to: Egyptian Arabic, MSA, English, Persian, etc.'),
      styleOption,
      providerOption
    ]
  },
  {
    ...common,
    name: 'say',
    description: 'Auto-detect your text, translate it, then copy/paste so YOU send it',
    type: 1,
    options: [
      textOption,
      targetOption('Language you want to send'),
      styleOption,
      providerOption
    ]
  },
  {
    ...common,
    name: 'voice',
    description: 'Transcribe audio, auto-detect language, and translate privately',
    type: 1,
    options: [
      {
        name: 'audio',
        description: 'Audio or Discord voice-message file',
        type: 11,
        required: true
      },
      targetOption('Language you want the transcript translated to'),
      styleOption,
      providerOption
    ]
  },
  {
    ...common,
    name: 'chat',
    description: 'Open or manage a private persistent TD AI chat in DMs',
    type: 1,
    options: [
      {
        name: 'open',
        description: 'Open a private AI chat; then type normally in the DM',
        type: 1,
        options: [chatLanguageOption]
      },
      {
        name: 'close',
        description: 'Close the AI chat and delete its temporary conversation memory',
        type: 1
      },
      {
        name: 'reset',
        description: 'Clear the current conversation context but keep the chat open',
        type: 1
      },
      {
        name: 'status',
        description: 'Show your current private AI chat status',
        type: 1
      }
    ]
  },
  {
    ...common,
    name: 'settings',
    description: 'Set your language and default translation behavior',
    type: 1,
    options: [
      {
        name: 'my_language',
        description: 'Used by “My language” and as the default right-click target',
        type: 3,
        required: false,
        choices: targetLanguageChoicesWithDefault('Keep current').filter((item) => item.value !== 'my')
      },
      {
        name: 'outgoing',
        description: 'Default target for outgoing translations',
        type: 3,
        required: false,
        choices: targetLanguageChoicesWithDefault('Keep current').filter((item) => item.value !== 'my')
      },
      providerOption,
      styleOption
    ]
  },
  {
    ...common,
    name: 'status',
    description: 'Check translator, AI and voice configuration',
    type: 1
  }
] as const;
