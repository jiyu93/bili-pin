import '../src/styles/content.css';
import { observeVideoFollowMenu } from '../src/ui/videoFollowMenuPin';

export default defineContentScript({
  matches: ['https://www.bilibili.com/video/*'],
  runAt: 'document_idle',
  // video 页不需要拦截 fetch/xhr，放在 ISOLATED 可直接访问 chrome.storage.local
  world: 'ISOLATED',
  main() {
    observeVideoFollowMenu();
  },
});


