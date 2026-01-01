import type { PinnedUp } from '../storage/pins';

export const PIN_BAR_ID = 'bili-pin-pinbar';
export const PIN_BAR_LIST_ID = 'bili-pin-pinbar-list';
export const PIN_BAR_TOGGLE_ID = 'bili-pin-pinbar-toggle';

export type PinBarHandlers = {
  onClickUid?: (uid: string) => void;
};

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
  title.textContent = '置顶UP';

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
  if (!list || !toggle) return;

  const expanded = bar.dataset.expanded === '1';
  list.classList.toggle('is-expanded', expanded);
  list.classList.toggle('is-collapsed', !expanded);

  // 判断是否需要展开按钮：用折叠高度阈值判断，而不是用 clientHeight（展开后会误判）
  const collapsedMax =
    Number.parseFloat(getComputedStyle(list).getPropertyValue('--bili-pin-collapsed-max-height')) || 72;
  const needsToggle = list.scrollHeight > collapsedMax + 2;
  toggle.style.display = needsToggle ? '' : 'none';

  // 文案
  if (needsToggle) {
    toggle.textContent = expanded ? '收起' : '展开';
  } else {
    // 不需要展开：强制为收起状态，避免占位
    bar.dataset.expanded = '0';
    list.classList.remove('is-expanded');
    list.classList.add('is-collapsed');
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
    empty.textContent = '还没有置顶，去头像列表点“置顶”吧';
    list.appendChild(empty);
    requestAnimationFrame(() => updatePinBarCollapse(bar));
    return;
  }

  for (const up of pinned) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'bili-pin-bar__item';
    item.dataset.uid = up.uid;

    const img = document.createElement('img');
    img.className = 'bili-pin-bar__face';
    img.alt = up.name ?? up.uid;
    if (up.face) img.src = up.face;

    const name = document.createElement('div');
    name.className = 'bili-pin-bar__name';
    name.textContent = up.name ?? up.uid;

    item.appendChild(img);
    item.appendChild(name);

    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handlers.onClickUid?.(up.uid);
    });

    list.appendChild(item);
  }

  requestAnimationFrame(() => updatePinBarCollapse(bar));
}


