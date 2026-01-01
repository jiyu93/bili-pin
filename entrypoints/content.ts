import '../src/styles/content.css';
import { observeUpAvatarStrip } from '../src/bili/observe';
import { injectPinUi } from '../src/ui/injectPinButtons';
import { installDebugBridge } from '../src/bili/debugBridge';

export default defineContentScript({
  matches: ['https://t.bilibili.com/*'],
  runAt: 'document_idle',
  main() {
    console.debug('[bili-pin] content script loaded');
    installDebugBridge();

    observeUpAvatarStrip((stripRoot) => {
      injectPinUi(stripRoot).catch((err) => {
        console.warn('[bili-pin] inject failed', err);
      });
    });
  },
});


