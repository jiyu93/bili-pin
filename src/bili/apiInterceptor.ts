/**
 * API拦截模块
 * 拦截B站动态页的API请求，从响应数据中提取UP列表信息（包括mid）
 * 这样就不需要从DOM中解析了，更可靠
 */

import { extractFaceHash } from './faceKey';

export interface UpInfo {
  mid: string;
  name: string;
  face: string;
}

// 存储从API响应中提取的UP信息
// 只用于“从接口拿mid”，不作为持久化标识（持久化只存mid）
const upInfoByFaceHash = new Map<string, UpInfo>(); // key: face hash (bfs/face/<hash>)
const upInfoByMid = new Map<string, UpInfo>(); // key: mid
let lastPortalUpList: UpInfo[] = [];
let desiredHostMid: string | null = null;

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
        if (mid && face) {
          ups.push({ mid: String(mid), face: String(face), name: String(name ?? '') });
        }
      }
    }
  } catch (error) {
    console.warn('[bili-pin] failed to extract UP info from portal response', error);
  }
  return ups;
}

/**
 * 处理API响应，提取UP信息并缓存
 */
function processApiResponse(url: string, responseData: any): void {
  try {
    // 只解析“推荐UP横条”的 portal 接口，避免做无关解析（也避免你看到“太多请求/太多逻辑”）
    if (!url.includes('/x/polymer/web-dynamic/v1/portal')) return;

    const ups = extractUpInfoFromPortalResponse(responseData);
    if (ups.length) lastPortalUpList = ups;

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

    if (ups.length > 0) {
      console.debug('[bili-pin] extracted UP info from API response', { 
        url, 
        count: ups.length,
        ups: ups.map(u => ({ mid: u.mid, name: u.name }))
      });
    }

    // 通知 UI：portal up_list 已 ready（让按钮重算 mid 映射）
    window.dispatchEvent(
      new CustomEvent('bili-pin:portal-up-list', {
        detail: { count: ups.length },
      }),
    );
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
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    
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
        
        // 克隆响应以便读取（原始响应只能读取一次）
        const clonedResponse = response.clone();
        
        // 异步处理响应，不阻塞原始请求
        clonedResponse.json().then((data: any) => {
          processApiResponse(url, data);
        }).catch(() => {
          // 如果不是JSON响应，忽略
        });
        
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
  
  XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...args: any[]) {
    const raw = typeof url === 'string' ? url : url.toString();
    const rewritten = raw.includes('api.bilibili.com') ? rewriteHostMidIfNeeded(raw) : raw;
    this._biliPinUrl = rewritten;
    return originalOpen.apply(this, [method, rewritten, ...args]);
  };
  
  XMLHttpRequest.prototype.send = function(...args: any[]) {
    const xhr = this;
    const url = xhr._biliPinUrl || '';
    
    // 只拦截B站API请求
    if (url.includes('api.bilibili.com')) {
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
    
    return originalSend.apply(this, args);
  };
}

/**
 * 初始化API拦截
 */
export function initApiInterceptor(): void {
  interceptFetch();
  interceptXHR();
  console.debug('[bili-pin] API interceptor initialized');
}

export function setDesiredHostMid(mid: string | null): void {
  desiredHostMid = mid ? String(mid).trim() : null;
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

/**
 * 通过头像URL获取UP信息
 */
export function getUpInfoByFace(faceUrl: string): UpInfo | null {
  const faceHash = extractFaceHash(faceUrl);
  if (!faceHash) return null;
  return upInfoByFaceHash.get(faceHash) || null;
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

