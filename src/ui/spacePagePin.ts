/**
 * UP主个人首页（space.bilibili.com）的置顶功能
 * 在"已关注"下拉框中添加"动态页置顶"按钮
 */

import { pinUp, unpinUp, isPinned, getPinnedUps } from '../storage/pins';
import { showToast } from './toast';
import { extractUidFromHref } from '../bili/selectors';

const PIN_BUTTON_MARK = 'data-bili-pin-space-button';

/**
 * 从当前页面URL中提取UP的mid
 */
function getMidFromUrl(): string | null {
  const match = window.location.pathname.match(/^\/\d+/);
  if (match) {
    const mid = match[0].slice(1); // 移除开头的 '/'
    if (/^\d+$/.test(mid)) {
      return mid;
    }
  }
  return null;
}

/**
 * 获取UP的名称和头像
 */
function getUpInfo(): { name: string | null; face: string | null } {
  // 尝试从页面中获取UP名称
  let name: string | null = null;
  const nameSelectors = [
    '.h-user-info .h-name',
    '.user-name',
    '[class*="username"]',
    '[class*="name"]',
  ];
  
  for (const selector of nameSelectors) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) {
      name = el.textContent?.trim() || null;
      if (name) break;
    }
  }

  // 尝试从页面中获取UP头像
  let face: string | null = null;
  const faceSelectors = [
    '.h-avatar img',
    '.user-avatar img',
    '[class*="avatar"] img',
  ];
  
  for (const selector of faceSelectors) {
    const img = document.querySelector<HTMLImageElement>(selector);
    if (img) {
      face = img.src || img.currentSrc || null;
      if (face) break;
    }
  }

  return { name, face };
}

/**
 * 查找"已关注"按钮和下拉框
 */
function findFollowButton(): { button: HTMLElement | null; dropdown: HTMLElement | null } {
  // 尝试多种可能的选择器
  const buttonSelectors = [
    'button:has-text("已关注")',
    '[class*="follow"][class*="button"]',
    '[class*="follow-btn"]',
    'button[class*="follow"]',
  ];

  let button: HTMLElement | null = null;
  let dropdown: HTMLElement | null = null;

  // 方法1: 通过文本内容查找"已关注"按钮
  const allButtons = Array.from(document.querySelectorAll<HTMLElement>('button, a[role="button"]'));
  for (const btn of allButtons) {
    const text = btn.textContent?.trim() || '';
    if (text === '已关注' || text.includes('已关注')) {
      button = btn;
      
      // 查找下拉框（可能在按钮的下一个兄弟元素，或者在父容器中）
      const container = btn.closest<HTMLElement>('[class*="follow"], [class*="relation"]') || 
                        btn.parentElement;
      
      if (container) {
        // 查找下拉菜单（可能是ul、div等）
        dropdown = container.querySelector<HTMLElement>('ul[class*="menu"]') ||
                   container.querySelector<HTMLElement>('ul[class*="dropdown"]') ||
                   container.querySelector<HTMLElement>('div[class*="menu"]') ||
                   container.querySelector<HTMLElement>('div[class*="dropdown"]') ||
                   container.querySelector<HTMLElement>('ul') ||
                   null;
        
        // 如果找到了下拉框，检查是否包含菜单项
        if (dropdown) {
          const hasMenuItems = dropdown.querySelector('li, [role="menuitem"]');
          if (hasMenuItems) {
            break;
          } else {
            dropdown = null;
          }
        }
      }
      
      // 也尝试查找按钮的下一个兄弟元素
      if (!dropdown) {
        const nextSibling = btn.nextElementSibling as HTMLElement;
        if (nextSibling && (nextSibling.tagName === 'UL' || nextSibling.tagName === 'DIV')) {
          dropdown = nextSibling;
          break;
        }
      }
    }
  }

  // 方法2: 通过Vue实例查找（如果方法1失败）
  if (!button || !dropdown) {
    for (const btn of allButtons) {
      const vue = (btn as any).__vueParentComponent || (btn as any).__vue__;
      if (vue) {
        const props = vue.props || vue.$props || vue.setupState || vue.ctx;
        if (props && (props.followed || props.isFollowed || props.follow === 1)) {
          button = btn;
          const container = btn.closest<HTMLElement>('[class*="follow"], [class*="relation"]') || 
                          btn.parentElement;
          if (container) {
            dropdown = container.querySelector<HTMLElement>('ul, [class*="menu"], [class*="dropdown"]');
          }
          if (button && dropdown) break;
        }
      }
    }
  }

  return { button, dropdown };
}

