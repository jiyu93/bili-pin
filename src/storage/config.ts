import {
  bridgeListenStorageChanges,
  bridgeStorageGet,
  bridgeStorageSet,
  bridgeStorageSnapshot,
  bridgeStorageSetMany,
  type StorageSnapshot,
  type StorageAreaName,
  type StorageReadResult,
} from '../utils/bridgeClient';
import { SYNC_META_KEY, SYNC_MIGRATION_KEY, PINS_RECORD_PREFIX, isPinsRecordKey } from './keys';
import { measureStorageSnapshot, storageItemBytes } from './snapshot';

type MigrationState = Record<string, 1>;
export type SyncMeta = {
  lastSyncWriteAt?: number;
};

function getChromeStorageArea(area: StorageAreaName) {
  return (globalThis as any).chrome?.storage?.[area];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeMigrationState(value: unknown): MigrationState {
  if (!isObject(value)) return {};

  const next: MigrationState = {};
  for (const [key, flag] of Object.entries(value)) {
    if (flag === 1) next[key] = 1;
  }
  return next;
}

export async function readStorageValue<T>(
  area: StorageAreaName,
  key: string,
): Promise<StorageReadResult<T>> {
  const chromeStorage = getChromeStorageArea(area);
  if (chromeStorage?.get) {
    return await new Promise<StorageReadResult<T>>((resolve, reject) => {
      chromeStorage.get(key, (result: Record<string, unknown>) => {
        const error = (globalThis as any).chrome?.runtime?.lastError;
        if (error) {
          reject(new Error(String(error.message || error)));
          return;
        }

        if (Object.prototype.hasOwnProperty.call(result, key)) {
          resolve({ found: true, value: result[key] as T });
          return;
        }

        resolve({ found: false });
      });
    });
  }

  return await bridgeStorageGet<T>(area, key);
}

export async function readStorageSnapshot(area: StorageAreaName): Promise<StorageSnapshot> {
  const storage = getChromeStorageArea(area);
  if (storage?.get) return measureStorageSnapshot(await storage.get(null));
  return bridgeStorageSnapshot(area);
}

async function writeStorageValues(area: StorageAreaName, values: Record<string, unknown>): Promise<void> {
  const storage = getChromeStorageArea(area);
  if (storage?.set) await storage.set(values);
  else await bridgeStorageSetMany(area, values);
}

export async function writeSyncPrimaryValues(values: Record<string, unknown>, snapshot: StorageSnapshot): Promise<void> {
  const entries = Object.entries(values);
  if (!entries.length) return;
  let bytes = snapshot.bytes;
  let count = snapshot.count;
  for (const [key, value] of entries) {
    const itemBytes = storageItemBytes(key, value);
    if (itemBytes > 8192) throw new Error('同步空间已满，无法保存置顶。');
    if (Object.prototype.hasOwnProperty.call(snapshot.values, key)) bytes -= storageItemBytes(key, snapshot.values[key]);
    else count++;
    bytes += itemBytes;
  }
  if (bytes > 102400) throw new Error('同步空间已满，无法保存置顶。');
  if (count > 512) throw new Error('同步记录数量已达上限，无法新增置顶记录。');
  await writeStorageValues('sync', values);
  try {
    await writeStorageValues('local', { ...values, [SYNC_META_KEY]: { lastSyncWriteAt: Date.now() } });
  } catch (error) {
    console.warn('[bili-pin] failed to mirror pins locally', toErrorMessage(error));
  }
}

export async function writeStorageValue<T>(
  area: StorageAreaName,
  key: string,
  value: T,
): Promise<void> {
  const chromeStorage = getChromeStorageArea(area);
  if (chromeStorage?.set) {
    await new Promise<void>((resolve, reject) => {
      chromeStorage.set({ [key]: value }, () => {
        const error = (globalThis as any).chrome?.runtime?.lastError;
        if (error) {
          reject(new Error(String(error.message || error)));
          return;
        }
        resolve();
      });
    });
    return;
  }

  await bridgeStorageSet(area, key, value);
}

async function getMigrationState(): Promise<MigrationState> {
  const entry = await readStorageValue<MigrationState>('local', SYNC_MIGRATION_KEY);
  return normalizeMigrationState(entry.value);
}

export async function markConfigMigrated(key: string): Promise<void> {
  const state = await getMigrationState();
  if (state[key] === 1) return;

  const next: MigrationState = { ...state, [key]: 1 };
  await writeStorageValue('local', SYNC_MIGRATION_KEY, next);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function writeMirroredConfig<T>(key: string, value: T): Promise<void> {
  const errors: unknown[] = [];
  let syncWriteAt = 0;

  try {
    await writeStorageValue('local', key, value);
  } catch (error) {
    errors.push(error);
    console.warn('[bili-pin] failed to write local config', { key, error: toErrorMessage(error) });
  }

  try {
    await writeStorageValue('sync', key, value);
    syncWriteAt = Date.now();
  } catch (error) {
    errors.push(error);
    console.warn('[bili-pin] failed to write sync config', { key, error: toErrorMessage(error) });
  }

  if (syncWriteAt > 0 && key !== SYNC_META_KEY) {
    try {
      await writeStorageValue<SyncMeta>('local', SYNC_META_KEY, {
        lastSyncWriteAt: syncWriteAt,
      });
    } catch (error) {
      console.warn('[bili-pin] failed to write sync meta', { key, error: toErrorMessage(error) });
    }
  }

  try {
    await markConfigMigrated(key);
  } catch (error) {
    console.warn('[bili-pin] failed to mark config migration', { key, error: toErrorMessage(error) });
  }

  if (errors.length >= 2) {
    throw errors[0] instanceof Error ? errors[0] : new Error(toErrorMessage(errors[0]));
  }
}

export function observeStorageChanges(
  keys: string[],
  callback: (change: { area: StorageAreaName; key: string }) => void,
): () => void {
  const keySet = new Set(keys);
  const handler = (area: StorageAreaName, changedKey: string) => {
    if (!keySet.has(changedKey) && !(keySet.has(PINS_RECORD_PREFIX) && isPinsRecordKey(changedKey))) return;
    callback({ area, key: changedKey });
  };

  const chromeStorage = (globalThis as any).chrome?.storage;
  if (chromeStorage?.onChanged?.addListener) {
    const listener = (changes: Record<string, unknown>, areaName: string) => {
      if (areaName !== 'local' && areaName !== 'sync') return;
      for (const changedKey of Object.keys(changes || {})) {
        handler(areaName, changedKey);
      }
    };
    chromeStorage.onChanged.addListener(listener);
    return () => chromeStorage.onChanged.removeListener(listener);
  }

  return bridgeListenStorageChanges(({ area, key }) => handler(area, key));
}
