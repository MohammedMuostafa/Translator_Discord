import { randomUUID } from 'node:crypto';

export type SpeechSession = {
  userId: string;
  text: string;
  language: string;
  createdAt: number;
};

const TTL_MS = 10 * 60 * 1000;
const sessions = new Map<string, SpeechSession>();

function cleanup(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, session] of sessions) {
    if (session.createdAt < cutoff) sessions.delete(id);
  }
}

export function createSpeechSession(userId: string, text: string, language: string): string {
  cleanup();
  const id = randomUUID().replaceAll('-', '').slice(0, 20);
  sessions.set(id, { userId, text, language, createdAt: Date.now() });
  return id;
}

export function getSpeechSession(id: string): SpeechSession | undefined {
  cleanup();
  return sessions.get(id);
}
