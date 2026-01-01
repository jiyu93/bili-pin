import '../src/styles/content.css';
import { observeUpAvatarStrip } from '../src/bili/observe';
import { injectPinUi } from '../src/ui/injectPinButtons';
import { installDebugBridge } from '../src/bili/debugBridge';
import { initApiInterceptor } from '../src/bili/apiInterceptor';

export default defineContentScript({
  matches: ['https://t.bilibili.com/*'],
  runAt: 'document_start', // 改为document_start，以便尽早拦截API请求
  // 关键：在 MAIN world 运行，才能拦截页面自身发出的 fetch/xhr（隔离世界改 window.fetch 没用）
  world: 'MAIN',
  main() {
    // 尽早初始化API拦截器，在页面加载API请求之前
    initApiInterceptor();
    installDebugBridge();

    observeUpAvatarStrip((stripRoot) => {
      injectPinUi(stripRoot).catch((err) => {
        console.warn('[bili-pin] inject failed', err);
      });
    });
  },
});


