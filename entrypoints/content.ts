import '../src/styles/content.css';
import { observeUpAvatarStrip } from '../src/bili/observe';
import { injectPinUi } from '../src/ui/injectPinButtons';

export default defineContentScript({
  matches: ['https://t.bilibili.com/*'],
  runAt: 'document_idle',
  main() {
    console.debug('[bili-pin] content script loaded');

    observeUpAvatarStrip((stripRoot) => {
      injectPinUi(stripRoot).catch((err) => {
        console.warn('[bili-pin] inject failed', err);
      });
    });
  },
});


