import {describe, expect, it, vi} from 'vitest';
import {createPushClient, isIOS, isStandalone, onNavigateMessage, registerServiceWorker, SYNC_INTERVAL_MS, urlBase64ToBytes, type PushEnv} from '../src/client';
import type {PushConfig} from '../src/types';

// P-256 uncompressed point shape: 65 bytes, base64url without padding.
const KEY_A = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
const KEY_B = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const cfg = (publicKey = KEY_A, kid = 'k1'): PushConfig => ({publicKey, kid});

function fakeSub(endpoint: string, key: string) {
  return {
    endpoint,
    options: {applicationServerKey: urlBase64ToBytes(key).buffer},
    toJSON: () => ({endpoint, keys: {p256dh: 'p', auth: 'a'}, expirationTime: null}),
    unsubscribe: vi.fn(() => Promise.resolve(true)),
  };
}

interface Opts {
  permission?: NotificationPermission
  requested?: NotificationPermission
  existing?: ReturnType<typeof fakeSub> | null
  ua?: string
  standalone?: boolean
  noPushManager?: boolean
  storage?: Record<string, string>
  now?: number
}

function setup(o: Opts = {}) {
  const state = {existing: o.existing ?? null};
  const subscribed: ReturnType<typeof fakeSub>[] = [];
  const pushManager = {
    getSubscription: vi.fn(() => Promise.resolve(state.existing)),
    subscribe: vi.fn(({applicationServerKey}: {applicationServerKey: BufferSource}) => {
      const key = [...new Uint8Array(applicationServerKey as ArrayBuffer)];
      const b64 = key.length === 65 && Buffer.from(key).equals(Buffer.from(urlBase64ToBytes(KEY_B))) ? KEY_B : KEY_A;
      const s = fakeSub(`https://push.test/${subscribed.length + 1}`, b64);
      subscribed.push(s);
      state.existing = s;
      return Promise.resolve(s);
    }),
  };
  const listeners: ((e: unknown) => void)[] = [];
  const store: Record<string, string> = o.storage ?? {};
  const Notification = {permission: o.permission ?? 'default', requestPermission: vi.fn(() => Promise.resolve(o.requested ?? 'granted'))};
  const env = {
    navigator: {
      userAgent: o.ua ?? 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130',
      platform: 'Linux',
      maxTouchPoints: 0,
      serviceWorker: {
        ready: Promise.resolve({pushManager}),
        register: vi.fn(() => Promise.resolve({})),
        addEventListener: (_: string, fn: (e: unknown) => void) => listeners.push(fn),
        removeEventListener: (_: string, fn: (e: unknown) => void) => listeners.splice(listeners.indexOf(fn), 1),
      },
    },
    Notification,
    PushManager: o.noPushManager ? undefined : {},
    matchMedia: () => ({matches: o.standalone ?? false}),
    storage: {getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v), removeItem: (k: string) => void delete store[k]},
    now: () => o.now ?? 1_000_000,
  } as unknown as PushEnv;
  const cb = {getConfig: vi.fn(() => Promise.resolve(cfg())), save: vi.fn(() => Promise.resolve()), remove: vi.fn(() => Promise.resolve())};
  return {env, cb, pushManager, Notification, subscribed, store, listeners, client: createPushClient(cb, env)};
}

describe('getStatus', () => {
  it('reports unsupported without PushManager, and needs-install on iOS outside the installed app', async () => {
    expect(await setup({noPushManager: true}).client.getStatus()).toBe('unsupported');
    const ios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari';
    expect(await setup({ua: ios, noPushManager: true}).client.getStatus()).toBe('needs-install');
    expect(await setup({ua: ios, standalone: true}).client.getStatus()).toBe('default');
  });

  it('maps permission and existing subscription, and never prompts', async () => {
    expect(await setup({permission: 'denied'}).client.getStatus()).toBe('denied');
    const s = setup({permission: 'default'});
    expect(await s.client.getStatus()).toBe('default');
    expect(s.Notification.requestPermission).not.toHaveBeenCalled();
    expect(await setup({permission: 'granted'}).client.getStatus()).toBe('default');
    expect(await setup({permission: 'granted', existing: fakeSub('https://push.test/x', KEY_A)}).client.getStatus()).toBe('subscribed');
  });

  it('detects iOS and standalone', () => {
    expect(isIOS(setup({ua: 'iPad'}).env)).toBe(true);
    expect(isIOS(setup().env)).toBe(false);
    expect(isStandalone(setup({standalone: true}).env)).toBe(true);
  });
});

describe('subscribe', () => {
  it('asks permission before anything else, then subscribes and saves with the key id', async () => {
    const s = setup();
    const order: string[] = [];
    s.Notification.requestPermission.mockImplementation(() => { order.push('permission'); return Promise.resolve('granted'); });
    s.cb.getConfig.mockImplementation(() => { order.push('config'); return Promise.resolve(cfg()); });
    expect(await s.client.subscribe()).toBe('subscribed');
    expect(order).toEqual(['permission', 'config']);
    expect(s.pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({userVisibleOnly: true}));
    expect(s.cb.save).toHaveBeenCalledWith({endpoint: 'https://push.test/1', keys: {p256dh: 'p', auth: 'a'}, vapid_kid: 'k1', expiration_time: null});
  });

  it('does nothing more when the user denies or dismisses the prompt', async () => {
    const denied = setup({requested: 'denied'});
    expect(await denied.client.subscribe()).toBe('denied');
    expect(denied.cb.getConfig).not.toHaveBeenCalled();
    expect(await setup({requested: 'default'}).client.subscribe()).toBe('default');
  });

  it('drops the browser subscription when the server save fails (no orphan) and reports error', async () => {
    const s = setup();
    s.cb.save.mockRejectedValue(new Error('500'));
    expect(await s.client.subscribe()).toBe('error');
    expect(s.subscribed[0].unsubscribe).toHaveBeenCalled();
  });

  it('is a no-op where push is unsupported', async () => {
    const s = setup({noPushManager: true});
    expect(await s.client.subscribe()).toBe('unsupported');
    expect(s.Notification.requestPermission).not.toHaveBeenCalled();
  });
});

