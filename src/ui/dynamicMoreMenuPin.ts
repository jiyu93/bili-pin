import { isPinned, pinUp, unpinUp, onPinsChange } from '../storage/pins';
import { showToast } from './toast';
import { getUpInfoByFace } from '../bili/apiInterceptor';

const LIST_ROOT_SELECTOR = '.bili-dyn-list__items';
const DYN_ITEM_SELECTOR = '.bili-dyn-item';
const MORE_BTN_SELECTOR = '.bili-dyn-more__btn';
const CASCADER_SELECTOR = '.bili-dyn-more__cascader';
const OPTIONS_SELECTOR = '.bili-cascader-options';
const LIST_POPOVER_SELECTOR = '.bili-cascader__list';
const POPOVER_HOVER_BRIDGE_MARK = 'data-bili-pin-more-hover-bridge';
const OPTION_ITEM_SELECTOR = '.bili-cascader-options__item';
const OPTION_LABEL_SELECTOR = '.bili-cascader-options__item-label';

const MENU_ITEM_MARK = 'data-bili-pin-dyn-more-menu-item';

function extractMidFromHref(href: string): string | null {
  const m = String(href || '').match(/space\.bilibili\.com\/(\d+)/);
  const mid = m?.[1] ?? '';
  return /^\d+$/.test(mid) ? mid : null;
}

function getUpInfoFromDynItem(item: HTMLElement): { mid: string | null; name?: string; face?: string } {
  const a = item.querySelector<HTMLAnchorElement>('a[href*="space.bilibili.com/"]');
  const mid = a ? extractMidFromHref(a.href || a.getAttribute('href') || '') : null;

  const name = item.querySelector<HTMLElement>('.bili-dyn-title__text')?.textContent?.trim() || undefined;

  const img =
    item.querySelector<HTMLImageElement>('.bili-dyn-item__avatar img') ??
    item.querySelector<HTMLImageElement>('.b-avatar img') ??
    item.querySelector<HTMLImageElement>('img[src*="/bfs/face/"]') ??
    null;

  // 注意：第一次 hover 时图片可能还没加载完（currentSrc 为空），因此尽量从多处兜底拿到 face URL
  const srcset =
    img?.closest('picture')?.querySelector<HTMLSourceElement>('source[srcset]')?.getAttribute('srcset') ??
    img?.getAttribute('srcset') ??
    null;
  const srcsetFirst = srcset ? String(srcset).split(',')[0]?.trim().split(' ')[0]?.trim() : '';

  const faceRaw =
    img?.currentSrc ||
    img?.src ||
    img?.getAttribute('src') ||
    img?.getAttribute('data-src') ||
    (img as any)?.dataset?.src ||
    srcsetFirst ||
    undefined;
  const face = faceRaw ? String(faceRaw).trim() : undefined;

  // 兜底：动态卡片 DOM 常不直接暴露 space 链接，用 “头像 URL -> API 缓存（portal/feed）” 反查 mid
  if (!mid && face) {
    const up = getUpInfoByFace(face);
    if (up?.mid && /^\d+$/.test(up.mid)) {
      return { mid: up.mid, name: name || up.name || undefined, face: face || up.face || undefined };
    }
  }

  return { mid, name: name || undefined, face: face || undefined };
}

function findOptionItems(options: HTMLElement): HTMLElement[] {
  return Array.from(options.querySelectorAll<HTMLElement>(OPTION_ITEM_SELECTOR));
}

async function updateMenuItemText(item: HTMLElement, mid: string): Promise<void> {
  const pinned = await isPinned(mid);
  const label = item.querySelector<HTMLElement>(OPTION_LABEL_SELECTOR) ?? item;
  label.textContent = pinned ? '取消置顶' : '置顶动态';
}

