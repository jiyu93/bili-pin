export type PinnedUp = {
  uid: string;
  name?: string;
  face?: string;
  pinnedAt: number;
};

const STORAGE_KEY = 'biliPin.pins.v1';

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
  const chromeStorage = globalThis.chrome?.storage?.local;
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
  const chromeStorage = globalThis.chrome?.storage?.local;
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
  return sortPinned(uniqByUid(Array.isArray(list) ? list : []));
}

export async function setPinnedUps(list: PinnedUp[]): Promise<void> {
  await storageSet(STORAGE_KEY, sortPinned(uniqByUid(Array.isArray(list) ? list : [])));
}

export async function isPinned(uid: string): Promise<boolean> {
  const list = await getPinnedUps();
  const target = String(uid ?? '').trim();
  return list.some((x) => x.uid === target);
}

export async function pinUp(input: Omit<PinnedUp, 'pinnedAt'> & { pinnedAt?: number }): Promise<PinnedUp[]> {
  const uid = String(input.uid ?? '').trim();
  if (!uid) return await getPinnedUps();

  const list = await getPinnedUps();
  const existing = list.find((x) => x.uid === uid);
  const next: PinnedUp = {
    uid,
    name: input.name ?? existing?.name,
    face: input.face ?? existing?.face,
    pinnedAt: input.pinnedAt ?? existing?.pinnedAt ?? Date.now(),
  };

  const merged = [next, ...list.filter((x) => x.uid !== uid)];
  await setPinnedUps(merged);
  return await getPinnedUps();
}

export async function unpinUp(uid: string): Promise<PinnedUp[]> {
  const target = String(uid ?? '').trim();
  const list = await getPinnedUps();
  const next = list.filter((x) => x.uid !== target);
  await setPinnedUps(next);
  return next;
}


