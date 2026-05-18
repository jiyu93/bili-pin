import Sortable from 'sortablejs';
import type { PinnedUp } from '../storage/pins';
import { getUpUpdateStatus, markUpAsRead } from '../bili/apiInterceptor';
import { readStorageValue, writeMirroredConfig, writeStorageValue } from '../storage/config';
import {
  PIN_BAR_EXPANDED_KEY,
  PIN_BAR_EXPANDED_STATE_KEY,
  PIN_BAR_HEIGHT_KEY,
  PIN_BAR_HEIGHT_STATE_KEY,
} from '../storage/keys';

export const PIN_BAR_ID = 'bili-pin-pinbar';
export const PIN_BAR_LIST_ID = 'bili-pin-pinbar-list';
export const PIN_BAR_COUNT_ID = 'bili-pin-pinbar-count';
export const PIN_BAR_RESIZE_ID = 'bili-pin-pinbar-resize';

const PIN_BAR_MIN_HEIGHT = 104;
const PIN_BAR_DEFAULT_HEIGHT = 120;
const PIN_BAR_EXPANDED_FALLBACK_HEIGHT = 236;
const PIN_BAR_MAX_HEIGHT = 480;

type BoolState = {
  value: boolean;
  updatedAt: number;
};

type NumberState = {
  value: number;
  updatedAt: number;
};

type PinBarListWithPersistState = HTMLElement & {
  __biliPinPersistedHeight?: number;
  __biliPinPendingHeight?: number;
  __biliPinSavingHeight?: boolean;
};

export type PinBarHandlers = {
  onClickMid?: (mid: string) => void;
  onUnpinMid?: (mid: string) => void;
  onReorder?: (mids: string[]) => void;
};

// 当前选中的UP mid（用于高亮显示）
let currentActiveMid: string | null = null;

async function storageGetBool(key: string, fallback: boolean): Promise<boolean> {
  const [syncStateEntry, localStateEntry, syncLegacyEntry, localLegacyEntry] = await Promise.all([
    readStorageValue<BoolState>('sync', PIN_BAR_EXPANDED_STATE_KEY),
    readStorageValue<BoolState>('local', PIN_BAR_EXPANDED_STATE_KEY),
    readStorageValue<boolean>('sync', key),
    readStorageValue<boolean>('local', key),
  ]);

  const syncState = syncStateEntry.found
    ? {
        value: Boolean(syncStateEntry.value?.value),
        updatedAt: Number(syncStateEntry.value?.updatedAt ?? 0) || 0,
      }
    : syncLegacyEntry.found
      ? { value: Boolean(syncLegacyEntry.value), updatedAt: 0 }
      : null;
  const localState = localStateEntry.found
    ? {
        value: Boolean(localStateEntry.value?.value),
        updatedAt: Number(localStateEntry.value?.updatedAt ?? 0) || 0,
      }
    : localLegacyEntry.found
      ? { value: Boolean(localLegacyEntry.value), updatedAt: 0 }
      : null;

  const authoritative = syncState ?? localState ?? { value: fallback, updatedAt: 0 };

  const syncLegacyValue = syncLegacyEntry.found ? Boolean(syncLegacyEntry.value) : fallback;
  const localLegacyValue = localLegacyEntry.found ? Boolean(localLegacyEntry.value) : fallback;
  const syncStateDirty =
    !syncStateEntry.found || !syncState || syncState.value !== authoritative.value || syncState.updatedAt !== authoritative.updatedAt;
  const localStateDirty =
    !localStateEntry.found || !localState || localState.value !== authoritative.value || localState.updatedAt !== authoritative.updatedAt;
  const syncLegacyDirty = !syncLegacyEntry.found || syncLegacyValue !== authoritative.value;
  const localLegacyDirty = !localLegacyEntry.found || localLegacyValue !== authoritative.value;

  if (!syncState && localState && (syncStateDirty || syncLegacyDirty)) {
    await writeStorageValue('sync', PIN_BAR_EXPANDED_STATE_KEY, authoritative);
    await writeStorageValue('sync', key, authoritative.value);
  }

  if (syncState && (localStateDirty || localLegacyDirty)) {
    await writeStorageValue('local', PIN_BAR_EXPANDED_STATE_KEY, authoritative);
    await writeStorageValue('local', key, authoritative.value);
  }

  return authoritative.value;
}

