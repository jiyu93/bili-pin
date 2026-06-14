// 注意：本项目的“UP 唯一标识”使用 B 站 mid（数字字符串）

import { observeStorageChanges, readStorageValue, writeMirroredConfig, writeStorageValue } from './config';
import {
  PINS_KEY as STORAGE_KEY,
  PINS_STATE_COMPACT_KEY as STORAGE_COMPACT_KEY,
  PINS_STATE_KEY as STORAGE_STATE_KEY,
} from './keys';
import { compactFaceUrl, normalizeFaceUrl } from '../utils/faceUrl';

export type PinnedUp = {
  mid: string;
  name?: string;
  face?: string;
  pinnedAt: number;
};

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

type CompactPinnedUp = [mid: string, name?: string, face?: string, pinnedAtDelta?: number];
type CompactRemoved = [mid: string, removedAtDelta: number];
type CompactPinsState = [
  version: 3,
  baseTime: number,
  items: CompactPinnedUp[],
  removed: CompactRemoved[],
  orderUpdatedAtDelta?: number,
  updatedAtDelta?: number,
];

const SYNC_QUOTA_BYTES_PER_ITEM = 8192;

function serializeList(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function normalizeItem(item: any): PinnedUp | null {
  const face = normalizeFaceUrl(item.face);
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

function getJsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value ?? null)).length;
}

function getStorageItemBytes(key: string, value: unknown): number {
  return new TextEncoder().encode(key).length + getJsonBytes(value);
}

function fitsSyncItemQuota(key: string, value: unknown): boolean {
  return getStorageItemBytes(key, value) <= SYNC_QUOTA_BYTES_PER_ITEM;
}

function getCompactBaseTime(state: PinsState): number {
  const timestamps = [
    state.orderUpdatedAt,
    state.updatedAt,
    ...state.items.flatMap((item) => [item.pinnedAt, item.updatedAt]),
    ...Object.values(state.removed),
  ].filter((value) => Number.isFinite(value) && value > 0);
  return timestamps.length ? Math.min(...timestamps) : 0;
}

function toCompactDelta(value: number, baseTime: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  if (!Number.isFinite(baseTime) || baseTime <= 0) return Math.round(value);
  return Math.max(0, Math.round(value - baseTime));
}

function fromCompactDelta(value: unknown, baseTime: number): number {
  const delta = Number(value);
  if (!Number.isFinite(delta) || delta < 0) return 0;
  if (!Number.isFinite(baseTime) || baseTime <= 0) return Math.round(delta);
  return Math.round(baseTime + delta);
}

function getOrderedSyncedItems(state: PinsState): SyncedPinnedUp[] {
  const itemMap = getStateItemMap(state);
  const ordered: SyncedPinnedUp[] = [];

  for (const mid of state.order) {
    const item = itemMap.get(mid);
    if (!item) continue;
    ordered.push(item);
    itemMap.delete(mid);
  }

  const remaining = Array.from(itemMap.values()).sort((a, b) => {
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
    return b.pinnedAt - a.pinnedAt;
  });
  ordered.push(...remaining);
  return ordered;
}

function compactPinsState(state: PinsState): CompactPinsState {
  const baseTime = getCompactBaseTime(state);
  const items = getOrderedSyncedItems(state).map((item): CompactPinnedUp => {
    const row: CompactPinnedUp = [item.mid];
    const name = String(item.name ?? '').trim();
    const face = compactFaceUrl(item.face);
    const pinnedAtDelta = toCompactDelta(item.pinnedAt, baseTime);

    if (name || face || pinnedAtDelta != null) row.push(name);
    if (face || pinnedAtDelta != null) row.push(face ?? '');
    if (pinnedAtDelta != null) row.push(pinnedAtDelta);

    return row;
  });
  const removed = Object.entries(state.removed)
    .map(([mid, removedAt]): CompactRemoved | null => {
      const delta = toCompactDelta(removedAt, baseTime);
      return delta == null ? null : [mid, delta];
    })
    .filter(Boolean) as CompactRemoved[];
  const orderUpdatedAtDelta = toCompactDelta(state.orderUpdatedAt, baseTime);
  const updatedAtDelta = toCompactDelta(state.updatedAt, baseTime);

  const compact: CompactPinsState = [3, baseTime, items, removed];
  if (orderUpdatedAtDelta != null || updatedAtDelta != null) compact.push(orderUpdatedAtDelta ?? 0);
  if (updatedAtDelta != null) compact.push(updatedAtDelta);
  return compact;
}

