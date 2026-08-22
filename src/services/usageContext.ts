import { AsyncLocalStorage } from 'node:async_hooks';

type UsageContext = { userId?: string };
const storage = new AsyncLocalStorage<UsageContext>();

export function runWithUsageUser<T>(userId: string | undefined, fn: () => T): T {
  return storage.run({ userId }, fn);
}

export function currentUsageUserId(): string | undefined {
  return storage.getStore()?.userId;
}
