import { randomUUID } from 'node:crypto';
import type { SmartReplyResult } from './smartReply.js';

type SmartReplySession = {
  userId: string;
  sourceMessage: string;
  language: string;
  result: SmartReplyResult;
  expiresAt: number;
};

const sessions = new Map<string, SmartReplySession>();
const TTL_MS = 20 * 60_000;

export function createSmartReplySession(
  userId: string,
  sourceMessage: string,
  language: string,
  result: SmartReplyResult
): string {
  const id = randomUUID();
  sessions.set(id, {
    userId,
    sourceMessage,
    language,
    result,
    expiresAt: Date.now() + TTL_MS
  });
  return id;
}

export function getSmartReplySession(id: string): SmartReplySession | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  if (session.expiresAt < Date.now()) {
    sessions.delete(id);
    return undefined;
  }
  return session;
}

export function updateSmartReplySession(id: string, result: SmartReplyResult): SmartReplySession | undefined {
  const session = getSmartReplySession(id);
  if (!session) return undefined;
  session.result = result;
  session.expiresAt = Date.now() + TTL_MS;
  return session;
}
