/**
 * 从 B 站头像 URL 中抽取一个稳定的 face hash，用于做本地 key。
 * 例如：//i0.hdslb.com/bfs/face/<hash>.jpg@96w_96h.webp
 */
export function extractFaceHash(url: string): string | null {
  const s = String(url ?? '');
  // bfs/face/<hash>.xxx 或 bfs/face/<hash>@...
  const m = s.match(/\/bfs\/face\/([0-9a-fA-F]+)(?:[.@/?#]|$)/);
  return m?.[1] ?? null;
}

function hashString32(input: string): string {
  // DJB2 32-bit
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

/**
 * 生成稳定的 faceKey：`face:<hash>`
 * 若无法抽 hash，则生成 `faceh:<hash32>`（保证任何非空头像URL都可用）
 */
export function makeFaceKey(faceUrl?: string): string | null {
  const url = String(faceUrl ?? '').trim();
  if (!url) return null;
  const hash = extractFaceHash(url);
  if (hash) return `face:${hash}`;
  return `faceh:${hashString32(url)}`;
}

/**
 * 规范化已有的 uid（兼容历史数据）：
 * - `face:<url>` / `face:<hash>` -> `face:<hash>`（若能提取到）
 * - `faceh:<hash32>` 保持不变
 */
export function normalizeUid(uid: string, faceUrl?: string): string {
  const raw = String(uid ?? '').trim();
  if (!raw) return '';

  if (raw.startsWith('face:')) {
    const payload = raw.slice('face:'.length);
    const hash = extractFaceHash(payload) ?? extractFaceHash(String(faceUrl ?? ''));
    return hash ? `face:${hash}` : raw;
  }

  if (raw.startsWith('faceh:')) return raw;

  return raw;
}