function normalizePinBarHeight(value: number): number {
  if (!Number.isFinite(value)) return PIN_BAR_DEFAULT_HEIGHT;
  return Math.max(PIN_BAR_MIN_HEIGHT, Math.min(PIN_BAR_MAX_HEIGHT, Math.round(value)));
}

async function storageGetPinBarHeight(): Promise<number> {
  const [syncStateEntry, localStateEntry, syncLegacyEntry, localLegacyEntry] = await Promise.all([
    readStorageValue<NumberState>('sync', PIN_BAR_HEIGHT_STATE_KEY),
    readStorageValue<NumberState>('local', PIN_BAR_HEIGHT_STATE_KEY),
    readStorageValue<number>('sync', PIN_BAR_HEIGHT_KEY),
    readStorageValue<number>('local', PIN_BAR_HEIGHT_KEY),
  ]);

  const syncState = syncStateEntry.found
    ? {
        value: normalizePinBarHeight(Number(syncStateEntry.value?.value)),
        updatedAt: Number(syncStateEntry.value?.updatedAt ?? 0) || 0,
      }
    : syncLegacyEntry.found
      ? { value: normalizePinBarHeight(Number(syncLegacyEntry.value)), updatedAt: 0 }
      : null;
  const localState = localStateEntry.found
    ? {
        value: normalizePinBarHeight(Number(localStateEntry.value?.value)),
        updatedAt: Number(localStateEntry.value?.updatedAt ?? 0) || 0,
      }
    : localLegacyEntry.found
      ? { value: normalizePinBarHeight(Number(localLegacyEntry.value)), updatedAt: 0 }
      : null;

  let authoritative = syncState ?? localState ?? null;
  if (!authoritative) {
    const expanded = await storageGetBool(PIN_BAR_EXPANDED_KEY, false);
    authoritative = {
      value: expanded ? PIN_BAR_EXPANDED_FALLBACK_HEIGHT : PIN_BAR_DEFAULT_HEIGHT,
      updatedAt: 0,
    };
  }

  const syncLegacyValue = syncLegacyEntry.found ? normalizePinBarHeight(Number(syncLegacyEntry.value)) : authoritative.value;
  const localLegacyValue = localLegacyEntry.found ? normalizePinBarHeight(Number(localLegacyEntry.value)) : authoritative.value;
  const syncStateDirty =
    !syncStateEntry.found || !syncState || syncState.value !== authoritative.value || syncState.updatedAt !== authoritative.updatedAt;
  const localStateDirty =
    !localStateEntry.found || !localState || localState.value !== authoritative.value || localState.updatedAt !== authoritative.updatedAt;
  const syncLegacyDirty = !syncLegacyEntry.found || syncLegacyValue !== authoritative.value;
  const localLegacyDirty = !localLegacyEntry.found || localLegacyValue !== authoritative.value;

  if ((!syncState || syncStateDirty || syncLegacyDirty) && authoritative) {
    await writeStorageValue('sync', PIN_BAR_HEIGHT_STATE_KEY, authoritative);
    await writeStorageValue('sync', PIN_BAR_HEIGHT_KEY, authoritative.value);
  }

  if ((!localState || localStateDirty || localLegacyDirty) && authoritative) {
    await writeStorageValue('local', PIN_BAR_HEIGHT_STATE_KEY, authoritative);
    await writeStorageValue('local', PIN_BAR_HEIGHT_KEY, authoritative.value);
  }

  return authoritative.value;
}

