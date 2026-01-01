/**
 * 旧的 Feed 筛选模块（历史遗留）
 * 
 * 现已不再使用：
 * - 不再通过 pushState 跳转 space.bilibili.com
 * - 不再尝试手动更新 Vue 状态
 * 
 * 新方案：在 MAIN world 拦截并改写 /feed/all 的 host_mid，让 B 站自己渲染 feed。
 */

import { fetchUserDynamicFeed, isValidMid } from './api';
import { findDynamicFeedContainer } from './selectors';

/**
 * 通过URL直接筛选Feed（最简单直接的方法）
 * 直接访问 https://space.bilibili.com/{mid}/dynamic 来筛选
 */
export async function filterFeedByUrl(mid: string): Promise<boolean> {
  if (!isValidMid(mid)) {
    return false;
  }

  try {
    // 方法1: 尝试通过修改当前页面的URL来触发筛选
    // B站动态页可能支持通过URL参数筛选
    const currentUrl = new URL(window.location.href);
    const newUrl = `https://space.bilibili.com/${mid}/dynamic`;
    
    // 尝试使用pushState修改URL（不刷新页面）
    window.history.pushState({ mid }, '', newUrl);
    
    // 触发popstate事件，让B站前端响应
    window.dispatchEvent(new PopStateEvent('popstate', { state: { mid } }));
    
    // 等待一下，看看是否有响应
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // 检查URL是否变化（说明可能成功了）
    if (window.location.href.includes(`/${mid}/dynamic`)) {
      console.debug('[bili-pin] feed filtered via URL', { mid });
      return true;
    }
    
    return false;
  } catch (error) {
    console.warn('[bili-pin] failed to filter feed by URL', error);
    return false;
  }
}

/**
 * 尝试通过直接调用API并更新Feed来筛选
 * 这是最直接的方法：调用B站API，获取数据，然后触发B站前端的更新
 */
export async function filterFeedByMid(mid: string): Promise<boolean> {
  if (!isValidMid(mid)) {
    console.warn('[bili-pin] invalid mid for feed filtering', { mid });
    return false;
  }

  try {
    // 优先尝试通过URL筛选（最简单）
    const urlSuccess = await filterFeedByUrl(mid);
    if (urlSuccess) {
      return true;
    }

    // 如果URL方法失败，尝试API方法
    // 1. 调用API获取该UP的动态数据
    const response = await fetchUserDynamicFeed(mid);
    
    if (response.code !== 0 || !response.data) {
      console.warn('[bili-pin] API returned error', response);
      return false;
    }

    // 2. 尝试找到B站前端的状态管理，直接更新数据
    const success = await updateFeedViaFramework(response.data, mid);
    if (success) {
      return true;
    }

    // 3. 如果框架方法失败，尝试直接操作DOM（最后手段）
    return await updateFeedViaDOM(response.data);
  } catch (error) {
    console.error('[bili-pin] failed to filter feed by API', error);
    return false;
  }
}

/**
 * 通过B站前端框架更新Feed
 */
async function updateFeedViaFramework(apiData: any, mid: string): Promise<boolean> {
  try {
    const anyWindow = window as any;
    
    // 方法1: 查找Vue实例并触发更新
    const feedContainer = findDynamicFeedContainer();
    if (feedContainer) {
      // 尝试访问Vue实例
      const vue3 = (feedContainer as any).__vueParentComponent;
      const vue2 = (feedContainer as any).__vue__;
      
      if (vue3 || vue2) {
        const instance = vue3 || vue2;
        
        // 尝试找到更新Feed的方法
        let current: any = instance;
        for (let i = 0; i < 20 && current; i++) {
          // 尝试多种可能的方法
          const methods = [
            'updateFeed',
            'setFeedData',
            'loadFeed',
            'refreshFeed',
            'setDynamicList',
          ];
          
          for (const methodName of methods) {
            if (typeof current[methodName] === 'function') {
              try {
                current[methodName](apiData, mid);
                console.debug('[bili-pin] updated feed via framework method', methodName);
                return true;
              } catch (e) {
                // 继续尝试
              }
            }
          }
          
          // 尝试访问setupState或props
          const state = current.setupState || current.props || current.ctx;
          if (state) {
            for (const methodName of ['updateFeed', 'setFeedData', 'loadFeed']) {
              if (typeof state[methodName] === 'function') {
                try {
                  state[methodName](apiData, mid);
                  console.debug('[bili-pin] updated feed via state method', methodName);
                  return true;
                } catch (e) {
                  // 继续尝试
                }
              }
            }
            
            // 尝试直接设置数据
            if (state.feedData !== undefined) {
              try {
                state.feedData = apiData.items || apiData;
                console.debug('[bili-pin] updated feed via direct state assignment');
                return true;
              } catch (e) {
                // 继续尝试
              }
            }
          }
          
          current = current.parent || current.$parent || current.ctx?.parent;
        }
      }
    }
    
    // 方法2: 尝试触发自定义事件，让B站前端监听并处理
    const event = new CustomEvent('bili-dynamic-feed-update', {
      detail: { data: apiData, mid },
      bubbles: true,
    });
    document.dispatchEvent(event);
    
    // 等待一下，看看是否有响应
    await new Promise(resolve => setTimeout(resolve, 100));
    
    return false;
  } catch (error) {
    console.warn('[bili-pin] failed to update feed via framework', error);
    return false;
  }
}

