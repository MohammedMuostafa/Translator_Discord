import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config.js';
import type { PlanId } from './modelCatalog.js';

export type { PlanId } from './modelCatalog.js';

export type AccountRole = 'user' | 'admin';
export type SubscriptionStatus = 'active' | 'paused' | 'expired';

export type UsageFeature =
  | 'translation'
  | 'chat'
  | 'ai_tools'
  | 'smart_reply'
  | 'voice_ai'
  | 'live_translation'
  | 'stt'
  | 'tts'
  | 'image_generate'
  | 'image_edit'
  | 'video_generate';

export type MediaJobKind =
  | 'image_generate'
  | 'image_edit'
  | 'video_generate';

export type PlanDefinition = {
  id: PlanId;
  name: string;
  monthlyCredits: number;
  voiceAi: boolean;
  liveTranslation: boolean;
  imageGenerate: boolean;
  imageEdit: boolean;
  videoGenerate: boolean;
  maxImageJobsPerMonth: number;
  maxImageEditJobsPerMonth: number;
  maxVideoJobsPerMonth: number;
  maxThinking: 'minimal' | 'low' | 'medium' | 'high';
};

export type UserAccount = {
  discordUserId: string;
  role: AccountRole;
  planId: PlanId;
  subscriptionStatus: SubscriptionStatus;
  creditsUsed: number;
  bonusCredits: number;
  periodStart: string;
  periodEnd: string;
  expiresAt?: string;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UsageBucket = {
  total: number;
  byFeature: Partial<Record<UsageFeature, number>>;
  jobs: Partial<Record<MediaJobKind, number>>;
};

export type ProviderHealthEntry = {
  key: string;
  provider: string;
  model: string;
  status: 'healthy' | 'rate-limited' | 'busy' | 'error';
  lastStatusCode?: number;
  lastMessage?: string;
  lastUpdatedAt: string;
  cooldownUntil?: string;
};

type SaaSState = {
  version: 2;
  plans: Record<PlanId, PlanDefinition>;
  users: Record<string, UserAccount>;
  usage: Record<string, UsageBucket>;
  providerHealth: Record<string, ProviderHealthEntry>;
  updatedAt: string;
};

const STATE_FILE = path.join(env.DATA_DIR, 'saas-state.json');
let cached: SaaSState | undefined;
let writeChain = Promise.resolve();

function nextMonthBoundary(from = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const end = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
}

function defaultPlans(): Record<PlanId, PlanDefinition> {
  return {
    free: {
      id: 'free',
      name: 'Free',
      monthlyCredits: 25_000,
      voiceAi: true,
      liveTranslation: false,
      imageGenerate: true,
      imageEdit: true,
      videoGenerate: false,
      maxImageJobsPerMonth: 20,
      maxImageEditJobsPerMonth: 30,
      maxVideoJobsPerMonth: 0,
      maxThinking: 'low'
    },
    plus: {
      id: 'plus',
      name: 'Plus',
      monthlyCredits: 250_000,
      voiceAi: true,
      liveTranslation: true,
      imageGenerate: true,
      imageEdit: true,
      videoGenerate: true,
      maxImageJobsPerMonth: 200,
      maxImageEditJobsPerMonth: 300,
      maxVideoJobsPerMonth: 10,
      maxThinking: 'medium'
    },
    pro: {
      id: 'pro',
      name: 'Pro',
      monthlyCredits: 1_500_000,
      voiceAi: true,
      liveTranslation: true,
      imageGenerate: true,
      imageEdit: true,
      videoGenerate: true,
      maxImageJobsPerMonth: 1000,
      maxImageEditJobsPerMonth: 1500,
      maxVideoJobsPerMonth: 60,
      maxThinking: 'high'
    }
  };
}

function blankBucket(): UsageBucket {
  return {
    total: 0,
    byFeature: {},
    jobs: {}
  };
}

function mergePlan(
  fallback: PlanDefinition,
  value: Partial<PlanDefinition> | undefined
): PlanDefinition {
  return {
    ...fallback,
    ...(value ?? {}),
    id: fallback.id,
    monthlyCredits: Math.max(
      1,
      Math.floor(
        Number(
          value?.monthlyCredits ??
          fallback.monthlyCredits
        )
      )
    ),
    maxImageJobsPerMonth: Math.max(
      0,
      Math.floor(
        Number(
          value?.maxImageJobsPerMonth ??
          fallback.maxImageJobsPerMonth
        )
      )
    ),
    maxImageEditJobsPerMonth: Math.max(
      0,
      Math.floor(
        Number(
          value?.maxImageEditJobsPerMonth ??
          fallback.maxImageEditJobsPerMonth
        )
      )
    ),
    maxVideoJobsPerMonth: Math.max(
      0,
      Math.floor(
        Number(
          value?.maxVideoJobsPerMonth ??
          fallback.maxVideoJobsPerMonth
        )
      )
    )
  };
}

function normalizeBucket(
  value: Partial<UsageBucket> | undefined
): UsageBucket {
  return {
    total: Math.max(
      0,
      Number(value?.total ?? 0)
    ),
    byFeature:
      value?.byFeature ?? {},
    jobs:
      value?.jobs ?? {}
  };
}

function defaultState(): SaaSState {
  return {
    version: 2,
    plans: defaultPlans(),
    users: {},
    usage: {},
    providerHealth: {},
    updatedAt:
      new Date().toISOString()
  };
}

async function load(): Promise<SaaSState> {
  if (cached) return cached;

  try {
    const raw =
      await readFile(
        STATE_FILE,
        'utf8'
      );

    const parsed =
      JSON.parse(raw) as {
        plans?: Partial<
          Record<
            PlanId,
            Partial<PlanDefinition>
          >
        >;
        users?: Record<
          string,
          UserAccount
        >;
        usage?: Record<
          string,
          Partial<UsageBucket>
        >;
        providerHealth?: Record<
          string,
          ProviderHealthEntry
        >;
        updatedAt?: string;
      };

    const defaults =
      defaultPlans();

    const usage =
      Object.fromEntries(
        Object.entries(
          parsed.usage ?? {}
        ).map(
          ([userId, bucket]) => [
            userId,
            normalizeBucket(
              bucket
            )
          ]
        )
      );

    cached = {
      version: 2,
      plans: {
        free: mergePlan(
          defaults.free,
          parsed.plans?.free
        ),
        plus: mergePlan(
          defaults.plus,
          parsed.plans?.plus
        ),
        pro: mergePlan(
          defaults.pro,
          parsed.plans?.pro
        )
      },
      users:
        parsed.users ?? {},
      usage,
      providerHealth:
        parsed.providerHealth ?? {},
      updatedAt:
        parsed.updatedAt ??
        new Date().toISOString()
    };
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException)
        .code !== 'ENOENT'
    ) {
      console.error(
        'Could not load SaaS state:',
        error
      );
    }

    cached =
      defaultState();
  }

  return cached;
}

