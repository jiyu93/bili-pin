// Storage Bridge 客户端通信逻辑
// 负责在 MAIN world 中与 ISOLATED world 的 bridge 进行通信

export type BridgeRequest =
  | { __biliPin: 1; kind: 'storage:get'; requestId: string; key: string; fallback: unknown }
  | { __biliPin: 1; kind: 'storage:set'; requestId: string; key: string; value: unknown };

export type BridgeResponse =
  | { __biliPin: 1; kind: 'storage:response'; requestId: string; ok: true; value?: unknown }
  | { __biliPin: 1; kind: 'storage:response'; requestId: string; ok: false; error: string };

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
        resolve((data as any).value as T);
      } else {
        reject(new Error(String((data as any).error || 'storage bridge error')));
      }
    };

    window.addEventListener('message', onMessage);
    window.postMessage(req, '*');
  });
}

export async function bridgeStorageGet<T>(key: string, fallback: T): Promise<T> {
  // 启动竞态：bridge 可能稍后才安装，因此做少量重试
  const requestId = randomId();
  const req: BridgeRequest = { __biliPin: 1, kind: 'storage:get', requestId, key, fallback };

  let lastErr: unknown = null;
  for (let i = 0; i < 3; i++) {
    try {
      return await requestViaBridge<T>(req, 600);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 50 + i * 80));
    }
  }
  throw lastErr ?? new Error('storage bridge get failed');
}

export async function bridgeStorageSet<T>(key: string, value: T): Promise<void> {
  const requestId = randomId();
  const req: BridgeRequest = { __biliPin: 1, kind: 'storage:set', requestId, key, value };

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

