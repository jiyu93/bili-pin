// 注意：本项目的“UP 唯一标识”使用 B 站 mid（数字字符串）

import { observeStorageChanges, readStorageSnapshot, writeSyncPrimaryValues } from './config';
import type { StorageSnapshot } from '../utils/bridgeClient';
import {
  PINS_KEY as STORAGE_KEY,
  PINS_STATE_COMPACT_KEY as STORAGE_COMPACT_KEY,
  PINS_STATE_KEY as STORAGE_STATE_KEY,
  PINS_RECORD_PREFIX,
  PINS_ORDER_KEY,
  isPinsRecordKey,
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

const PINS_SYNC_QUOTA_MESSAGE = '同步空间已满，无法保存置顶。';
const PINS_SYNC_RATE_LIMIT_MESSAGE = '同步写入过于频繁，请稍等一分钟后再试。';

function serializeList(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function normalizeItem(item: any): PinnedUp | null {
  if (!item || typeof item !== 'object') return null;
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

function normalizePinsWriteError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/MAX_WRITE_OPERATIONS_PER_MINUTE|max_write/i.test(message)) {
    return new Error(PINS_SYNC_RATE_LIMIT_MESSAGE);
  }
  if (/quota|bytes per item|QUOTA_BYTES/i.test(message)) {
    return new Error(PINS_SYNC_QUOTA_MESSAGE);
  }
  return error instanceof Error ? error : new Error(message);
}

function fromCompactDelta(value: unknown, baseTime: number): number {
  const delta = Number(value);
  if (!Number.isFinite(delta) || delta < 0) return 0;
  if (!Number.isFinite(baseTime) || baseTime <= 0) return Math.round(delta);
  return Math.round(baseTime + delta);
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
      if (!existing || removedAt >= existing.updatedAt) {
        itemMap.delete(mid);
        removed[mid] = Math.max(removed[mid] ?? 0, removedAt);
        updatedAt = Math.max(updatedAt, removedAt);
      }
    }

    for (const item of state.items) {
      const removedAt = removed[item.mid] ?? 0;
      if (removedAt >= item.updatedAt) continue;

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

// v4 每个 mid 一个独立记录；0 是显式取消，记录缺失不代表取消。
type PinRecord = [version: 4, updatedAt: number, pinned: 0 | 1, name?: string, face?: string, pinnedAt?: number];
type PinOrder = [version: 4, updatedAt: number, mids: string[]];

function hasPinsStateData(state: PinsState): boolean {
  return state.items.length > 0 || Object.keys(state.removed).length > 0 || state.order.length > 0;
}

function isPinRecord(value: unknown): value is PinRecord {
  return Array.isArray(value) && value[0] === 4 && Number.isFinite(value[1]) && value[1] > 0 && (value[2] === 0 || value[2] === 1);
}

function isPinOrder(value: unknown): value is PinOrder {
  return Array.isArray(value) && value[0] === 4 && Number.isFinite(value[1]) && value[1] > 0 && Array.isArray(value[2]);
}

function decodeSnapshot(snapshot: Record<string, unknown>): { state: PinsState; available: boolean } {
  const compact = snapshot[STORAGE_COMPACT_KEY];
  const v2 = snapshot[STORAGE_STATE_KEY] as any;
  const legacy = snapshot[STORAGE_KEY];
  const compactValid = Array.isArray(compact) && compact[0] === 3 && Array.isArray(compact[2]) && Array.isArray(compact[3]);
  const v2Valid = v2?.version === 2 && Array.isArray(v2.items);
  const legacyValid = Array.isArray(legacy);
  const state = mergePinsStates([
    compactValid ? normalizeCompactPinsState(compact) : buildPinsStateFromList([]),
    v2Valid ? normalizePinsState(v2) : buildPinsStateFromList([]),
    buildPinsStateFromList(normalizeList(legacy)),
  ]);
  let available = compactValid || v2Valid || legacyValid;
  const items = getStateItemMap(state);
  // 新协议的操作直接覆盖同一 mid 的旧协议数据，避免旧整表使已取消的 UP 复活。
  for (const [key, record] of Object.entries(snapshot)) {
    if (!isPinsRecordKey(key) || !isPinRecord(record)) continue;
    available = true;
    const mid = key.slice(PINS_RECORD_PREFIX.length);
    if (record[2] === 0) {
      items.delete(mid);
      state.removed[mid] = record[1];
    } else {
      items.set(mid, {
        mid,
        name: typeof record[3] === 'string' ? record[3] || undefined : undefined,
        face: normalizeFaceUrl(record[4]),
        pinnedAt: Number.isFinite(record[5]) && record[5]! > 0 ? record[5]! : record[1],
        updatedAt: record[1],
      });
      delete state.removed[mid];
    }
    state.updatedAt = Math.max(state.updatedAt, record[1]);
  }
  state.items = Array.from(items.values());
  const order = snapshot[PINS_ORDER_KEY];
  if (isPinOrder(order)) {
    state.order = order[2].filter((mid, index, all) => typeof mid === 'string' && items.has(mid) && all.indexOf(mid) === index);
    state.orderUpdatedAt = order[1];
    state.updatedAt = Math.max(state.updatedAt, order[1]);
  }
  return { state, available };
}

async function readPinsContext(): Promise<{ state: PinsState; sync: StorageSnapshot }> {
  // 读取错误必须向上传递，不能把 bridge 超时解释成空列表。
  const sync = await readStorageSnapshot('sync');
  const decoded = decodeSnapshot(sync.values);
  if (decoded.available) return { state: decoded.state, sync };
  const local = await readStorageSnapshot('local');
  return { state: decodeSnapshot(local.values).state, sync };
}

async function getAuthoritativePinsState(): Promise<PinsState> {
  return (await readPinsContext()).state;
}

function toPinRecord(item: SyncedPinnedUp): PinRecord {
  return [4, item.updatedAt, 1, item.name || '', compactFaceUrl(item.face) || '', item.pinnedAt];
}

function migrationRecords(state: PinsState, sync: StorageSnapshot): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  // 仅在用户操作时迁移已读到的旧数据；从不发布空的整表。
  for (const item of state.items) {
    const key = PINS_RECORD_PREFIX + item.mid;
    if (!isPinRecord(sync.values[key])) values[key] = toPinRecord(item);
  }
  for (const [mid, removedAt] of Object.entries(state.removed)) {
    const key = PINS_RECORD_PREFIX + mid;
    if (!isPinRecord(sync.values[key])) values[key] = [4, removedAt, 0] satisfies PinRecord;
  }
  return values;
}

let mutationQueue: Promise<unknown> = Promise.resolve();
function mutatePins(change: (state: PinsState, values: Record<string, unknown>, now: number) => void): Promise<PinnedUp[]> {
  const operation = mutationQueue.then(async () => {
    const { state, sync } = await readPinsContext();
    const values = migrationRecords(state, sync);
    const now = Math.max(Date.now(), state.updatedAt + 1);
    change(state, values, now);
    try {
      await writeSyncPrimaryValues(values, sync);
    } catch (error) {
      throw normalizePinsWriteError(error);
    }
    const pins = await getPinnedUps();
    notifyListeners(pins);
    return pins;
  });
  mutationQueue = operation.catch(() => {});
  return operation;
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
  let dirty = false;
  stopStorageObserver = observeStorageChanges([STORAGE_KEY, STORAGE_STATE_KEY, STORAGE_COMPACT_KEY, PINS_ORDER_KEY, PINS_RECORD_PREFIX], () => {
    dirty = true;
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(async () => {
      try {
        while (dirty && listeners.size > 0) {
          dirty = false;
          const pins = await getPinnedUps();
          if (dirty || listeners.size === 0) continue;
          const snapshot = serializeList(pins);
          if (snapshot !== lastNotifiedSnapshot) notifyListeners(pins);
        }
      } catch (error) {
        console.warn('[bili-pin] failed to refresh pins from storage change', error);
      } finally {
        scheduled = false;
      }
    });
  });
}

/** 排序仅改变顺序，不从 UI 列表的缺项推导取消置顶。 */
export async function reorderPinnedUps(mids: string[]): Promise<void> {
  await mutatePins((state, values, now) => {
    const current = derivePinnedUpsFromState(state);
    const remaining = new Set(current.map((item) => item.mid));
    const order: string[] = [];
    for (const mid of mids) {
      if (!remaining.delete(mid)) continue;
      order.push(mid);
    }
    order.push(...remaining);
    if (order.length) values[PINS_ORDER_KEY] = [4, now, order] satisfies PinOrder;
  });
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

  return mutatePins((state, values, now) => {
    const list = derivePinnedUpsFromState(state);
    const existing = list.find((item) => item.mid === inputMid);
    values[PINS_RECORD_PREFIX + inputMid] = [
      4, now, 1, input.name ?? existing?.name ?? '',
      compactFaceUrl(face ?? existing?.face) ?? '', input.pinnedAt ?? existing?.pinnedAt ?? now,
    ] satisfies PinRecord;
    values[PINS_ORDER_KEY] = [
      4, now, [inputMid, ...list.filter((item) => item.mid !== inputMid).map((item) => item.mid)],
    ] satisfies PinOrder;
  });
}

export async function unpinUp(mid: string): Promise<PinnedUp[]> {
  const target = String(mid ?? '').trim();
  if (!/^\d+$/.test(target)) return getPinnedUps();
  return mutatePins((_state, values, now) => {
    values[PINS_RECORD_PREFIX + target] = [4, now, 0] satisfies PinRecord;
  });
}
