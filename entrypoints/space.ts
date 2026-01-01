import '../src/styles/content.css';
import { observeSpacePage } from '../src/ui/spacePagePin';

export default defineContentScript({
  matches: ['https://space.bilibili.com/*'],
  runAt: 'document_idle',
  world: 'MAIN',
  main() {
    console.debug('[bili-pin] space page content script loaded');
    observeSpacePage();
  },
});

