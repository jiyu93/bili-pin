import { createPanelIcon } from './panelIcon';

/** 保留原站容器及其 click 事件，文字按钮的鼠标/键盘点击直接冒泡给原站。 */
export function installCommunityEntry(image: HTMLElement) {
  image.querySelector(':scope > .bili-pin-community-entry__button')?.remove();
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'bili-pin-community-entry__button';

  const label = document.createElement('span');
  label.textContent = 'bilibili社区中心';
  button.append(label, createPanelIcon('external'));

  image.classList.add('bili-pin-community-entry');
  image.appendChild(button);
  return {
    image,
    button,
    dispose() {
      button.remove();
      image.classList.remove('bili-pin-community-entry');
    },
  };
}