/**
 * 创建置顶按钮
 */
function createPinButton(isPinned: boolean): HTMLElement {
  const item = document.createElement('li');
  item.className = 'bili-pin-space-item';
  item.setAttribute(PIN_BUTTON_MARK, '1');

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'bili-pin-space-button';
  button.textContent = isPinned ? '取消动态页置顶' : '动态页置顶';

  item.appendChild(button);
  return item;
}

/**
 * 注入置顶按钮到下拉框
 */
async function injectPinButton(): Promise<void> {
  // 检查是否已经注入过
  if (document.querySelector(`[${PIN_BUTTON_MARK}="1"]`)) {
    return;
  }

  const mid = getMidFromUrl();
  if (!mid) {
    console.warn('[bili-pin] cannot get mid from URL');
    return;
  }

  const { button, dropdown } = findFollowButton();
  if (!button || !dropdown) {
    console.warn('[bili-pin] cannot find follow button or dropdown');
    return;
  }

  // 检查是否已置顶
  let pinned = await isPinned(mid);
  
  // 创建置顶按钮
  const pinButton = createPinButton(pinned);
  pinButton.setAttribute('data-pinned', pinned ? '1' : '0');
  
  // 添加到下拉框
  dropdown.appendChild(pinButton);

  // 绑定点击事件
  const btn = pinButton.querySelector<HTMLButtonElement>('button');
  if (btn) {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      try {
        const { name, face } = getUpInfo();
        
        if (pinned) {
          // 取消置顶
          await unpinUp(mid);
          showToast('已取消动态页置顶');
          pinned = false;
          // 更新按钮文本和状态
          btn.textContent = '动态页置顶';
          pinButton.setAttribute('data-pinned', '0');
        } else {
          // 置顶
          await pinUp({
            uid: mid,
            name: name || undefined,
            face: face || undefined,
          });
          showToast('已添加到动态页置顶');
          pinned = true;
          // 更新按钮文本和状态
          btn.textContent = '取消动态页置顶';
          pinButton.setAttribute('data-pinned', '1');
        }
      } catch (error: any) {
        showToast(error.message || '操作失败，请重试');
        console.error('[bili-pin] pin/unpin failed', error);
      }
    });
  }

  console.debug('[bili-pin] injected pin button to space page', { mid, pinned });
}

/**
 * 监听页面变化，自动注入
 */
export function observeSpacePage(): void {
  let injected = false;

  const tryInject = () => {
    if (injected) return;
    
    const mid = getMidFromUrl();
    if (!mid) return;

    const { button, dropdown } = findFollowButton();
    if (button && dropdown) {
      injectPinButton().then(() => {
        injected = true;
      }).catch((err) => {
        console.warn('[bili-pin] inject pin button failed', err);
      });
    }
  };

  // 立即尝试
  tryInject();

  // 监听DOM变化
  const observer = new MutationObserver(() => {
    if (!injected) {
      tryInject();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // 监听URL变化（SPA路由）
  let lastUrl = window.location.href;
  const checkUrlChange = () => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      injected = false;
      setTimeout(tryInject, 500);
    }
  };

  setInterval(checkUrlChange, 1000);
  window.addEventListener('popstate', () => {
    setTimeout(() => {
      injected = false;
      tryInject();
    }, 500);
  });
}

