export const InteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
  MessageComponent: 3
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
  UpdateMessage: 7
} as const;

export const MessageFlags = {
  Ephemeral: 1 << 6
} as const;

export async function editOriginalResponse(
  applicationId: string,
  token: string,
  payload: Record<string, unknown>
): Promise<void> {
  const url = `https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to edit Discord response (${response.status}): ${body.slice(0, 300)}`);
  }
}

export function clipDiscord(text: string, max = 1900): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
