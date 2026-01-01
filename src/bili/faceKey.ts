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

/**
 * 生成稳定的 faceKey：`face:<hash>`
 * 若无法抽 hash，则返回 null。
 */
export function makeFaceKey(faceUrl?: string): string | null {
  const hash = extractFaceHash(String(faceUrl ?? ''));
  return hash ? `face:${hash}` : null;
}

/**
 * 规范化已有的 uid（兼容历史数据）：
 * - `face:<url>` / `face:<hash>` -> `face:<hash>`（若能提取到）
 */
export function normalizeUid(uid: string, faceUrl?: string): string {
  const raw = String(uid ?? '').trim();
  if (!raw) return '';

  if (raw.startsWith('face:')) {
    const payload = raw.slice('face:'.length);
    const hash = extractFaceHash(payload) ?? extractFaceHash(String(faceUrl ?? ''));
    return hash ? `face:${hash}` : raw;
  }

  return raw;
}