async function persist(
  state: SaaSState
): Promise<void> {
  state.updatedAt =
    new Date().toISOString();

  cached = state;

  writeChain =
    writeChain.then(
      async () => {
        await mkdir(
          env.DATA_DIR,
          {
            recursive: true
          }
        );

        const temp =
          `${STATE_FILE}.tmp`;

        await writeFile(
          temp,
          `${JSON.stringify(
            state,
            null,
            2
          )}\n`,
          {
            encoding: 'utf8',
            mode: 0o600
          }
        );

        await rename(
          temp,
          STATE_FILE
        );
      }
    );

  await writeChain;
}

function isBootstrapAdmin(
  userId: string
): boolean {
  return Boolean(
    env.ADMIN_DISCORD_IDS
      ?.includes(userId)
  );
}

function freshAccount(
  userId: string
): UserAccount {
  const now = new Date();
  const period =
    nextMonthBoundary(now);
  const admin =
    isBootstrapAdmin(userId);

  return {
    discordUserId:
      userId,
    role:
      admin
        ? 'admin'
        : 'user',
    planId:
      admin
        ? 'pro'
        : 'free',
    subscriptionStatus:
      'active',
    creditsUsed: 0,
    bonusCredits: 0,
    periodStart:
      period.start,
    periodEnd:
      period.end,
    disabled: false,
    createdAt:
      now.toISOString(),
    updatedAt:
      now.toISOString()
  };
}

function resetPeriodIfNeeded(
  account: UserAccount
): UserAccount {
  const now =
    Date.now();

  if (
    new Date(
      account.periodEnd
    ).getTime() > now
  ) {
    return account;
  }

  const period =
    nextMonthBoundary(
      new Date()
    );

  return {
    ...account,
    creditsUsed: 0,
    periodStart:
      period.start,
    periodEnd:
      period.end,
    updatedAt:
      new Date().toISOString()
  };
}