function normalizeCompactPinsState(value: unknown): PinsState {
  if (!Array.isArray(value) || value[0] !== 3) {
    return buildPinsStateFromList([]);
  }

  const baseTime = Number(value[1]) || 0;
  const rawItems = Array.isArray(value[2]) ? value[2] : [];
  const rawRemoved = Array.isArray(value[3]) ? value[3] : [];
  const orderUpdatedAt = fromCompactDelta(value[4], baseTime);
  const updatedAtFromState = fromCompactDelta(value[5], baseTime);

  const items: SyncedPinnedUp[] = [];
  for (const rawItem of rawItems) {
    if (!Array.isArray(rawItem)) continue;
    const mid = String(rawItem[0] ?? '').trim();
    if (!/^\d+$/.test(mid)) continue;

    const pinnedAt = fromCompactDelta(rawItem[3], baseTime) || updatedAtFromState || baseTime || Date.now();
    const updatedAt = Math.max(pinnedAt, updatedAtFromState || 0);
    items.push({
      mid,
      name: String(rawItem[1] ?? '').trim() || undefined,
      face: normalizeFaceUrl(rawItem[2]),
      pinnedAt,
      updatedAt,
    });
  }

  const removed: Record<string, number> = {};
  for (const rawEntry of rawRemoved) {
    if (!Array.isArray(rawEntry)) continue;
    const mid = String(rawEntry[0] ?? '').trim();
    const removedAt = fromCompactDelta(rawEntry[1], baseTime);
    if (!/^\d+$/.test(mid) || removedAt <= 0) continue;
    removed[mid] = removedAt;
  }

  const uniqItems = uniqByUid(items).map((item) => ({
    ...item,
    updatedAt: Number((item as any).updatedAt ?? item.pinnedAt ?? 0) || item.pinnedAt || Date.now(),
  }));
  const order = uniqItems.map((item) => item.mid);
  const updatedAt =
    updatedAtFromState ||
    Math.max(orderUpdatedAt, ...uniqItems.map((item) => item.updatedAt), ...Object.values(removed), 0);

  return {
    version: 2,
    items: uniqItems,
    removed,
    order,
    orderUpdatedAt,
    updatedAt,
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

function serializeCompactPinsState(state: PinsState): string {
  return JSON.stringify(compactPinsState(state));
}

function mergePinsStates(states: PinsState[]): PinsState {
  const candidates = states
    .filter((state) => hasPinsStateData(state))
    .slice()
    .sort((a, b) => a.updatedAt - b.updatedAt);
  if (!candidates.length) return buildPinsStateFromList([]);

  const itemMap = new Map<string, SyncedPinnedUp>();
  const removed: Record<string, number> = {};
  let order: string[] = [];
  let orderUpdatedAt = 0;
  let updatedAt = 0;

  for (const state of candidates) {
    updatedAt = Math.max(updatedAt, state.updatedAt, state.orderUpdatedAt);

    for (const [mid, removedAt] of Object.entries(state.removed)) {
      if (!/^\d+$/.test(mid) || removedAt <= 0) continue;
      const existing = itemMap.get(mid);
      if (!existing || removedAt > existing.updatedAt) {
        itemMap.delete(mid);
        removed[mid] = Math.max(removed[mid] ?? 0, removedAt);
        updatedAt = Math.max(updatedAt, removedAt);
      }
    }

    for (const item of state.items) {
      const removedAt = removed[item.mid] ?? 0;
      if (removedAt > item.updatedAt) continue;

      const existing = itemMap.get(item.mid);
      if (!existing || item.updatedAt >= existing.updatedAt) {
        itemMap.set(item.mid, item);
        if (item.updatedAt > removedAt) delete removed[item.mid];
        updatedAt = Math.max(updatedAt, item.updatedAt, item.pinnedAt);
      }
    }

    if (state.orderUpdatedAt >= orderUpdatedAt && state.order.length > 0) {
      order = state.order.slice();
      orderUpdatedAt = state.orderUpdatedAt;
    }
  }

  const itemMidSet = new Set(itemMap.keys());
  const finalOrder = order.filter((mid, index, arr) => itemMidSet.has(mid) && arr.indexOf(mid) === index);
  const orderedSet = new Set(finalOrder);
  const remaining = Array.from(itemMap.values())
    .filter((item) => !orderedSet.has(item.mid))
    .sort((a, b) => {
      if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
      return b.pinnedAt - a.pinnedAt;
    });
  finalOrder.push(...remaining.map((item) => item.mid));

  return {
    version: 2,
    items: Array.from(itemMap.values()),
    removed,
    order: finalOrder,
    orderUpdatedAt,
    updatedAt,
  };
}

async function writeLegacyPinsSnapshot(state: PinsState): Promise<void> {
  const list = derivePinnedUpsFromState(state);
  const writes: Promise<void>[] = [
    writeStorageValue('local', STORAGE_STATE_KEY, state),
    writeStorageValue('local', STORAGE_KEY, list),
  ];

  if (fitsSyncItemQuota(STORAGE_STATE_KEY, state)) {
    writes.push(writeStorageValue('sync', STORAGE_STATE_KEY, state));
  }

  if (fitsSyncItemQuota(STORAGE_KEY, list)) {
    writes.push(writeStorageValue('sync', STORAGE_KEY, list));
  }

  const results = await Promise.allSettled(writes);
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('[bili-pin] failed to write legacy pins snapshot', result.reason);
    }
  }
}

