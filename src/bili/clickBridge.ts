import { switchFeedInDynamicPage } from './feedSwitch';

/**
 * 直接筛选Feed
 * 
 * @param stripRoot 推荐列表的根元素
 * @param mid 目标 UP 的真实数字 mid
 * @returns 是否成功触发筛选
 */
export async function filterFeedDirectly(
  stripRoot: HTMLElement,
  mid: string,
): Promise<boolean> {
  const targetMid = String(mid ?? '').trim();
  if (!/^\d+$/.test(targetMid)) return false;
  // 直接在动态页内切换（不会打开空间页/新标签）
  return switchFeedInDynamicPage(stripRoot, targetMid);
}

