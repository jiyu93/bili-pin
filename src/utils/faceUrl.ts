export function normalizeFaceUrl(value: unknown): string | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;

  if (raw.startsWith('~')) {
    const file = raw.slice(1).trim();
    if (!file) return undefined;
    const hasExtension = /\.[a-z0-9]+$/i.test(file);
    return `https://i0.hdslb.com/bfs/face/${hasExtension ? file : `${file}.jpg`}`;
  }

  if (raw.startsWith('//')) {
    return `https:${raw}`;
  }

  if (/^http:\/\/[^/]+\.hdslb\.com\/bfs\/face\//i.test(raw)) {
    return raw.replace(/^http:\/\//i, 'https://');
  }

  return raw;
}

export function compactFaceUrl(value: unknown): string | undefined {
  const normalized = normalizeFaceUrl(value);
  if (!normalized) return undefined;

  const match = normalized.match(/\/bfs\/face\/([^@?#]+)/i);
  if (!match?.[1]) return normalized;

  const file = match[1].trim();
  const named = file.match(/^([0-9a-f]{32,})(?:\.(jpe?g|png|webp|gif))?$/i);
  if (!named) return `~${file}`;

  const hash = named[1];
  const ext = (named[2] || 'jpg').toLowerCase();
  return ext === 'jpg' || ext === 'jpeg' ? `~${hash}` : `~${hash}.${ext}`;
}
