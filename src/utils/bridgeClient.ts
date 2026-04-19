// Storage Bridge 客户端通信逻辑
// 负责在 MAIN world 中与 ISOLATED world 的 bridge 进行通信

export type BridgeRequest =
  | { __biliPin: 1; kind: 'storage:get'; requestId: string; area: StorageAreaName; key: string }
  | { __biliPin: 1; kind: 'storage:set'; requestId: string; area: StorageAreaName; key: string; value: unknown };

export type BridgeResponse =
  | { __biliPin: 1; kind: 'storage:response'; requestId: string; ok: true; found?: boolean; value?: unknown }
  | { __biliPin: 1; kind: 'storage:response'; requestId: string; ok: false; error: string }
  | { __biliPin: 1; kind: 'storage:changed'; area: StorageAreaName; key: string };

export type StorageAreaName = 'local' | 'sync';

export type StorageReadResult<T> =
  | {
      found: true;
      value: T;
    }
  | {
      found: false;
      value?: undefined;
    };

function randomId(): string {
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function requestViaBridge<T>(req: BridgeRequest, timeoutMs = 500): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const timer = window.setTimeout(() => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      reject(new Error('storage bridge timeout'));
    }, timeoutMs);

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as BridgeResponse;
      if (!data || typeof data !== 'object') return;
      if ((data as any).__biliPin !== 1) return;
      if ((data as any).kind !== 'storage:response') return;
      if ((data as any).requestId !== req.requestId) return;
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      if ((data as any).ok) {
        if (req.kind === 'storage:get') {
          resolve({
            found: Boolean((data as any).found),
            value: (data as any).value,
          } as T);
          return;
        }

        resolve((data as any).value as T);
      } else {
        reject(new Error(String((data as any).error || 'storage bridge error')));
      }
    };

    window.addEventListener('message', onMessage);
    window.postMessage(req, '*');
  });
}

export async function bridgeStorageGet<T>(
  area: StorageAreaName,
  key: string,
): Promise<StorageReadResult<T>> {
  // 启动竞态：bridge 可能稍后才安装，因此做少量重试
  const requestId = randomId();
  const req: BridgeRequest = { __biliPin: 1, kind: 'storage:get', requestId, area, key };

  let lastErr: unknown = null;
  for (let i = 0; i < 3; i++) {
    try {
      return await requestViaBridge<StorageReadResult<T>>(req, 600);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 50 + i * 80));
    }
  }
  throw lastErr ?? new Error('storage bridge get failed');
}

export async function bridgeStorageSet<T>(
  area: StorageAreaName,
  key: string,
  value: T,
): Promise<void> {
  const requestId = randomId();
  const req: BridgeRequest = { __biliPin: 1, kind: 'storage:set', requestId, area, key, value };

  let lastErr: unknown = null;
  for (let i = 0; i < 3; i++) {
    try {
      await requestViaBridge<void>(req, 600);
      return;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 50 + i * 80));
    }
  }
  throw lastErr ?? new Error('storage bridge set failed');
}

export function bridgeListenStorageChanges(
  callback: (change: { area: StorageAreaName; key: string }) => void,
): () => void {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as BridgeResponse;
    if (!data || typeof data !== 'object') return;
    if ((data as any).__biliPin !== 1) return;
    if ((data as any).kind !== 'storage:changed') return;
    const area = (data as any).area;
    const key = String((data as any).key ?? '');
    if ((area !== 'local' && area !== 'sync') || !key) return;
    callback({ area, key });
  };

  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}
