import { filterFeedDirectly } from '../bili/clickBridge';
import { getPinnedUps, pinUp, reorderPinnedUps, unpinUp, onPinsChange, type PinnedUp } from '../storage/pins';
import { ensurePinBar, ensurePinBarPrefs, renderPinBar, removePinBar, setActiveMid } from './pinBar';
import { showToast } from './toast';
import { getDesiredHostMid, getUpInfoByFace, getUpInfoByName, getUpInfoByMid, setDesiredHostMid } from '../bili/apiInterceptor';
import { forceReloadAllFeed } from '../bili/feedSwitch';
import { normalizeFaceUrl } from '../utils/faceUrl';

const BTN_CLASS = 'bili-pin-btn';
const BTN_MARK = 'data-bili-pin-btn';

function ensurePinBtnContent(btn: HTMLButtonElement) {
  // 用 inline SVG：无需额外图片资源，颜色可由 CSS 控制
  if (btn.querySelector('.bili-pin-btn__svg')) return;
  btn.innerHTML = `
    <svg class="bili-pin-btn__svg bili-pin-btn__svg--outline" viewBox="0 0 24 24" aria-hidden="true">
      <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
      <path d="M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M9 15l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M14.5 4l5.5 5.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <svg class="bili-pin-btn__svg bili-pin-btn__svg--filled" viewBox="0 0 24 24" aria-hidden="true">
      <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
      <path d="M15.113 3.21l.094 .083l5.5 5.5a1 1 0 0 1 -1.175 1.59l-3.172 3.171l-1.424 3.797a1 1 0 0 1 -.158 .277l-.07 .08l-1.5 1.5a1 1 0 0 1 -1.32 .082l-.095 -.083l-2.793 -2.792l-3.793 3.792a1 1 0 0 1 -1.497 -1.32l.083 -.094l3.792 -3.793l-2.792 -2.793a1 1 0 0 1 -.083 -1.32l.083 -.094l1.5 -1.5a1 1 0 0 1 .258 -.187l.098 -.042l3.796 -1.425l3.171 -3.17a1 1 0 0 1 1.497 -1.26z" fill="currentColor"/>
    </svg>
  `.trim();
}

function extractNameAndFaceFromItem(item: HTMLElement): Pick<PinnedUp, 'name' | 'face'> {
  const img = item.querySelector<HTMLImageElement>('img');
  const face = normalizeFaceUrl(img?.currentSrc || img?.src);
  const nameEl = item.querySelector<HTMLElement>('.bili-dyn-up-list__item__name');
  const name = (nameEl?.textContent || img?.alt || '').trim() || undefined;
  return { name, face };
}

function getItemMid(item: HTMLElement): string | null {
  // 只从 portal 缓存映射 mid：页面打开时 portal(up_list) 已返回 mid/name/face
  const img = item.querySelector<HTMLImageElement>('img');
  const nameEl = item.querySelector<HTMLElement>('.bili-dyn-up-list__item__name');

  // 1. 优先通过头像 hash 匹配（最准确）
  if (img) {
    const face = img.currentSrc || img.src || '';
    if (face) {
      const upInfo = getUpInfoByFace(face);
      if (upInfo?.mid && /^\d+$/.test(upInfo.mid)) {
        return upInfo.mid;
      }
    }
  }

  // 2. 兜底：通过名字匹配（可能重名，但推荐列表范围内概率极低）
  if (nameEl) {
    const name = (nameEl.textContent || '').trim();
    if (name) {
      const upInfo = getUpInfoByName(name);
      if (upInfo?.mid && /^\d+$/.test(upInfo.mid)) {
        return upInfo.mid;
      }
    }
  }

  return null;
}

function findUpItems(stripRoot: HTMLElement): HTMLElement[] {
  const items = Array.from(stripRoot.querySelectorAll<HTMLElement>('.bili-dyn-up-list__item'));
  // 过滤“全部动态”
  return items.filter((el) => !el.querySelector('.bili-dyn-up-list__item__face.all'));
}

