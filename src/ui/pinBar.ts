import type { PinnedUp } from '../storage/pins';

export const PIN_BAR_ID = 'bili-pin-pinbar';
export const PIN_BAR_LIST_ID = 'bili-pin-pinbar-list';
export const PIN_BAR_TOGGLE_ID = 'bili-pin-pinbar-toggle';
export const PIN_BAR_COUNT_ID = 'bili-pin-pinbar-count';

const PIN_BAR_EXPANDED_KEY = 'biliPin.ui.pinBarExpanded.v1';

export type PinBarHandlers = {
  onClickUid?: (uid: string) => void;
  onUnpinUid?: (uid: string) => void;
};

// 当前选中的UP uid（用于高亮显示）
let currentActiveUid: string | null = null;

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
  titleText.textContent = '置顶UP';

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
    toggle.textContent = expanded ? '收起' : `展开（还有${hiddenCount}个）`;
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
  currentActiveUid = uid;
  updateActiveHighlight();
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
    const itemUid = item.dataset.uid;
    if (itemUid === currentActiveUid) {
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

  if (pinned.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'bili-pin-bar__empty';
    empty.textContent = '还没有置顶，去头像列表点"置顶"吧';
    list.appendChild(empty);
    requestAnimationFrame(() => updatePinBarCollapse(bar));
    return;
  }

  for (const up of pinned) {
    const item = document.createElement('div');
    item.className = 'bili-pin-bar__item';
    item.dataset.uid = up.uid;

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'bili-pin-bar__itemMain';

    const img = document.createElement('img');
    img.className = 'bili-pin-bar__face';
    img.alt = up.name ?? up.uid;
    if (up.face) img.src = up.face;

    const name = document.createElement('div');
    name.className = 'bili-pin-bar__name';
    name.textContent = up.name ?? up.uid;

    main.appendChild(img);
    main.appendChild(name);

    main.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 设置高亮
      setActiveUid(up.uid);
      handlers.onClickUid?.(up.uid);
    });

    const unpin = document.createElement('button');
    unpin.type = 'button';
    unpin.className = 'bili-pin-bar__unpin';
    unpin.textContent = '取消置顶';
    unpin.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handlers.onUnpinUid?.(up.uid);
    });

    item.appendChild(main);
    item.appendChild(unpin);
    list.appendChild(item);
  }

  // 更新高亮状态
  updateActiveHighlight();

  requestAnimationFrame(() => updatePinBarCollapse(bar));
}


