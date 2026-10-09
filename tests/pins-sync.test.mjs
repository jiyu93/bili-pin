import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';

const bundled = await build({ entryPoints: ['src/storage/pins.ts'], bundle: true, write: false, format: 'iife', globalName: 'pinsApi' });
const code = bundled.outputFiles[0].text;
const legacyKey = 'biliPin.pins.state.v3';
const recordKey = (mid) => `biliPin.pins.record.v4.${mid}`;
const orderKey = 'biliPin.pins.order.v4';
const legacy = [3, 1000, [['1', 'one', '', 0], ['2', 'two', '', 0]], [], 0, 0];

function device(initialSync = {}, initialLocal = {}) {
  const stores = { sync: structuredClone(initialSync), local: structuredClone(initialLocal) };
  const writes = [];
  const listeners = new Set();
  const errors = { get: null, set: null };
  const chrome = { runtime: {}, storage: { onChanged: {
    addListener: (callback) => listeners.add(callback), removeListener: (callback) => listeners.delete(callback),
  } } };
  for (const area of ['sync', 'local']) {
    chrome.storage[area] = {
      get(key, callback) {
        if (errors.get && area === 'sync') return Promise.reject(new Error(errors.get));
        const result = structuredClone(key == null ? stores[area] : Object.hasOwn(stores[area], key) ? { [key]: stores[area][key] } : {});
        if (callback) { queueMicrotask(() => callback(result)); return; }
        return Promise.resolve(result);
      },
      async set(values) {
        if (errors.set && area === 'sync') throw new Error(errors.set);
        writes.push({ area, values: structuredClone(values) });
        Object.assign(stores[area], structuredClone(values));
        for (const listener of listeners) listener(Object.fromEntries(Object.keys(values).map((key) => [key, { newValue: values[key] }])), area);
      },
    };
  }
  const context = vm.createContext({ chrome, console, TextEncoder, queueMicrotask, setTimeout, clearTimeout });
  vm.runInContext(code, context);
  return { api: context.pinsApi, chrome, stores, writes, errors, deliver(values) {
    Object.assign(stores.sync, structuredClone(values));
    for (const listener of listeners) listener(Object.fromEntries(Object.keys(values).map((key) => [key, { newValue: values[key] }])), 'sync');
  } };
}

async function mids(d) { return Array.from(await d.api.getPinnedUps(), (item) => item.mid); }
function syncWrites(d) { return Object.assign({}, ...d.writes.filter((write) => write.area === 'sync').map((write) => write.values)); }

test('新设备读空无写入；先置顶再取消，迟到的旧列表仍保留', async () => {
  const fresh = device();
  assert.deepEqual(await mids(fresh), []);
  assert.equal(fresh.writes.length, 0);
  await fresh.api.pinUp({ mid: '3', name: 'three' });
  await fresh.api.unpinUp('3');
  fresh.deliver({ [legacyKey]: legacy });
  assert.deepEqual(await mids(fresh), ['1', '2']);
  assert.equal(Object.hasOwn(syncWrites(fresh), legacyKey), false);
  assert.equal(Object.hasOwn(syncWrites(fresh), recordKey('1')), false);
  assert.equal(Object.hasOwn(syncWrites(fresh), recordKey('2')), false);
  const old = device({ [legacyKey]: legacy });
  old.deliver(syncWrites(fresh));
  assert.deepEqual(await mids(old), ['1', '2']);
});

test('两台设备离线修改不同 UP，按任意同步顺序保留双方操作', async () => {
  const base = { [recordKey('1')]: [4, 1000, 1, 'one', '', 1000], [recordKey('2')]: [4, 1000, 1, 'two', '', 1000] };
  const a = device(base), b = device(base);
  await a.api.pinUp({ mid: '3' });
  await b.api.unpinUp('1');
  await b.api.pinUp({ mid: '4' });
  a.deliver(syncWrites(b)); b.deliver(syncWrites(a));
  assert.deepEqual((await mids(a)).sort(), ['2', '3', '4']);
  assert.deepEqual((await mids(b)).sort(), ['2', '3', '4']);
  assert.deepEqual(Object.keys(syncWrites(a)).sort(), [recordKey('3'), orderKey].sort());
});

test('过期排序及空排序都不能删除远端新 UP 或复活已取消 UP', async () => {
  const d = device({ [legacyKey]: legacy });
  await d.api.unpinUp('1');
  d.deliver({ [recordKey('3')]: [4, 2000, 1, 'three', '', 2000] });
  await d.api.reorderPinnedUps(['1', '2']);
  await d.api.reorderPinnedUps([]);
  assert.deepEqual((await mids(d)).sort(), ['2', '3']);
  d.deliver({ [legacyKey]: legacy });
  assert.deepEqual((await mids(d)).sort(), ['2', '3']);
});

