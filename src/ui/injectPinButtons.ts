import { filterFeedDirectly } from '../bili/clickBridge';
import { getPinnedUps, pinUp, unpinUp, type PinnedUp } from '../storage/pins';
import { ensurePinBar, ensurePinBarPrefs, renderPinBar, setActiveUid } from './pinBar';
import { showToast } from './toast';
import { getUpInfoByFace } from '../bili/apiInterceptor';

const BTN_CLASS = 'bili-pin-btn';
const BTN_MARK = 'data-bili-pin-btn';
const HOST_MARK = 'data-bili-pin-host';

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

function ensureHostPositioning(host: HTMLElement) {
  const cs = getComputedStyle(host);
  if (cs.position === 'static') host.style.position = 'relative';
}

function setBtnState(btn: HTMLButtonElement, pinned: boolean) {
  btn.textContent = pinned ? '已置顶' : '置顶';
  btn.dataset.pinned = pinned ? '1' : '0';
  btn.classList.toggle('is-pinned', pinned);
}

function renderButtons(stripRoot: HTMLElement, pinnedSet: Set<string>) {
  const items = findUpItems(stripRoot);

  for (const item of items) {
    let mid = getItemMid(item);
    
    const host = item;

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
      btn.textContent = '置顶';
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
  stripRoot.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const item = target.closest<HTMLElement>('.bili-dyn-up-list__item');
    if (!item) return;

    const mid = getItemMid(item);
    if (!mid) return;
    getPinnedUps().then((pinned) => {
      const isPinned = pinned.some((p) => p.mid === mid);
      if (isPinned) setActiveUid(mid);
    });
  });
}

async function refreshPinUi(stripRoot: HTMLElement): Promise<void> {
  const pinned = await getPinnedUps();
  const pinnedSet = new Set(pinned.map((x) => x.mid));

  const bar = ensurePinBar(stripRoot);
  await ensurePinBarPrefs(bar);
  renderPinBar(bar, pinned, {
    onClickMid: async (mid) => {
      // 设置高亮（在点击时立即显示反馈）
      setActiveUid(mid);
      
      // 直接在动态页内切换（不再打开空间页/不再桥接 DOM 点击）
      const pinnedUp = pinned.find((p) => p.mid === mid);
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
}

export async function injectPinUi(stripRoot: HTMLElement): Promise<void> {
  await refreshPinUi(stripRoot);
}