function syncPinBarSizingFromBili(stripRoot: HTMLElement, bar: HTMLElement): void {
  // 以推荐横条的一个样本 item 的实际渲染尺寸为准，避免“置顶栏更小/省略号放不下”等问题
  const items = findUpItems(stripRoot);
  const sample = items[0] ?? null;
  if (!sample) return;

  // 注意：CSS 变量实际由 list 使用，因此要写到 list 上（否则可能被 list 上的默认值覆盖）
  const listEl = bar.querySelector<HTMLElement>('#bili-pin-pinbar-list') ?? bar;

  const itemRect = sample.getBoundingClientRect();
  if (itemRect.width > 10) {
    listEl.style.setProperty('--bili-pin-item-width', `${itemRect.width}px`);
  }

  // 尝试计算 gap
  if (items.length >= 2) {
    const r1 = items[0].getBoundingClientRect();
    const r2 = items[1].getBoundingClientRect();
    // 假设是左对齐或 flex 布局，第二个的 left 减去第一个的 right 即为间距
    // 注意：如果有 margin，margin 也算在 rect 外部，所以 rect.right 到 rect.left 之间的空间就是视觉上的 gap
    const gap = r2.left - r1.right;
    if (gap > 0 && gap < 50) {
      listEl.style.setProperty('--bili-pin-gap', `${gap}px`);
    }
  }

  const faceEl =
    sample.querySelector<HTMLElement>('.bili-dyn-up-list__item__face') ??
    sample.querySelector<HTMLElement>('.bili-dyn-up-list__item__face__img') ??
    null;
  const faceRect = faceEl?.getBoundingClientRect() ?? null;
  const faceSize = faceRect ? Math.max(faceRect.width, faceRect.height) : 0;
  if (faceSize > 10) {
    listEl.style.setProperty('--bili-pin-face-size', `${faceSize}px`);
  }

  const nameEl = sample.querySelector<HTMLElement>('.bili-dyn-up-list__item__name') ?? null;
  if (nameEl) {
    const cs = getComputedStyle(nameEl);
    const fontSize = parseFloat(cs.fontSize || '0');
    const lineHeightRaw = cs.lineHeight === 'normal' ? NaN : parseFloat(cs.lineHeight || '0');
    const lineHeight = Number.isFinite(lineHeightRaw) && lineHeightRaw > 0 ? lineHeightRaw : (fontSize ? fontSize * 1.3 : 16);
    if (fontSize > 0) listEl.style.setProperty('--bili-pin-name-font-size', `${fontSize}px`);
    if (lineHeight > 0) listEl.style.setProperty('--bili-pin-name-line-height', `${lineHeight}px`);
  }
}

function ensureHostPositioning(host: HTMLElement) {
  const cs = getComputedStyle(host);
  if (cs.position === 'static') host.style.position = 'relative';
}

function setBtnState(btn: HTMLButtonElement, pinned: boolean) {
  ensurePinBtnContent(btn);
  btn.setAttribute('aria-label', pinned ? '取消置顶' : '置顶');
  btn.title = pinned ? '取消置顶' : '置顶';
  btn.dataset.pinned = pinned ? '1' : '0';
  btn.classList.toggle('is-pinned', pinned);
}

function renderButtons(stripRoot: HTMLElement, pinnedSet: Set<string>) {
  const items = findUpItems(stripRoot);

  for (const item of items) {
    const mid = getItemMid(item);
    const host = item.querySelector<HTMLElement>('.bili-dyn-up-list__item__face') ?? item;
    let btn = host.querySelector<HTMLButtonElement>(`button[${BTN_MARK}="1"]`);
    const isNew = !btn;
    if (!btn) {
      ensureHostPositioning(host);
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = BTN_CLASS;
      btn.setAttribute(BTN_MARK, '1');
    }

    // 每次渲染都绑定当前身份，处理异步缓存到达及原生节点复用。
    btn.dataset.mid = mid ?? '';
    btn.disabled = !mid;
    setBtnState(btn, Boolean(mid && pinnedSet.has(mid)));
    if (!mid) {
      btn.setAttribute('aria-label', '置顶（正在加载）');
      btn.title = '正在获取UP信息，请稍候...';
    }
    if (!isNew) continue;

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const mid = btn.dataset.mid;
      if (!mid || !/^\d+$/.test(mid)) {
        showToast('正在获取UP信息，请稍候再试');
        return;
      }

      const currentlyPinned = btn.dataset.pinned === '1';
      try {
        if (currentlyPinned) {
          await unpinUp(mid);
        } else {
          await pinUp({ mid, ...extractNameAndFaceFromItem(item) });
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : '置顶操作失败，请重试');
        console.warn('[bili-pin] pin action failed', error);
        return;
      }

      // 同步UI（按钮 + 置顶栏）
      queuePinUiRefresh();
    });

    host.appendChild(btn);
  }
}

