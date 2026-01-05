/**
 * API拦截模块
 * 拦截B站动态页的API请求，从响应数据中提取UP列表信息（包括mid）
 * 这样就不需要从DOM中解析了，更可靠
 */

import { extractFaceHash } from './faceKey';
import { debugLog } from './debugFlag';

export interface UpInfo {
  mid: string;
  name: string;
  face: string;
  has_update?: boolean;
  mtime?: number;
}

const MAX_UP_INFO_CACHE = 5000;
const MAX_PORTAL_UP_LIST = 2000;
const MAX_MTIME_CACHE = 50000;

// 存储从API响应中提取的UP信息
// 只用于“从接口拿mid”，不作为持久化标识（持久化只存mid）
const upInfoByFaceHash = new Map<string, UpInfo>(); // key: face hash (bfs/face/<hash>)
const upInfoByMid = new Map<string, UpInfo>(); // key: mid
const mtimeByMid = new Map<string, number>(); // key: mid -> mtime (关注时间)
let lastPortalUpList: UpInfo[] = [];
let desiredHostMid: string | null = null;

function shouldProcessApiUrl(url: string): boolean {
  const u = String(url || '');
  if (!u.includes('api.bilibili.com')) return false;
  // 仅处理我们真正用得到的接口，避免对所有 API 响应做 JSON 解析导致长期性能/内存压力
  return (
    u.includes('/x/polymer/web-dynamic/v1/portal') ||
    u.includes('/x/polymer/web-dynamic/v1/uplist') ||
    u.includes('/x/polymer/web-dynamic/v1/feed/') ||
    u.includes('/x/relation/followings') ||
    u.includes('/x/relation/fans') ||
    u.includes('/x/relation/tag')
  );
}

function trimOldestFromMap<K, V>(m: Map<K, V>, max: number): void {
  if (m.size <= max) return;
  let remove = m.size - max;
  // Map 迭代顺序是插入顺序：删除最早的，避免无上限增长
  for (const k of m.keys()) {
    m.delete(k);
    remove -= 1;
    if (remove <= 0) break;
  }
}

function syncFilteredMidAttr(): void {
  try {
    const root = document.documentElement;
    if (!root) return;
    if (desiredHostMid) {
      root.setAttribute('data-bili-pin-filtered-mid', desiredHostMid);
    } else {
      root.removeAttribute('data-bili-pin-filtered-mid');
    }
  } catch {
    // ignore
  }
}

function unwrapData(resp: any): any {
  return resp?.data ?? resp;
}

