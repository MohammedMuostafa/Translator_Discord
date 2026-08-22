import { targetLanguageChoicesWithDefault } from './languages.js';

const GUILD_INSTALL = 0;
const USER_INSTALL = 1;
const GUILD = 0;
const BOT_DM = 1;
const PRIVATE_CHANNEL = 2;

const common = {
  integration_types: [USER_INSTALL],
  contexts: [GUILD, BOT_DM, PRIVATE_CHANNEL]
};

const guildOnly = {
  integration_types: [GUILD_INSTALL],
  contexts: [GUILD]
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
  max_length: 4000
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

const aiLanguageOption = {
  name: 'language',
  description: 'Language for the AI result',
  type: 3,
  required: false,
  choices: [
    { name: 'My language (from /settings)', value: 'my' },
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
    name: 'TD AI',
    type: 3
  },
  {
    ...common,
    name: 'translate',
    description: 'Translate text; source language is detected automatically',
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
    name: 'ai',
    description: 'Summarize, explain, simplify, rewrite, draft a reply, or ask TD AI',
    type: 1,
    options: [
      {
        name: 'action',
        description: 'What TD AI should do',
        type: 3,
        required: true,
        choices: [
          { name: '📝 Summarize', value: 'summarize' },
          { name: '🧠 Explain', value: 'explain' },
          { name: '💡 Simplify', value: 'simplify' },
          { name: '✍️ Rewrite', value: 'rewrite' },
          { name: '💬 Draft Reply', value: 'reply' },
          { name: '🤖 Ask AI', value: 'ask' }
        ]
      },
      {
        name: 'text',
        description: 'Text or question for TD AI',
        type: 3,
        required: true,
        max_length: 4000
      },
      aiLanguageOption
    ]
  },
  {
    ...common,
    name: 'say',
    description: 'Translate your text into a copy-ready message you can send yourself',
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
    ...guildOnly,
    name: 'music',
    description: 'Play music in your current Discord voice channel',
    type: 1,
    options: [
      {
        name: 'play',
        description: 'Play a song by name or public link',
        type: 1,
        options: [
          {
            name: 'query',
            description: 'Song name, artist + title, or public media URL',
            type: 3,
            required: true,
            max_length: 500
          }
        ]
      },
      {
        name: 'pause',
        description: 'Pause the current track',
        type: 1
      },
      {
        name: 'resume',
        description: 'Resume paused music',
        type: 1
      },
      {
        name: 'skip',
        description: 'Skip the current track',
        type: 1
      },
      {
        name: 'stop',
        description: 'Stop music and clear the queue',
        type: 1
      },
      {
        name: 'queue',
        description: 'Show the current music queue',
        type: 1
      },
      {
        name: 'now',
        description: 'Show what is playing now',
        type: 1
      }
    ]
  },
  {
    ...guildOnly,
    name: 'voicechat',
    description: 'Talk with TD AI or control the current voice session',
    type: 1,
    options: [
      {
        name: 'join',
        description: 'Join your current voice channel in AI conversation mode',
        type: 1,
        options: [chatLanguageOption]
      },
      {
        name: 'translate',
        description: 'Start live two-way voice translation in your current channel',
        type: 1,
        options: [
          {
            name: 'language_a',
            description: 'First language (default: English)',
            type: 3,
            required: false,
            choices: targetLanguageChoicesWithDefault('English (default)').filter(
              (item) => item.value !== 'my'
            )
          },
          {
            name: 'language_b',
            description: 'Second language (default: Egyptian Arabic)',
            type: 3,
            required: false,
            choices: targetLanguageChoicesWithDefault('Egyptian Arabic (default)').filter(
              (item) => item.value !== 'my'
            )
          },
          {
            name: 'output',
            description: 'Where TD AI sends translations',
            type: 3,
            required: false,
            choices: [
              { name: 'Voice & Captions', value: 'both' },
              { name: 'Voice only', value: 'voice' },
              { name: 'Captions only', value: 'captions' }
            ]
          },
          {
            name: 'quality',
            description: 'Translation quality / latency profile',
            type: 3,
            required: false,
            choices: [
              { name: 'Fast', value: 'fast' },
              { name: 'Balanced', value: 'balanced' },
              { name: 'Accurate', value: 'accurate' }
            ]
          }
        ]
      },
      {
        name: 'translate-stop',
        description: 'Stop live translation and return TD AI to conversation mode',
        type: 1
      },
      {
        name: 'write',
        description: 'Write a message in the text chat attached to the current voice channel',
        type: 1,
        options: [
          {
            name: 'text',
            description: 'Message TD AI should post',
            type: 3,
            required: true,
            max_length: 1800
          }
        ]
      },
      {
        name: 'skip',
        description: 'Stop the current TD AI voice response immediately',
        type: 1
      },
      {
        name: 'reconnect',
        description: 'Reconnect the current TD AI voice session',
        type: 1
      },
      {
        name: 'usage',
        description: 'Show your TD AI plan, used credits and remaining credits',
        type: 1
      },
      {
        name: 'status',
        description: 'Show the current TD AI voice-chat status for this server',
        type: 1
      },
      {
        name: 'leave',
        description: 'Disconnect TD AI and clear temporary voice conversation memory',
        type: 1
      }
    ]
  },

  {
    ...common,
    name: 'image',
    description: 'Generate or edit images with TD AI',
    type: 1,
    options: [
      {
        name: 'generate',
        description: 'Generate a new image from a prompt',
        type: 1,
        options: [
          {
            name: 'prompt',
            description: 'Describe the image you want',
            type: 3,
            required: true,
            max_length: 1800
          },
          {
            name: 'quality',
            description: 'Quality preset available on your plan',
            type: 3,
            required: false,
            choices: [
              { name: 'Draft — fastest', value: 'draft' },
              { name: 'Standard', value: 'standard' },
              { name: 'Premium', value: 'premium' }
            ]
          },
          {
            name: 'aspect',
            description: 'Image aspect ratio',
            type: 3,
            required: false,
            choices: [
              { name: 'Square 1:1', value: '1:1' },
              { name: 'Landscape 16:9', value: '16:9' },
              { name: 'Portrait 9:16', value: '9:16' },
              { name: 'Photo 3:2', value: '3:2' },
              { name: 'Photo 2:3', value: '2:3' },
              { name: 'Classic 4:3', value: '4:3' },
              { name: 'Portrait 3:4', value: '3:4' }
            ]
          }
        ]
      },
      {
        name: 'edit',
        description: 'Edit an existing image with a natural-language prompt',
        type: 1,
        options: [
          {
            name: 'image',
            description: 'Image to edit',
            type: 11,
            required: true
          },
          {
            name: 'prompt',
            description: 'Describe the changes you want',
            type: 3,
            required: true,
            max_length: 1800
          },
          {
            name: 'quality',
            description: 'Quality preset available on your plan',
            type: 3,
            required: false,
            choices: [
              { name: 'Draft — fastest', value: 'draft' },
              { name: 'Standard', value: 'standard' },
              { name: 'Premium', value: 'premium' }
            ]
          },
          {
            name: 'aspect',
            description: 'Output image aspect ratio',
            type: 3,
            required: false,
            choices: [
              { name: 'Square 1:1', value: '1:1' },
              { name: 'Landscape 16:9', value: '16:9' },
              { name: 'Portrait 9:16', value: '9:16' },
              { name: 'Photo 3:2', value: '3:2' },
              { name: 'Photo 2:3', value: '2:3' },
              { name: 'Classic 4:3', value: '4:3' },
              { name: 'Portrait 3:4', value: '3:4' }
            ]
          }
        ]
      }
    ]
  },
  {
    ...common,
    name: 'video',
    description: 'Generate AI video with the quality available on your TD AI plan',
    type: 1,
    options: [
      {
        name: 'generate',
        description: 'Generate a video from a text prompt',
        type: 1,
        options: [
          {
            name: 'prompt',
            description: 'Describe the video, camera, motion, lighting and audio',
            type: 3,
            required: true,
            max_length: 1800
          },
          {
            name: 'quality',
            description: 'Video quality preset available on your plan',
            type: 3,
            required: false,
            choices: [
              { name: 'Lite', value: 'lite' },
              { name: 'Fast', value: 'fast' },
              { name: 'Cinematic', value: 'cinematic' }
            ]
          },
          {
            name: 'aspect',
            description: 'Video aspect ratio',
            type: 3,
            required: false,
            choices: [
              { name: 'Landscape 16:9', value: '16:9' },
              { name: 'Vertical 9:16', value: '9:16' }
            ]
          }
        ]
      }
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
        description: 'Used by “My language” and TD AI message tools',
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
    name: 'help',
    description: 'Show TD AI features and quick usage guide',
    type: 1
  },
  {
    ...common,
    name: 'status',
    description: 'Check translator, AI chat, AI tools and voice configuration',
    type: 1
  }
] as const;
