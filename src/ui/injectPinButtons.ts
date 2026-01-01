import { filterFeedDirectly } from '../bili/clickBridge';
import { getPinnedUps, pinUp, setPinnedUps, unpinUp, type PinnedUp } from '../storage/pins';
import { ensurePinBar, ensurePinBarPrefs, renderPinBar, setActiveUid } from './pinBar';
import { showToast } from './toast';
import { getDesiredHostMid, getUpInfoByFace, getUpInfoByMid, setDesiredHostMid } from '../bili/apiInterceptor';
import { forceReloadAllFeed } from '../bili/feedSwitch';

const BTN_CLASS = 'bili-pin-btn';
const BTN_MARK = 'data-bili-pin-btn';
const HOST_MARK = 'data-bili-pin-host';

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

function extractNameAndFace(a: HTMLAnchorElement): Pick<PinnedUp, 'name' | 'face'> {
  const img = a.querySelector<HTMLImageElement>('img');
  const face = img?.currentSrc || img?.src || undefined;
  const name = (img?.alt || a.textContent || '').trim() || undefined;
  return { name, face };
}

function extractNameAndFaceFromItem(item: HTMLElement): Pick<PinnedUp, 'name' | 'face'> {
  const img = item.querySelector<HTMLImageElement>('img');
  const face = img?.currentSrc || img?.src || undefined;
  const nameEl = item.querySelector<HTMLElement>('.bili-dyn-up-list__item__name');
  const name = (nameEl?.textContent || img?.alt || '').trim() || undefined;
  return { name, face };
}

function getItemMid(item: HTMLElement): string | null {
  // 只从 portal 缓存映射 mid：页面打开时 portal(up_list) 已返回 mid/name/face
  const img = item.querySelector<HTMLImageElement>('img');
  if (img) {
    const face = img.currentSrc || img.src || '';
    if (face) {
      const upInfo = getUpInfoByFace(face);
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
  const sample = findUpItems(stripRoot)[0] ?? null;
  if (!sample) return;

  // 注意：CSS 变量实际由 list 使用，因此要写到 list 上（否则可能被 list 上的默认值覆盖）
  const listEl = bar.querySelector<HTMLElement>('#bili-pin-pinbar-list') ?? bar;

  const itemRect = sample.getBoundingClientRect();
  if (itemRect.width > 10) {
    listEl.style.setProperty('--bili-pin-item-width', `${itemRect.width}px`);
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
    // 置顶栏支持两行
    listEl.style.setProperty('--bili-pin-name-lines', '2');
    listEl.style.setProperty('--bili-pin-name-max-height', `${lineHeight * 2}px`);

    const collapsed = (faceSize || 44) + 6 + (lineHeight * 2) + 12;
    listEl.style.setProperty('--bili-pin-collapsed-max-height', `${collapsed}px`);
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
    let mid = getItemMid(item);
    
    // 按“头像圆形容器”定位按钮：与B站原生推荐栏对齐（右上角）
    const faceHost =
      item.querySelector<HTMLElement>('.bili-dyn-up-list__item__face') ??
      item.querySelector<HTMLElement>('.bili-dyn-up-list__item__face__img') ??
      null;
    const host = faceHost ?? item;

    // 标记host避免重复注入
    if (host.getAttribute(HOST_MARK) === '1') {
      const existed = host.querySelector<HTMLButtonElement>(`button[${BTN_MARK}="1"]`);
      if (existed) {
        // 如果之前没有 mid，现在尝试重新获取
        if (!mid) {
          mid = getItemMid(item);
        }
        if (mid) {
          existed.dataset.mid = mid;
          setBtnState(existed, pinnedSet.has(mid));
        }
      }
      continue;
    }

    host.setAttribute(HOST_MARK, '1');
    ensureHostPositioning(host);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.setAttribute(BTN_MARK, '1');
    
    // 即使暂时获取不到 mid，也创建按钮（但会禁用）
    if (mid) {
      btn.dataset.mid = mid;
      setBtnState(btn, pinnedSet.has(mid));
    } else {
      // 暂时没有 mid，创建按钮但禁用，并标记需要重试
      btn.dataset.mid = '';
      btn.dataset.retry = '1';
      btn.disabled = true;
      ensurePinBtnContent(btn);
      btn.setAttribute('aria-label', '置顶（正在加载）');
      btn.title = '正在获取UP信息，请稍候...';
      btn.style.opacity = '0.5';
    }

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      // 如果按钮被禁用，先尝试重新获取 mid
      if (btn.disabled || !mid) {
        mid = getItemMid(item);
        if (mid && /^\d+$/.test(mid)) {
          btn.dataset.mid = mid;
          btn.disabled = false;
          btn.style.opacity = '';
          btn.title = '';
          btn.removeAttribute('data-retry');
          setBtnState(btn, pinnedSet.has(mid));
        } else {
          showToast('正在获取UP信息，请稍候再试');
          return;
        }
      }

      const currentlyPinned = btn.dataset.pinned === '1';
      if (currentlyPinned) {
        await unpinUp(mid);
      } else {
        // 再次检查 mid 是否有效
        if (!mid || !/^\d+$/.test(mid)) {
          showToast('无法置顶：未获取到真实的UP ID。请等待页面加载完成后再试。');
          console.warn('[bili-pin] cannot pin: no real mid', { mid });
          return;
        }
        
        try {
          const meta = extractNameAndFaceFromItem(item);
          await pinUp({ mid, ...meta } as any);
        } catch (error: any) {
          showToast(error.message || '置顶失败，请重试');
          console.error('[bili-pin] pin failed', error);
          return;
        }
      }

      // 同步UI（按钮 + 置顶栏）
      await refreshPinUi(stripRoot);
    });

    host.appendChild(btn);

    // 如果暂时没有 mid，延迟重试获取
    if (!mid) {
      setTimeout(() => {
        const retryMid = getItemMid(item);
        if (retryMid && /^\d+$/.test(retryMid)) {
          btn.dataset.mid = retryMid;
          btn.disabled = false;
          btn.style.opacity = '';
          btn.title = '';
          btn.removeAttribute('data-retry');
          setBtnState(btn, pinnedSet.has(retryMid));
        }
      }, 1000); // 1秒后重试
    }
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
        setActiveUid(null);
        return;
      }
    }

    const mid = getItemMid(item);

    if (!mid) {
      // 点击了“全部动态”之类拿不到 mid 的入口：清空置顶栏高亮
      setActiveUid(null);
      return;
    }

    getPinnedUps().then((pinned) => {
      const isPinned = pinned.some((p) => p.mid === mid);
      // 点击了一个已置顶的UP：同步高亮；否则清空高亮，避免误导
      setActiveUid(isPinned ? mid : null);
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
      setActiveUid(null);
    },
    true,
  );
}

