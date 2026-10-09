import { isAllowedStorageKey } from './keys';
import type { StorageSnapshot } from '../utils/bridgeClient';

export function storageItemBytes(key: string, value: unknown): number {
  return new TextEncoder().encode(key).length + new TextEncoder().encode(JSON.stringify(value)).length;
}

export function measureStorageSnapshot(snapshot: Record<string, unknown>): StorageSnapshot {
  const entries = Object.entries(snapshot);
  return {
    values: Object.fromEntries(entries.filter(([key]) => isAllowedStorageKey(key))),
    bytes: entries.reduce((bytes, [key, value]) => bytes + storageItemBytes(key, value), 0),
    count: entries.length,
  };
}