/**
 * 通过直接操作DOM更新Feed（最后手段，可能不会触发响应式更新）
 */
async function updateFeedViaDOM(apiData: any): Promise<boolean> {
  try {
    const feedContainer = findDynamicFeedContainer();
    if (!feedContainer) {
      console.warn('[bili-pin] feed container not found');
      return false;
    }
    
    // 注意：直接操作DOM可能不会触发B站前端的响应式更新
    // 这只是一个兜底方案
    console.warn('[bili-pin] DOM update is not recommended, feed may not update properly');
    
    // 可以尝试清空容器，然后触发B站前端的重新加载
    // 但这需要B站前端有自动重新加载的逻辑
    
    return false;
  } catch (error) {
    console.warn('[bili-pin] failed to update feed via DOM', error);
    return false;
  }
}

/**
 * 尝试通过模拟点击"全部动态"然后立即筛选来触发B站的筛选逻辑
 * 这是一个hack方法：先重置，再筛选
 */
export async function filterFeedBySimulatingClick(stripRoot: HTMLElement, mid: string): Promise<boolean> {
  try {
    // 1. 找到"全部动态"按钮并点击（重置状态）
    const allDynamicBtn = stripRoot.querySelector<HTMLElement>('.bili-dyn-up-list__item__face.all');
    if (allDynamicBtn) {
      const clickable = allDynamicBtn.closest<HTMLElement>('.bili-dyn-up-list__item') || allDynamicBtn;
      clickable.click();
      
      // 等待一下让B站前端处理
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // 2. 现在尝试通过框架方法筛选
    return await filterFeedByMid(mid);
  } catch (error) {
    console.warn('[bili-pin] failed to filter by simulating click', error);
    return false;
  }
}

/**
 * 尝试通过拦截/模拟B站的网络请求来触发筛选
 * 观察B站点击推荐列表UP时的网络请求，然后模拟相同的请求
 */
export async function filterFeedByInterceptingRequest(mid: string): Promise<boolean> {
  try {
    // 方法：直接构造B站可能使用的API请求URL
    // 根据交接文档，API可能是 /x/polymer/web-dynamic/v1/feed/space?host_mid=xxx
    
    // 但更好的方法是：观察当前页面的fetch请求，找到B站使用的API
    // 然后直接调用相同的API，让B站前端自己处理响应
    
    // 尝试触发一个自定义事件，让B站前端监听并处理
    const event = new CustomEvent('bili-dynamic-select-up', {
      detail: { mid },
      bubbles: true,
      cancelable: true,
    });
    
    // 在多个可能的位置触发事件
    const feedContainer = findDynamicFeedContainer();
    if (feedContainer) {
      feedContainer.dispatchEvent(event);
    }
    document.dispatchEvent(event);
    window.dispatchEvent(event);
    
    // 等待一下，看看是否有响应
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // 检查Feed是否更新（通过检查URL或DOM变化）
    // 这里可以添加检查逻辑
    
    return false; // 暂时返回false，需要进一步测试
  } catch (error) {
    console.warn('[bili-pin] failed to filter by intercepting request', error);
    return false;
  }
}