test('sync 权威，显式空数据/删除记录不回退旧 local', async () => {
  const d = device({ [legacyKey]: [3, 0, [], []] }, { [legacyKey]: legacy });
  assert.deepEqual(await mids(d), []);
  const removed = device({ [recordKey('1')]: [4, 2000, 0] }, { [legacyKey]: legacy });
  assert.deepEqual(await mids(removed), []);
});

test('兼容 local v1/v2/v3；只读不上传，用户操作时按 mid 迁移', async () => {
  const states = [
    { 'biliPin.pins.v1': [{ mid: '1', pinnedAt: 1000 }] },
    { 'biliPin.pins.state.v2': { version: 2, items: [{ mid: '1', pinnedAt: 1000, updatedAt: 1000 }], removed: { '2': 2000 }, order: ['1'], updatedAt: 2000 } },
    { [legacyKey]: [3, 1000, [['1', 'one', '', 0]], [['2', 1000]], 0, 1000] },
  ];
  for (const local of states) {
    const d = device({}, local);
    assert.deepEqual(await mids(d), ['1']);
    assert.equal(d.writes.length, 0);
    await d.api.pinUp({ mid: '3' });
    assert.deepEqual((await mids(d)).sort(), ['1', '3']);
    assert.equal(d.stores.sync[recordKey('1')][1], local[legacyKey] ? 2000 : 1000);
    assert.equal(d.stores.sync[recordKey('1')][5], 1000);
    assert.equal(d.stores.local[recordKey('3')][2], 1);
    const fresh = device(d.stores.sync);
    assert.deepEqual((await mids(fresh)).sort(), ['1', '3']);
    if (local['biliPin.pins.state.v2'] || local[legacyKey]) assert.equal(d.stores.sync[recordKey('2')][2], 0);
  }
});

test('读取或 sync 写入失败不写 local，恢复后队列仍可操作', async () => {
  const d = device({ [legacyKey]: legacy });
  d.errors.get = 'read failed';
  await assert.rejects(d.api.pinUp({ mid: '3' }), /read failed/);
  assert.equal(d.writes.length, 0);
  d.errors.get = null; d.errors.set = 'MAX_WRITE_OPERATIONS_PER_MINUTE';
  await assert.rejects(d.api.unpinUp('1'), /过于频繁/);
  assert.equal(d.writes.length, 0);
  d.errors.set = null;
  await d.api.pinUp({ mid: '3' });
  assert.deepEqual((await mids(d)).sort(), ['1', '2', '3']);
});

test('单项、总字节和 key 数量配额预检；超限不写 sync/local', async () => {
  const item = device();
  await assert.rejects(item.api.pinUp({ mid: '1', name: 'x'.repeat(8192) }), /同步空间已满/);
  assert.equal(item.writes.length, 0);
  const total = device(Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`reserved.${i}`, 'x'.repeat(8000)])));
  await assert.rejects(total.api.pinUp({ mid: '1' }), /同步空间已满/);
  assert.equal(total.writes.length, 0);
  const count = device(Object.fromEntries(Array.from({ length: 512 }, (_, i) => [`reserved.${i}`, 0])));
  await assert.rejects(count.api.pinUp({ mid: '1' }), /同步记录数量已达上限/);
  assert.equal(count.writes.length, 0);
});

test('同页并发置顶串行执行且都保留；返回值与保存一致', async () => {
  const d = device();
  await Promise.all([d.api.pinUp({ mid: '1' }), d.api.pinUp({ mid: '2' })]);
  assert.deepEqual(await mids(d), ['2', '1']);
  const result = await d.api.unpinUp('2');
  assert.deepEqual(Array.from(result, (item) => item.mid), ['1']);
});

