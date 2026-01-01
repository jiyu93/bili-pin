/**
 * B站动态API调用模块
 * 用于直接获取指定UP的动态Feed
 */

export interface DynamicFeedResponse {
  code: number;
  message: string;
  data?: {
    items?: Array<{
      id_str: string;
      modules: any;
      [key: string]: any;
    }>;
    has_more?: number;
    offset?: string;
    [key: string]: any;
  };
}

/**
 * 获取指定UP的动态Feed
 * @param hostMid UP的mid（用户ID）
 * @param offset 偏移量，用于分页
 * @returns API响应数据
 */
export async function fetchUserDynamicFeed(
  hostMid: string,
  offset: string = '',
): Promise<DynamicFeedResponse> {
  const url = new URL('https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space');
  url.searchParams.set('host_mid', hostMid);
  if (offset) {
    url.searchParams.set('offset', offset);
  }
  // 添加其他可能需要的参数
  url.searchParams.set('page', '1');
  url.searchParams.set('page_size', '20');

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      credentials: 'include', // 包含cookies，用于身份验证
      headers: {
        'Accept': 'application/json',
        'Referer': 'https://t.bilibili.com/',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data as DynamicFeedResponse;
  } catch (error) {
    console.error('[bili-pin] failed to fetch dynamic feed', error);
    throw error;
  }
}

/**
 * 检查uid是否为有效的数字mid
 */
export function isValidMid(uid: string): boolean {
  return /^\d+$/.test(String(uid ?? '').trim());
}

/**
 * 通过UP名称搜索获取mid
 * 使用B站的搜索API
 */
export async function searchMidByName(name: string): Promise<string | null> {
  if (!name || name.trim().length === 0) {
    return null;
  }

  try {
    // B站搜索API
    const url = new URL('https://api.bilibili.com/x/web-interface/search/type');
    url.searchParams.set('search_type', 'bili_user');
    url.searchParams.set('keyword', name.trim());
    url.searchParams.set('page', '1');
    url.searchParams.set('pagesize', '10');

    const response = await fetch(url.toString(), {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'Referer': 'https://www.bilibili.com/',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.code !== 0 || !data.data?.result) {
      console.warn('[bili-pin] search API returned error', data);
      return null;
    }

    // 在搜索结果中查找名称完全匹配或最相似的UP
    const results = data.data.result;
    for (const user of results) {
      const userName = user.uname || user.name || '';
      // 精确匹配或包含匹配
      if (userName === name.trim() || userName.includes(name.trim()) || name.trim().includes(userName)) {
        const mid = String(user.mid || user.uid || '');
        if (isValidMid(mid)) {
          console.debug('[bili-pin] found mid via search', { name, mid, matchedName: userName });
          return mid;
        }
      }
    }

    // 如果没有完全匹配，返回第一个结果（如果存在）
    if (results.length > 0) {
      const first = results[0];
      const mid = String(first.mid || first.uid || '');
      if (isValidMid(mid)) {
        console.debug('[bili-pin] found mid via search (first result)', { name, mid, matchedName: first.uname || first.name });
        return mid;
      }
    }

    return null;
  } catch (error) {
    console.error('[bili-pin] failed to search mid by name', error);
    return null;
  }
}

