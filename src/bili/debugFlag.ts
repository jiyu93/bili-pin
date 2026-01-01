/**
 * 统一的 debug 开关：
 * - 默认关闭，避免污染用户控制台
 * - 需要时可在 DevTools 执行：localStorage.setItem('biliPin.debug','1'); 然后刷新
 */
export function isDebugEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem('biliPin.debug') === '1';
  } catch {
    return false;
  }
}

export function debugLog(...args: any[]): void {
  if (!isDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.debug(...args);
}


