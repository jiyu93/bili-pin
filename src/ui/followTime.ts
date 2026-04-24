import { getFollowMtimeByMid } from '../bili/apiInterceptor';

const PROCESSED_ATTR = 'data-bili-pin-mtime-injected';
const TIME_MARK_ATTR = 'data-bili-pin-time-injected';

let rootObserver: MutationObserver | null = null;
let listObserver: MutationObserver | null = null;
let observedListRoot: HTMLElement | null = null;

function formatTime(timestamp: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp * 1000);
  const Y = date.getFullYear();
  const M = (date.getMonth() + 1).toString().padStart(2, '0');
  const D = date.getDate().toString().padStart(2, '0');
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  const s = date.getSeconds().toString().padStart(2, '0');
  return `${Y}-${M}-${D} ${h}:${m}:${s}`;
}

function findRelationListRoot(): HTMLElement | null {
  const firstCard = document.querySelector<HTMLElement>('.relation-card');
  if (!firstCard) return null;

  return (
    firstCard.closest<HTMLElement>('[class*="relation-list"]') ||
    firstCard.closest<HTMLElement>('[class*="list"]') ||
    firstCard.parentElement
  );
}

export function observeFollowTime(): void {
  const root = document.documentElement;
  if (!root || root.getAttribute('data-bili-pin-follow-time-installed') === '1') return;
  root.setAttribute('data-bili-pin-follow-time-installed', '1');

  let scheduled = false;

  const check = () => {
    const cards = document.querySelectorAll<HTMLElement>('.relation-card');

    cards.forEach((card) => {
      if (card.getAttribute(PROCESSED_ATTR) === '1') return;

      const link = card.querySelector<HTMLAnchorElement>('a[href*="//space.bilibili.com/"]');
      if (!link) return;

      const m = link.href.match(/space\.bilibili\.com\/(\d+)/);
      const mid = m?.[1];
      if (!mid) return;

      const mtime = getFollowMtimeByMid(mid);
      if (!mtime) return;

      const container = card.querySelector<HTMLElement>('.relation-card-info');
      if (!container) return;

      if (container.getAttribute(TIME_MARK_ATTR) === '1') {
        card.setAttribute(PROCESSED_ATTR, '1');
        return;
      }

      const option = container.querySelector('[class*="option"]');
      const timeDiv = document.createElement('div');
      timeDiv.style.color = '#61666D';
      timeDiv.style.fontSize = '12px';
      timeDiv.style.marginTop = '8px';
      timeDiv.style.marginBottom = '0px';
      timeDiv.style.lineHeight = '1.5';
      timeDiv.style.fontFamily = '"PingFang SC", HarmonyOS_Regular, "Helvetica Neue", "Microsoft YaHei", sans-serif';
      timeDiv.textContent = `关注时间: ${formatTime(mtime)}`;

      if (option?.nextSibling) {
        container.insertBefore(timeDiv, option.nextSibling);
      } else {
        container.appendChild(timeDiv);
      }

      container.setAttribute(TIME_MARK_ATTR, '1');
      card.setAttribute(PROCESSED_ATTR, '1');
    });
  };

  const bindListObserver = () => {
    const nextRoot = findRelationListRoot();
    if (nextRoot === observedListRoot) return;

    if (listObserver) {
      listObserver.disconnect();
      listObserver = null;
    }

    observedListRoot = nextRoot;
    if (!nextRoot) return;

    listObserver = new MutationObserver(() => {
      scheduleCheck();
    });
    listObserver.observe(nextRoot, { childList: true, subtree: true });
  };

  const scan = () => {
    scheduled = false;
    check();
    bindListObserver();
  };

  const scheduleCheck = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(scan);
  };

  const ensureRootObserver = () => {
    if (rootObserver || !document.body) return;
    rootObserver = new MutationObserver(() => {
      if (observedListRoot && document.contains(observedListRoot)) return;
      observedListRoot = null;
      scheduleCheck();
    });
    rootObserver.observe(document.body, { childList: true, subtree: false });
  };

  ensureRootObserver();
  scheduleCheck();

  window.addEventListener('popstate', () => {
    observedListRoot = null;
    scheduleCheck();
  });
  window.addEventListener('bili-pin:relation-list-updated', scheduleCheck);
}