describe('unsubscribe', () => {
  it('removes the server record then the local subscription, and clears the stamp', async () => {
    const sub = fakeSub('https://push.test/9', KEY_A);
    const s = setup({permission: 'granted', existing: sub, storage: {'ctech-push:last-sync': '{"at":1,"kid":"k1"}'}});
    s.pushManager.getSubscription.mockImplementationOnce(() => Promise.resolve(sub)).mockImplementation(() => Promise.resolve(null));
    expect(await s.client.unsubscribe()).toBe('default');
    expect(s.cb.remove).toHaveBeenCalledWith('https://push.test/9');
    expect(sub.unsubscribe).toHaveBeenCalled();
    expect(s.store['ctech-push:last-sync']).toBeUndefined();
  });

  it('still unsubscribes locally when the server removal fails (logout must not hang)', async () => {
    const sub = fakeSub('https://push.test/9', KEY_A);
    const s = setup({permission: 'granted', existing: sub});
    s.cb.remove.mockRejectedValue(new Error('offline'));
    await s.client.unsubscribe();
    expect(sub.unsubscribe).toHaveBeenCalled();
  });
});

describe('syncOnLoad', () => {
  it('never prompts and does nothing without granted permission or a subscription', async () => {
    const s = setup({permission: 'default'});
    expect(await s.client.syncOnLoad()).toBe('default');
    expect(s.Notification.requestPermission).not.toHaveBeenCalled();
    expect(s.cb.save).not.toHaveBeenCalled();
    expect(await setup({permission: 'granted'}).client.syncOnLoad()).toBe('default');
  });

  it('re-subscribes when the VAPID key changed', async () => {
    const old = fakeSub('https://push.test/old', KEY_B);
    const s = setup({permission: 'granted', existing: old});
    expect(await s.client.syncOnLoad()).toBe('subscribed');
    expect(old.unsubscribe).toHaveBeenCalled();
    expect(s.cb.save).toHaveBeenCalledWith(expect.objectContaining({vapid_kid: 'k1'}));
  });

  it('saves at most once every 24 h', async () => {
    const sub = fakeSub('https://push.test/1', KEY_A);
    const fresh = setup({permission: 'granted', existing: sub, now: 1000 + SYNC_INTERVAL_MS - 1, storage: {'ctech-push:last-sync': '{"at":1000,"kid":"k1"}'}});
    expect(await fresh.client.syncOnLoad()).toBe('subscribed');
    expect(fresh.cb.save).not.toHaveBeenCalled();
    const stale = setup({permission: 'granted', existing: sub, now: 1000 + SYNC_INTERVAL_MS, storage: {'ctech-push:last-sync': '{"at":1000,"kid":"k1"}'}});
    await stale.client.syncOnLoad();
    expect(stale.cb.save).toHaveBeenCalledTimes(1);
  });

  it('saves again when the key id changed or there is no stamp', async () => {
    const sub = fakeSub('https://push.test/1', KEY_A);
    const noStamp = setup({permission: 'granted', existing: sub});
    await noStamp.client.syncOnLoad();
    expect(noStamp.cb.save).toHaveBeenCalledTimes(1);
    const kid = setup({permission: 'granted', existing: sub, storage: {'ctech-push:last-sync': '{"at":999999,"kid":"old"}'}});
    await kid.client.syncOnLoad();
    expect(kid.cb.save).toHaveBeenCalledTimes(1);
  });

  it('reports error instead of throwing when the config call fails', async () => {
    const s = setup({permission: 'granted', existing: fakeSub('https://push.test/1', KEY_A)});
    s.cb.getConfig.mockRejectedValue(new Error('down'));
    expect(await s.client.syncOnLoad()).toBe('error');
  });
});

describe('service worker helpers', () => {
  it('registers /sw.js at the root with updateViaCache none', async () => {
    const s = setup();
    await registerServiceWorker(s.env);
    expect(s.env.navigator.serviceWorker.register).toHaveBeenCalledWith('/sw.js', {scope: '/', updateViaCache: 'none'});
  });

  it('routes the worker navigate message and ignores anything else or unsafe', () => {
    const s = setup();
    const seen: string[] = [];
    const stop = onNavigateMessage((p) => seen.push(p), s.env);
    const send = (data: unknown) => s.listeners.forEach((l) => l({data}));
    send({type: 'ctech-push:navigate', url: '/nfe/detail?key=1'});
    send({type: 'ctech-push:navigate', url: '//evil.test'});
    send({type: 'other', url: '/x'});
    expect(seen).toEqual(['/nfe/detail?key=1', '/']);
    stop();
    expect(s.listeners).toHaveLength(0);
  });

  it('decodes base64url keys', () => {
    expect(urlBase64ToBytes(KEY_A)).toHaveLength(65);
  });
});
