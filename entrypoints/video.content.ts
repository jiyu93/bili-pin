import contentStyles from '../src/styles/content.css?inline';
import { injectStyleTag } from '../src/utils/style';
import { observeVideoFollowMenu } from '../src/ui/videoFollowMenuPin';

export default defineContentScript({
  matches: ['https://www.bilibili.com/video/*'],
  runAt: 'document_idle',
  // video 页需要访问 window.__INITIAL_STATE__ 获取 UP 主信息，且可以通过 storageBridge 访问存储
  world: 'MAIN',
  main() {
    injectStyleTag(contentStyles, 'bili-pin-video-style');
    observeVideoFollowMenu();
  },
});


