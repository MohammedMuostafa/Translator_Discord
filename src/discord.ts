import { currentUsageUserId } from './services/usageContext.js';
import { getUserPersonalization } from './services/userPersonalization.js';

export const InteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
  MessageComponent: 3,
  ModalSubmit: 5
} as const;

export const ApplicationCommandType = {
  ChatInput: 1,
  Message: 3
} as const;

export const InteractionResponseType = {
  Pong: 1,
  ChannelMessageWithSource: 4,
  DeferredChannelMessageWithSource: 5,
  DeferredUpdateMessage: 6,
  UpdateMessage: 7,
  Modal: 9
} as const;

export const MessageFlags = {
  Ephemeral: 1 << 6
} as const;

function resizeMarkdownHeadings(
  text: string,
  size: 'small' | 'medium' | 'large'
): string {
  const target = size === 'large' ? '#' : size === 'small' ? '###' : '##';

  return text
    .split('\n')
    .map((line) => {
      if (!/^\s{0,3}#{1,3}\s+/.test(line)) return line;
      return line.replace(/^\s{0,3}#{1,3}\s+/, `${target} `);
    })
    .join('\n');
}

function adjustDensity(
  text: string,
  density: 'compact' | 'comfortable' | 'relaxed'
): string {
  if (density === 'compact') {
    return text.replace(/\n{3,}/g, '\n\n');
  }

  if (density === 'relaxed') {
    return text.replace(/\n\n/g, '\n\n\n').replace(/\n{4,}/g, '\n\n\n');
  }

  return text.replace(/\n{4,}/g, '\n\n');
}

function stripLeadingEmoji(text: string): string {
  return text.replace(
    /^(\s{0,3}#{1,3}\s+)?(?:\p{Extended_Pictographic}\uFE0F?\s*)+/gmu,
    '$1'
  );
}

async function personalizePayload(
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const userId = currentUsageUserId();
  if (!userId || typeof payload.content !== 'string') return payload;

  try {
    const prefs = await getUserPersonalization(userId);
    let content = payload.content;

    content = resizeMarkdownHeadings(content, prefs.headingSize);
    content = adjustDensity(content, prefs.density);

    if (!prefs.showEmojis) {
      content = stripLeadingEmoji(content);
    }

    if (!prefs.showOriginal) {
      content = content
        .replace(
          /\n+(?:---\n)?\*\*Original\*\*\n(?:>[^\n]*(?:\n|$))+/giu,
          '\n'
        )
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    return {
      ...payload,
      content
    };
  } catch (error) {
    console.error('Could not apply user text personalization:', error);
    return payload;
  }
}

export async function editOriginalResponse(
  applicationId: string,
  token: string,
  payload: Record<string, unknown>
): Promise<void> {
  const finalPayload = await personalizePayload(payload);

  const response = await fetch(
    `https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`,
    {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(finalPayload),
      signal: AbortSignal.timeout(20_000)
    }
  );

  if (!response.ok) {
    throw new Error(
      `Failed to edit Discord response (${response.status}): ${(await response.text()).slice(0, 300)}`
    );
  }
}

export async function editOriginalResponseWithFile(
  applicationId: string,
  token: string,
  payload: Record<string, unknown>,
  file: {
    filename: string;
    contentType: string;
    data: Uint8Array
  }
): Promise<void> {
  const finalPayload = await personalizePayload(payload);

  const form = new FormData();
  form.append(
    'payload_json',
    JSON.stringify({
      ...finalPayload,
      attachments: [{
        id: 0,
        filename: file.filename
      }]
    })
  );

  form.append(
    'files[0]',
    new Blob(
      [Uint8Array.from(file.data)],
      { type: file.contentType }
    ),
    file.filename
  );

  const response = await fetch(
    `https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`,
    {
      method: 'PATCH',
      body: form,
      signal: AbortSignal.timeout(30_000)
    }
  );

  if (!response.ok) {
    throw new Error(
      `Failed to upload Discord audio (${response.status}): ${(await response.text()).slice(0, 300)}`
    );
  }
}

export function clipDiscord(
  text: string,
  max = 1900
): string {
  return text.length <= max
    ? text
    : `${text.slice(0, max - 1)}…`;
}
