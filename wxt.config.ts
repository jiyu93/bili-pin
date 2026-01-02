import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: 'Bili Pin',
    version: '1.0.0',
    description: '一个轻量级的 Bilibili 浏览器扩展，置顶你的宝藏UP主',
    permissions: ['storage'],
    host_permissions: [
      'https://t.bilibili.com/*',
      'https://space.bilibili.com/*',
      'https://www.bilibili.com/*',
      'https://api.bilibili.com/*',
    ],
  },
});