async function storageSetPinBarHeight(value: number): Promise<void> {
  const normalized = normalizePinBarHeight(value);
  const state: NumberState = {
    value: normalized,
    updatedAt: Date.now(),
  };
  await writeMirroredConfig(PIN_BAR_HEIGHT_STATE_KEY, state);
  await writeMirroredConfig(PIN_BAR_HEIGHT_KEY, normalized);
}

function applyPinBarHeight(list: HTMLElement, height: number): void {
  const normalized = normalizePinBarHeight(height);
  list.style.height = `${normalized}px`;
}

function setPersistedPinBarHeight(list: HTMLElement, height: number): void {
  const normalized = normalizePinBarHeight(height);
  (list as PinBarListWithPersistState).__biliPinPersistedHeight = normalized;
}

function getPersistedPinBarHeight(list: HTMLElement): number | null {
  const persisted = (list as PinBarListWithPersistState).__biliPinPersistedHeight;
  if (typeof persisted !== 'number' || !Number.isFinite(persisted)) return null;
  return normalizePinBarHeight(persisted);
}

function getAppliedPinBarHeight(list: HTMLElement): number {
  const inlineHeight = Number.parseFloat(list.style.height || '');
  if (Number.isFinite(inlineHeight)) {
    return normalizePinBarHeight(inlineHeight);
  }

  const computedHeight = Number.parseFloat(globalThis.getComputedStyle(list).height || '');
  if (Number.isFinite(computedHeight)) {
    return normalizePinBarHeight(computedHeight);
  }

  return normalizePinBarHeight(list.clientHeight);
}

function queuePinBarHeightPersist(list: HTMLElement, height: number): void {
  const state = list as PinBarListWithPersistState;
  const normalized = normalizePinBarHeight(height);
  const persistedHeight = getPersistedPinBarHeight(list);
  if (normalized === persistedHeight && state.__biliPinPendingHeight == null && !state.__biliPinSavingHeight) {
    return;
  }

  state.__biliPinPendingHeight = normalized;
  if (state.__biliPinSavingHeight) return;

  state.__biliPinSavingHeight = true;

  const flushNext = () => {
    const nextHeight = state.__biliPinPendingHeight;
    if (typeof nextHeight !== 'number' || !Number.isFinite(nextHeight)) {
      state.__biliPinSavingHeight = false;
      return;
    }

    state.__biliPinPendingHeight = undefined;

    void storageSetPinBarHeight(nextHeight)
      .then(() => {
        setPersistedPinBarHeight(list, nextHeight);
      })
      .catch(() => {})
      .finally(() => {
        flushNext();
      });
  };

  flushNext();
}

export async function ensurePinBarPrefs(bar: HTMLElement): Promise<void> {
  if (bar.dataset.prefsLoaded === '1') return;
  bar.dataset.prefsLoaded = '1';
  const list = bar.querySelector<HTMLElement>(`#${PIN_BAR_LIST_ID}`);
  if (!list) return;

  const height = await storageGetPinBarHeight();
  applyPinBarHeight(list, height);
  setPersistedPinBarHeight(list, height);
  updatePinBarLayout(bar);
}