test('远端 v4 变更通过 onPinsChange 通知，非置顶 key 不通知', async () => {
  const d = device();
  const notifications = [];
  const stop = d.api.onPinsChange((pins) => notifications.push(Array.from(pins, (item) => item.mid)));
  d.deliver({ [recordKey('1')]: [4, 1000, 1] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(notifications, [['1']]);
  d.deliver({ 'unrelated': 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(notifications.length, 1);
  stop();
});

test('MAIN 存储桥错误不会降级为空数据，更不会发送写请求', async () => {
  const callbacks = new Set(), requests = [];
  const window = {
    setTimeout, clearTimeout,
    addEventListener: (_event, callback) => callbacks.add(callback),
    removeEventListener: (_event, callback) => callbacks.delete(callback),
    postMessage(request) {
      requests.push(request);
      queueMicrotask(() => {
        for (const callback of callbacks) callback({ source: window, data: { __biliPin: 1, kind: 'storage:response', requestId: request.requestId, ok: false, error: 'bridge read failed' } });
      });
    },
  };
  const context = vm.createContext({ window, console, TextEncoder, queueMicrotask, setTimeout, clearTimeout });
  vm.runInContext(code, context);
  await assert.rejects(context.pinsApi.pinUp({ mid: '1' }), /bridge read failed/);
  assert.equal(requests.length, 3);
  assert.ok(requests.every((request) => request.kind === 'storage:snapshot'));
});

test('实际 MAIN → ISOLATED bridge 批量读写与变更转发；拒绝越界键', async () => {
  const bridgeBundle = await build({ entryPoints: ['entrypoints/storageBridge.content.ts'], bundle: true, write: false, format: 'iife', globalName: 'bridgeApi' });
  const d = device({ [legacyKey]: legacy, secret: 'must not cross the bridge' });
  const callbacks = new Set(), messages = [];
  const window = {
    setTimeout, clearTimeout,
    addEventListener: (_event, callback) => callbacks.add(callback),
    removeEventListener: (_event, callback) => callbacks.delete(callback),
    postMessage(message) {
      messages.push(message);
      queueMicrotask(() => {
        for (const callback of [...callbacks]) callback({ source: window, data: message });
      });
    },
  };
  const isolated = vm.createContext({ window, chrome: d.chrome, console, TextEncoder, defineContentScript: (definition) => definition });
  vm.runInContext(bridgeBundle.outputFiles[0].text, isolated);
  isolated.bridgeApi.default.main();
  const main = vm.createContext({ window, console, TextEncoder, queueMicrotask, setTimeout, clearTimeout });
  vm.runInContext(code, main);
  assert.deepEqual(Array.from(await main.pinsApi.getPinnedUps(), (item) => item.mid), ['1', '2']);
  const snapshot = messages.find((message) => message.kind === 'storage:response' && message.value?.values);
  assert.equal(Object.hasOwn(snapshot.value.values, 'secret'), false);
  assert.equal(snapshot.value.count, 2);
  await main.pinsApi.pinUp({ mid: '3' });
  assert.equal(d.stores.sync[recordKey('3')][2], 1);
  assert.equal(d.stores.local[recordKey('3')][2], 1);
  const notifications = [];
  const stop = main.pinsApi.onPinsChange((pins) => notifications.push(Array.from(pins, (item) => item.mid)));
  d.deliver({ [recordKey('1')]: [4, 5000, 0] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(notifications[0].sort(), ['2', '3']);
  stop();
  const collapseKeys = ['biliPin.ui.pinBarCollapsed.v1', 'biliPin.ui.trendingsCollapsed.v1'];
  for (const area of ['sync', 'local']) {
    const requestId = `collapse-${area}`;
    window.postMessage({ __biliPin: 1, kind: 'storage:setMany', requestId, area, values: {
      [collapseKeys[0]]: false, [collapseKeys[1]]: true,
    } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(messages.find((message) => message.kind === 'storage:response' && message.requestId === requestId).ok, true);
    for (const [index, key] of collapseKeys.entries()) {
      const readId = `read-${area}-${index}`;
      window.postMessage({ __biliPin: 1, kind: 'storage:get', requestId: readId, area, key });
      await new Promise((resolve) => setImmediate(resolve));
      const response = messages.find((message) => message.kind === 'storage:response' && message.requestId === readId);
      assert.equal(response.found, true);
      assert.equal(response.value, index === 1);
      assert.ok(messages.some((message) => message.kind === 'storage:changed' && message.area === area && message.key === key));
    }
  }
  const before = d.writes.length;
  for (const badKey of ['secret', 'biliPin.pins.record.v4.', 'biliPin.pins.record.v4.not-a-mid', 'biliPin.unknown']) {
    const requestId = `denied-${badKey}`;
    window.postMessage({ __biliPin: 1, kind: 'storage:setMany', requestId, area: 'sync', values: { [recordKey('5')]: [4, 1, 1], [badKey]: 1 } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(messages.find((message) => message.kind === 'storage:response' && message.requestId === requestId).ok, false);
  }
  assert.equal(d.writes.length, before);
});
