import { observeStorageChanges, readStorageValue, writeStorageValue } from '../storage/config';
import { showToast } from './toast';
import { createPanelIcon } from './panelIcon';

/** 标题保留在原容器内；内容隐藏由 content.css 控制，不移除原站节点。 */
export function installPanelCollapse(
  panel: HTMLElement,
  header: HTMLElement,
  key: string,
  label: string,
  onCollapse?: () => void,
): () => void {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'bili-pin-collapse';
  button.appendChild(createPanelIcon('collapse'));
  header.classList.add('bili-pin-collapse-header');
  let collapsed = false;
  let disposed = false;
  let revision = 0;
  let pending: boolean | undefined;
  let saving = false;

  const apply = (value: boolean) => {
    collapsed = value;
    panel.dataset.biliPinCollapsed = String(value);
    button.setAttribute('aria-expanded', String(!value));
    button.setAttribute('aria-label', `${value ? '展开' : '折叠'}${label}`);
    button.title = `${value ? '展开' : '折叠'}${label}`;
    if (value) onCollapse?.();
  };

  const load = async () => {
    const readingRevision = ++revision;
    try {
      const sync = await readStorageValue<boolean>('sync', key);
      const value = typeof sync.value === 'boolean'
        ? sync.value
        : (await readStorageValue<boolean>('local', key)).value;
      if (!disposed && !saving && revision === readingRevision) apply(value === true);
    } catch (error) {
      console.warn('[bili-pin] failed to read collapse preference', error);
    }
  };

  // 合并快速连点，避免迟到的读取或较早的保存覆盖用户最后一次选择。
  const save = async () => {
    if (saving) return;
    saving = true;
    while (pending !== undefined) {
      const value = pending;
      pending = undefined;
      try {
        await writeStorageValue('sync', key, value);
        await writeStorageValue('local', key, value);
      } catch (error) {
        console.warn('[bili-pin] failed to save collapse preference', error);
        if (!disposed) showToast('折叠状态保存失败，请稍后重试');
      }
    }
    saving = false;
  };

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    revision++;
    apply(!collapsed);
    pending = collapsed;
    void save();
  });
  apply(false);
  header.appendChild(button);
  const stopStorage = observeStorageChanges([key], ({ area }) => {
    if (area === 'sync' && !saving) void load();
  });
  void load();

  return () => {
    disposed = true;
    revision++;
    stopStorage();
    button.remove();
    header.classList.remove('bili-pin-collapse-header');
    delete panel.dataset.biliPinCollapsed;
  };
}
