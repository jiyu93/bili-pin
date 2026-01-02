// 注意：本项目的“UP 唯一标识”使用 B 站 mid（数字字符串）

export type PinnedUp = {
  mid: string;
  name?: string;
  face?: string;
  pinnedAt: number;
};

const STORAGE_KEY = 'biliPin.pins.v1';

function normalizeItem(item: any): PinnedUp | null {
  const face = String(item.face ?? '').trim() || undefined;
  // 兼容读取：历史字段可能叫 uid；新字段为 mid
  const baseMid = String(item.mid ?? item.uid ?? '').trim();

  // 仅接受 mid（B 站用户 id，数字字符串）。
  // 这样可以保证后续 feed 切换（host_mid）链路稳定可用。
  if (!/^\d+$/.test(baseMid)) return null;

  // 这是真实的数字mid，直接使用
  return {
    mid: baseMid,
    name: item.name,
    face,
    pinnedAt: Number(item.pinnedAt ?? 0) || Date.now(),
  };
}

function uniqByUid(list: PinnedUp[]): PinnedUp[] {
  const map = new Map<string, PinnedUp>();
  for (const item of list) {
    const mid = String(item.mid ?? '').trim();
    if (!mid) continue;
    map.set(mid, { ...item, mid });
  }
  return Array.from(map.values());
}

