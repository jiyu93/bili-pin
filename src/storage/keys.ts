export const PINS_KEY = 'biliPin.pins.v1';
export const PINS_STATE_KEY = 'biliPin.pins.state.v2';
export const PINS_STATE_COMPACT_KEY = 'biliPin.pins.state.v3';
export const PINS_RECORD_PREFIX = 'biliPin.pins.record.v4.';
export const PINS_ORDER_KEY = 'biliPin.pins.order.v4';
export const PIN_BAR_EXPANDED_KEY = 'biliPin.ui.pinBarExpanded.v1';
export const PIN_BAR_EXPANDED_STATE_KEY = 'biliPin.ui.pinBarExpanded.state.v2';
export const PIN_BAR_HEIGHT_KEY = 'biliPin.ui.pinBarHeight.v1';
export const PIN_BAR_HEIGHT_STATE_KEY = 'biliPin.ui.pinBarHeight.state.v1';
export const SYNC_META_KEY = 'biliPin.syncMeta.v1';
export const SYNC_MIGRATION_KEY = 'biliPin.syncMigration.v1';

export const STORAGE_BRIDGE_ALLOWED_KEYS = [
  PINS_KEY,
  PINS_STATE_KEY,
  PINS_STATE_COMPACT_KEY,
  PINS_ORDER_KEY,
  PINS_RECORD_PREFIX,
  PIN_BAR_EXPANDED_KEY,
  PIN_BAR_EXPANDED_STATE_KEY,
  PIN_BAR_HEIGHT_KEY,
  PIN_BAR_HEIGHT_STATE_KEY,
  SYNC_META_KEY,
  SYNC_MIGRATION_KEY,
] as const;

export function isPinsRecordKey(key: string): boolean {
  return key.startsWith(PINS_RECORD_PREFIX) && /^\d+$/.test(key.slice(PINS_RECORD_PREFIX.length));
}

export function isAllowedStorageKey(key: string): boolean {
  if (typeof key !== 'string' || key === PINS_RECORD_PREFIX) return false;
  return STORAGE_BRIDGE_ALLOWED_KEYS.includes(key as (typeof STORAGE_BRIDGE_ALLOWED_KEYS)[number]) || isPinsRecordKey(key);
}
