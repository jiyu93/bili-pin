import Sortable from 'sortablejs';
import type { PinnedUp } from '../storage/pins';
import { getUpUpdateStatus, markUpAsRead } from '../bili/apiInterceptor';

export const PIN_BAR_ID = 'bili-pin-pinbar';
export const PIN_BAR_LIST_ID = 'bili-pin-pinbar-list';
export const PIN_BAR_TOGGLE_ID = 'bili-pin-pinbar-toggle';
export const PIN_BAR_COUNT_ID = 'bili-pin-pinbar-count';

const PIN_BAR_EXPANDED_KEY = 'biliPin.ui.pinBarExpanded.v1';

export type PinBarHandlers = {
  onClickMid?: (mid: string) => void;
  onUnpinMid?: (mid: string) => void;
  onReorder?: (mids: string[]) => void;
};

// 当前选中的UP mid（用于高亮显示）
let currentActiveMid: string | null = null;

async function storageGetBool(key: string, fallback: boolean): Promise<boolean> {
  const chromeStorage = (globalThis as any).chrome?.storage?.local;
  if (chromeStorage?.get) {
    return await new Promise<boolean>((resolve) => {
      chromeStorage.get({ [key]: fallback }, (result: Record<string, unknown>) => {
        resolve(Boolean(result?.[key] ?? fallback));
      });
    });
  }

  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? Boolean(JSON.parse(raw)) : fallback;
  } catch {
    return fallback;
  }
}

async function storageSetBool(key: string, value: boolean): Promise<void> {
  const chromeStorage = (globalThis as any).chrome?.storage?.local;
  if (chromeStorage?.set) {
    await new Promise<void>((resolve) => {
      chromeStorage.set({ [key]: value }, () => resolve());
    });
    return;
  }

  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export async function ensurePinBarPrefs(bar: HTMLElement): Promise<void> {
  if (bar.dataset.prefsLoaded === '1') return;
  bar.dataset.prefsLoaded = '1';
  const expanded = await storageGetBool(PIN_BAR_EXPANDED_KEY, false);
  bar.dataset.expanded = expanded ? '1' : '0';
}

export function ensurePinBar(stripRoot: HTMLElement): HTMLElement {
  const existing = document.getElementById(PIN_BAR_ID);
  if (existing) return existing;

  const bar = document.createElement('div');
  bar.id = PIN_BAR_ID;
  bar.className = 'bili-pin-bar';
  bar.dataset.expanded = '0';

  const header = document.createElement('div');
  header.className = 'bili-pin-bar__header';

  const title = document.createElement('div');
  title.className = 'bili-pin-bar__title';

  const titleText = document.createElement('span');
  titleText.className = 'bili-pin-bar__titleText';
  titleText.textContent = '置顶动态';

  const count = document.createElement('span');
  count.id = PIN_BAR_COUNT_ID;
  count.className = 'bili-pin-bar__count';
  count.textContent = '0';

  title.appendChild(titleText);
  title.appendChild(count);

  const toggle = document.createElement('button');
  toggle.id = PIN_BAR_TOGGLE_ID;
  toggle.type = 'button';
  toggle.className = 'bili-pin-bar__toggle';
  toggle.textContent = '展开';
  toggle.style.display = 'none';
  toggle.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const next = bar.dataset.expanded === '1' ? '0' : '1';
    bar.dataset.expanded = next;
    // 记住展开/收起状态
    storageSetBool(PIN_BAR_EXPANDED_KEY, next === '1').catch(() => {});
    // 切换后重新计算是否需要按钮/文案
    requestAnimationFrame(() => updatePinBarCollapse(bar));
  });

  header.appendChild(title);
  header.appendChild(toggle);

  const list = document.createElement('div');
  list.id = PIN_BAR_LIST_ID;
  list.className = 'bili-pin-bar__list';
  list.classList.add('is-collapsed');

  bar.appendChild(header);
  bar.appendChild(list);

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

function updatePinBarCollapse(bar: HTMLElement): void {
  const list = bar.querySelector<HTMLElement>(`#${PIN_BAR_LIST_ID}`);
  const toggle = bar.querySelector<HTMLButtonElement>(`#${PIN_BAR_TOGGLE_ID}`);
  const countEl = bar.querySelector<HTMLElement>(`#${PIN_BAR_COUNT_ID}`);
  if (!list || !toggle) return;

  const expanded = bar.dataset.expanded === '1';
  list.classList.toggle('is-expanded', expanded);
  list.classList.toggle('is-collapsed', !expanded);

  const items = Array.from(list.querySelectorAll<HTMLElement>('.bili-pin-bar__item'));
  const total = items.length;
  if (countEl) countEl.textContent = String(total);

  // 判断是否有第二行：用 offsetTop 判断，比高度更直观
  let hiddenCount = 0;
  if (items.length > 0) {
    const firstTop = Math.min(...items.map((el) => el.offsetTop));
    hiddenCount = items.filter((el) => el.offsetTop > firstTop + 1).length;
  }

  const needsToggle = hiddenCount > 0;
  toggle.style.display = needsToggle ? '' : 'none';

  // 文案
  if (needsToggle) {
    toggle.textContent = expanded ? '收起' : `展开(还有${hiddenCount}个)`;
  } else {
    // 不需要展开：强制为收起状态，避免占位
    bar.dataset.expanded = '0';
    list.classList.remove('is-expanded');
    list.classList.add('is-collapsed');
    // 顺带把状态记为收起，避免下次加载时仍是展开
    storageSetBool(PIN_BAR_EXPANDED_KEY, false).catch(() => {});
  }
}

/**
 * 设置当前激活的UP（用于高亮显示）
 */
export function setActiveUid(uid: string | null): void {
  currentActiveMid = uid;
  updateActiveHighlight();

  // 如果激活了某个UP，清除其更新状态（消蓝点）
  if (uid) {
    markUpAsRead(uid);
    // 立即更新DOM，移除蓝点
    const bar = document.getElementById(PIN_BAR_ID);
    if (bar) {
      const item = bar.querySelector<HTMLElement>(`.bili-pin-bar__item[data-mid="${uid}"]`);
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
      setActiveUid(up.mid);
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

  requestAnimationFrame(() => updatePinBarCollapse(bar));
}


