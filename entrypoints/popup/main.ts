import { getPinnedUps, onPinsChange } from '../../src/storage/pins';
import { readStorageSnapshot } from '../../src/storage/config';
import { PINS_RECORD_PREFIX, PINS_ORDER_KEY, PINS_STATE_COMPACT_KEY, PINS_STATE_KEY, SYNC_META_KEY, isPinsRecordKey } from '../../src/storage/keys';

function latestUpdate(snapshot: Record<string, unknown>): number {
  const compact = snapshot[PINS_STATE_COMPACT_KEY] as any;
  const v2 = snapshot[PINS_STATE_KEY] as any;
  const order = snapshot[PINS_ORDER_KEY] as any;
  const meta = snapshot[SYNC_META_KEY] as any;
  const records = Object.entries(snapshot)
    .filter(([key]) => key.startsWith(PINS_RECORD_PREFIX) && isPinsRecordKey(key))
    .map(([, value]) => Number((value as any)?.[1]) || 0);
  return Math.max(0, ...records, Number(v2?.updatedAt) || 0, Number(order?.[1]) || 0,
    Number(meta?.lastSyncWriteAt) || 0, (Number(compact?.[1]) || 0) + (Number(compact?.[5]) || 0));
}

function setValue(id: string, text: string) {
  document.getElementById(id)!.textContent = text;
}

async function refresh() {
  try {
    const [pins, sync, local] = await Promise.all([getPinnedUps(), readStorageSnapshot('sync'), readStorageSnapshot('local')]);
    const updatedAt = Math.max(latestUpdate(sync.values), latestUpdate(local.values));
    setValue('avatarCount', String(pins.length));
    setValue('lastSyncedAt', updatedAt > 0 ? new Date(updatedAt).toLocaleString('zh-CN', { hour12: false }) : '无');
  } catch (error) {
    setValue('avatarCount', '读取失败');
    setValue('lastSyncedAt', error instanceof Error ? error.message : String(error));
  }
}

void refresh();
onPinsChange(() => { void refresh(); });
