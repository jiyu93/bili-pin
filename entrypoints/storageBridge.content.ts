/**
 * storage bridge（ISOLATED world）
 *
 * 目的：让 MAIN world 代码也能稳定读写 chrome.storage（跨子域共享），避免退回页面 localStorage。
 * 策略：优先读写 chrome.storage.sync（支持同一 Google 账号跨设备同步），local 作为离线缓存兜底。
 */

type BridgeRequest =
  | {
      __biliPin: 1;
      kind: 'storage:get';
      requestId: string;
      key: string;
      fallback: unknown;
    }
  | {
      __biliPin: 1;
      kind: 'storage:set';
      requestId: string;
      key: string;
      value: unknown;
    };

type BridgeResponse =
  | {
      __biliPin: 1;
      kind: 'storage:response';
      requestId: string;
      ok: true;
      value?: unknown;
    }
  | {
      __biliPin: 1;
      kind: 'storage:response';
      requestId: string;
      ok: false;
      error: string;
    };

function isRequest(data: unknown): data is BridgeRequest {
  if (!data || typeof data !== 'object') return false;
  const d = data as any;
  return d.__biliPin === 1 && (d.kind === 'storage:get' || d.kind === 'storage:set') && typeof d.requestId === 'string';
}


const ALLOWED_KEYS = [
  'biliPin.pins.v1',
  'biliPin.ui.pinBarExpanded.v1'
];

function isAllowedKey(key: string): boolean {
  // 必须是 biliPin. 开头，防止污染其他数据
  return key.startsWith('biliPin.') && ALLOWED_KEYS.includes(key);
}

async function chromeStorageGet<T>(key: string, fallback: T): Promise<T> {
  if (!isAllowedKey(key)) {
    throw new Error(`Access denied: key "${key}" is not allowed`);
  }
  const local = (globalThis as any).chrome?.storage?.local;
  const sync = (globalThis as any).chrome?.storage?.sync;

  // 优先读 sync
  if (sync?.get) {
    try {
      const result = await new Promise<Record<string, unknown>>((resolve) => {
        sync.get({ [key]: undefined }, resolve);
      });
      const value = result?.[key] as T;
      if (value !== undefined) return value;
    } catch {}
  }

  // sync 无数据，读 local
  if (local?.get) {
    const result = await new Promise<Record<string, unknown>>((resolve) => {
      local.get({ [key]: fallback }, resolve);
    });
    const value = (result?.[key] as T) ?? fallback;
    // 迁移：local 有数据但 sync 为空，自动提升到 sync
    if (value !== fallback && sync?.set) {
      sync.set({ [key]: value }).catch(() => {});
    }
    return value;
  }

  throw new Error('chrome.storage not available');
}

async function chromeStorageSet<T>(key: string, value: T): Promise<void> {
  if (!isAllowedKey(key)) {
    throw new Error(`Access denied: key "${key}" is not allowed`);
  }
  const local = (globalThis as any).chrome?.storage?.local;
  const sync = (globalThis as any).chrome?.storage?.sync;

  // 同时写入 sync 和 local
  if (sync?.set) {
    await new Promise<void>((resolve) => sync.set({ [key]: value }, () => resolve()));
  }
  if (local?.set) {
    await new Promise<void>((resolve) => local.set({ [key]: value }, () => resolve()));
    return;
  }

  throw new Error('chrome.storage not available');
}

export default defineContentScript({
  matches: ['https://t.bilibili.com/*', 'https://space.bilibili.com/*', 'https://www.bilibili.com/video/*'],
  runAt: 'document_start',
  world: 'ISOLATED',
  main() {
    if ((globalThis as any).__biliPinStorageBridgeInstalled) return;
    (globalThis as any).__biliPinStorageBridgeInstalled = 1;

    // 监听 chrome.storage.sync 变更，主动向 MAIN world 广播
    const sync = (globalThis as any).chrome?.storage?.sync;
    if (sync?.onChanged?.addListener) {
      sync.onChanged.addListener((changes: Record<string, any>) => {
        for (const [key, change] of Object.entries(changes)) {
          if (!isAllowedKey(key)) continue;
          window.postMessage(
            {
              __biliPin: 1,
              kind: 'storage:changed',
              key,
              newValue: change?.newValue,
            },
            '*',
          );
        }
      });
    }

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!isRequest(data)) return;

      const respond = (resp: BridgeResponse) => {
        window.postMessage(resp, '*');
      };

      if (data.kind === 'storage:get') {
        chromeStorageGet(data.key, data.fallback)
          .then((value) => respond({ __biliPin: 1, kind: 'storage:response', requestId: data.requestId, ok: true, value }))
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
        chromeStorageSet(data.key, data.value)
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