/**
 * 监听推荐列表的选中状态，同步高亮置顶栏
 */
function observeRecommendationListSelection(stripRoot: HTMLElement): void {
  // 监听推荐列表的点击事件
  // 注意：用 capture 提前于 B 站自己的 click handler 执行，确保能在“发请求之前”清空 desiredHostMid
  stripRoot.addEventListener(
    'click',
    (e) => {
    // 仅对“用户真实点击”生效：避免我们程序触发的 click 把 desiredHostMid 立刻清空
    if (!(e as MouseEvent).isTrusted) return;

    const target = e.target as HTMLElement;
    const item = target.closest<HTMLElement>('.bili-dyn-up-list__item');
    if (!item) return;

    // 检查是否处于劫持状态（之前通过置顶切到了某个不在推荐栏的UP，并强制高亮了"全部动态"）
    if (getDesiredHostMid()) {
      // 无论如何，用户点击了推荐栏，先清除劫持状态
      setDesiredHostMid(null);

      // 检查是否命中Bug场景：用户点击了“看似 active 但实际上被劫持”的“全部动态”
      const isAll = !!item.querySelector('.bili-dyn-up-list__item__face.all');
      const isActive = item.classList.contains('active');
      
      if (isAll && isActive) {
        // 此时 B 站因为 active 状态而忽略点击，我们需要手动强制刷新
        e.preventDefault();
        e.stopPropagation();
        
        forceReloadAllFeed(stripRoot);
        // 清空置顶栏高亮
        setActiveMid(null);
        return;
      }
    }

    const mid = getItemMid(item);

    if (!mid) {
      // 点击了“全部动态”之类拿不到 mid 的入口：清空置顶栏高亮
      setActiveMid(null);
      return;
    }

    getPinnedUps().then((pinned) => {
      const isPinned = pinned.some((p) => p.mid === mid);
      // 点击了一个已置顶的UP：同步高亮；否则清空高亮，避免误导
      setActiveMid(isPinned ? mid : null);
    });
    },
    true,
  );
}

function installGlobalExitFilterListenersOnce(): void {
  const root = document.documentElement;
  if (!root || root.getAttribute('data-bili-pin-exit-filter-listener') === '1') return;
  root.setAttribute('data-bili-pin-exit-filter-listener', '1');

  // tabs（全部/视频投稿/追番追剧/专栏）不在 stripRoot 内，需要全局监听
  document.addEventListener(
    'click',
    (e) => {
      if (!(e as MouseEvent).isTrusted) return;
      if (!getDesiredHostMid()) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tabItem = target.closest<HTMLElement>('.bili-dyn-list-tabs__item');
      if (!tabItem) return;
      setDesiredHostMid(null);
      setActiveMid(null);
    },
    true,
  );
}