export function ensurePinBar(stripRoot: HTMLElement): HTMLElement {
  const existing = document.getElementById(PIN_BAR_ID);
  if (existing) return existing;

  const bar = document.createElement('div');
  bar.id = PIN_BAR_ID;
  bar.className = 'bili-pin-bar';

  const header = document.createElement('div');
  header.className = 'bili-pin-bar__header';

  const title = document.createElement('div');
  title.className = 'bili-pin-bar__title';

  const titleText = document.createElement('span');
  titleText.className = 'bili-pin-bar__titleText';
  titleText.textContent = '置顶UP主';

  const count = document.createElement('span');
  count.id = PIN_BAR_COUNT_ID;
  count.className = 'bili-pin-bar__count';
  count.textContent = '0';

  title.appendChild(titleText);
  title.appendChild(count);

  header.appendChild(title);

  const list = document.createElement('div');
  list.id = PIN_BAR_LIST_ID;
  list.className = 'bili-pin-bar__list';

  const resize = document.createElement('button');
  resize.id = PIN_BAR_RESIZE_ID;
  resize.type = 'button';
  resize.className = 'bili-pin-bar__resize';
  resize.setAttribute('aria-label', '拖动调整置顶栏高度');
  resize.title = '拖动调整高度';

  bar.appendChild(header);
  bar.appendChild(list);
  bar.appendChild(resize);
  ensurePinBarResizeHandle(bar, list, resize);

  // 插到“关注UP推荐列表”上方
  // 注意：`.bili-dyn-up-list` 通常是 flex 容器，若把 bar 插在其内部会与关注UP推荐列表同一行分宽度
  // 因此优先插在 `.bili-dyn-up-list` 外部的上一层，保证独占一行
  const listRoot = stripRoot.closest<HTMLElement>('.bili-dyn-up-list');
  if (listRoot?.parentElement) {
    listRoot.insertAdjacentElement('beforebegin', bar);
  } else {
    // 兜底：至少保证能插入
    stripRoot.insertAdjacentElement('beforebegin', bar);
  }
  return bar;
}

function ensurePinBarResizeHandle(bar: HTMLElement, list: HTMLElement, handle: HTMLButtonElement): void {
  if (handle.dataset.dragInstalled === '1') return;
  handle.dataset.dragInstalled = '1';

  let dragging = false;
  let startY = 0;
  let startHeight = 0;

  const finishDrag = () => {
    if (!dragging) return;
    dragging = false;
    bar.dataset.resizing = '0';
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', onPointerUp, true);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    event.preventDefault();
    const nextHeight = normalizePinBarHeight(startHeight + (event.clientY - startY));
    applyPinBarHeight(list, nextHeight);
  };

  const onPointerUp = () => {
    const finalHeight = getAppliedPinBarHeight(list);
    const persistedHeight = getPersistedPinBarHeight(list);
    finishDrag();
    if (finalHeight === persistedHeight) {
      return;
    }
    queuePinBarHeightPersist(list, finalHeight);
  };

  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    startY = event.clientY;
    startHeight = getAppliedPinBarHeight(list);
    bar.dataset.resizing = '1';
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
  });
}

function updatePinBarLayout(bar: HTMLElement): void {
  const list = bar.querySelector<HTMLElement>(`#${PIN_BAR_LIST_ID}`);
  const countEl = bar.querySelector<HTMLElement>(`#${PIN_BAR_COUNT_ID}`);
  if (!list) return;

  const items = Array.from(list.querySelectorAll<HTMLElement>('.bili-pin-bar__item'));
  const total = items.length;
  if (countEl) countEl.textContent = String(total);
}

/**
 * 设置当前激活的UP（用于高亮显示）
 */
export function setActiveMid(mid: string | null): void {
  currentActiveMid = mid;
  updateActiveHighlight();

  // 如果激活了某个UP，清除其更新状态（消蓝点）
  if (mid) {
    markUpAsRead(mid);
    // 立即更新DOM，移除蓝点
    const bar = document.getElementById(PIN_BAR_ID);
    if (bar) {
      const item = bar.querySelector<HTMLElement>(`.bili-pin-bar__item[data-mid="${mid}"]`);
      if (item) {
        const dot = item.querySelector('.bili-pin-bar__updateDot');
        if (dot) dot.remove();
      }
    }
  }
}

/**
 * 更新高亮显示
 */
