import { findUpAvatarStripRoot } from './selectors';

export type UpStripFoundHandler = (stripRoot: HTMLElement | null) => void;

/** 等待原生横条；出现后仅观察祖先的直接子节点，避免动态流/hover 触发全页扫描。 */
export function observeUpAvatarStrip(handler: UpStripFoundHandler): () => void {
  let destroyed = false;
  let frame: number | null = null;
  let observedNodes: Node[] = [];
  let waiting = false;

  const observer = new MutationObserver(() => schedule());
  const run = () => {
    frame = null;
    if (destroyed) return;
    const strip = findUpAvatarStripRoot();
    const nodes: Node[] = [];
    // 根节点尚未出现时短暂观察中栏（或文档），以捕获异步创建的 section / 横条。
    if (!strip) {
      nodes.push(document.querySelector('main') ?? document.documentElement);
    }
    for (let node: Node | null = strip?.parentElement ?? nodes[0]?.parentNode; node; node = node.parentNode) {
      nodes.push(node);
    }
    const nextWaiting = !strip;
    if (waiting !== nextWaiting || nodes.length !== observedNodes.length || nodes.some((node, i) => node !== observedNodes[i])) {
      observer.disconnect();
      nodes.forEach((node, i) => observer.observe(node, { childList: true, subtree: nextWaiting && i === 0 }));
      observedNodes = nodes;
      waiting = nextWaiting;
    }
    handler(strip);
  };
  const schedule = () => {
    if (!destroyed && frame === null) frame = requestAnimationFrame(run);
  };

  schedule();
  window.addEventListener('popstate', schedule);
  return () => {
    destroyed = true;
    if (frame !== null) cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener('popstate', schedule);
  };
}
