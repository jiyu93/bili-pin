// 注意：本项目的“UP 唯一标识”使用 B 站 mid（数字字符串）

export type PinnedUp = {
  uid: string;
  name?: string;
  face?: string;
  pinnedAt: number;
};

const STORAGE_KEY = 'biliPin.pins.v1';

function normalizeItem(item: PinnedUp): PinnedUp | null {
  const face = String(item.face ?? '').trim() || undefined;
  const baseUid = String(item.uid ?? '').trim();

  // 仅接受 mid（B 站用户 id，数字字符串）。
  // 这样可以保证后续 feed 切换（host_mid）链路稳定可用。
  if (!/^\d+$/.test(baseUid)) return null;

  // 这是真实的数字mid，直接使用
  return {
    uid: baseUid,
    name: item.name,
    face,
    pinnedAt: Number(item.pinnedAt ?? 0) || Date.now(),
  };
}

function uniqByUid(list: PinnedUp[]): PinnedUp[] {
  const map = new Map<string, PinnedUp>();
  for (const item of list) {
    const uid = String(item.uid ?? '').trim();
    if (!uid) continue;
    map.set(uid, { ...item, uid });
  }
  return Array.from(map.values());
}

function sortPinned(list: PinnedUp[]): PinnedUp[] {
  return [...list].sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));
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

  // 兜底：开发/测试环境（不在扩展上下文时）用 localStorage
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

  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export async function getPinnedUps(): Promise<PinnedUp[]> {
  const list = await storageGet<PinnedUp[]>(STORAGE_KEY, []);
  const raw = Array.isArray(list) ? list : [];
  const normalized = raw.map((x) => normalizeItem(x)).filter(Boolean) as PinnedUp[];
  const next = sortPinned(uniqByUid(normalized));

  // 如果发生了迁移/去重，写回一次，清理“脏数据”
  const beforeKey = JSON.stringify(
    raw.map((x) => [String(x.uid ?? '').trim(), String(x.face ?? '').trim()]),
  );
  const afterKey = JSON.stringify(next.map((x) => [x.uid, String(x.face ?? '').trim()]));
  if (beforeKey !== afterKey) {
    await storageSet(STORAGE_KEY, next);
  }

  return next;
}

export async function setPinnedUps(list: PinnedUp[]): Promise<void> {
  const raw = Array.isArray(list) ? list : [];
  const normalized = raw.map((x) => normalizeItem(x)).filter(Boolean) as PinnedUp[];
  await storageSet(STORAGE_KEY, sortPinned(uniqByUid(normalized)));
}

export async function isPinned(uid: string): Promise<boolean> {
  const list = await getPinnedUps();
  const target = String(uid ?? '').trim();
  return /^\d+$/.test(target) && list.some((x) => x.uid === target);
}

export async function pinUp(input: Omit<PinnedUp, 'pinnedAt'> & { pinnedAt?: number }): Promise<PinnedUp[]> {
  const face = String(input.face ?? '').trim() || undefined;
  const inputUid = String(input.uid ?? '').trim();
  
  // 只接受 mid（数字字符串）
  if (!/^\d+$/.test(inputUid)) {
    console.warn('[bili-pin] cannot pin UP without real mid', { uid: inputUid, name: input.name });
    throw new Error(`无法置顶：未获取到真实的UP ID。请确保该UP在推荐列表中，或等待页面加载完成后再试。`);
  }

  const list = await getPinnedUps();
  const existing = list.find((x) => x.uid === inputUid);
  const next: PinnedUp = {
    uid: inputUid,
    name: input.name ?? existing?.name,
    face: face ?? existing?.face,
    pinnedAt: input.pinnedAt ?? existing?.pinnedAt ?? Date.now(),
  };

  const merged = [next, ...list.filter((x) => x.uid !== inputUid)];
  await setPinnedUps(merged);
  return await getPinnedUps();
}

/**
 * 更新UP的mid（用于迁移旧数据）
 * 注意：现在只接受真实的数字mid，此函数主要用于数据迁移
 */
export async function updateUpMid(oldUid: string, newMid: string): Promise<PinnedUp[]> {
  if (!/^\d+$/.test(newMid)) {
    console.warn('[bili-pin] invalid newMid', { newMid });
    return await getPinnedUps();
  }

  const list = await getPinnedUps();
  
  // 查找匹配的UP（通过旧的uid）
  const index = list.findIndex((x) => x.uid === oldUid);
  
  if (index >= 0) {
    // 更新为新的mid
    const existing = list[index];
    const updated: PinnedUp = {
      ...existing,
      uid: newMid,
    };
    
    // 移除旧的，添加新的
    const updatedList = [...list];
    updatedList[index] = updated;
    await setPinnedUps(updatedList);
    
    console.debug('[bili-pin] updated UP mid', { 
      oldUid, 
      newMid,
      name: existing.name 
    });
  }
  
  return await getPinnedUps();
}

export async function unpinUp(uid: string): Promise<PinnedUp[]> {
  const target = String(uid ?? '').trim();
  
  // 只处理真实的数字mid
  if (!/^\d+$/.test(target)) {
    console.warn('[bili-pin] cannot unpin: invalid mid', { uid: target });
    return await getPinnedUps();
  }

  const list = await getPinnedUps();
  const next = list.filter((x) => x.uid !== target);

  await setPinnedUps(next);
  return next;
}


