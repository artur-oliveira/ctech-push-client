import {createElement} from 'react';
import {act, create} from 'react-test-renderer';
import {describe, expect, it, vi} from 'vitest';
import {usePushSubscription, type UsePushSubscriptionResult} from '../src/usePushSubscription';
import type {PushEnv} from '../src/client';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';

function env(permission: NotificationPermission): PushEnv {
  const sub = {endpoint: 'https://push.test/1', toJSON: () => ({endpoint: 'https://push.test/1', keys: {p256dh: 'p', auth: 'a'}}), unsubscribe: vi.fn(() => Promise.resolve(true))};
  const pushManager = {getSubscription: vi.fn(() => Promise.resolve(null)), subscribe: vi.fn(() => Promise.resolve(sub))};
  return {
    navigator: {userAgent: 'Chrome', platform: 'Linux', maxTouchPoints: 0, serviceWorker: {ready: Promise.resolve({pushManager})}},
    Notification: {permission, requestPermission: vi.fn(() => Promise.resolve('granted'))},
    PushManager: {},
    matchMedia: () => ({matches: false}),
    storage: null,
  } as unknown as PushEnv;
}

function render(e: PushEnv, enabled = true) {
  const out: {current: UsePushSubscriptionResult | null} = {current: null};
  const cb = {getConfig: vi.fn(() => Promise.resolve({publicKey: KEY, kid: 'k1'})), save: vi.fn(() => Promise.resolve()), remove: vi.fn(() => Promise.resolve())};
  const Probe = () => {
    out.current = usePushSubscription({...cb, enabled, env: e});
    return null;
  };
  return {out, cb, mount: () => act(async () => void create(createElement(Probe)))};
}

describe('usePushSubscription', () => {
  it('starts as loading and settles on the synced status', async () => {
    const r = render(env('default'));
    await r.mount();
    expect(r.out.current?.status).toBe('default');
  });

  it('stays loading and does not touch the browser while disabled (no session yet)', async () => {
    const e = env('granted');
    const r = render(e, false);
    await r.mount();
    expect(r.out.current?.status).toBe('loading');
  });

  it('subscribe updates the status and saves once', async () => {
    const r = render(env('default'));
    await r.mount();
    await act(async () => r.out.current!.subscribe());
    expect(r.out.current?.status).toBe('subscribed');
    expect(r.cb.save).toHaveBeenCalledTimes(1);
  });

  it('reports unsupported where push does not exist', async () => {
    const e = env('default');
    (e as {PushManager?: unknown}).PushManager = undefined;
    const r = render(e);
    await r.mount();
    expect(r.out.current?.status).toBe('unsupported');
  });
});