export async function getUserAccount(
  userId: string
): Promise<UserAccount> {
  const state =
    await load();

  let account =
    state.users[userId] ??
    freshAccount(userId);

  const previousPeriodEnd =
    account.periodEnd;

  account =
    resetPeriodIfNeeded(
      account
    );

  if (
    account.periodEnd !==
    previousPeriodEnd
  ) {
    state.usage[userId] =
      blankBucket();
  }

  if (
    isBootstrapAdmin(userId) &&
    account.role !== 'admin'
  ) {
    account = {
      ...account,
      role: 'admin'
    };
  }

  state.users[userId] =
    account;

  await persist(state);

  return account;
}

export async function isAdminUser(
  userId: string
): Promise<boolean> {
  if (
    isBootstrapAdmin(userId)
  ) {
    return true;
  }

  return (
    await getUserAccount(
      userId
    )
  ).role === 'admin';
}

export async function getPlan(
  planId: PlanId
): Promise<PlanDefinition> {
  const state =
    await load();

  return (
    state.plans[planId] ??
    state.plans.free
  );
}

export async function listPlans():
Promise<PlanDefinition[]> {
  const state =
    await load();

  return (
    ['free', 'plus', 'pro'] as PlanId[]
  ).map(
    (id) =>
      state.plans[id]
  );
}

export async function updatePlan(
  planId: PlanId,
  patch: Partial<PlanDefinition>
): Promise<PlanDefinition> {
  const state =
    await load();

  const current =
    state.plans[planId];

  if (!current) {
    throw new Error(
      'Unknown plan.'
    );
  }

  const next =
    mergePlan(
      current,
      patch
    );

  state.plans[planId] =
    next;

  await persist(state);

  return next;
}

function mediaLimit(
  plan: PlanDefinition,
  kind: MediaJobKind
): number {
  switch (kind) {
    case 'image_generate':
      return plan.maxImageJobsPerMonth;

    case 'image_edit':
      return plan.maxImageEditJobsPerMonth;

    case 'video_generate':
      return plan.maxVideoJobsPerMonth;
  }
}

function mediaEnabled(
  plan: PlanDefinition,
  kind: MediaJobKind
): boolean {
  switch (kind) {
    case 'image_generate':
      return plan.imageGenerate;

    case 'image_edit':
      return plan.imageEdit;

    case 'video_generate':
      return plan.videoGenerate;
  }
}

export async function userUsageSummary(
  userId: string
) {
  const account =
    await getUserAccount(
      userId
    );

  const plan =
    await getPlan(
      account.planId
    );

  const allowance =
    plan.monthlyCredits +
    Math.max(
      0,
      account.bonusCredits
    );

  const remaining =
    Math.max(
      0,
      allowance -
      account.creditsUsed
    );

  const state =
    await load();

  const bucket =
    normalizeBucket(
      state.usage[userId]
    );

  const jobs = {
    image_generate:
      bucket.jobs.image_generate ??
      0,
    image_edit:
      bucket.jobs.image_edit ??
      0,
    video_generate:
      bucket.jobs.video_generate ??
      0
  };

  return {
    account,
    plan,
    allowance,
    used:
      account.creditsUsed,
    remaining,
    percent:
      allowance > 0
        ? Math.min(
            100,
            Math.round(
              (
                account.creditsUsed /
                allowance
              ) * 1000
            ) / 10
          )
        : 100,
    byFeature:
      bucket.byFeature,
    jobs,
    media: {
      imageGenerate: {
        used:
          jobs.image_generate,
        limit:
          plan.maxImageJobsPerMonth,
        remaining:
          Math.max(
            0,
            plan.maxImageJobsPerMonth -
            jobs.image_generate
          ),
        enabled:
          plan.imageGenerate
      },
      imageEdit: {
        used:
          jobs.image_edit,
        limit:
          plan.maxImageEditJobsPerMonth,
        remaining:
          Math.max(
            0,
            plan.maxImageEditJobsPerMonth -
            jobs.image_edit
          ),
        enabled:
          plan.imageEdit
      },
      videoGenerate: {
        used:
          jobs.video_generate,
        limit:
          plan.maxVideoJobsPerMonth,
        remaining:
          Math.max(
            0,
            plan.maxVideoJobsPerMonth -
            jobs.video_generate
          ),
        enabled:
          plan.videoGenerate
      }
    }
  };
}

