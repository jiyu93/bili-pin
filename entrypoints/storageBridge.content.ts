/**
 * storage bridge（ISOLATED world）
 *
 * 目的：让 MAIN world 代码也能稳定读写 `chrome.storage.local`（跨子域共享），避免退回页面 localStorage。
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

async function chromeStorageGet<T>(key: string, fallback: T): Promise<T> {
  const chromeStorage = (globalThis as any).chrome?.storage?.local;
  if (!chromeStorage?.get) throw new Error('chrome.storage.local not available');
  return await new Promise<T>((resolve) => {
    chromeStorage.get({ [key]: fallback }, (result: Record<string, unknown>) => {
      resolve((result?.[key] as T) ?? fallback);
    });
  });
}

async function chromeStorageSet<T>(key: string, value: T): Promise<void> {
  const chromeStorage = (globalThis as any).chrome?.storage?.local;
  if (!chromeStorage?.set) throw new Error('chrome.storage.local not available');
  await new Promise<void>((resolve) => {
    chromeStorage.set({ [key]: value }, () => resolve());
  });
}

export default defineContentScript({
  matches: ['https://t.bilibili.com/*', 'https://space.bilibili.com/*', 'https://www.bilibili.com/*'],
  runAt: 'document_start',
  world: 'ISOLATED',
  main() {
    if ((globalThis as any).__biliPinStorageBridgeInstalled) return;
    (globalThis as any).__biliPinStorageBridgeInstalled = 1;

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


