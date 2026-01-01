import { extractUidFromHref, findSpaceAnchors } from './selectors';

function fireClick(el: HTMLElement): void {
  el.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
    }),
  );
}

/**
 * 尝试把“置顶栏点击 uid”桥接到“关注UP推荐列表点击该UP”的行为。
 * 优先触发原列表中对应的 anchor（或其更外层可点击容器）。
 */
export function clickUidInStrip(stripRoot: HTMLElement, uid: string): boolean {
  const targetUid = String(uid ?? '').trim();
  if (!targetUid) return false;

  // 兜底：如果 uid 是我们构造的 faceKey（拿不到真实uid时），用头像图匹配
  if (targetUid.startsWith('face:')) {
    const face = targetUid.slice('face:'.length);
    const items = Array.from(stripRoot.querySelectorAll<HTMLElement>('.bili-dyn-up-list__item'));
    for (const item of items) {
      const img = item.querySelector<HTMLImageElement>('img');
      const src = img?.currentSrc || img?.src || '';
      if (src && src.includes(face)) {
        try {
          fireClick(item);
          item.click?.();
          return true;
        } catch {
          return false;
        }
      }
    }
    return false;
  }

  const anchors = findSpaceAnchors(stripRoot);
  const a = anchors.find((x) => extractUidFromHref(x.href) === targetUid);
  if (!a) return false;

  // 有些实现把点击绑定在更外层的item上
  const clickable =
    a.closest<HTMLElement>('[role="button"]') ??
    a.closest<HTMLElement>('button') ??
    a.closest<HTMLElement>('li') ??
    a;

  try {
    fireClick(clickable);
    // 保险：部分站点监听原生 click()
    clickable.click?.();
    return true;
  } catch {
    return false;
  }
}


