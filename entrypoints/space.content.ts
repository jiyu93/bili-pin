import '../src/styles/content.css';
import { observeSpacePage } from '../src/ui/spaceFollowMenuPin';

export default defineContentScript({
  matches: ['https://space.bilibili.com/*'],
  runAt: 'document_idle',
  // space 页不需要拦截 fetch/xhr，放在 ISOLATED 可直接使用 chrome.storage.local
  world: 'ISOLATED',
  main() {
    observeSpacePage();
  },
});


