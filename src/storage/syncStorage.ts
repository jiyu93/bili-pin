/**
 * 统一存储层：优先使用 chrome.storage.sync（支持同一 Google 账号跨设备同步），
 * 降级使用 chrome.storage.local（离线缓存 / 未登录 Chrome 时的兜底）。
 */

import { bridgeStorageGet, bridgeStorageSet } from '../utils/bridgeClient';

export async function syncStorageGet<T>(key: string, fallback: T): Promise<T> {
  const local = (globalThis as any).chrome?.storage?.local;
  const sync = (globalThis as any).chrome?.storage?.sync;

  // 1. 优先读 sync
  if (sync?.get) {
    try {
      const result = await new Promise<Record<string, unknown>>((resolve) => {
        sync.get({ [key]: undefined }, resolve);
      });
      const value = result?.[key] as T;
      if (value !== undefined) return value;
    } catch {}
  }

  // 2. sync 无数据，读 local
  if (local?.get) {
    try {
      const result = await new Promise<Record<string, unknown>>((resolve) => {
        local.get({ [key]: fallback }, resolve);
      });
      const value = (result?.[key] as T) ?? fallback;
      // 迁移逻辑：local 有有效数据且 sync 可用但为空，则自动提升到 sync
      if (value !== fallback && sync?.set) {
        sync.set({ [key]: value }).catch(() => {});
      }
      return value;
    } catch {}
  }

  // 3. MAIN world 通过 bridge 访问
  try {
    return await bridgeStorageGet<T>(key, fallback);
  } catch {}

  // 4. 最终兜底：页面 localStorage（开发环境 / 非扩展上下文）
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function syncStorageSet<T>(key: string, value: T): Promise<void> {
  const local = (globalThis as any).chrome?.storage?.local;
  const sync = (globalThis as any).chrome?.storage?.sync;

  // 同时写入 sync 和 local，保证同步+离线可用
  if (sync?.set) {
    await new Promise<void>((resolve) => sync.set({ [key]: value }, () => resolve()));
  }
  if (local?.set) {
    await new Promise<void>((resolve) => local.set({ [key]: value }, () => resolve()));
    return;
  }

  // MAIN world 通过 bridge 访问
  try {
    await bridgeStorageSet<T>(key, value);
    return;
  } catch {}

  // 最终兜底
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {}
}
