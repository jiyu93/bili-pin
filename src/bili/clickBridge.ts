import { switchFeedInDynamicPage } from './feedSwitch';

/**
 * 直接筛选Feed
 * 
 * @param stripRoot 推荐列表的根元素
 * @param uid 目标UP的uid（必须是真实的数字mid）
 * @returns 是否成功触发筛选
 */
export async function filterFeedDirectly(
  stripRoot: HTMLElement,
  uid: string,
  _name?: string,
  _face?: string,
): Promise<boolean> {
  const mid = String(uid ?? '').trim();
  if (!/^\d+$/.test(mid)) return false;
  // 直接在动态页内切换（不会打开空间页/新标签）
  return switchFeedInDynamicPage(stripRoot, mid);
}


