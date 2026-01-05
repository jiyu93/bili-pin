import { getFollowMtimeByMid } from '../bili/apiInterceptor';

const PROCESSED_ATTR = 'data-bili-pin-mtime-injected';

function formatTime(timestamp: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp * 1000);
  const Y = date.getFullYear();
  const M = (date.getMonth() + 1).toString().padStart(2, '0');
  const D = date.getDate().toString().padStart(2, '0');
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  const s = date.getSeconds().toString().padStart(2, '0');
  return `${Y}-${M}-${D} ${h}:${m}:${s}`;
}

export function observeFollowTime(): void {
  const root = document.documentElement;
  if (!root || root.getAttribute('data-bili-pin-follow-time-installed') === '1') return;
  root.setAttribute('data-bili-pin-follow-time-installed', '1');

  const check = () => {
    // 适配新的 DOM 结构：.relation-card
    // 注意：.relation-card 可能是 li 的子元素，也可能是直接的列表项
    const cards = document.querySelectorAll('.relation-card');
    
    cards.forEach((card) => {
      if (card.getAttribute(PROCESSED_ATTR)) return;

      // 1. 找 mid
      const link = card.querySelector<HTMLAnchorElement>('a[href*="//space.bilibili.com/"]');
      if (!link) return;

      const m = link.href.match(/space\.bilibili\.com\/(\d+)/);
      const mid = m?.[1];
      if (!mid) return;

      const mtime = getFollowMtimeByMid(mid);
      if (mtime) {
        // 2. 找插入位置
        // 优先适配 .relation-card-info 结构
        let container: Element | null = card.querySelector('.relation-card-info');
        let refNode: Node | null = null;
        
        // 如果找到了 info 容器
        if (container) {
            // 尝试找操作区（已关注按钮等）
            // 类名可能是 relation-card-info-option 或 relation-card-info__option
            const option = container.querySelector('[class*="option"]');
            
            if (option) {
                // 如果找到了 option，插入到它后面
                refNode = option.nextSibling;
            } else {
                // 如果没找到 option，直接 append 到最后（refNode = null）
                refNode = null;
            }
        }

        if (container) {
          // 防止重复插入到同一个容器（应对 li 和 relation-card 同时被选中的情况）
          if (container.getAttribute('data-bili-pin-time-injected')) return;

          const timeDiv = document.createElement('div');
          timeDiv.style.color = '#61666D'; // 使用 B 站次级文字颜色
          timeDiv.style.fontSize = '12px';
          timeDiv.style.marginTop = '8px'; // 与上方按钮保持间距
          timeDiv.style.marginBottom = '0px'; 
          timeDiv.style.lineHeight = '1.5';
          timeDiv.style.fontFamily = '"PingFang SC", HarmonyOS_Regular, "Helvetica Neue", "Microsoft YaHei", sans-serif';
          timeDiv.textContent = `关注时间: ${formatTime(mtime)}`;
          
          if (refNode) {
              container.insertBefore(timeDiv, refNode);
          } else {
              container.appendChild(timeDiv);
          }
          
          container.setAttribute('data-bili-pin-time-injected', '1');
          card.setAttribute(PROCESSED_ATTR, '1');
        }
      }
    });
  };

  const observer = new MutationObserver((mutations) => {
    // 简单的节流或者直接检查
    check();
  });

  if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
  } else {
      document.addEventListener('DOMContentLoaded', () => {
          observer.observe(document.body, { childList: true, subtree: true });
      });
  }

  // 初始检查
  check();
  
  // 监听 URL 变化（B站是单页应用）
  // 虽然 MutationObserver 会捕获大部分页面变化，但手动 check 确保 URL 变动后立即响应
  window.addEventListener('popstate', check);

  // 监听 API 数据更新
  window.addEventListener('bili-pin:relation-list-updated', check);

  // 某些框架路由可能不触发 popstate，MutationObserver 应该能覆盖
}

