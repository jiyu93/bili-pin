/**
 * MID解析模块
 * 当只有faceKey时，尝试通过各种方式获取真实的数字mid
 */

import { makeFaceKey, extractFaceHash } from './faceKey';
import { extractUidFromHref, findSpaceAnchors } from './selectors';
import { searchMidByName } from './api';

/**
 * 通过头像匹配在页面中查找真实mid
 * 在推荐列表、Feed内容、或其他地方查找匹配的头像，然后提取mid
 */
export function findMidByFace(faceUrl: string, stripRoot?: HTMLElement): string | null {
  if (!faceUrl) return null;

  const targetFaceKey = makeFaceKey(faceUrl);
  if (!targetFaceKey) return null;

  const targetHash = extractFaceHash(faceUrl);

  // 方法1: 在推荐列表中查找匹配的头像
  if (stripRoot) {
    const items = stripRoot.querySelectorAll<HTMLElement>('.bili-dyn-up-list__item');
    for (const item of items) {
      const img = item.querySelector<HTMLImageElement>('img');
      if (img) {
        const src = img.currentSrc || img.src || '';
        const itemFaceKey = makeFaceKey(src);
        if (itemFaceKey === targetFaceKey) {
          // 找到了匹配的头像，尝试提取mid
          const anchor = item.querySelector<HTMLAnchorElement>('a[href*="space.bilibili.com"]');
          if (anchor) {
            const mid = extractUidFromHref(anchor.href);
            if (mid) return mid;
          }
        }
      }
    }
  }

  // 方法2: 在整个页面中查找匹配的头像（在Feed内容中）
  // 查找所有动态卡片中的头像
  const feedItems = document.querySelectorAll<HTMLElement>(
    '.bili-dyn-item, [class*="dyn-item"], article[class*="dyn"]'
  );
  
  for (const item of Array.from(feedItems)) {
    // 查找动态卡片中的UP头像
    const avatarImg = item.querySelector<HTMLImageElement>(
      'img[class*="face"], img[class*="avatar"], .bili-dyn-item__author img, [class*="author"] img'
    );
    
    if (avatarImg) {
      const src = avatarImg.currentSrc || avatarImg.src || '';
      const itemFaceKey = makeFaceKey(src);
      if (itemFaceKey === targetFaceKey) {
        // 找到了匹配的头像，查找该卡片中的UP链接
        const anchor = item.querySelector<HTMLAnchorElement>('a[href*="space.bilibili.com"]');
        if (anchor) {
          const mid = extractUidFromHref(anchor.href);
          if (mid) return mid;
        }
      }
    }
  }

  // 方法2b: 查找所有包含该头像的链接（更广泛的搜索）
  const allAnchors = findSpaceAnchors(document);
  for (const anchor of allAnchors) {
    // 查找anchor附近的img
    const container = anchor.closest<HTMLElement>('article, .bili-dyn-item, [class*="dyn-item"]') || anchor.parentElement;
    if (container) {
      const img = container.querySelector<HTMLImageElement>('img');
      if (img) {
        const src = img.currentSrc || img.src || '';
        const itemFaceKey = makeFaceKey(src);
        if (itemFaceKey === targetFaceKey) {
          const mid = extractUidFromHref(anchor.href);
          if (mid) return mid;
        }
      }
    }
  }

  // 方法3: 如果知道头像hash，尝试直接匹配hash
  if (targetHash) {
    // 查找所有包含该hash的头像URL
    const allImgs = document.querySelectorAll<HTMLImageElement>('img[src*="' + targetHash + '"]');
    for (const img of Array.from(allImgs)) {
      const container = img.closest<HTMLElement>('article, .bili-dyn-item, [class*="dyn-item"], .bili-dyn-up-list__item');
      if (container) {
        const anchor = container.querySelector<HTMLAnchorElement>('a[href*="space.bilibili.com"]');
        if (anchor) {
          const mid = extractUidFromHref(anchor.href);
          if (mid) return mid;
        }
      }
    }
  }

  return null;
}

/**
 * 通过UP名称在推荐列表中查找mid
 * 这是一个备选方案，如果头像匹配失败
 */
export function findMidByName(name: string, stripRoot?: HTMLElement): string | null {
  if (!name) return null;

  const searchName = name.trim().toLowerCase();

  if (stripRoot) {
    const items = stripRoot.querySelectorAll<HTMLElement>('.bili-dyn-up-list__item');
    for (const item of items) {
      const nameEl = item.querySelector<HTMLElement>('.bili-dyn-up-list__item__name');
      const itemName = nameEl?.textContent?.trim().toLowerCase() || '';
      
      // 模糊匹配：检查名称是否包含或相似
      if (itemName.includes(searchName) || searchName.includes(itemName)) {
        const anchor = item.querySelector<HTMLAnchorElement>('a[href*="space.bilibili.com"]');
        if (anchor) {
          const mid = extractUidFromHref(anchor.href);
          if (mid) return mid;
        }
      }
    }
  }

  return null;
}

/**
 * 综合方法：尝试多种方式获取mid
 * 只返回真实的数字mid，不接受faceKey
 * @param allowAsync 是否允许异步搜索（通过API）
 */
export async function resolveMid(
  uid: string,
  faceUrl?: string,
  name?: string,
  stripRoot?: HTMLElement,
  allowAsync: boolean = true,
): Promise<string | null> {
  // 如果已经是数字mid，直接返回
  if (/^\d+$/.test(uid)) {
    return uid;
  }

  // 如果不是数字mid，尝试通过各种方式解析
  // 方法1: 通过头像在页面中匹配（优先从API缓存）
  if (faceUrl) {
    const { getUpInfoByFace } = await import('./apiInterceptor');
    const upInfo = getUpInfoByFace(faceUrl);
    if (upInfo?.mid && /^\d+$/.test(upInfo.mid)) {
      console.debug('[bili-pin] resolved mid from API cache', { mid: upInfo.mid, name: upInfo.name });
      return upInfo.mid;
    }

    // 如果API缓存没有，尝试在DOM中查找
    const mid = findMidByFace(faceUrl, stripRoot);
    if (mid && /^\d+$/.test(mid)) return mid;
  }

  // 方法2: 通过名称在推荐列表中匹配
  if (name) {
    const mid = findMidByName(name, stripRoot);
    if (mid && /^\d+$/.test(mid)) return mid;
  }

  // 方法3: 如果前两种方法都失败，且允许异步，尝试通过搜索API获取
  if (allowAsync && name) {
    console.debug('[bili-pin] attempting to search mid via API', { name });
    const mid = await searchMidByName(name);
    if (mid && /^\d+$/.test(mid)) return mid;
  }

  // 所有方法都失败，返回null（不再返回faceKey）
  return null;
}