export async function assertFeatureAccess(
  userId: string,
  feature: UsageFeature
): Promise<void> {
  const account =
    await getUserAccount(
      userId
    );

  if (account.disabled) {
    throw new Error(
      'This TD AI account is suspended.'
    );
  }

  if (
    account.expiresAt &&
    new Date(
      account.expiresAt
    ).getTime() <=
      Date.now()
  ) {
    throw new Error(
      'Your TD AI subscription has expired.'
    );
  }

  if (
    account.subscriptionStatus !==
    'active'
  ) {
    throw new Error(
      'Your TD AI plan is not active.'
    );
  }

  const plan =
    await getPlan(
      account.planId
    );

  if (
    feature === 'voice_ai' &&
    !plan.voiceAi
  ) {
    throw new Error(
      'Voice AI is not included in your plan.'
    );
  }

  if (
    feature ===
      'live_translation' &&
    !plan.liveTranslation
  ) {
    throw new Error(
      'Live Voice Translation is not included in your plan.'
    );
  }

  if (
    feature ===
      'image_generate' &&
    !plan.imageGenerate
  ) {
    throw new Error(
      'Image generation is not included in your plan.'
    );
  }

  if (
    feature ===
      'image_edit' &&
    !plan.imageEdit
  ) {
    throw new Error(
      'Image editing is not included in your plan.'
    );
  }

  if (
    feature ===
      'video_generate' &&
    !plan.videoGenerate
  ) {
    throw new Error(
      'Video generation is not included in your plan.'
    );
  }

  const summary =
    await userUsageSummary(
      userId
    );

  if (
    summary.remaining <= 0
  ) {
    throw new Error(
      'Your TD AI monthly credits are finished.'
    );
  }
}

export async function assertCreditsAvailable(
  userId: string,
  credits: number
): Promise<void> {
  const summary =
    await userUsageSummary(
      userId
    );

  const needed =
    Math.max(
      1,
      Math.ceil(credits)
    );

  if (
    summary.remaining <
    needed
  ) {
    throw new Error(
      `This request needs about ${needed.toLocaleString()} TD credits, but you only have ${summary.remaining.toLocaleString()} left.`
    );
  }
}

export async function assertMediaAccess(
  userId: string,
  kind: MediaJobKind
): Promise<void> {
  await assertFeatureAccess(
    userId,
    kind
  );

  const summary =
    await userUsageSummary(
      userId
    );

  const limit =
    mediaLimit(
      summary.plan,
      kind
    );

  const used =
    summary.jobs[kind];

  if (
    !mediaEnabled(
      summary.plan,
      kind
    ) ||
    limit <= 0
  ) {
    throw new Error(
      'This media feature is not included in your plan.'
    );
  }

  if (
    used >= limit
  ) {
    throw new Error(
      `You reached your monthly ${kind.replaceAll('_', ' ')} limit (${limit.toLocaleString()}).`
    );
  }
}

export async function recordUsage(
  userId: string | undefined,
  feature: UsageFeature,
  credits: number
): Promise<void> {
  if (
    !userId ||
    !Number.isFinite(
      credits
    ) ||
    credits <= 0
  ) {
    return;
  }

  const state =
    await load();

  let account =
    state.users[userId] ??
    freshAccount(userId);

  account =
    resetPeriodIfNeeded(
      account
    );

  const charge =
    Math.max(
      1,
      Math.ceil(credits)
    );

  account.creditsUsed +=
    charge;

  account.updatedAt =
    new Date().toISOString();

  state.users[userId] =
    account;

  const bucket =
    normalizeBucket(
      state.usage[userId]
    );

  bucket.total +=
    charge;

  bucket.byFeature[feature] =
    (
      bucket.byFeature[
        feature
      ] ?? 0
    ) + charge;

  state.usage[userId] =
    bucket;

  await persist(state);
}

export async function recordMediaJob(
  userId: string,
  kind: MediaJobKind
): Promise<void> {
  const state =
    await load();

  const bucket =
    normalizeBucket(
      state.usage[userId]
    );

  bucket.jobs[kind] =
    (
      bucket.jobs[kind] ??
      0
    ) + 1;

  state.usage[userId] =
    bucket;

  await persist(state);
}

export function estimateTextCredits(
  inputChars: number,
  outputChars: number
): number {
  return Math.max(
    1,
    Math.ceil(
      (
        Math.max(
          0,
          inputChars
        ) +
        Math.max(
          0,
          outputChars
        )
      ) / 4
    )
  );
}

