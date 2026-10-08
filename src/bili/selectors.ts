const MID_RE_SPACE = /(?:^|\/)space\.bilibili\.com\/(\d+)(?:[/?#]|$)/i;
const MID_RE_PARAM = /[?&#]mid=(\d+)(?:[&#]|$)/i;

export function extractMidFromHref(href: string): string | null {
  const s = String(href ?? '');
  const m1 = s.match(MID_RE_SPACE);
  if (m1?.[1]) return m1[1];
  const m2 = s.match(MID_RE_PARAM);
  if (m2?.[1]) return m2[1];
  return null;
}

/** 只接受中栏内的原生推荐横条；加载期间等待，不猜测其他空间链接容器。 */
export function findUpAvatarStripRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('main .bili-dyn-up-list > .bili-dyn-up-list__window');
}

export function getUpAvatarStripAnchor(stripRoot: HTMLElement): HTMLElement | null {
  if (!stripRoot.isConnected || !stripRoot.matches('.bili-dyn-up-list__window')) return null;
  const anchor = stripRoot.parentElement;
  if (!anchor?.matches('.bili-dyn-up-list') || !anchor.closest('main')) return null;
  return anchor;
}

/**
 * 查找动态Feed列表容器
 */
export function findDynamicFeedContainer(): HTMLElement | null {
  // 尝试多个可能的选择器
  const candidates = [
    '.bili-dyn-list__items',
    '.bili-dyn-list',
    '[class*="dyn-list"]',
    '[class*="feed-list"]',
  ];

  for (const selector of candidates) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) return el;
  }

  return null;
}

export function getUpAvatarStripDiagnostics() {
  const strip = findUpAvatarStripRoot();
  const anchor = strip ? getUpAvatarStripAnchor(strip) : null;
  const bar = document.getElementById('bili-pin-pinbar');
  return {
    stripFound: Boolean(strip),
    anchorParentTag: anchor?.parentElement?.tagName ?? null,
    barFound: Boolean(bar),
    barPlacedCorrectly: Boolean(anchor && bar?.nextElementSibling === anchor),
    stripRect: strip?.getBoundingClientRect().toJSON() ?? null,
    barRect: bar?.getBoundingClientRect().toJSON() ?? null,
  };
}
