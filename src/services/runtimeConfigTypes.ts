export type TextTask = 'translation' | 'chat' | 'code' | 'ai_tools' | 'smart_reply';
export type MediaTask = 'image_generate' | 'image_edit' | 'video_generate';
export type GeminiTask = 'voice_live' | 'voice_translate' | 'stt' | 'tts';
export type RuntimeTask = TextTask | MediaTask | GeminiTask;

export type ProviderKind =
  | 'openai-compatible'
  | 'openai-native'
  | 'anthropic-native'
  | 'gemini-native'
  | 'openrouter';

export type ThinkingLevelName = 'minimal' | 'low' | 'medium' | 'high';
export type VoiceSpeakerAccess = 'everyone' | 'owner-only';
export type DisplayDensity = 'compact' | 'comfortable' | 'relaxed';
export type DisplayHeadingSize = 'large' | 'medium' | 'small';
export type DisplayDivider = 'none' | 'line' | 'spaced';
export type TextTransport = ProviderKind;

export type ProviderProfile = {
  id: string;
  name: string;
  kind: ProviderKind;
  apiUrl?: string;
  encryptedApiKey: string;
  apiKeyHint: string;
  enabled: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type ModelRegistration = {
  id: string;
  providerId: string;
  label: string;
  capabilities: RuntimeTask[];
  enabled: boolean;
  priority?: number;
  taskAssignments?: RuntimeTask[];
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type TaskRoute = {
  providerId: string;
  model: string;
  fallbackProviderId?: string;
  fallbackModel?: string;
};

export type VoiceRuntimeSettings = {
  thinkingLevel: ThinkingLevelName;
  silenceMs: number;
  liveVoice: string;
  ttsVoice: string;
  speakerAccess: VoiceSpeakerAccess;
};

export type DisplayRuntimeSettings = {
  headingSize: DisplayHeadingSize;
  density: DisplayDensity;
  divider: DisplayDivider;
  showEmojis: boolean;
  showDetectedLanguage: boolean;
  showProvider: boolean;
  showOriginal: boolean;
  quoteArabic: boolean;
  originalPreviewChars: number;
  smartAnswerArabicFirst: boolean;
};
