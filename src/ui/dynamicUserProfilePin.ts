import { isPinned, onPinsChange, pinUp, unpinUp } from '../storage/pins';
import { showToast } from './toast';

const PROFILE_SELECTOR = '.bili-user-profile';
const FOOTER_SELECTOR = '.bili-user-profile-view__info__footer';
const BUTTON_CLASS = 'bili-pin-user-profile-button';
const BUTTON_MARK = 'data-bili-pin-user-profile-button';
const PROFILE_HOOK_MARK = 'data-bili-pin-user-profile-hooked';

const profileObservers = new WeakMap<HTMLElement, MutationObserver>();

function extractMidFromHref(href: string): string | null {
  const m = String(href || '').match(/space\.bilibili\.com\/(\d+)/);
  const mid = m?.[1] ?? '';
  return /^\d+$/.test(mid) ? mid : null;
}

function getSrcsetFirstValue(raw: string | null | undefined): string {
  const first = String(raw || '').split(',')[0]?.trim().split(' ')[0]?.trim() || '';
  return first;
}

function getProfileInfo(profile: HTMLElement): { mid: string | null; name?: string; face?: string } {
  const link =
    profile.querySelector<HTMLAnchorElement>('.bili-user-profile-view__avatar[href*="space.bilibili.com/"]') ??
    profile.querySelector<HTMLAnchorElement>('.bili-user-profile-view__info__uname[href*="space.bilibili.com/"]') ??
    profile.querySelector<HTMLAnchorElement>('a[href*="space.bilibili.com/"]') ??
    null;
  const mid = link ? extractMidFromHref(link.href || link.getAttribute('href') || '') : null;

  const name =
    profile.querySelector<HTMLElement>('.bili-user-profile-view__info__uname')?.textContent?.trim() ||
    undefined;

  const img =
    profile.querySelector<HTMLImageElement>('.bili-user-profile-view__avatar img') ??
    profile.querySelector<HTMLImageElement>('img[src*="/bfs/face/"]') ??
    null;
  const srcset =
    img?.closest('picture')?.querySelector<HTMLSourceElement>('source[srcset]')?.getAttribute('srcset') ??
    img?.getAttribute('srcset') ??
    null;
  const face =
    img?.currentSrc ||
    img?.src ||
    img?.getAttribute('src') ||
    img?.getAttribute('data-src') ||
    getSrcsetFirstValue(srcset) ||
    undefined;

  return { mid, name, face: face ? String(face).trim() : undefined };
}

function setButtonBusy(button: HTMLElement, busy: boolean): void {
  button.style.opacity = busy ? '0.6' : '';
  button.style.pointerEvents = busy ? 'none' : '';
}

async function updateButtonText(button: HTMLElement, mid: string): Promise<void> {
  const pinned = await isPinned(mid);
  button.textContent = pinned ? '取消置顶' : '置顶UP主';
  button.setAttribute('aria-label', pinned ? '取消置顶UP主' : '置顶UP主');
  button.classList.toggle('is-pinned', pinned);
}

