import { extractUidFromHref, findSpaceAnchors } from '../bili/selectors';
import { clickUidInStrip } from '../bili/clickBridge';
import { makeFaceKey } from '../bili/faceKey';
import { getPinnedUps, pinUp, unpinUp, type PinnedUp } from '../storage/pins';
import { ensurePinBar, renderPinBar } from './pinBar';

const BTN_CLASS = 'bili-pin-btn';
const BTN_MARK = 'data-bili-pin-btn';
const HOST_MARK = 'data-bili-pin-host';

function extractNameAndFace(a: HTMLAnchorElement): Pick<PinnedUp, 'name' | 'face'> {
  const img = a.querySelector<HTMLImageElement>('img');
  const face = img?.currentSrc || img?.src || undefined;
  const name = (img?.alt || a.textContent || '').trim() || undefined;
  return { name, face };
}

function extractNameAndFaceFromItem(item: HTMLElement): Pick<PinnedUp, 'name' | 'face'> {
  const img = item.querySelector<HTMLImageElement>('img');
  const face = img?.currentSrc || img?.src || undefined;
  const nameEl = item.querySelector<HTMLElement>('.bili-dyn-up-list__item__name');
  const name = (nameEl?.textContent || img?.alt || '').trim() || undefined;
  return { name, face };
}

function getItemUid(item: HTMLElement): string | null {
  // 1) 如果item里有 space 链接（少数情况下），优先用真实uid
  const a = item.querySelector<HTMLAnchorElement>('a[href]');
  const uid = a ? extractUidFromHref(a.href) : null;
  if (uid) return uid;

  // 2) 常见情况下没有 uid，退化为 faceKey
  const img = item.querySelector<HTMLImageElement>('img');
  const face = img?.currentSrc || img?.src || '';
  return makeFaceKey(face);
}

function findUpItems(stripRoot: HTMLElement): HTMLElement[] {
  const items = Array.from(stripRoot.querySelectorAll<HTMLElement>('.bili-dyn-up-list__item'));
  // 过滤“全部动态”
  return items.filter((el) => !el.querySelector('.bili-dyn-up-list__item__face.all'));
}

function ensureHostPositioning(host: HTMLElement) {
  const cs = getComputedStyle(host);
  if (cs.position === 'static') host.style.position = 'relative';
}

function setBtnState(btn: HTMLButtonElement, pinned: boolean) {
  btn.textContent = pinned ? '已置顶' : '置顶';
  btn.dataset.pinned = pinned ? '1' : '0';
  btn.classList.toggle('is-pinned', pinned);
}

function renderButtons(stripRoot: HTMLElement, pinnedSet: Set<string>) {
  const items = findUpItems(stripRoot);
  for (const item of items) {
    const uid = getItemUid(item);
    if (!uid) continue;

    const host = item;

    // 标记host避免重复注入
    if (host.getAttribute(HOST_MARK) === '1') {
      const existed = host.querySelector<HTMLButtonElement>(`button[${BTN_MARK}="1"]`);
      if (existed) setBtnState(existed, pinnedSet.has(uid));
      continue;
    }

    host.setAttribute(HOST_MARK, '1');
    ensureHostPositioning(host);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.setAttribute(BTN_MARK, '1');
    btn.dataset.uid = uid;
    setBtnState(btn, pinnedSet.has(uid));

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const currentlyPinned = btn.dataset.pinned === '1';
      if (currentlyPinned) {
        await unpinUp(uid);
      } else {
        const meta = extractNameAndFaceFromItem(item);
        await pinUp({ uid, ...meta });
      }

      // 同步UI（按钮 + 置顶栏）
      const latest = await getPinnedUps();
      const nextSet = new Set(latest.map((x) => x.uid));
      setBtnState(btn, nextSet.has(uid));
      const bar = ensurePinBar(stripRoot);
      renderPinBar(bar, latest, {
        onClickUid: (uid2) => {
          const ok = clickUidInStrip(stripRoot, uid2);
          if (!ok) console.debug('[bili-pin] failed to bridge click', { uid: uid2 });
        },
      });
    });

    host.appendChild(btn);
  }
}

export async function injectPinUi(stripRoot: HTMLElement): Promise<void> {
  const pinned = await getPinnedUps();
  const pinnedSet = new Set(pinned.map((x) => x.uid));

  const bar = ensurePinBar(stripRoot);
  renderPinBar(bar, pinned, {
    onClickUid: (uid) => {
      const ok = clickUidInStrip(stripRoot, uid);
      if (!ok) console.debug('[bili-pin] failed to bridge click', { uid });
    },
  });

  renderButtons(stripRoot, pinnedSet);
}


