import { getUpAvatarStripDiagnostics } from './selectors';

const SOURCE = 'bili-pin';

function injectPageScript() {
  const script = document.createElement('script');
  script.textContent = `
(() => {
  const SOURCE = ${JSON.stringify(SOURCE)};
  // 页面console可用：window.__biliPin.dump()
  window.__biliPin = {
    dump() {
      window.postMessage({ source: SOURCE, type: 'DUMP_REQUEST' }, '*');
    },
  };
  window.addEventListener('message', (ev) => {
    const data = ev && ev.data;
    if (!data || data.source !== SOURCE) return;
    if (data.type === 'DUMP_RESPONSE') {
      console.info('[bili-pin] diagnostics', data.payload);
    }
  });
})();
`;
  document.documentElement.appendChild(script);
  script.remove();
}

export function installDebugBridge() {
  // 只注入一次
  const key = '__biliPinBridgeInstalled';
  if ((window as any)[key]) return;
  (window as any)[key] = true;

  injectPageScript();

  window.addEventListener('message', (ev) => {
    const data = ev && (ev as MessageEvent).data;
    if (!data || data.source !== SOURCE) return;
    if (data.type === 'DUMP_REQUEST') {
      const payload = getUpAvatarStripDiagnostics();
      window.postMessage({ source: SOURCE, type: 'DUMP_RESPONSE', payload }, '*');
    }
  });
}


