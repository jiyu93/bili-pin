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

  // 1) 优先点击“全部动态”（重置/刷新最稳定）
  const allFace = stripRoot.querySelector<HTMLElement>('.bili-dyn-up-list__item__face.all');
  const allItem = allFace?.closest<HTMLElement>('.bili-dyn-up-list__item') ?? null;
  if (safeClick(allItem)) return true;

  // 2) 其次点击任意一个推荐 UP item（触发 feed reload）
  const anyItem = stripRoot.querySelector<HTMLElement>('.bili-dyn-up-list__item');
  if (safeClick(anyItem)) return true;

  return false;
}


