import { findUpAvatarStripRoot } from './selectors';

export type UpStripFoundHandler = (stripRoot: HTMLElement) => void;

/**
 * 监听 SPA/异步渲染导致的DOM变化，尽可能在“头像横条”出现时调用 handler。
 * handler 需要自行保证幂等（重复调用不应产生重复注入）。
 */
export function observeUpAvatarStrip(handler: UpStripFoundHandler): () => void {
  let destroyed = false;
  let scheduled = false;
  let lastEl: HTMLElement | null = null;

  const run = () => {
    scheduled = false;
    if (destroyed) return;

    const el = findUpAvatarStripRoot();
    if (!el) return;

    // 只在首次找到或节点变更时触发；后续注入逻辑会更稳。
    if (el !== lastEl) {
      lastEl = el;
      handler(el);
    } else {
      // DOM 可能被重新渲染但复用了同一根节点，允许外部按需二次校验
      handler(el);
    }
  };

  const schedule = () => {
    if (destroyed || scheduled) return;
    scheduled = true;
    requestAnimationFrame(run);
  };

  schedule();

  const mo = new MutationObserver(schedule);
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // B站是 SPA，前进/后退可能会换内容
  window.addEventListener('popstate', schedule);

  return () => {
    destroyed = true;
    mo.disconnect();
    window.removeEventListener('popstate', schedule);
  };
}