function ensureButton(profile: HTMLElement): void {
  const footer = profile.querySelector<HTMLElement>(FOOTER_SELECTOR);
  if (!footer) return;

  const info = getProfileInfo(profile);
  if (!info.mid) return;

  const existed = footer.querySelector<HTMLElement>(`[${BUTTON_MARK}="1"]`);
  if (existed) {
    existed.dataset.mid = info.mid;
    updateButtonText(existed, info.mid).catch(() => {});
    return;
  }

  const button = document.createElement('div');
  button.className = `bili-user-profile-view__info__button ${BUTTON_CLASS}`;
  button.setAttribute(BUTTON_MARK, '1');
  button.setAttribute('role', 'button');
  button.setAttribute('tabindex', '0');
  button.dataset.mid = info.mid;

  let busy = false;
  const toggle = async (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;

    const latest = getProfileInfo(profile);
    const mid = latest.mid || button.dataset.mid || '';
    if (!/^\d+$/.test(mid)) {
      showToast('无法置顶：未获取到真实的UP ID');
      return;
    }

    busy = true;
    setButtonBusy(button, true);
    button.textContent = '处理中...';

    try {
      const pinned = await isPinned(mid);
      if (pinned) {
        await unpinUp(mid);
        showToast('已取消置顶');
      } else {
        await pinUp({
          mid,
          name: latest.name || info.name,
          face: latest.face || info.face,
        });
        showToast('已置顶UP主');
      }
    } catch (err: any) {
      showToast(err?.message || '操作失败，请重试');
    } finally {
      await updateButtonText(button, mid).catch(() => {});
      setButtonBusy(button, false);
      busy = false;
    }
  };

  button.addEventListener('click', toggle);
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    toggle(event);
  });

  const chat = footer.querySelector<HTMLElement>('.bili-user-profile-view__info__button.chat');
  if (chat && chat.parentElement === footer) {
    footer.insertBefore(button, chat);
  } else {
    footer.appendChild(button);
  }

  updateButtonText(button, info.mid).catch(() => {});
}

function hookProfile(profile: HTMLElement): void {
  if (profile.getAttribute(PROFILE_HOOK_MARK) === '1') return;
  profile.setAttribute(PROFILE_HOOK_MARK, '1');

  let scheduled = false;
  const scheduleEnsure = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      ensureButton(profile);
    });
  };
  scheduleEnsure();

  const observer = new MutationObserver(scheduleEnsure);
  observer.observe(profile, {
    attributes: true,
    childList: true,
    subtree: true,
    attributeFilter: ['style', 'class', 'href', 'src', 'srcset'],
  });
  profileObservers.set(profile, observer);
}

function cleanupProfile(profile: HTMLElement): void {
  profileObservers.get(profile)?.disconnect();
  profileObservers.delete(profile);
  profile.removeAttribute(PROFILE_HOOK_MARK);
}

function scanProfiles(): void {
  const profiles = Array.from(document.querySelectorAll<HTMLElement>(PROFILE_SELECTOR));
  for (const profile of profiles) hookProfile(profile);
}

export function observeDynamicUserProfilePin(): void {
  const root = document.documentElement;
  if (!root || root.getAttribute('data-bili-pin-user-profile-installed') === '1') return;
  root.setAttribute('data-bili-pin-user-profile-installed', '1');

  onPinsChange(() => {
    const buttons = document.querySelectorAll<HTMLElement>(`[${BUTTON_MARK}="1"]`);
    buttons.forEach((button) => {
      const mid = button.dataset.mid;
      if (mid) updateButtonText(button, mid).catch(() => {});
    });
  });

  scanProfiles();

  let bodyObserver: MutationObserver | null = null;
  let documentObserver: MutationObserver | null = null;
  const attachBodyObserver = () => {
    if (!document.body || bodyObserver) return;

    bodyObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches(PROFILE_SELECTOR)) hookProfile(node);
          node.querySelectorAll?.<HTMLElement>(PROFILE_SELECTOR).forEach(hookProfile);
        });
        mutation.removedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches(PROFILE_SELECTOR)) cleanupProfile(node);
          node.querySelectorAll?.<HTMLElement>(PROFILE_SELECTOR).forEach(cleanupProfile);
        });
      }
    });

    bodyObserver.observe(document.body, { childList: true, subtree: false });
    documentObserver?.disconnect();
    documentObserver = null;
    scanProfiles();
  };

  attachBodyObserver();

  if (!bodyObserver) {
    documentObserver = new MutationObserver((mutations) => {
      attachBodyObserver();
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches(PROFILE_SELECTOR)) hookProfile(node);
          node.querySelectorAll?.<HTMLElement>(PROFILE_SELECTOR).forEach(hookProfile);
        });
        mutation.removedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches(PROFILE_SELECTOR)) cleanupProfile(node);
          node.querySelectorAll?.<HTMLElement>(PROFILE_SELECTOR).forEach(cleanupProfile);
        });
      }
    });

    documentObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
  window.addEventListener('popstate', scanProfiles);
}