export function estimateAudioCredits(
  seconds: number,
  multiplier = 12
): number {
  return Math.max(
    1,
    Math.ceil(
      Math.max(
        0.1,
        seconds
      ) *
      multiplier
    )
  );
}

export async function listUsers():
Promise<Array<
  Awaited<
    ReturnType<
      typeof userUsageSummary
    >
  >
>> {
  const state =
    await load();

  const ids =
    new Set<string>([
      ...Object.keys(
        state.users
      ),
      ...(
        env.ADMIN_DISCORD_IDS ??
        []
      )
    ]);

  const rows = [];

  for (
    const id of ids
  ) {
    rows.push(
      await userUsageSummary(
        id
      )
    );
  }

  return rows.sort(
    (a, b) =>
      b.used - a.used
  );
}

export async function adminUpdateUser(
  userId: string,
  patch:
    Partial<
      Pick<
        UserAccount,
        | 'role'
        | 'planId'
        | 'subscriptionStatus'
        | 'bonusCredits'
        | 'expiresAt'
        | 'disabled'
      >
    > & {
      creditsUsed?: number;
    }
): Promise<UserAccount> {
  const state =
    await load();

  let account =
    resetPeriodIfNeeded(
      state.users[userId] ??
      freshAccount(userId)
    );

  if (
    patch.planId &&
    !state.plans[
      patch.planId
    ]
  ) {
    throw new Error(
      'Unknown plan.'
    );
  }

  if (
    patch.role &&
    ![
      'user',
      'admin'
    ].includes(
      patch.role
    )
  ) {
    throw new Error(
      'Unknown account role.'
    );
  }

  if (
    patch.subscriptionStatus &&
    ![
      'active',
      'paused',
      'expired'
    ].includes(
      patch.subscriptionStatus
    )
  ) {
    throw new Error(
      'Unknown subscription status.'
    );
  }

  account = {
    ...account,
    ...patch,
    creditsUsed:
      patch.creditsUsed ===
      undefined
        ? account.creditsUsed
        : Math.max(
            0,
            Math.floor(
              Number(
                patch.creditsUsed
              )
            )
          ),
    bonusCredits:
      patch.bonusCredits ===
      undefined
        ? account.bonusCredits
        : Math.max(
            0,
            Math.floor(
              Number(
                patch.bonusCredits
              )
            )
          ),
    role:
      isBootstrapAdmin(
        userId
      )
        ? 'admin'
        : (
          patch.role ??
          account.role
        ),
    updatedAt:
      new Date().toISOString()
  };

  state.users[userId] =
    account;

  await persist(state);

  return account;
}

export async function resetUserUsage(
  userId: string
): Promise<void> {
  const state =
    await load();

  const account =
    resetPeriodIfNeeded(
      state.users[userId] ??
      freshAccount(userId)
    );

  account.creditsUsed =
    0;

  account.updatedAt =
    new Date().toISOString();

  state.users[userId] =
    account;

  state.usage[userId] =
    blankBucket();

  await persist(state);
}

export async function recordProviderHealth(
  input: {
    provider: string;
    model: string;
    ok: boolean;
    status?: number;
    message?: string;
  }
): Promise<void> {
  const state =
    await load();

  const key =
    `${input.provider}/${input.model}`;

  const cooldownMs =
    input.status === 429
      ? 60_000
      : input.status === 503
        ? 30_000
        : 0;

  state.providerHealth[
    key
  ] = {
    key,
    provider:
      input.provider,
    model:
      input.model,
    status:
      input.ok
        ? 'healthy'
        : input.status ===
            429
          ? 'rate-limited'
          : input.status ===
              503
            ? 'busy'
            : 'error',
    lastStatusCode:
      input.status,
    lastMessage:
      input.message?.slice(
        0,
        400
      ),
    lastUpdatedAt:
      new Date().toISOString(),
    cooldownUntil:
      cooldownMs
        ? new Date(
            Date.now() +
            cooldownMs
          ).toISOString()
        : undefined
  };

  await persist(state);
}

export async function listProviderHealth():
Promise<ProviderHealthEntry[]> {
  const state =
    await load();

  return Object.values(
    state.providerHealth
  ).sort(
    (a, b) =>
      b.lastUpdatedAt.localeCompare(
        a.lastUpdatedAt
      )
  );
}
