import { findUpAvatarStripRoot, getUpAvatarStripDiagnostics } from './selectors';

export type UpStripFoundHandler = (stripRoot: HTMLElement) => void;

/**
 * 监听 SPA/异步渲染导致的DOM变化，尽可能在“关注UP推荐列表”出现时调用 handler。
 * handler 需要自行保证幂等（重复调用不应产生重复注入）。
 */
export function observeUpAvatarStrip(handler: UpStripFoundHandler): () => void {
  let destroyed = false;
  let scheduled = false;
  let lastEl: HTMLElement | null = null;
  let missCount = 0;
  let loggedNotFound = false;

  const run = () => {
    scheduled = false;
    if (destroyed) return;

    const el = findUpAvatarStripRoot();
    if (!el) {
      missCount += 1;
      // 避免刷屏：连续多次找不到后，仅输出一次诊断信息
      if (!loggedNotFound && missCount >= 12) {
        loggedNotFound = true;
        console.info('[bili-pin] 关注UP推荐列表未定位到', getUpAvatarStripDiagnostics());
        console.info(
          '[bili-pin] tip: you can run `window.__biliPin?.dump()` in console to re-print diagnostics',
        );
      }
      return;
    }

    // 只在首次找到或“根节点变更”时触发注入。
    // 否则在 hover/tooltip 等频繁 DOM 变化时会反复重渲染，造成按钮闪烁。
    if (el === lastEl) return;
    lastEl = el;
    handler(el);
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


