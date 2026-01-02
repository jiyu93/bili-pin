import { isPinned, pinUp, unpinUp, onPinsChange } from '../storage/pins';
import { showToast } from './toast';
import { getUpInfoByMid } from '../bili/apiInterceptor';

// hover 菜单弹层（teleport 到 body 下）
const POPOVER_ROOT_SELECTOR = '.vui_popover';
const MENU_PANEL_SELECTOR = '.menu-popover__panel';
const MENU_ITEM_SELECTOR = '.menu-popover__panel-item';

const MENU_ITEM_MARK = 'data-bili-pin-space-menu-item';

// 追踪最后一次 hover 的相关元素 MID，用于在菜单弹出时识别是哪个 UP
let lastHoveredListMid: string | null = null;

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
    document.querySelector<HTMLElement>('.upinfo-detail__top .nickname')?.textContent?.trim() ||
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
        // 尝试从 API 缓存获取精准信息（包含头像等），如果缓存没有（比如 header 区域），则回退到 getUpMeta (space owner)
        const cached = getUpInfoByMid(mid);
        if (cached) {
            await pinUp({ mid, name: cached.name, face: cached.face });
        } else {
            // 如果是列表里的用户但缓存没命中，理论上不应该发生（因为列表加载时已经缓存了），除非接口改了或者时序问题。
            // 但如果是 space owner（header 区域），缓存里肯定没有，这时候用 getUpMeta 抓取页面上的信息。
            // 为了区分，比较一下 mid 是否是 url 里的 mid (owner)
            const ownerMid = getMidFromUrl();
            if (mid === ownerMid) {
                 await pinUp({ mid, ...getUpMeta() });
            } else {
                // 是列表用户但无缓存，尝试用 dom 兜底（这里比较难抓，暂时直接存 mid，pinUp 内部会尝试去拿 info 修复）
                 await pinUp({ mid });
            }
        }
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
  // 决策逻辑：
  // 1. 如果 lastHoveredListMid 存在且最近被刷新过（这里简单假设非空即有效），优先使用它。
  //    注意：B站的 popover 触发机制通常是 hover，所以 lastHoveredListMid 应该是准确的。
  //    为了避免误判（比如 hover 了列表然后去 hover header），我们需要在 unhover 时清理吗？
  //    不完全需要，因为 popover 出现意味着刚刚 hover 了某个元素。
  //    但是，如果用户 hover 了列表（popover没出或出了消失），然后 hover header，header 的 popover 出现。
  //    此时我们需要区分。
  
  // 简单策略：如果 popover 出现，检查当前鼠标位置或者最近的 hover 记录。
  // 由于我们无法直接知道 popover 是谁触发的（它只是 teleport 到了 body），只能靠“推测”。
  // 大部分情况下，popover 出现是因为刚刚 hover 了 trigger。
  
  // 我们可以认为：如果 lastHoveredListMid 有值，且距离现在很近（比如 200ms 内），则认为是列表触发。
  // 但 JS 单线程，popover mutation callback 执行时，hover 事件应该刚发生不久。
  
  // 更稳妥的方式：
  // 如果是 Header 的关注按钮，它是页面静态的一部分。
  // 如果是列表的关注按钮，它们是动态列表。
  
  // 既然我们已经 hook 了 mouseover，我们可以在 mouseover 时记录时间戳。
  
  let targetMid = getMidFromUrl(); // 默认 owner
  
  if (lastHoveredListMid) {
      // 只有当确定是 hover 了列表里的项时，我们才认为是列表项。
      // 我们在 mouseover 逻辑里只会在检测到列表项结构时设置 lastHoveredListMid。
      // 但是我们需要一个过期时间，防止 hover 了一下列表，然后去操作 header，结果还是用了列表的 mid。
      // 给个 2000ms 有效期（考虑到动画延迟等）
      if (Date.now() - lastHoveredListTime < 2000) {
          targetMid = lastHoveredListMid;
      }
  }

  if (!targetMid) return;

  for (const panel of panels) {
    if (!isLikelyFollowMenu(panel)) continue;
    ensureMenuItem(panel, targetMid);
  }
}

let lastHoveredListTime = 0;

export function observeSpacePage(): void {
  const root = document.documentElement;
  if (!root || root.getAttribute('data-bili-pin-space-menu-installed') === '1') return;
  root.setAttribute('data-bili-pin-space-menu-installed', '1');

  // 监听置顶列表变化，同步更新当前打开的菜单项状态
  onPinsChange(() => {
    const items = document.querySelectorAll<HTMLElement>(`[${MENU_ITEM_MARK}="1"]`);
    items.forEach((item) => {
      const mid = item.dataset.mid;
      if (mid) updateMenuItemText(item, mid).catch(() => {});
    });
  });

  // 监听鼠标悬停，探测列表项中的 mid
  document.addEventListener('mouseover', (e) => {
      const target = e.target as HTMLElement;
      if (!target) return;

      // 1. Header Area Check (Priority)
      // 如果 hover 到了 header 区域的按钮，明确清除 list mid。
      // header 按钮通常在 .h-inner, .operations, .space-head-follow 等区域
      const inHeader = target.closest('.h-inner') || 
                       target.closest('.h-basic') || 
                       target.closest('.operations') || 
                       target.closest('.space-head-follow') ||
                       target.closest('.h-action') ||
                       target.closest('.wrapper-right');
                       
      if (inHeader) {
          lastHoveredListMid = null;
          lastHoveredListTime = 0;
          return;
      }
      
      // 优化策略：
      // 不依赖特定的 'list-item' class，而是向上查找任何包含 space 链接的容器。
      // 只要该容器内的 space 链接指向的 mid 与当前页面 owner 不同，就认为是列表项。
      
      let el: HTMLElement | null = target;
      let foundMid: string | null = null;
      const ownerMid = getMidFromUrl();

      // 向上遍历最多 8 层
      for (let i = 0; i < 8; i++) {
          if (!el || el === document.body || el === document.documentElement) break;
          // 防止向上查找超出范围（比如查到了 wrapper 导致扫到了整个列表）
          if (el.classList.contains('wrapper') || el.id === 'app') break;

          // 在当前层级查找 space 链接
          // 注意：有些链接可能在 img 父级，也可能在 name 里
          const links = el.querySelectorAll<HTMLAnchorElement>('a[href*="//space.bilibili.com/"]');
          for (const link of links) {
               const m = link.href.match(/space\.bilibili\.com\/(\d+)/);
               if (m && m[1]) {
                   const mid = m[1];
                   // 如果找到的 mid 不是 owner，那肯定是列表里的其他人
                   if (mid !== ownerMid) {
                       foundMid = mid;
                       break;
                   }
               }
          }
          if (foundMid) break;
          el = el.parentElement;
      }
      
      if (foundMid) {
          lastHoveredListMid = foundMid;
          lastHoveredListTime = Date.now();
      }
  }, { passive: true });

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


