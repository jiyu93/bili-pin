export const PINS_KEY = 'biliPin.pins.v1';
export const PINS_STATE_KEY = 'biliPin.pins.state.v2';
export const PINS_STATE_COMPACT_KEY = 'biliPin.pins.state.v3';
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
  PIN_BAR_EXPANDED_KEY,
  PIN_BAR_EXPANDED_STATE_KEY,
  PIN_BAR_HEIGHT_KEY,
  PIN_BAR_HEIGHT_STATE_KEY,
  SYNC_META_KEY,
  SYNC_MIGRATION_KEY,
] as const;

export const POPUP_SUMMARY_KEYS = [
  PINS_KEY,
  PINS_STATE_KEY,
  PINS_STATE_COMPACT_KEY,
  PIN_BAR_EXPANDED_STATE_KEY,
  PIN_BAR_HEIGHT_STATE_KEY,
  SYNC_META_KEY,
] as const;
