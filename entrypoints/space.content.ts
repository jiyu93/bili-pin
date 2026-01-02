import contentStyles from '../src/styles/content.css?inline';
import { injectStyleTag } from '../src/utils/style';
import { observeSpacePage } from '../src/ui/spaceFollowMenuPin';
import { initApiInterceptor } from '../src/bili/apiInterceptor';
import { installDebugBridge } from '../src/bili/debugBridge';

export default defineContentScript({
  matches: ['https://space.bilibili.com/*'],
  runAt: 'document_start',
  // space 页需要拦截 fetch/xhr (x/relation/followings 等) 以获取粉丝/关注列表信息
  world: 'MAIN',
  main() {
    injectStyleTag(contentStyles, 'bili-pin-space-style');
    initApiInterceptor();
    installDebugBridge();
    // 观察页面变化注入菜单
    // 注意：observeSpacePage 内部使用 document.body 监听，
    // 由于 runAt: document_start，此时 body 可能未就绪，需等待
    if (document.body) {
      observeSpacePage();
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observeSpacePage();
      });
    }
  },
});


