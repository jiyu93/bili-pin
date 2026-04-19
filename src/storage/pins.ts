// 注意：本项目的“UP 唯一标识”使用 B 站 mid（数字字符串）

import { observeStorageChanges, readStorageValue, writeMirroredConfig, writeStorageValue } from './config';

export type PinnedUp = {
  mid: string;
  name?: string;
  face?: string;
  pinnedAt: number;
};

const STORAGE_KEY = 'biliPin.pins.v1';
const STORAGE_STATE_KEY = 'biliPin.pins.state.v2';

type SyncedPinnedUp = PinnedUp & {
  updatedAt: number;
};

type PinsState = {
  version: 2;
  items: SyncedPinnedUp[];
  removed: Record<string, number>;
  order: string[];
  orderUpdatedAt: number;
  updatedAt: number;
};

function serializeList(value: unknown): string {
  return JSON.stringify(value ?? null);
}

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

function normalizeList(value: unknown): PinnedUp[] {
  const raw = Array.isArray(value) ? value : [];
  return uniqByUid(raw.map((x) => normalizeItem(x)).filter(Boolean) as PinnedUp[]);
}

function normalizeSyncedItem(item: unknown): SyncedPinnedUp | null {
  const base = normalizeItem(item);
  if (!base) return null;

  const updatedAt = Number((item as any)?.updatedAt ?? base.pinnedAt ?? 0) || base.pinnedAt || Date.now();
  return {
    ...base,
    updatedAt,
  };
}

function normalizeRemoved(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const next: Record<string, number> = {};
  for (const [mid, ts] of Object.entries(value as Record<string, unknown>)) {
    const targetMid = String(mid ?? '').trim();
    const removedAt = Number(ts);
    if (!/^\d+$/.test(targetMid)) continue;
    if (!Number.isFinite(removedAt) || removedAt <= 0) continue;
    next[targetMid] = removedAt;
  }
  return next;
}

function buildPinsStateFromList(list: PinnedUp[]): PinsState {
  const normalized = uniqByUid(list);
  const items: SyncedPinnedUp[] = normalized.map((item) => ({
    ...item,
    updatedAt: Number(item.pinnedAt) || Date.now(),
  }));
  const latest = Math.max(0, ...items.map((item) => item.updatedAt));
  return {
    version: 2,
    items,
    removed: {},
    order: normalized.map((item) => item.mid),
    orderUpdatedAt: latest,
    updatedAt: latest,
  };
}

function normalizePinsState(value: unknown): PinsState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return buildPinsStateFromList([]);
  }

  const raw = value as Record<string, unknown>;
  const items = Array.isArray(raw.items)
    ? raw.items.map((item) => normalizeSyncedItem(item)).filter(Boolean) as SyncedPinnedUp[]
    : [];
  const uniqItems = uniqByUid(items).map((item) => ({
    ...item,
    updatedAt: Number((item as any).updatedAt ?? item.pinnedAt ?? 0) || item.pinnedAt || Date.now(),
  }));
  const itemMidSet = new Set(uniqItems.map((item) => item.mid));
  const order = Array.isArray(raw.order)
    ? raw.order
        .map((item) => String(item ?? '').trim())
        .filter((mid, index, arr) => /^\d+$/.test(mid) && arr.indexOf(mid) === index && itemMidSet.has(mid))
    : [];
  const removed = normalizeRemoved(raw.removed);
  const orderUpdatedAt = Number(raw.orderUpdatedAt ?? 0) || 0;
  const updatedAt = Number(raw.updatedAt ?? 0) || Math.max(orderUpdatedAt, ...uniqItems.map((item) => item.updatedAt), 0);

  return {
    version: 2,
    items: uniqItems,
    removed,
    order,
    orderUpdatedAt,
    updatedAt,
  };
}

function getStateItemMap(state: PinsState): Map<string, SyncedPinnedUp> {
  return new Map(state.items.map((item) => [item.mid, item] as const));
}

function derivePinnedUpsFromState(state: PinsState): PinnedUp[] {
  const itemMap = getStateItemMap(state);
  const ordered: PinnedUp[] = [];

  for (const mid of state.order) {
    const item = itemMap.get(mid);
    if (!item) continue;
    ordered.push({
      mid: item.mid,
      name: item.name,
      face: item.face,
      pinnedAt: item.pinnedAt,
    });
    itemMap.delete(mid);
  }

  const remaining = Array.from(itemMap.values()).sort((a, b) => {
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
    return b.pinnedAt - a.pinnedAt;
  });
  for (const item of remaining) {
    ordered.push({
      mid: item.mid,
      name: item.name,
      face: item.face,
      pinnedAt: item.pinnedAt,
    });
  }

  return ordered;
}

function serializePinsState(state: PinsState): string {
  return JSON.stringify({
    version: 2,
    items: state.items
      .slice()
      .sort((a, b) => a.mid.localeCompare(b.mid))
      .map((item) => ({
        mid: item.mid,
        name: item.name,
        face: item.face,
        pinnedAt: item.pinnedAt,
        updatedAt: item.updatedAt,
      })),
    removed: Object.fromEntries(Object.entries(state.removed).sort(([a], [b]) => a.localeCompare(b))),
    order: state.order,
    orderUpdatedAt: state.orderUpdatedAt,
    updatedAt: state.updatedAt,
  });
}

async function writePinsSnapshot(state: PinsState): Promise<void> {
  const list = derivePinnedUpsFromState(state);
  await writeMirroredConfig(STORAGE_STATE_KEY, state);
  await writeMirroredConfig(STORAGE_KEY, list);
}

