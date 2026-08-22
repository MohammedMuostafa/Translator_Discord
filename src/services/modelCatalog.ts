export type PlanId = 'free' | 'plus' | 'pro';
export type ModelKind =
  | 'text'
  | 'image'
  | 'video'
  | 'live'
  | 'tts'
  | 'stt';

export type ModelStrength =
  | 'basic'
  | 'standard'
  | 'premium';

export type TextQuality =
  | 'fast'
  | 'balanced'
  | 'best';

export type ImageQuality =
  | 'draft'
  | 'standard'
  | 'premium';

export type VideoQuality =
  | 'lite'
  | 'fast'
  | 'cinematic';

export type ModelCatalogItem = {
  id: string;
  label: string;
  kind: ModelKind;
  strength: ModelStrength;
  plans: PlanId[];
  relativeCost: number;
  internalOnly?: boolean;
  verifiedApiId?: boolean;
};

export const MODEL_CATALOG: ModelCatalogItem[] = [
  // Text models visible in the user's Google AI Studio quota page.
  {
    id: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash Lite',
    kind: 'text',
    strength: 'basic',
    plans: ['free', 'plus', 'pro'],
    relativeCost: 1
  },
  {
    id: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash Lite',
    kind: 'text',
    strength: 'basic',
    plans: ['free', 'plus', 'pro'],
    relativeCost: 1,
    verifiedApiId: true
  },
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash Lite',
    kind: 'text',
    strength: 'basic',
    plans: ['free', 'plus', 'pro'],
    relativeCost: 1
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    kind: 'text',
    strength: 'standard',
    plans: ['free', 'plus', 'pro'],
    relativeCost: 2,
    verifiedApiId: true
  },
  {
    id: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash',
    kind: 'text',
    strength: 'standard',
    plans: ['plus', 'pro'],
    relativeCost: 2,
    verifiedApiId: true
  },
  {
    id: 'gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    kind: 'text',
    strength: 'standard',
    plans: ['plus', 'pro'],
    relativeCost: 2,
    verifiedApiId: true
  },
  {
    id: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    kind: 'text',
    strength: 'standard',
    plans: ['plus', 'pro'],
    relativeCost: 3
  },
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    kind: 'text',
    strength: 'premium',
    plans: ['pro'],
    relativeCost: 4,
    verifiedApiId: true
  },
  {
    id: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro',
    kind: 'text',
    strength: 'premium',
    plans: ['pro'],
    relativeCost: 4,
    verifiedApiId: true
  },
  {
    id: 'gemini-3.7-flash',
    label: 'Gemini 3.7 Flash',
    kind: 'text',
    strength: 'premium',
    plans: ['pro'],
    relativeCost: 5
  },

  // Current Nano Banana API IDs.
  {
    id: 'gemini-3.1-flash-lite-image',
    label: 'Nano Banana 2 Lite',
    kind: 'image',
    strength: 'basic',
    plans: ['free', 'plus', 'pro'],
    relativeCost: 15,
    verifiedApiId: true
  },
  {
    id: 'gemini-2.5-flash-image',
    label: 'Nano Banana',
    kind: 'image',
    strength: 'standard',
    plans: ['plus', 'pro'],
    relativeCost: 25,
    verifiedApiId: true
  },
  {
    id: 'gemini-3.1-flash-image',
    label: 'Nano Banana 2',
    kind: 'image',
    strength: 'standard',
    plans: ['plus', 'pro'],
    relativeCost: 30,
    verifiedApiId: true
  },
  {
    id: 'gemini-3-pro-image',
    label: 'Nano Banana Pro',
    kind: 'image',
    strength: 'premium',
    plans: ['pro'],
    relativeCost: 50,
    verifiedApiId: true
  },

  // Current Veo 3.1 Gemini API IDs.
  {
    id: 'veo-3.1-lite-generate-preview',
    label: 'Veo 3.1 Lite',
    kind: 'video',
    strength: 'standard',
    plans: ['plus', 'pro'],
    relativeCost: 120,
    verifiedApiId: true
  },
  {
    id: 'veo-3.1-fast-generate-preview',
    label: 'Veo 3.1 Fast',
    kind: 'video',
    strength: 'standard',
    plans: ['plus', 'pro'],
    relativeCost: 220,
    verifiedApiId: true
  },
  {
    id: 'veo-3.1-generate-preview',
    label: 'Veo 3.1',
    kind: 'video',
    strength: 'premium',
    plans: ['pro'],
    relativeCost: 400,
    verifiedApiId: true
  },
  {
    id: 'gemini-omni-flash',
    label: 'Gemini Omni Flash',
    kind: 'video',
    strength: 'standard',
    plans: ['plus', 'pro'],
    relativeCost: 180,
    internalOnly: true,
    verifiedApiId: true
  },

  // Internal voice/media utility models.
  {
    id: 'gemini-3.1-flash-live-preview',
    label: 'Gemini 3.1 Flash Live',
    kind: 'live',
    strength: 'standard',
    plans: ['free', 'plus', 'pro'],
    relativeCost: 0,
    internalOnly: true,
    verifiedApiId: true
  },
  {
    id: 'gemini-2.5-flash-native-audio-preview-12-2025',
    label: 'Gemini 2.5 Flash Live',
    kind: 'live',
    strength: 'standard',
    plans: ['free', 'plus', 'pro'],
    relativeCost: 0,
    internalOnly: true,
    verifiedApiId: true
  },
  {
    id: 'gemini-3.5-live-translate-preview',
    label: 'Gemini 3.5 Live Translate',
    kind: 'live',
    strength: 'premium',
    plans: ['plus', 'pro'],
    relativeCost: 0,
    internalOnly: true,
    verifiedApiId: true
  },
  {
    id: 'gemini-2.5-flash-preview-tts',
    label: 'Gemini 2.5 Flash TTS',
    kind: 'tts',
    strength: 'standard',
    plans: ['free', 'plus', 'pro'],
    relativeCost: 0,
    internalOnly: true,
    verifiedApiId: true
  },
  {
    id: 'gemini-3.1-flash-tts-preview',
    label: 'Gemini 3.1 Flash TTS',
    kind: 'tts',
    strength: 'standard',
    plans: ['free', 'plus', 'pro'],
    relativeCost: 0,
    internalOnly: true,
    verifiedApiId: true
  }
];

