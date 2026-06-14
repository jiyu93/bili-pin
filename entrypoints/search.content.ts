import contentStyles from '../src/styles/content.css?inline';
import { injectStyleTag } from '../src/utils/style';
import { observeSearchUserPin } from '../src/ui/searchUserPin';
import { installStorageWarningToast } from '../src/ui/storageWarning';

export default defineContentScript({
  matches: ['https://search.bilibili.com/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    injectStyleTag(contentStyles, 'bili-pin-content-style');
    installStorageWarningToast();
    observeSearchUserPin();
  },
});