async function storageGet<T>(key: string, fallback: T): Promise<T> {
  const chromeStorage = (globalThis as any).chrome?.storage?.local;
  if (chromeStorage?.get) {
    return await new Promise<T>((resolve) => {
      chromeStorage.get({ [key]: fallback }, (result: Record<string, unknown>) => {
        resolve((result?.[key] as T) ?? fallback);
      });
    });
  }

  // 次优：通过 storage bridge（ISOLATED world）访问 chrome.storage.local
  // 说明：MAIN world 无法直接访问扩展 API，但可以通过 window.postMessage 与 ISOLATED content script 通信。
  try {
    const value = await bridgeStorageGet<T>(key, fallback);
    return value;
  } catch {
    // ignore，继续走 localStorage 兜底
  }

  // 兜底：开发/测试环境（不在扩展上下文时）用 localStorage（注意：不同子域不共享）
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function storageSet<T>(key: string, value: T): Promise<void> {
  const chromeStorage = (globalThis as any).chrome?.storage?.local;
  if (chromeStorage?.set) {
    await new Promise<void>((resolve) => {
      chromeStorage.set({ [key]: value }, () => resolve());
    });
    return;
  }

  // 次优：通过 storage bridge（ISOLATED world）访问 chrome.storage.local
  try {
    await bridgeStorageSet<T>(key, value);
    return;
  } catch {
    // ignore，继续走 localStorage 兜底
  }

  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

type BridgeRequest =
  | { __biliPin: 1; kind: 'storage:get'; requestId: string; key: string; fallback: unknown }
  | { __biliPin: 1; kind: 'storage:set'; requestId: string; key: string; value: unknown };

type BridgeResponse =
  | { __biliPin: 1; kind: 'storage:response'; requestId: string; ok: true; value?: unknown }
  | { __biliPin: 1; kind: 'storage:response'; requestId: string; ok: false; error: string };

function randomId(): string {
  // 足够用：只需在同一页面生命周期内避免冲突
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

async function bridgeStorageGet<T>(key: string, fallback: T): Promise<T> {
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

async function bridgeStorageSet<T>(key: string, value: T): Promise<void> {
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

export async function getPinnedUps(): Promise<PinnedUp[]> {
  const list = await storageGet<any[]>(STORAGE_KEY, []);
  const raw = Array.isArray(list) ? list : [];
  const normalized = raw.map((x) => normalizeItem(x)).filter(Boolean) as PinnedUp[];
  const next = uniqByUid(normalized);

  // 如果发生了迁移/去重，写回一次，清理“脏数据”
  const beforeKey = JSON.stringify(
    raw.map((x) => [String(x.mid ?? x.uid ?? '').trim(), String(x.face ?? '').trim()]),
  );
  const afterKey = JSON.stringify(next.map((x) => [x.mid, String(x.face ?? '').trim()]));
  if (beforeKey !== afterKey) {
    await storageSet(STORAGE_KEY, next);
  }

  return next;
}

// 事件监听
type PinsChangeListener = (pins: PinnedUp[]) => void;
const listeners = new Set<PinsChangeListener>();

export function onPinsChange(callback: PinsChangeListener): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notifyListeners(pins: PinnedUp[]) {
  for (const cb of listeners) {
    try {
      cb(pins);
    } catch (e) {
      console.error('[bili-pin] error in pins listener', e);
    }
  }
}

export async function setPinnedUps(list: PinnedUp[]): Promise<void> {
  const raw = Array.isArray(list) ? list : [];
  const normalized = raw.map((x) => normalizeItem(x)).filter(Boolean) as PinnedUp[];
  const next = uniqByUid(normalized);
  await storageSet(STORAGE_KEY, next);
  
  // 通知监听器
  notifyListeners(next);
}

export async function isPinned(mid: string): Promise<boolean> {
  const list = await getPinnedUps();
  const target = String(mid ?? '').trim();
  return /^\d+$/.test(target) && list.some((x) => x.mid === target);
}

export async function pinUp(
  input: Omit<PinnedUp, 'pinnedAt'> & { pinnedAt?: number },
): Promise<PinnedUp[]> {
  const face = String(input.face ?? '').trim() || undefined;
  const inputMid = String((input as any).mid ?? (input as any).uid ?? '').trim();
  
  // 只接受 mid（数字字符串）
  if (!/^\d+$/.test(inputMid)) {
    console.warn('[bili-pin] cannot pin UP without real mid', { mid: inputMid, name: input.name });
    throw new Error(`无法置顶：未获取到真实的UP ID。请确保该UP在推荐列表中，或等待页面加载完成后再试。`);
  }

  const list = await getPinnedUps();
  const existing = list.find((x) => x.mid === inputMid);
  const next: PinnedUp = {
    mid: inputMid,
    name: input.name ?? existing?.name,
    face: face ?? existing?.face,
    pinnedAt: input.pinnedAt ?? existing?.pinnedAt ?? Date.now(),
  };

  const merged = [next, ...list.filter((x) => x.mid !== inputMid)];
  await setPinnedUps(merged);
  return await getPinnedUps();
}

/**
 * 更新UP的mid（用于迁移旧数据）
 * 注意：现在只接受真实的数字mid，此函数主要用于数据迁移
 */
export async function updateUpMid(oldMid: string, newMid: string): Promise<PinnedUp[]> {
  if (!/^\d+$/.test(newMid)) {
    console.warn('[bili-pin] invalid newMid', { newMid });
    return await getPinnedUps();
  }

  const list = await getPinnedUps();
  
  // 查找匹配的UP（通过旧的uid）
  const index = list.findIndex((x) => x.mid === oldMid);
  
  if (index >= 0) {
    // 更新为新的mid
    const existing = list[index];
    const updated: PinnedUp = {
      ...existing,
      mid: newMid,
    };
    
    // 移除旧的，添加新的
    const updatedList = [...list];
    updatedList[index] = updated;
    await setPinnedUps(updatedList);
    
    console.debug('[bili-pin] updated UP mid', { 
      oldMid, 
      newMid,
      name: existing.name 
    });
  }
  
  return await getPinnedUps();
}

export async function unpinUp(mid: string): Promise<PinnedUp[]> {
  const target = String(mid ?? '').trim();
  
  // 只处理真实的数字mid
  if (!/^\d+$/.test(target)) {
    console.warn('[bili-pin] cannot unpin: invalid mid', { mid: target });
    return await getPinnedUps();
  }

  const list = await getPinnedUps();
  const next = list.filter((x) => x.mid !== target);

  await setPinnedUps(next);
  return next;
}


