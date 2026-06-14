import { STORAGE_SYNC_WARNING_EVENT } from '../storage/config';
import { showToast } from './toast';

export function installStorageWarningToast(): void {
  const root = document.documentElement;
  if (!root || root.getAttribute('data-bili-pin-storage-warning-toast') === '1') return;
  root.setAttribute('data-bili-pin-storage-warning-toast', '1');

  window.addEventListener(STORAGE_SYNC_WARNING_EVENT, () => {
    showToast('置顶已保存到本机，但同步空间已满，可能无法同步到其他设备。', 3600);
  });
}
