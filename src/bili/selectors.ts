const UID_RE_SPACE = /(?:^|\/)space\.bilibili\.com\/(\d+)(?:[/?#]|$)/i;
const UID_RE_MID_PARAM = /[?&#]mid=(\d+)(?:[&#]|$)/i;

export function extractUidFromHref(href: string): string | null {
  const s = String(href ?? '');
  const m1 = s.match(UID_RE_SPACE);
  if (m1?.[1]) return m1[1];
  const m2 = s.match(UID_RE_MID_PARAM);
  if (m2?.[1]) return m2[1];
  return null;
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
  // 靠近页面顶部的候选更可能是“关注UP推荐列表”
  if (rect.top > -100 && rect.top < 650) score += 12;
  if (rect.height > 20 && rect.height < 200) score += 6;
  if (rect.width > 400) score += 4;

  // 横向滚动/横向布局的候选更可能是关注UP推荐列表
  const cs = getComputedStyle(el);
  if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') score += 10;
  if (cs.display.includes('flex') || cs.display.includes('grid')) score += 6;
  if (cs.whiteSpace === 'nowrap') score += 4;

  return score;
}

/**
 * 尝试在动态页中定位“关注UP推荐列表”的容器。
 * 这是启发式定位：B站会改DOM，因此把策略集中在这里，方便后续调整。
 */
export function findUpAvatarStripRoot(): HTMLElement | null {
  // 1) 明确命中：B站动态页关注UP推荐列表容器（最稳定）
  const direct = document.querySelector<HTMLElement>('.bili-dyn-up-list__window');
  if (direct) return direct;

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

export type UpStripDiagnostics = {
  url: string;
  title: string;
  totalAnchors: number;
  uidAnchors: number;
  sampleUidHrefs: Array<{ uid: string; href: string }>;
  candidateCount: number;
  topCandidates: Array<{
    tag: string;
    className: string;
    uidCount: number;
    score: number;
    rect: { top: number; left: number; width: number; height: number };
    styleHint: { display: string; overflowX: string; whiteSpace: string };
  }>;
};

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

export function getUpAvatarStripDiagnostics(): UpStripDiagnostics {
  const allAnchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
  const uidAnchors = findSpaceAnchors(document);

  const sampleUidHrefs: Array<{ uid: string; href: string }> = [];
  for (const a of uidAnchors.slice(0, 12)) {
    const uid = extractUidFromHref(a.href);
    if (!uid) continue;
    sampleUidHrefs.push({ uid, href: a.href });
  }

  // 候选评分（与 findUpAvatarStripRoot 相同逻辑，但会返回前 N 个，方便调试）
  const candidates = new Set<HTMLElement>();
  for (const a of uidAnchors) {
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
    const rect = el.getBoundingClientRect();
    if (rect.height > 800) continue;
    const uidCount = uniqueUidCount(el);
    if (uidCount < 3) continue;
    scored.push({ el, uidCount, score: computeScore(el, uidCount) });
  }
  scored.sort((a, b) => b.score - a.score);

  const topCandidates = scored.slice(0, 8).map((c) => {
    const rect = c.el.getBoundingClientRect();
    const cs = getComputedStyle(c.el);
    return {
      tag: c.el.tagName.toLowerCase(),
      className: c.el.className || '',
      uidCount: c.uidCount,
      score: c.score,
      rect: {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      styleHint: {
        display: cs.display,
        overflowX: cs.overflowX,
        whiteSpace: cs.whiteSpace,
      },
    };
  });

  return {
    url: location.href,
    title: document.title,
    totalAnchors: allAnchors.length,
    uidAnchors: uidAnchors.length,
    sampleUidHrefs,
    candidateCount: scored.length,
    topCandidates,
  };
}


