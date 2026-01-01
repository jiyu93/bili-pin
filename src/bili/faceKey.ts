/**
 * 从 B 站头像 URL 中抽取 face hash。
 *
 * 用途：
 * - 仅用于把“portal 接口返回的 up_list(face, mid)”与页面 DOM 里的头像 img.src 关联起来
 * - 不用于持久化，也不作为用户唯一标识（唯一标识是 mid）
 *
 * 示例：
 * - `https://i0.hdslb.com/bfs/face/<hash>.jpg@96w_96h.webp` -> `<hash>`
 */
export function extractFaceHash(url: string): string | null {
  const s = String(url ?? '');
  const m = s.match(/\/bfs\/face\/([0-9a-fA-F]+)(?:[.@/?#]|$)/);
  return m?.[1] ?? null;
}


