// Discord API constants.
const USER_INSTALL = 1;
const GUILD = 0;
const BOT_DM = 1;
const PRIVATE_CHANNEL = 2;

// Every command belongs to the user installation and is usable in servers, app DMs,
// normal DMs, and group DMs. This is what makes the app follow your Discord account.
const common = {
  integration_types: [USER_INSTALL],
  contexts: [GUILD, BOT_DM, PRIVATE_CHANNEL]
};

const languageOption = (name: string, description: string, required = false) => ({
  name,
  description,
  type: 3,
  required,
  min_length: 2,
  max_length: 32
});

export const commands = [
  {
    ...common,
    name: 'Translate',
    type: 3
  },
  {
    ...common,
    name: 'translate',
    description: 'Translate text privately',
    type: 1,
    options: [
      {
        name: 'text',
        description: 'Text to translate',
        type: 3,
        required: true,
        max_length: 1800
      },
      languageOption('target', 'Target language: Arabic, English, ar, en, ja, de, ...')
    ]
  },
  {
    ...common,
    name: 'say',
    description: 'Translate what you type and send the translated text',
    type: 1,
    options: [
      {
        name: 'text',
        description: 'Write naturally in Arabic or any supported language',
        type: 3,
        required: true,
        max_length: 1800
      },
      languageOption('target', 'Target language; defaults to your outgoing language')
    ]
  },
  {
    ...common,
    name: 'voice',
    description: 'Transcribe and translate an audio or voice file',
    type: 1,
    options: [
      {
        name: 'audio',
        description: 'Audio or Discord voice-message file',
        type: 11,
        required: true
      },
      languageOption('target', 'Target language; defaults to your outgoing language'),
      {
        name: 'send',
        description: 'Post the translated text publicly when Discord allows it',
        type: 5,
        required: false
      }
    ]
  },
  {
    ...common,
    name: 'settings',
    description: 'Set default incoming and outgoing translation languages',
    type: 1,
    options: [
      languageOption('incoming', 'Right-click Translate target; default Arabic'),
      languageOption('outgoing', '/say and /voice target; default English')
    ]
  },
  {
    ...common,
    name: 'status',
    description: 'Check translator and voice configuration',
    type: 1
  }
] as const;
