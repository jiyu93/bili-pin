const UID_RE = /(?:^|\/)space\.bilibili\.com\/(\d+)(?:[/?#]|$)/i;

export function extractUidFromHref(href: string): string | null {
  const m = String(href ?? '').match(UID_RE);
  return m?.[1] ?? null;
}

export function findSpaceAnchors(root: ParentNode = document): HTMLAnchorElement[] {
  const all = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]'));
  return all.filter((a) => extractUidFromHref(a.href));
}

type Candidate = { el: HTMLElement; score: number; uidCount: number };

function uniqueUidCount(el: HTMLElement): number {
  const uids = new Set<string>();
  for (const a of findSpaceAnchors(el)) {
    const uid = extractUidFromHref(a.href);
    if (uid) uids.add(uid);
  }
  return uids.size;
}

function computeScore(el: HTMLElement, uidCount: number): number {
  let score = uidCount;

  const rect = el.getBoundingClientRect();
  // 靠近页面顶部的候选更可能是“头像横条”
  if (rect.top > -100 && rect.top < 650) score += 12;
  if (rect.height > 20 && rect.height < 200) score += 6;
  if (rect.width > 400) score += 4;

  // 横向滚动/横向布局的候选更可能是头像横条
  const cs = getComputedStyle(el);
  if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') score += 10;
  if (cs.display.includes('flex') || cs.display.includes('grid')) score += 6;
  if (cs.whiteSpace === 'nowrap') score += 4;

  return score;
}

/**
 * 尝试在动态页中定位“UP头像横向列表”的容器。
 * 这是启发式定位：B站会改DOM，因此把策略集中在这里，方便后续调整。
 */
export function findUpAvatarStripRoot(): HTMLElement | null {
  const anchors = findSpaceAnchors(document);
  if (anchors.length === 0) return null;

  const candidates = new Set<HTMLElement>();
  for (const a of anchors) {
    const p1 = a.parentElement;
    const p2 = p1?.parentElement;
    const p3 = p2?.parentElement;
    if (p1) candidates.add(p1);
    if (p2) candidates.add(p2);
    if (p3) candidates.add(p3);
    const closest = a.closest<HTMLElement>('ul,ol,div,section');
    if (closest) candidates.add(closest);
  }

  const scored: Candidate[] = [];
  for (const el of candidates) {
    // 排除太大的容器（比如整个feed）
    const rect = el.getBoundingClientRect();
    if (rect.height > 800) continue;

    const uidCount = uniqueUidCount(el);
    if (uidCount < 6) continue;
    scored.push({ el, uidCount, score: computeScore(el, uidCount) });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.el ?? null;
}

export function getStripUids(stripRoot: HTMLElement): string[] {
  const uids: string[] = [];
  const seen = new Set<string>();
  for (const a of findSpaceAnchors(stripRoot)) {
    const uid = extractUidFromHref(a.href);
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    uids.push(uid);
  }
  return uids;
}


