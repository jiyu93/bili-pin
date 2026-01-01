let toastTimer: number | null = null;

export function showToast(message: string, ms = 2400): void {
  const id = 'bili-pin-toast';
  const existing = document.getElementById(id);
  const el = existing ?? document.createElement('div');
  el.id = id;
  el.textContent = message;
  el.style.position = 'fixed';
  el.style.right = '16px';
  el.style.bottom = '16px';
  el.style.zIndex = '2147483647';
  el.style.maxWidth = '360px';
  el.style.padding = '10px 12px';
  el.style.borderRadius = '10px';
  el.style.background = 'rgba(0,0,0,0.78)';
  el.style.color = '#fff';
  el.style.fontSize = '12px';
  el.style.lineHeight = '1.4';
  el.style.boxShadow = '0 6px 16px rgba(0,0,0,0.22)';

  if (!existing) document.body.appendChild(el);

  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.remove();
    toastTimer = null;
  }, ms);
}


