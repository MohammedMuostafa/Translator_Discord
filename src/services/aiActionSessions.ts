import { randomUUID } from 'node:crypto';
import type { DiscordMessage } from '../types.js';

type AiActionSession = {
  userId: string;
  message: DiscordMessage;
  expiresAt: number;
};

const sessions = new Map<string, AiActionSession>();
const TTL_MS = 15 * 60_000;

export function createAiActionSession(userId: string, message: DiscordMessage): string {
  const id = randomUUID();
  sessions.set(id, { userId, message, expiresAt: Date.now() + TTL_MS });
  return id;
}

export function getAiActionSession(id: string): AiActionSession | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  if (session.expiresAt < Date.now()) {
    sessions.delete(id);
    return undefined;
  }
  return session;
}
