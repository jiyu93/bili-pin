import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'wxt';

const manifestKeyPath = path.resolve(process.cwd(), 'config/manifest-key.txt');
const manifestKey =
  process.env.BILI_PIN_MANIFEST_KEY?.trim() ||
  (fs.existsSync(manifestKeyPath) ? fs.readFileSync(manifestKeyPath, 'utf8').trim() : '');

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    ...(manifestKey ? { key: manifestKey } : {}),
    name: 'Bili Pin',
    version: '1.1.1',
    description: '一个简单的Bilibili插件，在你的动态首页置顶你的宝藏UP主。',
    icons: {
      16: '/icons/icon-16.png',
      32: '/icons/icon-32.png',
      48: '/icons/icon-48.png',
      128: '/icons/icon-128.png',
    },
    action: {
      default_title: 'Bili Pin',
      default_popup: 'popup.html',
      default_icon: {
        16: '/icons/icon-16.png',
        32: '/icons/icon-32.png',
        48: '/icons/icon-48.png',
        128: '/icons/icon-128.png',
      },
    },
    permissions: ['storage'],
  },
});
