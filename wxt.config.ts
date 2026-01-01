import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: 'Bili Pin',
    version: '0.0.1',
    description: '在B站动态页添加置顶UP头像栏',
    permissions: ['storage'],
    host_permissions: [
      'https://t.bilibili.com/*',
      'https://space.bilibili.com/*',
      'https://www.bilibili.com/*',
      'https://api.bilibili.com/*',
    ],
  },
});


