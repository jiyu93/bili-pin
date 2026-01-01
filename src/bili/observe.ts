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


