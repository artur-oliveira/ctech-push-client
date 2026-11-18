import {readFileSync} from 'node:fs';
import {describe, expect, it, vi} from 'vitest';
import {fakeWindow, golden, loadWorker, ORIGIN} from './helpers';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

describe('sw.js', () => {
  it('has no fetch handler and no cache usage, so a deploy never meets a stale bundle', () => {
    const code = readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
    expect(code).not.toMatch(/'fetch'|"fetch"|caches\./);
    expect(Object.keys(loadWorker().handlers).sort()).toEqual(['activate', 'install', 'notificationclick', 'push']);
  });

  it('stamps the package version into the built worker', () => {
    const code = readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
    expect(code).toContain(`const SW_VERSION = '${pkg.version}'`);
    expect(code).not.toContain('__SW_VERSION__');
  });

  it('install skips waiting and activate claims clients', async () => {
    const w = loadWorker();
    await w.fire('install');
    await w.fire('activate');
    expect(w.self.skipWaiting).toHaveBeenCalled();
    expect(w.self.clients.claim).toHaveBeenCalled();
  });

  it('shows the golden payload as sent', async () => {
    const w = loadWorker();
    await w.pushJSON(golden);
    expect(w.shown).toHaveLength(1);
    const {title, options} = w.shown[0];
    expect(title).toBe(golden.notification.title);
    expect(options).toMatchObject({
      body: golden.notification.body,
      tag: golden.notification.tag,
      lang: 'pt-BR',
      silent: false,
      data: {v: 1, id: 'evt-0001', type: 'document.rejected', navigate: golden.notification.navigate},
    });
  });

  it('always shows a notification, even for an unreadable or empty payload', async () => {
    for (const run of [(w: ReturnType<typeof loadWorker>) => w.fire('push'), (w: ReturnType<typeof loadWorker>) => w.fire('push', {data: {json: () => { throw new Error('bad'); }}}), (w: ReturnType<typeof loadWorker>) => w.pushJSON({unexpected: true})]) {
      const w = loadWorker();
      await run(w);
      expect(w.shown).toHaveLength(1);
      expect(w.shown[0].title).toBe('Nova atualização no CTech');
      expect(w.shown[0].options.data).toMatchObject({navigate: '/'});
    }
  });

  it('is silent when an app window is focused (the WebSocket toast already told the user)', async () => {
    const w = loadWorker([fakeWindow(`${ORIGIN}/dashboard`, true)]);
    await w.pushJSON(golden);
    expect(w.shown[0].options.silent).toBe(true);
  });

  it('truncates oversized fields and drops a foreign navigate target', async () => {
    const w = loadWorker();
    await w.pushJSON({web_push: 8030, notification: {title: 'x'.repeat(500), body: 'y'.repeat(900), tag: 't'.repeat(200), navigate: 'https://evil.test/x', data: {v: 1}}});
    const {title, options} = w.shown[0];
    expect(title).toHaveLength(120);
    expect((options.body as string).length).toBe(240);
    expect((options.tag as string).length).toBe(64);
    expect(options.data).toMatchObject({navigate: '/'});
  });

  it('click focuses an open window of the origin and asks it to route', async () => {
    const open = fakeWindow(`${ORIGIN}/dashboard`);
    const other = fakeWindow('https://other.test/');
    const w = loadWorker([other, open]);
    const close = vi.fn();
    await w.fire('notificationclick', {notification: {close, data: {navigate: '/nfe/detail?key=1'}}});
    expect(close).toHaveBeenCalled();
    expect(open.focus).toHaveBeenCalled();
    expect(open.postMessage).toHaveBeenCalledWith({type: 'ctech-push:navigate', url: '/nfe/detail?key=1'});
    expect(other.focus).not.toHaveBeenCalled();
    expect(w.self.clients.openWindow).not.toHaveBeenCalled();
  });

  it('click opens a new window when none is open, and never an off-origin or unsafe URL', async () => {
    const w = loadWorker();
    await w.fire('notificationclick', {notification: {close: vi.fn(), data: {navigate: '/guide'}}});
    expect(w.self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/guide`);
    for (const bad of ['//evil.test', 'https://evil.test', '/\\evil.test', 'javascript:alert(1)', '/a\nb', undefined]) {
      const x = loadWorker();
      await x.fire('notificationclick', {notification: {close: vi.fn(), data: {navigate: bad}}});
      expect(x.self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
    }
  });
});