async function refreshPinUi(stripRoot: HTMLElement): Promise<void> {
  const pinned = await getPinnedUps();
  if (stripRoot !== activeStripRoot || !stripRoot.isConnected) return;

  // API 缓存仅补全当前渲染，不自动改写持久化置顶数据。
  const enriched = pinned.map((p) => {
    const info = getUpInfoByMid(p.mid);
    if (!info) return p;
    const name = (info.name || '').trim() || undefined;
    const face = normalizeFaceUrl(info.face);

    // face 的合并策略要更保守：只有在“原本没有 face 或明显不是头像 URL”时才覆盖，避免引入回归。
    const currentFace = normalizeFaceUrl(p.face);
    const isLikelyFaceUrl = (u?: string) => !!u && /\/bfs\/face\//.test(u);

    const next: PinnedUp = {
      ...p,
      // 昵称以 portal 为准（更可靠）
      name: name ?? p.name,
      // 头像只在必要时回填
      face: currentFace ? currentFace : (isLikelyFaceUrl(face) ? face : undefined) ?? normalizeFaceUrl(p.face),
    };
    return next;
  });

  const pinnedForRender = enriched;
  const pinnedSet = new Set(pinnedForRender.map((x) => x.mid));

  const bar = ensurePinBar(stripRoot);
  if (!bar) return;
  syncPinBarSizingFromBili(stripRoot, bar);
  await ensurePinBarPrefs(bar);
  if (stripRoot !== activeStripRoot || !stripRoot.isConnected || !bar.isConnected) return;
  renderPinBar(bar, pinnedForRender, {
    onClickMid: async (mid) => {
      // 设置高亮（在点击时立即显示反馈）
      setActiveMid(mid);
      
      // 直接在动态页内切换（不再打开空间页/不再桥接 DOM 点击）
      const ok = await filterFeedDirectly(stripRoot, mid);
      if (!ok) showToast('切换失败：暂时无法在动态页内刷新该UP的Feed，请稍后重试');
    },
    onUnpinMid: async (mid) => {
      try {
        await unpinUp(mid);
        queuePinUiRefresh();
      } catch (err) {
        console.warn('[bili-pin] unpin failed', err);
        showToast(err instanceof Error ? err.message : String(err));
      }
    },
    onReorder: async (newOrderMids) => {
      try {
        await reorderPinnedUps(newOrderMids);
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
        queuePinUiRefresh();
      }
    },
  });

  renderButtons(stripRoot, pinnedSet);

  // 监听推荐列表的选中状态（只设置一次）
  if (!stripRoot.hasAttribute('data-bili-pin-selection-observer')) {
    stripRoot.setAttribute('data-bili-pin-selection-observer', '1');
    observeRecommendationListSelection(stripRoot);
  }

  installGlobalExitFilterListenersOnce();
}

let activeObserver: MutationObserver | null = null;
let activeStripRoot: HTMLElement | null = null;
let refreshFrame: number | null = null;
let refreshing = false;
let refreshPending = false;
let globalListenersInstalled = false;

// 所有刷新串行执行，事件合并到一帧；旧节点的异步读取不能覆盖新页面。
function queuePinUiRefresh(): void {
  refreshPending = true;
  if (refreshing || refreshFrame !== null) return;
  refreshFrame = requestAnimationFrame(async () => {
    refreshFrame = null;
    const root = activeStripRoot;
    refreshPending = false;
    if (!root?.isConnected) return;
    refreshing = true;
    try {
      await refreshPinUi(root);
    } catch (error) {
      console.warn('[bili-pin] refresh failed', error);
    } finally {
      refreshing = false;
      if (refreshPending) queuePinUiRefresh();
    }
  });
}

function initGlobalListenersOnce(): void {
  if (globalListenersInstalled) return;
  globalListenersInstalled = true;
  window.addEventListener('bili-pin:portal-up-list', queuePinUiRefresh);
  onPinsChange(queuePinUiRefresh);
}

function isNativeStripMutation(mutation: MutationRecord): boolean {
  const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
  if (target?.closest(`.${BTN_CLASS}`)) return false;
  if (mutation.type !== 'childList') return true;
  const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
  return nodes.some((node) => !(node instanceof Element && node.matches(`.${BTN_CLASS}`)));
}

export function injectPinUi(stripRoot: HTMLElement | null): void {
  initGlobalListenersOnce();
  if (stripRoot === activeStripRoot) {
    // 同一个横条被移动、或栏被原生渲染移除时，也校正插入位置。
    if (stripRoot) {
      const previousBar = document.getElementById('bili-pin-pinbar');
      const bar = ensurePinBar(stripRoot);
      if (bar && bar !== previousBar) queuePinUiRefresh();
    }
    return;
  }
  activeObserver?.disconnect();
  activeObserver = null;
  activeStripRoot = stripRoot;
  if (!stripRoot) {
    removePinBar();
    return;
  }

  activeObserver = new MutationObserver((mutations) => {
    if (mutations.some(isNativeStripMutation)) queuePinUiRefresh();
  });
  activeObserver.observe(stripRoot, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['src'],
  });
  queuePinUiRefresh();
}
