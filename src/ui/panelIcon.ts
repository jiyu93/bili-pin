/** 面板图标共用尺寸和描边，避免字体符号与 CSS 折线的视觉差异。 */
export function createPanelIcon(kind: 'collapse' | 'external'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('bili-pin-panel-icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', kind === 'collapse' ? 'M4 6l4 4 4-4' : 'M4 12l8-8M5 4h7v7');
  svg.appendChild(path);
  return svg;
}
