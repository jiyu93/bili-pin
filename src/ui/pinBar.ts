import type { PinnedUp } from '../storage/pins';

export const PIN_BAR_ID = 'bili-pin-pinbar';
export const PIN_BAR_LIST_ID = 'bili-pin-pinbar-list';

export type PinBarHandlers = {
  onClickUid?: (uid: string) => void;
};

export function ensurePinBar(stripRoot: HTMLElement): HTMLElement {
  const existing = document.getElementById(PIN_BAR_ID);
  if (existing) return existing;

  const bar = document.createElement('div');
  bar.id = PIN_BAR_ID;
  bar.className = 'bili-pin-bar';

  const title = document.createElement('div');
  title.className = 'bili-pin-bar__title';
  title.textContent = '置顶UP';

  const list = document.createElement('div');
  list.id = PIN_BAR_LIST_ID;
  list.className = 'bili-pin-bar__list';

  bar.appendChild(title);
  bar.appendChild(list);

  // 插到“原头像横条”上方
  stripRoot.insertAdjacentElement('beforebegin', bar);
  return bar;
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
}


