import { findSpaceAnchors, extractUidFromHref } from '../bili/selectors';
import { clickUidInStrip } from '../bili/clickBridge';
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
  const anchors = findSpaceAnchors(stripRoot);
  for (const a of anchors) {
    const uid = extractUidFromHref(a.href);
    if (!uid) continue;

    const host =
      a.closest<HTMLElement>('li') ??
      a.closest<HTMLElement>('div') ??
      a.parentElement ??
      null;
    if (!host) continue;

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
        const meta = extractNameAndFace(a);
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