function isVisible(el: HTMLElement): boolean {
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function findOpenMoreMenuOptions(): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>(OPTIONS_SELECTOR));
  const candidates = all.filter((opt) => {
    const text = (opt.textContent || '').trim();
    if (!text.includes('取消关注')) return false;
    if (!text.includes('举报')) return false;
    // 选“当前打开的那个”：options 或其 popper 可见
    const popper = opt.closest<HTMLElement>(LIST_POPOVER_SELECTOR) ?? opt;
    return isVisible(popper);
  });
  if (!candidates.length) return null;

  // 多个候选时选 z-index 最大的（最前面的菜单）
  let best = candidates[0];
  let bestZ = -Infinity;
  for (const opt of candidates) {
    const popper = opt.closest<HTMLElement>(LIST_POPOVER_SELECTOR) ?? opt;
    const z = parseInt(getComputedStyle(popper).zIndex || '0', 10);
    const zi = Number.isFinite(z) ? z : 0;
    if (zi >= bestZ) {
      bestZ = zi;
      best = opt;
    }
  }
  return best;
}

function markHoverBridge(options: HTMLElement): void {
  // 只给“当前打开的 popper”打标记，避免全站其它 cascader 受到影响
  const popper = options.closest<HTMLElement>(LIST_POPOVER_SELECTOR);
  if (!popper) return;
  const marked = Array.from(document.querySelectorAll<HTMLElement>(`${LIST_POPOVER_SELECTOR}[${POPOVER_HOVER_BRIDGE_MARK}="1"]`));
  for (const el of marked) el.removeAttribute(POPOVER_HOVER_BRIDGE_MARK);
  popper.setAttribute(POPOVER_HOVER_BRIDGE_MARK, '1');
}

function ensureMenuItemInOptions(
  options: HTMLElement,
  mid: string,
  meta: { name?: string; face?: string },
): boolean {
  // 解决“鼠标从按钮滑向菜单时经过空白导致菜单闪烁消失”的体验问题：
  // 给当前 popper 打标记，用 CSS ::before 做一个透明 hover 桥接区域。
  markHoverBridge(options);

  const existed = options.querySelector<HTMLElement>(`[${MENU_ITEM_MARK}="1"]`);
  if (existed) {
    updateMenuItemText(existed, mid).catch(() => {});
    return true;
  }

  const items = findOptionItems(options);
  const cancelFollow = items.find((x) => (x.textContent || '').trim().includes('取消关注')) ?? null;
  const report = items.find((x) => (x.textContent || '').trim().includes('举报')) ?? null;
  const template = cancelFollow ?? report ?? items[0] ?? null;
  if (!template) return false;

  // 关键：克隆原生菜单项，继承 B 站 scoped 样式（data-v-*）与 hover 效果
  const item = template.cloneNode(true) as HTMLElement;
  item.setAttribute(MENU_ITEM_MARK, '1');
  item.dataset.mid = mid; // 存储 mid 以便后续更新

  // 清空文本（克隆会复制原 label）
  const label = item.querySelector<HTMLElement>(OPTION_LABEL_SELECTOR) ?? item;
  label.textContent = '';

  let busy = false;
  item.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    busy = true;
    item.style.opacity = '0.6';
    item.style.pointerEvents = 'none';
    label.textContent = '处理中...';

    try {
      const pinned = await isPinned(mid);
      if (pinned) {
        await unpinUp(mid);
        showToast('已取消置顶');
      } else {
        await pinUp({ mid, name: meta.name, face: meta.face });
        showToast('已置顶动态');
      }
    } catch (err: any) {
      showToast(err?.message || '操作失败，请重试');
    } finally {
      await updateMenuItemText(item, mid).catch(() => {});
      item.style.opacity = '';
      item.style.pointerEvents = '';
      busy = false;
    }
  });

  // 插入位置：优先放在“取消关注”前，其次放在“举报”前，否则追加
  if (cancelFollow && cancelFollow.parentElement === options) {
    options.insertBefore(item, cancelFollow);
  } else if (report && report.parentElement === options) {
    options.insertBefore(item, report);
  } else {
    options.appendChild(item);
  }

  updateMenuItemText(item, mid).catch(() => {});
  return true;
}

