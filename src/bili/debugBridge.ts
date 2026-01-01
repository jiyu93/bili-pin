import { getUpAvatarStripDiagnostics } from './selectors';
import { getAllCachedUpInfo } from './apiInterceptor';
import { getPinnedUps } from '../storage/pins';

export function installDebugBridge() {
  // 只安装一次
  const key = '__biliPinBridgeInstalled';
  if ((window as any)[key]) return;
  (window as any)[key] = true;

  // 不再注入 <script>（会被B站 CSP 拦），直接在当前 world 挂调试方法
  (window as any).__biliPin = {
    dump() {
      console.info('[bili-pin] diagnostics', getUpAvatarStripDiagnostics());
    },
    async cache() {
      const cachedUps = getAllCachedUpInfo();
      const pinnedUps = await getPinnedUps();
      console.info('[bili-pin] cache', {
        cachedUpsCount: cachedUps.length,
        pinnedUpsCount: pinnedUps.length,
        cachedUps: cachedUps.slice(0, 10).map((u) => ({ mid: u.mid, name: u.name })),
      });
    },
  };
}


