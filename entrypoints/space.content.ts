import '../src/styles/content.css';
import { observeSpacePage } from '../src/ui/spaceFollowMenuPin';

export default defineContentScript({
  matches: ['https://space.bilibili.com/*'],
  runAt: 'document_idle',
  world: 'MAIN',
  main() {
    observeSpacePage();
  },
});


