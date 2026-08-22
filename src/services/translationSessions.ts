import { randomUUID } from 'node:crypto';
import type { DiscordMessage } from '../types.js';

export type TranslationSession = {
  userId: string;
  message?: DiscordMessage;
  text?: string;
  createdAt: number;
};

const TTL_MS = 10 * 60 * 1000;
const sessions = new Map<string, TranslationSession>();

function cleanup(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, session] of sessions) {
    if (session.createdAt < cutoff) sessions.delete(id);
  }
}

export function createTranslationSession(userId: string, message: DiscordMessage): string {
  cleanup();
  const id = randomUUID().replaceAll('-', '').slice(0, 20);
  sessions.set(id, { userId, message, createdAt: Date.now() });
  return id;
}

export function createTranslationTextSession(userId: string, text: string): string {
  cleanup();
  const id = randomUUID().replaceAll('-', '').slice(0, 20);
  sessions.set(id, { userId, text, createdAt: Date.now() });
  return id;
}

export function getTranslationSession(id: string): TranslationSession | undefined {
  cleanup();
  return sessions.get(id);
}