function updateActiveHighlight(): void {
  const bar = document.getElementById(PIN_BAR_ID);
  if (!bar) return;

  const list = bar.querySelector<HTMLElement>(`#${PIN_BAR_LIST_ID}`);
  if (!list) return;

  const items = Array.from(list.querySelectorAll<HTMLElement>('.bili-pin-bar__item'));
  for (const item of items) {
    const itemMid = item.dataset.mid;
    if (itemMid === currentActiveMid) {
      item.classList.add('is-active');
    } else {
      item.classList.remove('is-active');
    }
  }
}

export function renderPinBar(
  bar: HTMLElement,
  pinned: PinnedUp[],
  handlers: PinBarHandlers = {},
): void {
  const list = bar.querySelector<HTMLElement>(`#${PIN_BAR_LIST_ID}`);
  if (!list) return;

  list.innerHTML = '';

  // 销毁旧实例（如果有），防止内存泄漏
  if ((list as any)._sortable) {
    (list as any)._sortable.destroy();
    delete (list as any)._sortable;
  }

  // 初始化 Sortable
  (list as any)._sortable = new Sortable(list, {
    animation: 250, // 动画时间
    delay: 100, // 稍微延迟一点，避免误触点击
    delayOnTouchOnly: true,
    touchStartThreshold: 3, // 必须移动多少像素才开始拖拽
    ghostClass: 'bili-pin-ghost', // 占位符样式
    dragClass: 'bili-pin-dragging', // 拖拽中样式
    direction: 'horizontal', // 主要是水平布局（grid 其实也是）
    onEnd: (evt) => {
      // 获取新的顺序
      const newOrder = Array.from(list.querySelectorAll<HTMLElement>('.bili-pin-bar__item'))
        .map((el) => el.dataset.mid)
        .filter(Boolean) as string[];

      // 检查顺序是否变化
      const oldOrder = pinned.map((p) => p.mid);
      if (JSON.stringify(newOrder) !== JSON.stringify(oldOrder)) {
        handlers.onReorder?.(newOrder);
      }
    },
  });

  for (const up of pinned) {
    const item = document.createElement('div');
    item.className = 'bili-pin-bar__item';
    item.dataset.mid = up.mid;
    // Sortable 会处理 draggable，不需要手动设，但为了语义化可以留着，不过 Sortable 通常不需要
    // item.draggable = true; 

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'bili-pin-bar__itemMain';

    const faceWrap = document.createElement('div');
    faceWrap.className = 'bili-pin-bar__faceWrap';

    const img = document.createElement('img');
    img.className = 'bili-pin-bar__face';
    img.alt = up.name ?? up.mid;
    if (up.face) img.src = up.face;

    const name = document.createElement('div');
    name.className = 'bili-pin-bar__name';
    name.textContent = up.name ?? up.mid;

    // 检查是否有新动态更新（蓝点）
    if (getUpUpdateStatus(up.mid)) {
      const dot = document.createElement('div');
      dot.className = 'bili-pin-bar__updateDot';
      faceWrap.appendChild(dot);
    }

    faceWrap.appendChild(img);
    main.appendChild(name);

    main.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // 如果是鼠标点击，则主动移除焦点，避免 :focus-within 导致 X 按钮常驻
      if (e.detail > 0) {
        main.blur();
      }

      // 设置高亮
      setActiveMid(up.mid);
      handlers.onClickMid?.(up.mid);
    });

    const unpin = document.createElement('button');
    unpin.type = 'button';
    unpin.className = 'bili-pin-bar__unpin';
    unpin.setAttribute('aria-label', '取消置顶');
    unpin.title = '取消置顶';
    unpin.innerHTML = `
      <svg class="bili-pin-bar__unpinIcon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18 6l-12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `.trim();
    unpin.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handlers.onUnpinMid?.(up.mid);
    });
    faceWrap.appendChild(unpin);

    main.prepend(faceWrap);
    item.appendChild(main);
    list.appendChild(item);
  }

  // 更新高亮状态
  updateActiveHighlight();

  requestAnimationFrame(() => updatePinBarLayout(bar));
}
