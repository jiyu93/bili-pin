import { setDesiredHostMid } from './apiInterceptor';

function safeClick(el: HTMLElement | null): boolean {
  if (!el) return false;
  try {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    el.click?.();
    return true;
  } catch {
    return false;
  }
}

function setFilteredUiMid(mid: string | null) {
  try {
    const root = document.documentElement;
    if (!mid) {
      delete (root as any).dataset.biliPinFilteredMid;
      return;
    }
    (root as any).dataset.biliPinFilteredMid = String(mid);
  } catch {
    // ignore
  }
}

function triggerFeedReloadByTabs(): boolean {
  const tabs = Array.from(
    document.querySelectorAll<HTMLElement>('.bili-dyn-list-tabs__item'),
  ).filter((x) => x.isConnected);
  if (tabs.length < 2) return false;

  const active = tabs.find((t) => t.classList.contains('active')) ?? null;
  const other = tabs.find((t) => t !== active) ?? null;
  if (!other) return false;

  // 先切到另一个tab，确保触发请求；再切回“全部”(active) 以保持用户预期
  if (!safeClick(other)) return false;
  if (active) setTimeout(() => safeClick(active), 60);
  return true;
}

/**
 * 在动态页内切换 feed 到指定 UP（mid）。
 *
 * 实现思路：
 * - 先设置 desiredHostMid
 * - 再触发一次“任意会导致 B 站发起 feed 请求”的点击
 * - apiInterceptor 会把该次（以及后续分页）/feed/all 请求的 host_mid 改写为 desiredHostMid
 * - B 站自己渲染列表，我们不碰 DOM/框架状态
 */
export function switchFeedInDynamicPage(stripRoot: HTMLElement, mid: string): boolean {
  const m = String(mid ?? '').trim();
  if (!/^\d+$/.test(m)) return false;

  setDesiredHostMid(m);
  setFilteredUiMid(m);

  // 0) 优先通过“全部/视频投稿/追番追剧/专栏”tab 触发刷新（最稳定：即使“全部动态”已被选中也会发请求）
  if (triggerFeedReloadByTabs()) return true;

  // 1) 优先点击“全部动态”（重置/刷新最稳定）
  const allFace = stripRoot.querySelector<HTMLElement>('.bili-dyn-up-list__item__face.all');
  const allItem = allFace?.closest<HTMLElement>('.bili-dyn-up-list__item') ?? null;
  if (safeClick(allItem)) return true;

  // 2) 其次点击任意一个推荐 UP item（触发 feed reload）
  const anyItem = stripRoot.querySelector<HTMLElement>('.bili-dyn-up-list__item');
  if (safeClick(anyItem)) return true;

  return false;
}


