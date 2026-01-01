import { makeFaceKey, normalizeUid } from '../bili/faceKey';

export type PinnedUp = {
  uid: string;
  name?: string;
  face?: string;
  pinnedAt: number;
};

const STORAGE_KEY = 'biliPin.pins.v1';

function normalizeItem(item: PinnedUp): PinnedUp | null {
  const face = String(item.face ?? '').trim() || undefined;

  // 尽量把历史 numeric uid 迁移到 faceKey（因为动态页关注UP推荐列表不一定暴露真实uid）
  const faceKey = makeFaceKey(face);
  const baseUid = String(item.uid ?? '').trim();
  const uid = normalizeUid(faceKey ?? baseUid, face);

  if (!uid) return null;
  return {
    uid,
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
  const target = normalizeUid(String(uid ?? ''), undefined);
  return list.some((x) => x.uid === target);
}

export async function pinUp(input: Omit<PinnedUp, 'pinnedAt'> & { pinnedAt?: number }): Promise<PinnedUp[]> {
  const face = String(input.face ?? '').trim() || undefined;
  const uid = normalizeUid(String(input.uid ?? ''), face) || makeFaceKey(face) || String(input.uid ?? '').trim();
  if (!uid) return await getPinnedUps();

  const list = await getPinnedUps();
  const existing = list.find((x) => x.uid === uid);
  const next: PinnedUp = {
    uid,
    name: input.name ?? existing?.name,
    face: face ?? existing?.face,
    pinnedAt: input.pinnedAt ?? existing?.pinnedAt ?? Date.now(),
  };

  const merged = [next, ...list.filter((x) => x.uid !== uid)];
  await setPinnedUps(merged);
  return await getPinnedUps();
}

export async function unpinUp(uid: string): Promise<PinnedUp[]> {
  const target = normalizeUid(String(uid ?? ''), undefined);
  const list = await getPinnedUps();

  // 兼容：如果 target 是 faceKey，则同时清掉历史遗留的同一 face 的不同 uid 记录
  let next = list.filter((x) => x.uid !== target);
  if (target.startsWith('face:')) {
    const hash = target.slice('face:'.length);
    next = next.filter((x) => makeFaceKey(x.face) !== `face:${hash}`);
  }

  await setPinnedUps(next);
  return next;
}


