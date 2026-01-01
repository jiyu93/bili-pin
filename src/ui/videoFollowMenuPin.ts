import { isPinned, pinUp, unpinUp } from '../storage/pins';
import { showToast } from './toast';

// Vant popover（video 播放页“已关注”按钮）
const POPOVER_SELECTOR = '.van-popover.van-popper';
const FOLLOW_DROPDOWN_SELECTOR = 'ul.follow_dropdown';
const FOLLOW_ITEM_SELECTOR = 'ul.follow_dropdown > li';

const MENU_ITEM_MARK = 'data-bili-pin-video-menu-item';

function getOwnerFromInitialState(): { mid?: string; name?: string; face?: string } {
  const st = (globalThis as any).__INITIAL_STATE__ ?? null;
  const owner = st?.videoData?.owner ?? st?.videoData?.staff?.[0] ?? null;
  const mid = owner?.mid ?? owner?.uid ?? null;
  const name = owner?.name ?? owner?.uname ?? null;
  const face = owner?.face ?? owner?.avatar ?? null;
  return {
    mid: mid != null ? String(mid).trim() : undefined,
    name: name != null ? String(name).trim() : undefined,
    face: face != null ? String(face).trim() : undefined,
  };
}

function getMidFromDom(): string | null {
  const scope =
    document.querySelector<HTMLElement>('.up-panel-container') ||
    document.querySelector<HTMLElement>('.up-info-container') ||
    document.querySelector<HTMLElement>('#mirror-vdcon') ||
    document.body;

  const a = scope.querySelector<HTMLAnchorElement>('a[href*="space.bilibili.com/"]') ?? null;
  const href = a?.getAttribute('href') || '';
  const m = href.match(/space\.bilibili\.com\/(\d+)/);
  const mid = m?.[1] ?? '';
  return /^\d+$/.test(mid) ? mid : null;
}

function getUpMetaFromDom(): { name?: string; face?: string } {
  const scope =
    document.querySelector<HTMLElement>('.up-panel-container') ||
    document.querySelector<HTMLElement>('.up-info-container') ||
    document.querySelector<HTMLElement>('#mirror-vdcon') ||
    document.body;

  const name =
    scope.querySelector<HTMLElement>('.up-name')?.textContent?.trim() ||
    scope.querySelector<HTMLElement>('.name')?.textContent?.trim() ||
    scope.querySelector<HTMLAnchorElement>('a[href*="space.bilibili.com/"]')?.textContent?.trim() ||
    undefined;

  const face =
    scope.querySelector<HTMLImageElement>('.bili-avatar-img')?.currentSrc ||
    scope.querySelector<HTMLImageElement>('.bili-avatar-img')?.src ||
    scope.querySelector<HTMLImageElement>('a[href*="space.bilibili.com/"] img')?.currentSrc ||
    scope.querySelector<HTMLImageElement>('a[href*="space.bilibili.com/"] img')?.src ||
    undefined;

  return { name: name || undefined, face: face || undefined };
}

function getUpInfo(): { mid: string | null; name?: string; face?: string } {
  const owner = getOwnerFromInitialState();
  const mid = (owner.mid && /^\d+$/.test(owner.mid) ? owner.mid : null) || getMidFromDom();
  const metaDom = getUpMetaFromDom();
  return {
    mid,
    name: owner.name || metaDom.name,
    face: owner.face || metaDom.face,
  };
}

function isLikelyFollowMenu(content: HTMLElement): boolean {
  const text = (content.textContent || '').trim();
  return text.includes('取消关注') || text.includes('设置分组');
}

async function updateMenuItemText(item: HTMLElement, mid: string): Promise<void> {
  const pinned = await isPinned(mid);
  item.textContent = pinned ? '取消置顶' : '置顶动态';
}

function ensureMenuItemInFollowDropdown(ul: HTMLElement): void {
  const info = getUpInfo();
  const mid = info.mid;
  if (!mid) return;

  const existed = ul.querySelector<HTMLElement>(`[${MENU_ITEM_MARK}="1"]`);
  if (existed) {
    updateMenuItemText(existed, mid).catch(() => {});
    return;
  }

  const items = Array.from(ul.querySelectorAll<HTMLElement>(FOLLOW_ITEM_SELECTOR));
  const group = items.find((x) => (x.textContent || '').trim().includes('设置分组')) ?? null;
  const unfollow = items.find((x) => (x.textContent || '').trim().includes('取消关注')) ?? null;
  const template = group ?? unfollow ?? items[0] ?? null;
  if (!template) return;

  // 关键：克隆原生 li，继承样式/作用域属性（data-v-*）
  const item = template.cloneNode(true) as HTMLElement;
  item.setAttribute(MENU_ITEM_MARK, '1');
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
        await pinUp({ mid, name: info.name, face: info.face });
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

  // 插入位置：优先在“设置分组”前，其次“取消关注”前，否则追加
  if (group && group.parentElement === ul) {
    ul.insertBefore(item, group);
  } else if (unfollow && unfollow.parentElement === ul) {
    ul.insertBefore(item, unfollow);
  } else {
    ul.appendChild(item);
  }

  updateMenuItemText(item, mid).catch(() => {});
}

function hookPopover(popover: HTMLElement): void {
  if (popover.getAttribute('data-bili-pin-hooked') === '1') return;
  popover.setAttribute('data-bili-pin-hooked', '1');

  const tryInject = () => {
    // video 页已关注菜单结构：div.van-popover.van-followed > ul.follow_dropdown > li
    const ul = popover.querySelector<HTMLElement>(FOLLOW_DROPDOWN_SELECTOR);
    if (ul && isLikelyFollowMenu(ul)) {
      ensureMenuItemInFollowDropdown(ul);
      return;
    }
  };

  // 先尝试一次（有些页面 popover 初始就已生成）
  tryInject();

  // 监听“显示/隐藏”和内容生成：只观察这个 popover，自身开销很低
  const mo = new MutationObserver(() => tryInject());
  mo.observe(popover, { attributes: true, childList: true, subtree: true });
}

function scanAndHook(): void {
  // 可能存在多个 popover（分享/更多），这里先 hook 全部，靠内容识别“设置分组/取消关注”来筛掉
  const popovers = Array.from(document.querySelectorAll<HTMLElement>(POPOVER_SELECTOR));
  for (const p of popovers) hookPopover(p);
}

export function observeVideoFollowMenu(): void {
  const root = document.documentElement;
  if (!root || root.getAttribute('data-bili-pin-video-follow-installed') === '1') return;
  root.setAttribute('data-bili-pin-video-follow-installed', '1');

  // 初次扫描
  scanAndHook();

  // 只观察 body 直接子节点新增（popover 通常 teleport 到 body 下），避免 subtree 监听带来性能问题
  if (!document.body) return;
  const observer = new MutationObserver((ms) => {
    for (const m of ms) {
      for (const n of Array.from(m.addedNodes)) {
        if (!(n instanceof Element)) continue;
        if (n.matches?.(POPOVER_SELECTOR)) hookPopover(n as HTMLElement);
        const p = (n as Element).querySelector?.(POPOVER_SELECTOR);
        if (p) hookPopover(p as HTMLElement);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: false });
}