export const TEXT_MODEL_BY_PLAN: Record<
  PlanId,
  Record<TextQuality, string[]>
> = {
  free: {
    fast: [
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash-lite'
    ],
    balanced: [
      'gemini-3.5-flash-lite',
      'gemini-2.5-flash'
    ],
    best: [
      'gemini-2.5-flash',
      'gemini-3.5-flash-lite'
    ]
  },
  plus: {
    fast: [
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite'
    ],
    balanced: [
      'gemini-3.5-flash',
      'gemini-3-flash-preview'
    ],
    best: [
      'gemini-3.6-flash',
      'gemini-3.5-flash'
    ]
  },
  pro: {
    fast: [
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite'
    ],
    balanced: [
      'gemini-3.6-flash',
      'gemini-3.5-flash'
    ],
    best: [
      'gemini-3.7-flash',
      'gemini-3.1-pro-preview',
      'gemini-2.5-pro'
    ]
  }
};

export const IMAGE_MODEL_BY_PLAN: Record<
  PlanId,
  Record<ImageQuality, string | undefined>
> = {
  free: {
    draft: 'gemini-3.1-flash-lite-image',
    standard: 'gemini-3.1-flash-lite-image',
    premium: undefined
  },
  plus: {
    draft: 'gemini-3.1-flash-lite-image',
    standard: 'gemini-3.1-flash-image',
    premium: 'gemini-3.1-flash-image'
  },
  pro: {
    draft: 'gemini-3.1-flash-image',
    standard: 'gemini-3.1-flash-image',
    premium: 'gemini-3-pro-image'
  }
};

