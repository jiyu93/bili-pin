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

function findAnyRealUpItem(stripRoot: HTMLElement): HTMLElement | null {
  const items = Array.from(stripRoot.querySelectorAll<HTMLElement>('.bili-dyn-up-list__item'));
  if (items.length === 0) return null;

  // 过滤“全部动态”（若存在）
  for (const it of items) {
    if (it.querySelector('.bili-dyn-up-list__item__face.all')) continue;
    return it;
  }
  return items[0] ?? null;
}

function findAllDynamicItem(stripRoot: HTMLElement): HTMLElement | null {
  const allFace = stripRoot.querySelector<HTMLElement>('.bili-dyn-up-list__item__face.all');
  return allFace?.closest<HTMLElement>('.bili-dyn-up-list__item') ?? null;
}

function findActiveUpItem(stripRoot: HTMLElement): HTMLElement | null {
  return stripRoot.querySelector<HTMLElement>('.bili-dyn-up-list__item.active');
}

/**
 * 为了保证“每次切换都能触发请求”，这里会挑一个“非当前 active”的推荐UP item 来点击。
 * 若都找不到（比如只有一个），则退化为：先点“全部动态”再点该UP，强行制造状态变化。
 */
function findNonActiveRealUpItem(stripRoot: HTMLElement): HTMLElement | null {
  const active = findActiveUpItem(stripRoot);
  const items = Array.from(stripRoot.querySelectorAll<HTMLElement>('.bili-dyn-up-list__item'));
  const realItems = items.filter((it) => !it.querySelector('.bili-dyn-up-list__item__face.all'));
  if (realItems.length === 0) return null;

  // 从上次 index 继续轮换，避免总点同一个导致“第二次没动静”
  const rawIdx = Number(stripRoot.getAttribute('data-bili-pin-trigger-idx') || '0');
  const startIdx = Number.isFinite(rawIdx) ? rawIdx : 0;

  for (let k = 0; k < realItems.length; k += 1) {
    const idx = (startIdx + k) % realItems.length;
    const it = realItems[idx]!;
    if (active && it === active) continue;
    stripRoot.setAttribute('data-bili-pin-trigger-idx', String((idx + 1) % realItems.length));
    return it;
  }

  // 全都 active（极端情况）：返回第一个
  stripRoot.setAttribute('data-bili-pin-trigger-idx', String((startIdx + 1) % realItems.length));
  return realItems[0] ?? null;
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

  // 1) 优先点一个“非当前 active”的推荐UP，确保每次都触发切换
  const realNonActive = findNonActiveRealUpItem(stripRoot);
  if (safeClick(realNonActive)) return true;

  // 2) 若只有一个推荐UP且已 active：先点“全部动态”制造变化，再点该UP
  const allItem = findAllDynamicItem(stripRoot);
  const anyReal = findAnyRealUpItem(stripRoot);
  if (safeClick(allItem)) {
    requestAnimationFrame(() => {
      safeClick(anyReal);
    });
    return true;
  }

  // 3) 再兜底：点击 tabs（全部/视频投稿/追番追剧/专栏）
  const anyTab = document.querySelector<HTMLElement>('.bili-dyn-list-tabs__item');
  if (safeClick(anyTab)) return true;

  return false;
}


