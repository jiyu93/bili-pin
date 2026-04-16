import { isPinned, pinUp, unpinUp, onPinsChange } from '../storage/pins';
import { showToast } from './toast';
import { getUpInfoByMid } from '../bili/apiInterceptor';

const INSTALL_MARK = 'data-bili-pin-user-card-installed';
const CARD_MARK = 'data-bili-pin-user-card-scanned';
const BTN_MARK = 'data-bili-pin-user-card-btn';

function isLikelyUserCard(el: HTMLElement): boolean {
  const text = el.textContent || '';
  if (!text.includes('发消息')) return false;
  const hasFollow =
    text.includes('已关注') ||
    text.includes('+关注') ||
    text.includes('特别关注') ||
    /(?<!\S)关注(?!\S)/.test(text);
  if (!hasFollow) return false;
  const hasSpaceLink = !!el.querySelector('a[href*="space.bilibili.com/"]');
  if (!hasSpaceLink) return false;
  return true;
}

function findUserCardsUnder(root: Element): HTMLElement[] {
  const found = new Set<HTMLElement>();

  const selectors = [
    '.user-card',
    '.bili-user-card',
    '.bili-user-profile-card',
    '.user-profile-card',
    '.user-info-card',
    '.vui_popover',
    '[class*="user-card"]',
    '[class*="UserCard"]',
    '[class*="user-profile"]',
    '[class*="UserProfile"]',
  ];
  for (const s of selectors) {
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(s));
    for (const n of nodes) {
      if (isLikelyUserCard(n)) found.add(n);
    }
  }

  if (root instanceof HTMLElement && isLikelyUserCard(root)) {
    found.add(root);
  }

  return Array.from(found);
}

function extractMidFromCard(card: HTMLElement): string | null {
  const a = card.querySelector<HTMLAnchorElement>('a[href*="space.bilibili.com/"]');
  if (!a) return null;
  const href = a.getAttribute('href') || '';
  const m = href.match(/space\.bilibili\.com\/(\d+)/);
  const mid = m?.[1] ?? '';
  return /^\d+$/.test(mid) ? mid : null;
}

function getUpMetaFromCard(card: HTMLElement): { name?: string; face?: string } {
  const nameLink = card.querySelector<HTMLElement>('a[href*="space.bilibili.com/"]');
  const name = nameLink?.textContent?.trim() || undefined;

  const imgs = Array.from(card.querySelectorAll<HTMLImageElement>('img'));
  const face = imgs[0]?.currentSrc || imgs[0]?.src || undefined;
  return { name, face };
}

async function updateBtnText(btn: HTMLElement, mid: string): Promise<void> {
  const pinned = await isPinned(mid);
  btn.textContent = pinned ? '取消置顶' : '置顶动态';
}

function ensureButton(card: HTMLElement, mid: string): void {
  if (card.getAttribute(CARD_MARK) === '1') {
    const existed = card.querySelector<HTMLElement>(`[${BTN_MARK}="1"]`);
    if (existed) {
      updateBtnText(existed, mid).catch(() => {});
    }
    return;
  }
  card.setAttribute(CARD_MARK, '1');

  const buttons = Array.from(card.querySelectorAll<HTMLElement>('button'));
  const msgBtn = buttons.find((b) => (b.textContent || '').trim().includes('发消息')) ?? null;
  const followBtn =
    buttons.find((b) => {
      const t = (b.textContent || '').trim();
      return t.includes('已关注') || t.includes('+关注') || t === '关注' || t.includes('特别关注');
    }) ?? null;

  const template = msgBtn || followBtn;
  if (!template) return;

  const container = template.parentElement;
  if (!container) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = template.className;
  btn.setAttribute(BTN_MARK, '1');
  btn.dataset.mid = mid;

  let busy = false;
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    busy = true;
    btn.style.opacity = '0.6';
    btn.style.pointerEvents = 'none';

    try {
      const pinned = await isPinned(mid);
      if (pinned) {
        await unpinUp(mid);
        showToast('已取消置顶');
      } else {
        const meta = getUpMetaFromCard(card);
        const cached = getUpInfoByMid(mid);
        await pinUp({ mid, name: cached?.name || meta.name, face: cached?.face || meta.face });
        showToast('已置顶动态');
      }
    } catch (err: any) {
      showToast(err?.message || '操作失败，请重试');
    } finally {
      await updateBtnText(btn, mid).catch(() => {});
      btn.style.opacity = '';
      btn.style.pointerEvents = '';
      busy = false;
    }
  });

  if (msgBtn && msgBtn.parentElement === container) {
    msgBtn.insertAdjacentElement('afterend', btn);
  } else if (followBtn && followBtn.parentElement === container) {
    followBtn.insertAdjacentElement('afterend', btn);
  } else {
    container.appendChild(btn);
  }

  updateBtnText(btn, mid).catch(() => {});
}

function scan(root: Element): void {
  const cards = findUserCardsUnder(root);
  for (const card of cards) {
    const mid = extractMidFromCard(card);
    if (mid) ensureButton(card, mid);
  }
}

export function observeDynamicUserCard(): void {
  const html = document.documentElement;
  if (!html || html.getAttribute(INSTALL_MARK) === '1') return;
  html.setAttribute(INSTALL_MARK, '1');

  onPinsChange(() => {
    const btns = document.querySelectorAll<HTMLElement>(`[${BTN_MARK}="1"]`);
    btns.forEach((b) => {
      const mid = b.dataset.mid;
      if (mid) updateBtnText(b, mid).catch(() => {});
    });
  });

  scan(document.body);

  if (!document.body) return;

  let raf = 0;
  const pending = new Set<Element>();
  const flush = () => {
    raf = 0;
    for (const el of pending) scan(el);
    pending.clear();
  };

  const observer = new MutationObserver((ms) => {
    let hasAdded = false;
    for (const m of ms) {
      for (const n of Array.from(m.addedNodes)) {
        if (n instanceof Element) {
          pending.add(n);
          hasAdded = true;
        }
      }
    }
    if (hasAdded && !raf) {
      raf = window.requestAnimationFrame(flush);
    }
  });

  observer.observe(document.body, { childList: true, subtree: false });
}
