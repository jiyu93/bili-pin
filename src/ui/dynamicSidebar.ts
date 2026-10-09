import { TRENDINGS_COLLAPSED_KEY } from '../storage/keys';
import { installPanelCollapse } from './collapsiblePanel';
import { installCommunityEntry } from './communityEntry';

let stopObserving: (() => void) | null = null;

/** 共用右栏观察：出现后只监听两张卡片及祖先的直接子节点。 */
export function observeDynamicSidebar(): () => void {
  if (stopObserving) return stopObserving;
  let disposed = false;
  let frame: number | null = null;
  let activePanel: HTMLElement | null = null;
  let activeHeader: HTMLElement | null = null;
  let disposePanel: (() => void) | null = null;
  let community: ReturnType<typeof installCommunityEntry> | null = null;
  const observer = new MutationObserver(() => schedule());

  const run = () => {
    frame = null;
    if (disposed) return;
    const panel = document.querySelector<HTMLElement>('.bili-dyn-home--member aside.right .bili-dyn-search-trendings');
    const image = document.querySelector<HTMLElement>('.bili-dyn-home--member aside.right .bili-dyn-banner__img.clickable');
    if (image !== (community?.image ?? null) || (community && !community.button.isConnected)) {
      community?.dispose();
      community = image ? installCommunityEntry(image) : null;
    }
    const header = panel?.querySelector<HTMLElement>(':scope > .title') ?? null;
    if (panel !== activePanel || header !== activeHeader) {
      disposePanel?.();
      activePanel = panel;
      activeHeader = header;
      disposePanel = panel && header ? installPanelCollapse(panel, header, TRENDINGS_COLLAPSED_KEY, 'bilibili热搜') : null;
    }

    observer.disconnect();
    const sidebar = document.querySelector('.bili-dyn-home--member aside.right');
    const home = document.querySelector('.bili-dyn-home--member');
    if (panel || image) {
      const nodes = new Set<Node>();
      for (const root of [panel, image, sidebar]) {
        for (let node: Node | null = root; node; node = node.parentNode) {
          nodes.add(node);
        }
      }
      for (const node of nodes) observer.observe(node, {
        childList: true,
        subtree: node === sidebar && (!panel || !image),
      });
    } else {
      const root = sidebar ?? home ?? document.documentElement;
      observer.observe(root, { childList: true, subtree: Boolean(sidebar) || !home });
      for (let node = root.parentNode; node; node = node.parentNode) observer.observe(node, { childList: true });
    }
  };
  const schedule = () => {
    if (!disposed && frame === null) frame = requestAnimationFrame(run);
  };

  schedule();
  window.addEventListener('popstate', schedule);
  stopObserving = () => {
    disposed = true;
    if (frame !== null) cancelAnimationFrame(frame);
    observer.disconnect();
    disposePanel?.();
    community?.dispose();
    window.removeEventListener('popstate', schedule);
    stopObserving = null;
  };
  return stopObserving;
}
