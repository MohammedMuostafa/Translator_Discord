import { sourceLanguageChoices, targetLanguageChoices } from './languages.js';

const USER_INSTALL = 1;
const GUILD = 0;
const BOT_DM = 1;
const PRIVATE_CHANNEL = 2;

const common = {
  integration_types: [USER_INSTALL],
  contexts: [GUILD, BOT_DM, PRIVATE_CHANNEL]
};

const sourceOption = (required = false) => ({
  name: 'source',
  description: 'Source language; Auto detect is the default',
  type: 3,
  required,
  choices: sourceLanguageChoices
});

const targetOption = (description: string, required = false) => ({
  name: 'target',
  description,
  type: 3,
  required,
  choices: targetLanguageChoices
});

const providerOption = {
  name: 'provider',
  description: 'Translation engine; Default uses your configured provider',
  type: 3,
  required: false,
  choices: [
    { name: 'Default', value: 'default' },
    { name: 'AI (best for Egyptian Arabic / style)', value: 'ai' },
    { name: 'LibreTranslate', value: 'libretranslate' },
    { name: 'Google Translate', value: 'google' },
    { name: 'DeepL', value: 'deepl' }
  ]
};

const styleOption = {
  name: 'style',
  description: 'Translation style; non-Natural styles are best with AI',
  type: 3,
  required: false,
  choices: [
    { name: 'Natural', value: 'natural' },
    { name: 'Literal', value: 'literal' },
    { name: 'Casual', value: 'casual' },
    { name: 'Formal', value: 'formal' }
  ]
};

const textOption = {
  name: 'text',
  description: 'Text to translate',
  type: 3,
  required: true,
  max_length: 1800
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
    description: 'Translate text privately with source/target/provider choices',
    type: 1,
    options: [textOption, sourceOption(), targetOption('Target language; defaults to your incoming language'), providerOption, styleOption]
  },
  {
    ...common,
    name: 'say',
    description: 'Translate privately, then copy/paste it so YOU send the message',
    type: 1,
    options: [textOption, sourceOption(), targetOption('Target language; defaults to your outgoing language'), providerOption, styleOption]
  },
  {
    ...common,
    name: 'voice',
    description: 'Transcribe audio and return a private translation you can copy',
    type: 1,
    options: [
      {
        name: 'audio',
        description: 'Audio or Discord voice-message file',
        type: 11,
        required: true
      },
      targetOption('Target language; defaults to your outgoing language'),
      providerOption,
      styleOption
    ]
  },
  {
    ...common,
    name: 'settings',
    description: 'Set your default translation targets, provider and style',
    type: 1,
    options: [
      {
        name: 'incoming',
        description: 'Right-click Translate target',
        type: 3,
        required: false,
        choices: targetLanguageChoices
      },
      {
        name: 'outgoing',
        description: '/say and /voice target',
        type: 3,
        required: false,
        choices: targetLanguageChoices
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