async function writePinsSnapshot(state: PinsState, options: { notifySyncError?: boolean } = {}): Promise<void> {
  await writeMirroredConfig(STORAGE_COMPACT_KEY, compactPinsState(state), {
    notifySyncError: options.notifySyncError,
  });
  await writeLegacyPinsSnapshot(state);
}

function hasPinsStateData(state: PinsState): boolean {
  return state.items.length > 0 || Object.keys(state.removed).length > 0 || state.order.length > 0;
}

async function getAuthoritativePinsState(): Promise<PinsState> {
  const [syncCompactEntry, localCompactEntry, syncStateEntry, localStateEntry, syncLegacyEntry, localLegacyEntry] = await Promise.all([
    readStorageValue<CompactPinsState>('sync', STORAGE_COMPACT_KEY),
    readStorageValue<CompactPinsState>('local', STORAGE_COMPACT_KEY),
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
  const syncCompactState = syncCompactEntry.found ? normalizeCompactPinsState(syncCompactEntry.value) : buildPinsStateFromList([]);
  const localCompactState = localCompactEntry.found ? normalizeCompactPinsState(localCompactEntry.value) : buildPinsStateFromList([]);
  const syncListState = buildPinsStateFromList(normalizeList(syncLegacyEntry.value));
  const localListState = buildPinsStateFromList(normalizeList(localLegacyEntry.value));
  const authoritative = mergePinsStates([
    syncState,
    localState,
    syncListState,
    localListState,
    syncCompactState,
    localCompactState,
  ]);
  const authoritativeList = derivePinnedUpsFromState(authoritative);
  const authoritativeCompact = compactPinsState(authoritative);

  const syncRawList = normalizeList(syncLegacyEntry.value);
  const localRawList = normalizeList(localLegacyEntry.value);
  const syncCompactChanged = serializeCompactPinsState(syncCompactState) !== JSON.stringify(authoritativeCompact);
  const localCompactChanged = serializeCompactPinsState(localCompactState) !== JSON.stringify(authoritativeCompact);
  const syncRawChanged = serializeList(syncRawList) !== serializeList(authoritativeList);
  const localRawChanged = serializeList(localRawList) !== serializeList(authoritativeList);
  const compactFitsSync = fitsSyncItemQuota(STORAGE_COMPACT_KEY, authoritativeCompact);
  const legacyFitsSync = fitsSyncItemQuota(STORAGE_KEY, authoritativeList) || fitsSyncItemQuota(STORAGE_STATE_KEY, authoritative);

  if (hasPinsStateData(authoritative) && (localCompactChanged || (syncCompactChanged && compactFitsSync))) {
    await writePinsSnapshot(authoritative, { notifySyncError: false });
  }

  if (hasPinsStateData(authoritative) && (localRawChanged || (syncRawChanged && legacyFitsSync))) {
    await writeLegacyPinsSnapshot(authoritative);
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
  stopStorageObserver = observeStorageChanges([STORAGE_KEY, STORAGE_STATE_KEY, STORAGE_COMPACT_KEY], () => {
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

  await writePinsSnapshot(nextState, { notifySyncError: true });

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
  const face = normalizeFaceUrl(input.face);
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
