import { isPinned, onPinsChange, pinUp, unpinUp } from '../storage/pins';
import { showToast } from './toast';

const CARD_SELECTOR = '.b-user-video-card, .b-user-info-card';
const ACTIONS_SELECTOR = '.user-actions';
const BUTTON_MARK = 'data-bili-pin-search-user-button';
const CARD_MARK = 'data-bili-pin-search-user-card';
const ROOT_SELECTOR = '#i_cecream, .search-page-wrapper, .search-content';

function extractMidFromHref(href: string): string | null {
  const m = String(href || '').match(/space\.bilibili\.com\/(\d+)/);
  const mid = m?.[1] ?? '';
  return /^\d+$/.test(mid) ? mid : null;
}

function getSrcsetFirstValue(raw: string | null | undefined): string {
  return String(raw || '').split(',')[0]?.trim().split(' ')[0]?.trim() || '';
}

function getUserInfo(card: HTMLElement): { mid: string | null; name?: string; face?: string } {
  const link =
    card.querySelector<HTMLAnchorElement>('.user-name[href*="space.bilibili.com/"]') ??
    card.querySelector<HTMLAnchorElement>('a[href*="space.bilibili.com/"]') ??
    null;
  const mid = link ? extractMidFromHref(link.href || link.getAttribute('href') || '') : null;

  const name = card.querySelector<HTMLElement>('.user-name')?.textContent?.trim() || undefined;

  const img =
    card.querySelector<HTMLImageElement>('.search-user-avatar img') ??
    card.querySelector<HTMLImageElement>('.bili-avatar-img') ??
    card.querySelector<HTMLImageElement>('img[src*="/bfs/face/"], img[data-src*="/bfs/face/"]') ??
    null;
  const srcset =
    img?.closest('picture')?.querySelector<HTMLSourceElement>('source[srcset]')?.getAttribute('srcset') ??
    img?.getAttribute('srcset') ??
    null;
  const face =
    img?.currentSrc ||
    img?.src ||
    img?.getAttribute('data-src') ||
    img?.getAttribute('src') ||
    getSrcsetFirstValue(srcset) ||
    undefined;

  return { mid, name, face: face ? String(face).trim() : undefined };
}

async function updateButtonText(button: HTMLButtonElement, mid: string): Promise<void> {
  const pinned = await isPinned(mid);
  button.textContent = pinned ? '取消置顶' : '置顶UP主';
  button.setAttribute('aria-label', pinned ? '取消置顶UP主' : '置顶UP主');
  button.classList.toggle('is-pinned', pinned);
}

function setBusy(button: HTMLButtonElement, busy: boolean): void {
  button.disabled = busy;
  button.style.opacity = busy ? '0.6' : '';
}

function createPinButton(template: HTMLButtonElement | null, card: HTMLElement, initialMid: string): HTMLButtonElement {
  const button = template ? (template.cloneNode(false) as HTMLButtonElement) : document.createElement('button');
  button.type = 'button';
  button.disabled = false;
  button.removeAttribute('disabled');
  button.removeAttribute('aria-disabled');
  button.classList.add('bili-pin-search-user-button');
  button.classList.remove('vui_button--disabled');
  button.setAttribute(BUTTON_MARK, '1');
  button.dataset.mid = initialMid;

  let busy = false;
  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;

    const latest = getUserInfo(card);
    const mid = latest.mid || button.dataset.mid || '';
    if (!/^\d+$/.test(mid)) {
      showToast('无法置顶：未获取到真实的UP ID');
      return;
    }

    busy = true;
    setBusy(button, true);
    button.textContent = '处理中...';

    try {
      const pinned = await isPinned(mid);
      if (pinned) {
        await unpinUp(mid);
        showToast('已取消置顶');
      } else {
        await pinUp({
          mid,
          name: latest.name,
          face: latest.face,
        });
        showToast('已置顶UP主');
      }
    } catch (err: any) {
      showToast(err?.message || '操作失败，请重试');
    } finally {
      await updateButtonText(button, mid).catch(() => {});
      setBusy(button, false);
      busy = false;
    }
  });

  return button;
}

function ensureButton(card: HTMLElement): void {
  const info = getUserInfo(card);
  if (!info.mid) return;

  const actions = card.querySelector<HTMLElement>(ACTIONS_SELECTOR);
  if (!actions) return;

  const existed = actions.querySelector<HTMLButtonElement>(`button[${BUTTON_MARK}="1"]`);
  if (existed) {
    existed.dataset.mid = info.mid;
    updateButtonText(existed, info.mid).catch(() => {});
    return;
  }

  const nativeButton = actions.querySelector<HTMLButtonElement>('button.vui_button, button');
  const button = createPinButton(nativeButton, card, info.mid);
  actions.appendChild(button);
  updateButtonText(button, info.mid).catch(() => {});
}

function scan(root: ParentNode = document): void {
  const cards = Array.from(root.querySelectorAll<HTMLElement>(CARD_SELECTOR));
  for (const card of cards) {
    if (card.getAttribute(CARD_MARK) === '1') {
      ensureButton(card);
      continue;
    }
    card.setAttribute(CARD_MARK, '1');
    ensureButton(card);
  }
}

function observeRoot(root: HTMLElement): void {
  scan(root);

  let scheduled = false;
  const scheduleScan = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      scan(root);
    });
  };

  const observer = new MutationObserver(scheduleScan);
  observer.observe(root, { childList: true, subtree: true });
}

export function observeSearchUserPin(): void {
  const html = document.documentElement;
  if (!html || html.getAttribute('data-bili-pin-search-user-installed') === '1') return;
  html.setAttribute('data-bili-pin-search-user-installed', '1');

  onPinsChange(() => {
    const buttons = document.querySelectorAll<HTMLButtonElement>(`button[${BUTTON_MARK}="1"]`);
    buttons.forEach((button) => {
      const mid = button.dataset.mid;
      if (mid) updateButtonText(button, mid).catch(() => {});
    });
  });

  const attach = () => {
    const root = document.querySelector<HTMLElement>(ROOT_SELECTOR) ?? document.body;
    if (!root) return false;
    observeRoot(root);
    return true;
  };

  if (attach()) return;

  const waitBody = new MutationObserver(() => {
    if (!attach()) return;
    waitBody.disconnect();
  });
  waitBody.observe(document.documentElement, { childList: true, subtree: true });
}
