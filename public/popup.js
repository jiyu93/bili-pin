const KEYS = [
  'biliPin.pins.v1',
  'biliPin.pins.state.v2',
  'biliPin.ui.pinBarExpanded.state.v2',
  'biliPin.syncMeta.v1',
];

async function getAreaSnapshot(area) {
  return await new Promise((resolve, reject) => {
    chrome.storage[area].get(KEYS, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(String(error.message || error)));
        return;
      }
      resolve(result || {});
    });
  });
}

function formatDateTime(value) {
  const ts = Number(value);
  if (!Number.isFinite(ts) || ts <= 0) return '无';
  return new Date(ts).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function getPinsCount(snapshot) {
  return Array.isArray(snapshot['biliPin.pins.v1']) ? snapshot['biliPin.pins.v1'].length : 0;
}

function getLatestUpdatedAt(snapshot) {
  const pinsUpdatedAt = Number(snapshot['biliPin.pins.state.v2']?.updatedAt ?? 0) || 0;
  const expandedUpdatedAt = Number(snapshot['biliPin.ui.pinBarExpanded.state.v2']?.updatedAt ?? 0) || 0;
  return Math.max(pinsUpdatedAt, expandedUpdatedAt);
}

function setValue(id, text) {
  document.getElementById(id).textContent = text;
}

async function refresh() {
  try {
    const [syncSnapshot, localSnapshot] = await Promise.all([
      getAreaSnapshot('sync'),
      getAreaSnapshot('local'),
    ]);

    const lastSyncWriteAt = Number(localSnapshot['biliPin.syncMeta.v1']?.lastSyncWriteAt ?? 0) || 0;
    const localUpdatedAt = getLatestUpdatedAt(localSnapshot);
    const syncUpdatedAt = getLatestUpdatedAt(syncSnapshot);
    const lastSyncedAt = Math.max(lastSyncWriteAt, localUpdatedAt, syncUpdatedAt);
    const avatarCount = getPinsCount(syncSnapshot) || getPinsCount(localSnapshot);

    setValue('avatarCount', String(avatarCount));
    setValue('lastSyncedAt', formatDateTime(lastSyncedAt));
  } catch (error) {
    setValue('avatarCount', '读取失败');
    setValue('lastSyncedAt', error instanceof Error ? error.message : String(error));
  }
}
refresh();