async function refreshPinUi(stripRoot: HTMLElement): Promise<void> {
  const pinned = await getPinnedUps();

  // 回填/修正昵称与头像：space 页置顶时可能缺 portal 缓存（或曾经抓错 DOM），导致 name/face 不准。
  // 动态页 portal 有可靠的 {mid,name,face}，因此优先用它修正并写回 storage（一次性纠正历史脏数据）。
  let needWriteBack = false;
  const enriched = pinned.map((p) => {
    const info = getUpInfoByMid(p.mid);
    if (!info) return p;
    const name = (info.name || '').trim() || undefined;
    const face = (info.face || '').trim() || undefined;

    // face 的合并策略要更保守：只有在“原本没有 face 或明显不是头像 URL”时才覆盖，避免引入回归。
    const currentFace = (p.face || '').trim() || undefined;
    const isLikelyFaceUrl = (u?: string) => !!u && /\/bfs\/face\//.test(u);

    const next: PinnedUp = {
      ...p,
      // 昵称以 portal 为准（更可靠）
      name: name ?? p.name,
      // 头像只在必要时回填
      face: currentFace ? currentFace : (isLikelyFaceUrl(face) ? face : undefined) ?? p.face,
    };
    if (next.name !== p.name || next.face !== p.face) needWriteBack = true;
    return next;
  });
  if (needWriteBack) {
    await setPinnedUps(enriched);
  }

  const pinnedForRender = needWriteBack ? enriched : pinned;
  const pinnedSet = new Set(pinnedForRender.map((x) => x.mid));

  const bar = ensurePinBar(stripRoot);
  syncPinBarSizingFromBili(stripRoot, bar);
  await ensurePinBarPrefs(bar);
  renderPinBar(bar, pinnedForRender, {
    onClickMid: async (mid) => {
      // 设置高亮（在点击时立即显示反馈）
      setActiveUid(mid);
      
      // 直接在动态页内切换（不再打开空间页/不再桥接 DOM 点击）
      const pinnedUp = pinnedForRender.find((p) => p.mid === mid);
      const ok = await filterFeedDirectly(stripRoot, mid, pinnedUp?.name, pinnedUp?.face);
      if (!ok) showToast('切换失败：暂时无法在动态页内刷新该UP的Feed，请稍后重试');
    },
    onUnpinMid: async (mid) => {
      try {
        await unpinUp(mid);
        await refreshPinUi(stripRoot);
      } catch (err) {
        console.warn('[bili-pin] unpin failed', err);
      }
    },
    onReorder: async (newOrderMids) => {
      const pinned = await getPinnedUps();
      const map = new Map(pinned.map((p) => [p.mid, p]));
      const next: PinnedUp[] = [];

      for (const mid of newOrderMids) {
        const p = map.get(mid);
        if (p) {
          next.push(p);
          map.delete(mid);
        }
      }

      // 兜底：保留任何不在新顺序里的项
      for (const p of map.values()) {
        next.push(p);
      }

      await setPinnedUps(next);
    },
  });

  renderButtons(stripRoot, pinnedSet);

  // portal up_list ready 后，主动刷新一次（让按钮从“禁用”变为“可用”）
  if (!stripRoot.hasAttribute('data-bili-pin-portal-listener')) {
    stripRoot.setAttribute('data-bili-pin-portal-listener', '1');
    window.addEventListener('bili-pin:portal-up-list', () => {
      refreshPinUi(stripRoot).catch(() => {});
    });
  }

  // 监听推荐列表的选中状态（只设置一次）
  if (!stripRoot.hasAttribute('data-bili-pin-selection-observer')) {
    stripRoot.setAttribute('data-bili-pin-selection-observer', '1');
    observeRecommendationListSelection(stripRoot);
  }

  installGlobalExitFilterListenersOnce();
}

export async function injectPinUi(stripRoot: HTMLElement): Promise<void> {
  await refreshPinUi(stripRoot);
}
