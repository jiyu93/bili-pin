/**
 * storage bridge（ISOLATED world）
 *
 * 目的：让 MAIN world 代码也能稳定读写 `chrome.storage.local/sync`，避免退回页面 localStorage。
 */

type StorageAreaName = 'local' | 'sync';

type BridgeRequest =
  | {
      __biliPin: 1;
      kind: 'storage:get';
      requestId: string;
      area: StorageAreaName;
      key: string;
    }
  | {
      __biliPin: 1;
      kind: 'storage:set';
      requestId: string;
      area: StorageAreaName;
      key: string;
      value: unknown;
    };

type BridgeResponse =
  | {
      __biliPin: 1;
      kind: 'storage:response';
      requestId: string;
      ok: true;
      found?: boolean;
      value?: unknown;
    }
  | {
      __biliPin: 1;
      kind: 'storage:response';
      requestId: string;
      ok: false;
      error: string;
    }
  | {
      __biliPin: 1;
      kind: 'storage:changed';
      area: StorageAreaName;
      key: string;
    };

function isRequest(data: unknown): data is BridgeRequest {
  if (!data || typeof data !== 'object') return false;
  const d = data as any;
  return d.__biliPin === 1 && (d.kind === 'storage:get' || d.kind === 'storage:set') && typeof d.requestId === 'string';
}


const ALLOWED_KEYS = [
  'biliPin.pins.v1',
  'biliPin.pins.state.v2',
  'biliPin.ui.pinBarExpanded.v1',
  'biliPin.ui.pinBarExpanded.state.v2',
  'biliPin.syncMeta.v1',
  'biliPin.syncMigration.v1',
];

function isAllowedKey(key: string): boolean {
  // 必须是 biliPin. 开头，防止污染其他数据
  return key.startsWith('biliPin.') && ALLOWED_KEYS.includes(key);
}

async function chromeStorageGet<T>(area: StorageAreaName, key: string): Promise<{ found: boolean; value?: T }> {
  if (!isAllowedKey(key)) {
    throw new Error(`Access denied: key "${key}" is not allowed`);
  }
  const chromeStorage = (globalThis as any).chrome?.storage?.[area];
  if (!chromeStorage?.get) throw new Error(`chrome.storage.${area} not available`);
  return await new Promise<{ found: boolean; value?: T }>((resolve, reject) => {
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

async function chromeStorageSet<T>(area: StorageAreaName, key: string, value: T): Promise<void> {
  if (!isAllowedKey(key)) {
    throw new Error(`Access denied: key "${key}" is not allowed`);
  }
  const chromeStorage = (globalThis as any).chrome?.storage?.[area];
  if (!chromeStorage?.set) throw new Error(`chrome.storage.${area} not available`);
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
}

export default defineContentScript({
  matches: ['https://t.bilibili.com/*', 'https://space.bilibili.com/*', 'https://www.bilibili.com/video/*'],
  runAt: 'document_start',
  world: 'ISOLATED',
  main() {
    if ((globalThis as any).__biliPinStorageBridgeInstalled) return;
    (globalThis as any).__biliPinStorageBridgeInstalled = 1;

    const chromeStorage = (globalThis as any).chrome?.storage;
    chromeStorage?.onChanged?.addListener((changes: Record<string, unknown>, areaName: string) => {
      if (areaName !== 'local' && areaName !== 'sync') return;

      for (const key of Object.keys(changes || {})) {
        if (!isAllowedKey(key)) continue;
        window.postMessage(
          {
            __biliPin: 1,
            kind: 'storage:changed',
            area: areaName,
            key,
          } satisfies BridgeResponse,
          '*',
        );
      }
    });

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!isRequest(data)) return;

      const respond = (resp: BridgeResponse) => {
        window.postMessage(resp, '*');
      };

      if (data.kind === 'storage:get') {
        chromeStorageGet(data.area, data.key)
          .then((result) =>
            respond({
              __biliPin: 1,
              kind: 'storage:response',
              requestId: data.requestId,
              ok: true,
              found: result.found,
              value: result.value,
            }),
          )
          .catch((err: any) =>
            respond({
              __biliPin: 1,
              kind: 'storage:response',
              requestId: data.requestId,
              ok: false,
              error: String(err?.message || err),
            }),
          );
        return;
      }

      if (data.kind === 'storage:set') {
        chromeStorageSet(data.area, data.key, data.value)
          .then(() => respond({ __biliPin: 1, kind: 'storage:response', requestId: data.requestId, ok: true }))
          .catch((err: any) =>
            respond({
              __biliPin: 1,
              kind: 'storage:response',
              requestId: data.requestId,
              ok: false,
              error: String(err?.message || err),
            }),
          );
      }
    });
  },
});