export const VIDEO_MODEL_BY_PLAN: Record<
  PlanId,
  Record<VideoQuality, string | undefined>
> = {
  free: {
    lite: undefined,
    fast: undefined,
    cinematic: undefined
  },
  plus: {
    lite: 'veo-3.1-lite-generate-preview',
    fast: 'veo-3.1-fast-generate-preview',
    cinematic: undefined
  },
  pro: {
    lite: 'veo-3.1-lite-generate-preview',
    fast: 'veo-3.1-fast-generate-preview',
    cinematic: 'veo-3.1-generate-preview'
  }
};

export function catalogItem(
  id: string
): ModelCatalogItem | undefined {
  return MODEL_CATALOG.find(
    (item) => item.id === id
  );
}

export function isTextModelAllowed(
  planId: PlanId,
  modelId: string
): boolean {
  const item = catalogItem(modelId);

  // Unknown admin-configured IDs remain usable only for Pro.
  // This prevents a new premium model from silently leaking to Free/Plus.
  if (!item) return planId === 'pro';

  return (
    item.kind === 'text' &&
    item.plans.includes(planId)
  );
}

export function filterTextModelsForPlan(
  planId: PlanId,
  models: string[]
): string[] {
  const allowed =
    models.filter((model) =>
      isTextModelAllowed(
        planId,
        model
      )
    );

  if (allowed.length) return allowed;

  return [
    ...TEXT_MODEL_BY_PLAN[
      planId
    ].balanced
  ];
}

export function imageModelForPlan(
  planId: PlanId,
  quality: ImageQuality
): string | undefined {
  return IMAGE_MODEL_BY_PLAN[
    planId
  ][quality];
}

export function videoModelForPlan(
  planId: PlanId,
  quality: VideoQuality
): string | undefined {
  return VIDEO_MODEL_BY_PLAN[
    planId
  ][quality];
}

export function imageModelsForPlan(
  planId: PlanId,
  quality: ImageQuality
): string[] {
  const chains: Record<PlanId, Record<ImageQuality, string[]>> = {
    free: {
      draft: ['gemini-3.1-flash-lite-image'],
      standard: ['gemini-3.1-flash-lite-image'],
      premium: []
    },
    plus: {
      draft: ['gemini-3.1-flash-lite-image', 'gemini-2.5-flash-image'],
      standard: ['gemini-3.1-flash-image', 'gemini-2.5-flash-image', 'gemini-3.1-flash-lite-image'],
      premium: ['gemini-3.1-flash-image', 'gemini-2.5-flash-image']
    },
    pro: {
      draft: ['gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image'],
      standard: ['gemini-3.1-flash-image', 'gemini-2.5-flash-image', 'gemini-3.1-flash-lite-image'],
      premium: ['gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image']
    }
  };
  return [...chains[planId][quality]];
}

export function videoModelsForPlan(
  planId: PlanId,
  quality: VideoQuality
): string[] {
  const chains: Record<PlanId, Record<VideoQuality, string[]>> = {
    free: { lite: [], fast: [], cinematic: [] },
    plus: {
      lite: ['veo-3.1-lite-generate-preview', 'veo-3.1-fast-generate-preview'],
      fast: ['veo-3.1-fast-generate-preview', 'veo-3.1-lite-generate-preview'],
      cinematic: []
    },
    pro: {
      lite: ['veo-3.1-lite-generate-preview', 'veo-3.1-fast-generate-preview'],
      fast: ['veo-3.1-fast-generate-preview', 'veo-3.1-lite-generate-preview', 'veo-3.1-generate-preview'],
      cinematic: ['veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview', 'veo-3.1-lite-generate-preview']
    }
  };
  return [...chains[planId][quality]];
}

export function publicModelCatalog(): Array<
  Omit<ModelCatalogItem, 'plans'> & {
    plans: PlanId[];
  }
> {
  return MODEL_CATALOG.filter(
    (item) =>
      !item.internalOnly
  );
}
