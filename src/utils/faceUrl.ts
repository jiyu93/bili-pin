export function normalizeFaceUrl(value: unknown): string | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;

  if (raw.startsWith('//')) {
    return `https:${raw}`;
  }

  if (/^http:\/\/[^/]+\.hdslb\.com\/bfs\/face\//i.test(raw)) {
    return raw.replace(/^http:\/\//i, 'https://');
  }

  return raw;
}
