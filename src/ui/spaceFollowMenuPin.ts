import { isPinned, pinUp, unpinUp, onPinsChange } from '../storage/pins';
import { showToast } from './toast';

// hover 菜单弹层（teleport 到 body 下）
const POPOVER_ROOT_SELECTOR = '.vui_popover';
const MENU_PANEL_SELECTOR = '.menu-popover__panel';
const MENU_ITEM_SELECTOR = '.menu-popover__panel-item';

const MENU_ITEM_MARK = 'data-bili-pin-space-menu-item';

function getMidFromUrl(): string | null {
  const m = globalThis.location?.pathname?.match(/^\/(\d+)/);
  const mid = m?.[1] ?? '';
  return /^\d+$/.test(mid) ? mid : null;
}

function getUpNameFromTitle(): string | undefined {
  const title = String(document.title || '').trim();
  const idx = title.indexOf('的个人空间');
  if (idx > 0) return title.slice(0, idx).trim() || undefined;
  return undefined;
}

function getUpNameFromOgTitle(): string | undefined {
  const raw = document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content?.trim() || '';
  if (!raw) return undefined;
  const idx = raw.indexOf('的个人空间');
  if (idx > 0) return raw.slice(0, idx).trim() || undefined;
  // 兜底：部分页面可能没有“的个人空间”后缀
  return raw || undefined;
}

function getUpMeta(): { name?: string; face?: string } {
  // 注意：space 页有“签名/简介”区域也可能带 title 属性，不能用过宽的 `[title]` 去抓，否则容易把签名当昵称。
  const name =
    document.querySelector<HTMLElement>('.upinfo-detail__top .name')?.textContent?.trim() ||
    document.querySelector<HTMLElement>('.h-name')?.textContent?.trim() ||
    getUpNameFromOgTitle() ||
    getUpNameFromTitle();

  // 头像优先取页面“真实头像 img”，og:image 仅作为兜底（有些页面 og:image 不是头像）。
  const face =
    document.querySelector<HTMLImageElement>('.bili-avatar-img.bili-avatar-face')?.currentSrc ||
    document.querySelector<HTMLImageElement>('.bili-avatar-img.bili-avatar-face')?.src ||
    document.querySelector<HTMLImageElement>('.b-avatar img')?.currentSrc ||
    document.querySelector<HTMLImageElement>('.b-avatar img')?.src ||
    document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content?.trim() ||
    undefined;

  return { name: name || undefined, face: face || undefined };
}

function isLikelyFollowMenu(panel: HTMLElement): boolean {
  const text = (panel.textContent || '').trim();
  // “已关注”的菜单通常包含“设置分组 / 取消关注”
  return text.includes('取消关注') || text.includes('设置分组');
}

async function updateMenuItemText(item: HTMLElement, mid: string): Promise<void> {
  const pinned = await isPinned(mid);
  item.textContent = pinned ? '取消置顶' : '置顶动态';
}

function ensureMenuItem(panel: HTMLElement, mid: string): void {
  const existed = panel.querySelector<HTMLElement>(`[${MENU_ITEM_MARK}="1"]`);
  if (existed) {
    updateMenuItemText(existed, mid).catch(() => {});
    return;
  }

  // 关键：B站这里的菜单项样式通常是 scoped（带 data-v-xxxx），直接 createElement 会导致颜色/hover 背景不生效。
  // 因此优先克隆一个原生菜单项（“设置分组/取消关注”），保证结构与属性一致。
  const existingItems = Array.from(panel.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR));
  const template =
    existingItems.find((x) => (x.textContent || '').trim().includes('设置分组')) ??
    existingItems.find((x) => (x.textContent || '').trim().includes('取消关注')) ??
    null;

  const item = (template ? (template.cloneNode(true) as HTMLElement) : document.createElement('div')) as HTMLElement;
  // clone 后可能带有其它 class，但必须至少包含 panel-item class
  if (!item.classList.contains('menu-popover__panel-item')) item.classList.add('menu-popover__panel-item');
  item.setAttribute(MENU_ITEM_MARK, '1');
  item.dataset.mid = mid;
  // 清空原文本（clone 会复制原有文本节点）
  item.textContent = '';

  let busy = false;
  item.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    busy = true;
    item.style.opacity = '0.6';
    item.style.pointerEvents = 'none';
    item.textContent = '处理中...';

    try {
      const pinned = await isPinned(mid);
      if (pinned) {
        await unpinUp(mid);
        showToast('已取消置顶');
      } else {
        await pinUp({ mid, ...getUpMeta() });
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

  // 优先放在“设置分组”前面，其次“取消关注”前面
  const group = existingItems.find((x) => (x.textContent || '').trim().includes('设置分组')) ?? null;
  const unfollow = existingItems.find((x) => (x.textContent || '').trim().includes('取消关注')) ?? null;
  if (group && group.parentElement === panel) {
    panel.insertBefore(item, group);
  } else if (unfollow && unfollow.parentElement === panel) {
    panel.insertBefore(item, unfollow);
  } else {
    panel.appendChild(item);
  }

  updateMenuItemText(item, mid).catch(() => {});
}

function tryInjectIntoPanels(panels: HTMLElement[]): void {
  const mid = getMidFromUrl();
  if (!mid) return;

  for (const panel of panels) {
    if (!isLikelyFollowMenu(panel)) continue;
    ensureMenuItem(panel, mid);
  }
}

export function observeSpacePage(): void {
  // 监听置顶列表变化，同步更新当前打开的菜单项状态
  onPinsChange(() => {
    const items = document.querySelectorAll<HTMLElement>(`[${MENU_ITEM_MARK}="1"]`);
    items.forEach((item) => {
      const mid = item.dataset.mid;
      if (mid) updateMenuItemText(item, mid).catch(() => {});
    });
  });

  const root = document.documentElement;
  if (!root || root.getAttribute('data-bili-pin-space-menu-installed') === '1') return;
  root.setAttribute('data-bili-pin-space-menu-installed', '1');

  // 第一性原理：菜单不打开时没有 DOM，所以“注入菜单”就是“菜单 DOM 出现时自动补一项”。
  // 这里不依赖 hover/click 事件，只监听 body **直接子节点**新增的 popover（teleport 容器），避免监听 subtree 导致卡顿。
  if (!document.body) return;

  const scanPopover = (popover: Element) => {
    const panels = Array.from(popover.querySelectorAll<HTMLElement>(MENU_PANEL_SELECTOR));
    if (!panels.length) return;
    tryInjectIntoPanels(panels);
  };

  const scanExisting = () => {
    const popovers = Array.from(document.querySelectorAll<HTMLElement>(POPOVER_ROOT_SELECTOR));
    for (const p of popovers) scanPopover(p);
  };

  // 先扫一遍：避免在 observer 安装前菜单已存在
  scanExisting();

  let raf = 0;
  const pending = new Set<Element>();
  const flush = () => {
    raf = 0;
    for (const el of pending) scanPopover(el);
    pending.clear();
  };

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const n of Array.from(m.addedNodes)) {
        if (!(n instanceof Element)) continue;
        // popover 根节点通常直接挂在 body 下（.vui_popover...）
        if (n.matches(POPOVER_ROOT_SELECTOR)) {
          pending.add(n);
        } else {
          const p = n.querySelector?.(POPOVER_ROOT_SELECTOR);
          if (p) pending.add(p);
        }
      }
    }
    if (pending.size && !raf) {
      raf = window.requestAnimationFrame(flush);
    }
  });

  // 关键：subtree=false，只观察 body 直接子节点变化（极低频）
  observer.observe(document.body, { childList: true });
}