async function writePinsSnapshotToArea(area: 'local' | 'sync', state: PinsState): Promise<void> {
  const list = derivePinnedUpsFromState(state);
  await writeStorageValue(area, STORAGE_STATE_KEY, state);
  await writeStorageValue(area, STORAGE_KEY, list);
}

function hasPinsStateData(state: PinsState): boolean {
  return state.items.length > 0 || Object.keys(state.removed).length > 0 || state.order.length > 0;
}

async function getAuthoritativePinsState(): Promise<PinsState> {
  const [syncStateEntry, localStateEntry, syncLegacyEntry, localLegacyEntry] = await Promise.all([
    readStorageValue<PinsState>('sync', STORAGE_STATE_KEY),
    readStorageValue<PinsState>('local', STORAGE_STATE_KEY),
    readStorageValue<any[]>('sync', STORAGE_KEY),
    readStorageValue<any[]>('local', STORAGE_KEY),
  ]);

  const syncState = syncStateEntry.found
    ? normalizePinsState(syncStateEntry.value)
    : buildPinsStateFromList(normalizeList(syncLegacyEntry.value));
  const localState = localStateEntry.found
    ? normalizePinsState(localStateEntry.value)
    : buildPinsStateFromList(normalizeList(localLegacyEntry.value));

  const syncHasData = hasPinsStateData(syncState);
  const localHasData = hasPinsStateData(localState);
  const authoritative = syncHasData ? syncState : localState;
  const authoritativeList = derivePinnedUpsFromState(authoritative);

  const syncRawList = normalizeList(syncLegacyEntry.value);
  const localRawList = normalizeList(localLegacyEntry.value);
  const syncStateChanged = serializePinsState(syncState) !== serializePinsState(authoritative);
  const localStateChanged = serializePinsState(localState) !== serializePinsState(authoritative);
  const syncRawChanged = serializeList(syncRawList) !== serializeList(authoritativeList);
  const localRawChanged = serializeList(localRawList) !== serializeList(authoritativeList);

  if (!syncHasData && localHasData && (syncStateChanged || syncRawChanged)) {
    await writePinsSnapshotToArea('sync', authoritative);
  }

  if (syncHasData && (localStateChanged || localRawChanged)) {
    await writePinsSnapshotToArea('local', authoritative);
  }

  return authoritative;
}

export async function getPinnedUps(): Promise<PinnedUp[]> {
  const state = await getAuthoritativePinsState();
  return derivePinnedUpsFromState(state);
}

// 事件监听
type PinsChangeListener = (pins: PinnedUp[]) => void;
const listeners = new Set<PinsChangeListener>();
let stopStorageObserver: (() => void) | null = null;
let lastNotifiedSnapshot = '';

export function onPinsChange(callback: PinsChangeListener): () => void {
  ensureStorageObserver();
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
    if (listeners.size === 0 && stopStorageObserver) {
      stopStorageObserver();
      stopStorageObserver = null;
    }
  };
}

function notifyListeners(pins: PinnedUp[]) {
  lastNotifiedSnapshot = serializeList(pins);
  for (const cb of listeners) {
    try {
      cb(pins);
    } catch (e) {
      console.error('[bili-pin] error in pins listener', e);
    }
  }
}

function ensureStorageObserver() {
  if (stopStorageObserver) return;

  let scheduled = false;
  stopStorageObserver = observeStorageChanges([STORAGE_KEY, STORAGE_STATE_KEY], () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(async () => {
      scheduled = false;
      if (listeners.size === 0) return;
      try {
        const pins = await getPinnedUps();
        const snapshot = serializeList(pins);
        if (snapshot === lastNotifiedSnapshot) return;
        notifyListeners(pins);
      } catch (error) {
        console.warn('[bili-pin] failed to refresh pins from storage change', error);
      }
    });
  });
}

export async function setPinnedUps(list: PinnedUp[]): Promise<void> {
  const currentState = await getAuthoritativePinsState();
  const currentItems = getStateItemMap(currentState);
  const nextList = uniqByUid(
    (Array.isArray(list) ? list : []).map((item) => normalizeItem(item)).filter(Boolean) as PinnedUp[],
  );
  const nextMidSet = new Set(nextList.map((item) => item.mid));
  const now = Date.now();
  const nextItems: SyncedPinnedUp[] = [];
  const nextRemoved: Record<string, number> = { ...currentState.removed };

  for (const item of nextList) {
    const existing = currentItems.get(item.mid);
    const changed =
      !existing ||
      existing.name !== item.name ||
      existing.face !== item.face ||
      existing.pinnedAt !== item.pinnedAt;
    nextItems.push({
      mid: item.mid,
      name: item.name,
      face: item.face,
      pinnedAt: item.pinnedAt,
      updatedAt: changed ? now : existing.updatedAt,
    });
    delete nextRemoved[item.mid];
  }

  for (const item of currentItems.values()) {
    if (nextMidSet.has(item.mid)) continue;
    nextRemoved[item.mid] = Math.max(nextRemoved[item.mid] ?? 0, now);
  }

  const nextState: PinsState = {
    version: 2,
    items: nextItems,
    removed: nextRemoved,
    order: nextList.map((item) => item.mid),
    orderUpdatedAt: now,
    updatedAt: now,
  };

  await writePinsSnapshot(nextState);

  // 通知监听器
  notifyListeners(nextList);
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