function ensureMenuItemForDynItem(dynItem: HTMLElement): boolean {
  const info = getUpInfoFromDynItem(dynItem);
  if (!info.mid) return false;

  // 1) 先尝试“卡片内部结构”（debug HTML 是这种）
  const innerOptions = dynItem.querySelector<HTMLElement>(OPTIONS_SELECTOR);
  if (innerOptions) {
    return ensureMenuItemInOptions(innerOptions, info.mid, { name: info.name, face: info.face });
  }

  // 2) 再尝试“teleport 到 body 的 popper”（你截图更像这种）
  const open = findOpenMoreMenuOptions();
  if (open) {
    return ensureMenuItemInOptions(open, info.mid, { name: info.name, face: info.face });
  }
  return false;
}

function scheduleEnsureMenuItem(dynItem: HTMLElement): void {
  // 菜单 DOM/作者缓存可能在 hover 后异步就绪：做更长但低频的短重试（避免“第一次 hover”漏掉）
  const token = String((Number(dynItem.getAttribute('data-bili-pin-more-token') || '0') || 0) + 1);
  dynItem.setAttribute('data-bili-pin-more-token', token);

  const delays = [0, 40, 80, 140, 220, 340, 520, 800, 1200, 1600];
  const run = (idx: number) => {
    if (dynItem.getAttribute('data-bili-pin-more-token') !== token) return;
    const ok = ensureMenuItemForDynItem(dynItem);
    if (ok) return;
    if (idx >= delays.length - 1) return;
    window.setTimeout(() => run(idx + 1), delays[idx + 1]);
  };

  run(0);
}

function scanListRoot(listRoot: HTMLElement): void {
  const items = Array.from(listRoot.querySelectorAll<HTMLElement>(DYN_ITEM_SELECTOR));
  for (const item of items) {
    if (item.getAttribute('data-bili-pin-more-menu-scanned') === '1') continue;
    item.setAttribute('data-bili-pin-more-menu-scanned', '1');

    // 关键：三点菜单的 DOM 常在 hover 时才生成/变可用。
    // 因此不依赖“扫描时机”，而是在用户 hover 到按钮时再注入（并做轻量重试）。
    const moreBtn = item.querySelector<HTMLElement>(MORE_BTN_SELECTOR);
    if (moreBtn && moreBtn.getAttribute('data-bili-pin-more-hooked') !== '1') {
      moreBtn.setAttribute('data-bili-pin-more-hooked', '1');
      moreBtn.addEventListener('pointerenter', () => scheduleEnsureMenuItem(item));
      moreBtn.addEventListener('click', () => scheduleEnsureMenuItem(item));
    }
  }
}

export function observeDynamicFeedMoreMenu(): void {
  // 监听置顶列表变化，同步更新当前打开的菜单项状态
  onPinsChange(() => {
    const items = document.querySelectorAll<HTMLElement>(`[${MENU_ITEM_MARK}="1"]`);
    items.forEach((item) => {
      const mid = item.dataset.mid;
      if (mid) updateMenuItemText(item, mid).catch(() => {});
    });
  });

  const root = document.documentElement;
  if (!root || root.getAttribute('data-bili-pin-dyn-more-installed') === '1') return;
  root.setAttribute('data-bili-pin-dyn-more-installed', '1');

  let listRoot: HTMLElement | null = null;
  let listObserver: MutationObserver | null = null;

  const attach = (el: HTMLElement) => {
    if (el === listRoot) return;
    listRoot = el;

    if (listObserver) listObserver.disconnect();
    listObserver = new MutationObserver(() => {
      if (!listRoot) return;
      scanListRoot(listRoot);
    });
    // 只监听列表直接子节点变化：动态流新增通常是 append/prepend list item
    listObserver.observe(el, { childList: true, subtree: false });
    scanListRoot(el);
  };

  const findAndAttach = () => {
    const el = document.querySelector<HTMLElement>(LIST_ROOT_SELECTOR);
    if (el) attach(el);
  };

  // 初次尝试（可能 DOM 尚未就绪）
  findAndAttach();

  // SPA/异步渲染：仅在 documentElement 上观察 childList（subtree=true 会更重，这里只做一次 attach 检测）
  const mo = new MutationObserver(() => findAndAttach());
  mo.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('popstate', findAndAttach);
}


