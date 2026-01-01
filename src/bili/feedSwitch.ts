import { setDesiredHostMid, getUpInfoByFace } from './apiInterceptor';

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

function getItemMid(item: HTMLElement): string | null {
  // 1. 优先尝试从注入的图钉按钮获取（如果已注入）
  const btn = item.querySelector<HTMLElement>('.bili-pin-btn');
  if (btn?.dataset.mid) {
    return btn.dataset.mid;
  }

  // 2. 尝试通过头像反查
  const img = item.querySelector<HTMLImageElement>('img');
  if (img) {
    const face = img.currentSrc || img.src || '';
    if (face) {
      const info = getUpInfoByFace(face);
      if (info?.mid) return info.mid;
    }
  }

  return null;
}

function findUpItemByMid(stripRoot: HTMLElement, mid: string): HTMLElement | null {
  const items = Array.from(stripRoot.querySelectorAll<HTMLElement>('.bili-dyn-up-list__item'));
  for (const item of items) {
    // 忽略全部动态
    if (item.querySelector('.bili-dyn-up-list__item__face.all')) continue;
    
    if (getItemMid(item) === mid) {
      return item;
    }
  }
  return null;
}

function findActiveUpItem(stripRoot: HTMLElement): HTMLElement | null {
  return stripRoot.querySelector<HTMLElement>('.bili-dyn-up-list__item.active');
}

export function findAllDynamicItem(stripRoot: HTMLElement): HTMLElement | null {
  const allFace = stripRoot.querySelector<HTMLElement>('.bili-dyn-up-list__item__face.all');
  return allFace?.closest<HTMLElement>('.bili-dyn-up-list__item') ?? null;
}

function findAnyRealUpItem(stripRoot: HTMLElement): HTMLElement | null {
  const items = Array.from(stripRoot.querySelectorAll<HTMLElement>('.bili-dyn-up-list__item'));
  if (items.length === 0) return null;

  // 过滤“全部动态”
  for (const it of items) {
    if (it.querySelector('.bili-dyn-up-list__item__face.all')) continue;
    return it;
  }
  return items[0] ?? null;
}

/**
 * 为了保证“每次切换都能触发请求”，这里会挑一个“非当前 active”的推荐UP item 来点击。
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
 */
export function switchFeedInDynamicPage(stripRoot: HTMLElement, mid: string): boolean {
  const m = String(mid ?? '').trim();
  if (!/^\d+$/.test(m)) return false;

  // 1. 尝试在推荐横条中直接找到该 UP
  const targetItem = findUpItemByMid(stripRoot, m);
  if (targetItem) {
    // 找到了：直接点击该 UP，让 B 站自然处理（无需拦截，因为本身就是该 UP）
    // 为了防止之前设置了 desiredHostMid 导致干扰，先清空
    setDesiredHostMid(null);
    
    // 如果已经是 active，依然点击（可能用户想刷新，或者确认高亮）
    // 若点击无效，暂不处理（符合原生行为）
    safeClick(targetItem);
    return true;
  }

  // 2. 没找到：需要拦截请求
  setDesiredHostMid(m);

  // 需求：如果置顶栏中的UP头像在推荐栏中不存在，则优先取消推荐栏中的高亮。
  // 如果推荐栏无法取消高亮，则在这种情况下将高亮选择在推荐栏最左边的"全部动态"上。

  const allItem = findAllDynamicItem(stripRoot);
  if (allItem) {
    const isActive = allItem.classList.contains('active');
    
    if (!isActive) {
      // 2a. "全部动态"当前未激活：直接点击它
      // UI 会变成"全部动态"高亮 -> 发起"全部动态"请求 -> 被拦截为目标 UP
      safeClick(allItem);
      return true;
    } else {
      // 2b. "全部动态"当前已激活：
      // 我们需要触发请求刷新（因为 desiredHostMid 变了），但单纯再次点击 active item 可能无效。
      // 策略：快速切换：点一个非 active 的 UP -> 马上点回全部动态
      const pivot = findNonActiveRealUpItem(stripRoot);
      if (pivot && safeClick(pivot)) {
        // 利用 RAF 或 setTimeout 确保第一次点击生效并产生（哪怕微小的）状态变化
        // 注意：间隔太短可能被 debounce，太长会有视觉闪烁。
        // B 站动态页响应点击通常很快。
        requestAnimationFrame(() => {
           safeClick(allItem);
        });
        return true;
      } else {
        // 没别的可点（极少见），只能强点全部动态碰运气
        safeClick(allItem);
        return true;
      }
    }
  }

  // 3. 实在没有"全部动态"（防御性兜底）：回退到“找任意非 active UP 点击”
  // 这会导致 UI 高亮错位（高亮了别的 UP），但能保证内容切过去。
  const realNonActive = findNonActiveRealUpItem(stripRoot);
  if (safeClick(realNonActive)) return true;

  // 4. 终极兜底：点 Tabs
  const anyTab = document.querySelector<HTMLElement>('.bili-dyn-list-tabs__item');
  if (safeClick(anyTab)) return true;

  return false;
}

/**
 * 强制刷新到“全部动态”
 * 用于解决：当 UI 上“全部动态”已经是 active，但实际上处于“置顶劫持状态”时，
 * 用户点击“全部动态”被 B 站忽略的问题。
 */
export function forceReloadAllFeed(stripRoot: HTMLElement): void {
  // 1. 确保已清除拦截（由调用方保证，或者这里再保底一次）
  setDesiredHostMid(null);

  const allItem = findAllDynamicItem(stripRoot);
  if (!allItem) return;

  // 如果当前已经是 active，需要先切走再切回来，以强制触发刷新
  if (allItem.classList.contains('active')) {
     const pivot = findNonActiveRealUpItem(stripRoot);
     if (pivot && safeClick(pivot)) {
       requestAnimationFrame(() => {
         safeClick(allItem);
       });
     } else {
       // 只有一个 item 或找不到 pivot，强点
       safeClick(allItem);
     }
  } else {
    // 正常点击
    safeClick(allItem);
  }
}