function rewriteHostMidIfNeeded(rawUrl: string): string {
  if (!desiredHostMid) return rawUrl;
  try {
    const u = new URL(rawUrl, window.location.origin);
    const p = u.pathname;
    // 只改写动态页 feed 的请求，让 B 站自己走原有渲染逻辑
    // 注意：B站不同tab/场景会走 feed/all、feed/space、feed/video、feed/article... 等不同端点。
    // 若只改写 feed/all，会出现“第一次触发走了别的feed端点 -> 没被改写 -> 需要点两次”的现象。
    const isDynamicFeed = p.includes('/x/polymer/web-dynamic/v1/feed/');
    if (!isDynamicFeed) return rawUrl;

    u.searchParams.set('host_mid', desiredHostMid);
    return u.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * 从 uplist 接口响应中提取UP列表（加载更多）
 * 结构推测：data.items[] -> { mid, name, face }
 */
function extractUpInfoFromUpListResponse(data: any): UpInfo[] {
  const ups: UpInfo[] = [];
  try {
    const d = unwrapData(data);
    // 尝试多种可能的列表字段: data.items, data.list, 或者 data 本身就是数组
    const items = d?.items ?? d?.list ?? (Array.isArray(d) ? d : null);
    if (Array.isArray(items)) {
      for (const up of items) {
        const mid = up?.mid ?? up?.uid;
        const face = up?.face ?? up?.avatar;
        const name = up?.name ?? up?.uname ?? up?.title ?? '';
        const hasUpdate = !!(up?.has_update ?? 0);
        if (mid && face) {
          ups.push({ mid: String(mid), face: String(face), name: String(name ?? ''), has_update: hasUpdate });
        }
      }
    }
  } catch (error) {
    console.warn('[bili-pin] failed to extract UP info from uplist response', error);
  }
  return ups;
}

/**
 * 从 portal 接口响应中提取推荐UP横条 up_list（你截图里的接口）
 * 典型结构：data.up_list.items[] -> { mid, name, face }
 */
function extractUpInfoFromPortalResponse(data: any): UpInfo[] {
  const ups: UpInfo[] = [];
  try {
    const d = unwrapData(data);
    const upList = d?.up_list ?? d?.upList ?? null;
    const items = upList?.items ?? upList?.list ?? null;
    if (Array.isArray(items)) {
      for (const up of items) {
        const mid = up?.mid ?? up?.uid;
        const face = up?.face ?? up?.avatar;
        const name = up?.name ?? up?.uname ?? up?.title ?? '';
        const hasUpdate = !!(up?.has_update ?? 0);
        if (mid && face) {
          ups.push({ mid: String(mid), face: String(face), name: String(name ?? ''), has_update: hasUpdate });
        }
      }
    }
  } catch (error) {
    console.warn('[bili-pin] failed to extract UP info from portal response', error);
  }
  return ups;
}

/**
 * 从 x/relation/followings 或 x/relation/fans 接口响应中提取用户信息
 * 结构通常是: data.list[] -> { mid, uname, face, ... }
 */
function extractUpInfoFromRelationResponse(data: any): UpInfo[] {
  const ups: UpInfo[] = [];
  try {
    const d = unwrapData(data);
    const list = d?.list ?? d?.items ?? null;
    if (Array.isArray(list)) {
      for (const up of list) {
        const mid = up?.mid ?? up?.uid;
        const face = up?.face ?? up?.avatar;
        const name = up?.uname ?? up?.name ?? '';
        const mtime = up?.mtime;
        if (mid && face) {
          ups.push({ mid: String(mid), face: String(face), name: String(name ?? ''), mtime });
        }
      }
    }
  } catch (error) {
    console.warn('[bili-pin] failed to extract UP info from relation response', error);
  }
  return ups;
}

/**
 * 从 feed/* 接口响应中提取作者信息（用于动态流卡片：三点菜单等场景经常拿不到 space 链接）
 * 常见结构：data.items[].modules.module_author -> { mid, name/uname, face }
 * 也可能存在转发/引用：orig.modules.module_author 或 desc.user_profile.info
 */
function extractUpInfoFromFeedResponse(data: any): UpInfo[] {
  const ups: UpInfo[] = [];
  try {
    const d = unwrapData(data);
    const items = d?.items ?? d?.list ?? d?.data?.items ?? null;
    if (!Array.isArray(items)) return ups;

    const pickFromAuthorModule = (obj: any): UpInfo | null => {
      const mod = obj?.modules?.module_author ?? obj?.modules?.moduleAuthor ?? null;
      const mid = mod?.mid ?? mod?.uid ?? null;
      const face = mod?.face ?? mod?.avatar ?? null;
      const name = mod?.name ?? mod?.uname ?? mod?.title ?? '';
      if (!mid || !face) return null;
      return { mid: String(mid), face: String(face), name: String(name ?? '') };
    };

    const pickFromUserProfile = (obj: any): UpInfo | null => {
      const info = obj?.desc?.user_profile?.info ?? obj?.user_profile?.info ?? null;
      const mid = info?.mid ?? info?.uid ?? null;
      const face = info?.face ?? info?.avatar ?? null;
      const name = info?.uname ?? info?.name ?? '';
      if (!mid || !face) return null;
      return { mid: String(mid), face: String(face), name: String(name ?? '') };
    };

    for (const it of items) {
      const a1 = pickFromAuthorModule(it);
      if (a1) ups.push(a1);

      const a2 = pickFromAuthorModule(it?.orig);
      if (a2) ups.push(a2);

      const a3 = pickFromUserProfile(it);
      if (a3) ups.push(a3);
    }
  } catch {
    // ignore
  }
  return ups;
}

/**
 * 处理API响应，提取UP信息并缓存
 */
function processApiResponse(url: string, responseData: any): void {
  try {
    const isPortal = url.includes('/x/polymer/web-dynamic/v1/portal');
    const isUpList = url.includes('/x/polymer/web-dynamic/v1/uplist');
    const isFeed = url.includes('/x/polymer/web-dynamic/v1/feed/');
    const isRelation = url.includes('/x/relation/followings') || url.includes('/x/relation/fans') || url.includes('/x/relation/tag');

    if (!isPortal && !isUpList && !isFeed && !isRelation) return;

    let ups: UpInfo[] = [];
    if (isPortal) {
      ups = extractUpInfoFromPortalResponse(responseData);
    } else if (isUpList) {
      ups = extractUpInfoFromUpListResponse(responseData);
    } else if (isRelation) {
      ups = extractUpInfoFromRelationResponse(responseData);
    } else {
      ups = extractUpInfoFromFeedResponse(responseData);
    }

    if (isPortal && ups.length) {
      // portal 是“当前推荐横条”的权威列表：直接替换
      lastPortalUpList = ups.slice(0, MAX_PORTAL_UP_LIST);
    } else if (isUpList && ups.length) {
      // uplist 可能加载更多：做去重追加，并限制最大长度，避免长期增长
      const existed = new Set(lastPortalUpList.map((u) => u.mid));
      for (const up of ups) {
        if (!up?.mid) continue;
        if (existed.has(up.mid)) continue;
        lastPortalUpList.push(up);
        existed.add(up.mid);
      }
      if (lastPortalUpList.length > MAX_PORTAL_UP_LIST) {
        lastPortalUpList = lastPortalUpList.slice(-MAX_PORTAL_UP_LIST);
      }
    }

    // 缓存UP信息（用头像 hash 做关联，用于把“DOM里的头像”映射到 “portal给的mid”）
    for (const up of ups) {
      if (up.mid && up.face) {
        const faceHash = extractFaceHash(up.face);
        if (faceHash) {
          upInfoByFaceHash.set(faceHash, up);
        }
        upInfoByMid.set(String(up.mid), up);
      }
    }
    trimOldestFromMap(upInfoByFaceHash, MAX_UP_INFO_CACHE);
    trimOldestFromMap(upInfoByMid, MAX_UP_INFO_CACHE);

    // 关注时间单独缓存（关系列表可能很长，避免因 upInfo 裁剪导致关注时间功能失效）
    if (isRelation && ups.length) {
      for (const up of ups) {
        const mid = up?.mid ? String(up.mid) : '';
        const mtime = (up as any)?.mtime;
        if (!mid || !/^\d+$/.test(mid)) continue;
        if (typeof mtime === 'number' && Number.isFinite(mtime) && mtime > 0) {
          mtimeByMid.set(mid, mtime);
        }
      }
      trimOldestFromMap(mtimeByMid, MAX_MTIME_CACHE);
    }

    if (ups.length > 0) {
      debugLog('[bili-pin] extracted UP info from API response', {
        url,
        count: ups.length,
        ups: ups.map((u) => ({ mid: u.mid, name: u.name })),
      });
    }

    // 通知 UI：portal up_list 已 ready（让按钮重算 mid 映射）
    if (isPortal || isUpList) {
      window.dispatchEvent(
        new CustomEvent('bili-pin:portal-up-list', {
          detail: { count: ups.length },
        }),
      );
    }

    if (isRelation && ups.length > 0) {
      window.dispatchEvent(
        new CustomEvent('bili-pin:relation-list-updated', {
          detail: { count: ups.length },
        }),
      );
    }
  } catch (error) {
    console.warn('[bili-pin] failed to process API response', error);
  }
}

/**
 * 拦截fetch请求
 */
function interceptFetch(): void {
  const originalFetch = window.fetch;
  
  window.fetch = async function(...args) {
    const req = args[0] as (string | URL | Request | undefined);
    const url =
      typeof req === 'string'
        ? req
        : req instanceof Request
          ? req.url
          : req instanceof URL
            ? req.toString()
            : '';
    const needProcess = shouldProcessApiUrl(url);
    
    // 只拦截B站API请求
    if (url.includes('api.bilibili.com')) {
      try {
        // 若正在“切换到某个 mid”，则改写 feed 请求的 host_mid
        if (typeof args[0] === 'string') {
          args[0] = rewriteHostMidIfNeeded(args[0]);
        } else if (args[0] && typeof (args[0] as any).url === 'string') {
          const req = args[0] as Request;
          const rewritten = rewriteHostMidIfNeeded(req.url);
          if (rewritten !== req.url) {
            args[0] = new Request(rewritten, req);
          }
        }

        const response = await originalFetch.apply(this, args);
        
        // 仅对目标接口解析 JSON，避免对大量无关 API 响应做解析导致长期性能/内存压力
        if (needProcess) {
          // 克隆响应以便读取（原始响应只能读取一次）
          const clonedResponse = response.clone();
          // 异步处理响应，不阻塞原始请求
          clonedResponse
            .json()
            .then((data: any) => {
              processApiResponse(url, data);
            })
            .catch(() => {
              // 如果不是JSON响应，忽略
            });
        }
        
        return response;
      } catch (error) {
        console.warn('[bili-pin] fetch interception error', error);
        return originalFetch.apply(this, args);
      }
    }
    
    return originalFetch.apply(this, args);
  };
}

/**
 * 拦截XMLHttpRequest
 */
function interceptXHR(): void {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ) {
    const raw = typeof url === 'string' ? url : url.toString();
    const rewritten = raw.includes('api.bilibili.com') ? rewriteHostMidIfNeeded(raw) : raw;
    (this as any)._biliPinUrl = rewritten;
    return originalOpen.call(this, method, rewritten, async ?? true, username as any, password as any);
  };
  
  XMLHttpRequest.prototype.send = function(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const xhr = this as any;
    const url = xhr._biliPinUrl || '';
    const needProcess = shouldProcessApiUrl(url);
    
    // 只拦截B站API请求
    if (url.includes('api.bilibili.com') && needProcess) {
      const originalOnReadyStateChange = xhr.onreadystatechange;
      
      xhr.onreadystatechange = function() {
        if (originalOnReadyStateChange) {
          originalOnReadyStateChange.apply(this, arguments as any);
        }
        
        // 当请求完成时，提取数据
        if (xhr.readyState === 4 && xhr.status === 200) {
          try {
            const responseText = xhr.responseText;
            if (responseText) {
              const data = JSON.parse(responseText);
              processApiResponse(url, data);
            }
          } catch (error) {
            // 忽略解析错误
          }
        }
      };
    }
    
    return originalSend.call(this, body as any);
  };
}

/**
 * 初始化API拦截
 */
export function initApiInterceptor(): void {
  const key = '__biliPinApiInterceptorInstalled';
  if ((window as any)[key]) return;
  (window as any)[key] = 1;
  interceptFetch();
  interceptXHR();
  debugLog('[bili-pin] API interceptor initialized');
}

export function setDesiredHostMid(mid: string | null): void {
  desiredHostMid = mid ? String(mid).trim() : null;
  syncFilteredMidAttr();
}

export function getDesiredHostMid(): string | null {
  return desiredHostMid;
}

/**
 * 通过mid获取UP信息（从缓存中）
 */
export function getUpInfoByMid(mid: string): UpInfo | null {
  return upInfoByMid.get(String(mid)) || null;
}

export function getFollowMtimeByMid(mid: string): number | null {
  const m = String(mid ?? '').trim();
  if (!/^\d+$/.test(m)) return null;
  const cached = mtimeByMid.get(m);
  if (typeof cached === 'number' && Number.isFinite(cached) && cached > 0) return cached;
  const info = upInfoByMid.get(m);
  const fallback = info?.mtime;
  if (typeof fallback === 'number' && Number.isFinite(fallback) && fallback > 0) return fallback;
  return null;
}

/**
 * 通过头像URL获取UP信息
 */
export function getUpInfoByFace(faceUrl: string): UpInfo | null {
  const faceHash = extractFaceHash(faceUrl);
  if (!faceHash) return null;
  return upInfoByFaceHash.get(faceHash) || null;
}

/**
 * 通过名称获取UP信息（从最近一次 portal 列表中查找，作为兜底）
 */
export function getUpInfoByName(name: string): UpInfo | null {
  const n = name.trim();
  if (!n) return null;
  return lastPortalUpList.find((u) => u.name === n) || null;
}

/**
 * 获取UP是否有新动态
 */
export function getUpUpdateStatus(mid: string): boolean {
  const info = upInfoByMid.get(String(mid));
  return info?.has_update ?? false;
}

/**
 * 标记UP为已读（消除红点）
 */
export function markUpAsRead(mid: string): void {
  const info = upInfoByMid.get(String(mid));
  if (info) {
    info.has_update = false;
  }
}

/**
 * 获取所有缓存的UP信息
 */
export function getAllCachedUpInfo(): UpInfo[] {
  return Array.from(upInfoByMid.values());
}

/**
 * 获取最近一次 portal 返回的推荐UP横条列表（用于调试/按名称兜底匹配）
 */
export function getLastPortalUpList(): UpInfo[] {
  return lastPortalUpList;
}

