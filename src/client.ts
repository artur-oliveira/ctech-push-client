import {NAVIGATE_MESSAGE_TYPE, type PushCallbacks, type PushConfig, type PushStatus} from './types';
import {safePath} from './payload';

/** How often a subscribed device re-sends its subscription to the server (keeps `last_seen` and the TTL fresh). */
export const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STAMP_KEY = 'ctech-push:last-sync';

/** Browser surface the client needs; injected in tests, the globals in production. */
export interface PushEnv {
  navigator: Navigator
  Notification?: typeof Notification
  PushManager?: unknown
  matchMedia?: (query: string) => { matches: boolean }
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
  now?: () => number
}

function browserEnv(): PushEnv {
  let storage: PushEnv['storage'] = null;
  try {
    storage = globalThis.localStorage;
  } catch {
    storage = null; // blocked storage: the stamp is a per-device convenience only
  }
  return {
    navigator: globalThis.navigator,
    Notification: (globalThis as {Notification?: typeof Notification}).Notification,
    PushManager: (globalThis as {PushManager?: unknown}).PushManager,
    matchMedia: globalThis.matchMedia?.bind(globalThis),
    storage,
  };
}

export function isIOS(env: PushEnv = browserEnv()): boolean {
  const n = env.navigator;
  return /iPad|iPhone|iPod/.test(n.userAgent) || (n.platform === 'MacIntel' && n.maxTouchPoints > 1);
}

export function isStandalone(env: PushEnv = browserEnv()): boolean {
  return !!env.matchMedia?.('(display-mode: standalone)').matches || (env.navigator as {standalone?: boolean}).standalone === true;
}

/** Registers the cache-free worker at the origin root. Call once on app start (a client effect). */
export function registerServiceWorker(env: PushEnv = browserEnv()): Promise<ServiceWorkerRegistration | null> {
  if (!env.navigator.serviceWorker) return Promise.resolve(null);
  return env.navigator.serviceWorker.register('/sw.js', {scope: '/', updateViaCache: 'none'});
}

/** Calls `handler(path)` when the worker asks the page to route after a notification click. Returns the unsubscriber. */
export function onNavigateMessage(handler: (path: string) => void, env: PushEnv = browserEnv()): () => void {
  const sw = env.navigator.serviceWorker;
  if (!sw) return () => undefined;
  const listener = (e: MessageEvent) => {
    const d = e.data as {type?: unknown; url?: unknown} | null;
    if (d && d.type === NAVIGATE_MESSAGE_TYPE) handler(safePath(d.url));
  };
  sw.addEventListener('message', listener);
  return () => sw.removeEventListener('message', listener);
}

export function urlBase64ToBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function sameKey(buf: ArrayBuffer | null | undefined, b64: string): boolean {
  if (!buf) return false;
  const a = new Uint8Array(buf);
  const b = urlBase64ToBytes(b64);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export interface PushClient {
  /** Current status, from browser capability, permission and the existing subscription. Never prompts. */
  getStatus: () => Promise<PushStatus>
  /** Asks permission, subscribes and saves. Must be called inside a click handler (the permission prompt needs the gesture). */
  subscribe: () => Promise<PushStatus>
  /** Removes the server record (best effort) and the local subscription. Safe to call on logout. */
  unsubscribe: () => Promise<PushStatus>
  /**
   * On app load: re-subscribes when the VAPID key changed, and re-saves at most once every 24 h. Never prompts: it does
   * nothing unless permission was already granted.
   */
  syncOnLoad: () => Promise<PushStatus>
}

/** Framework-free core. The React hook is a thin wrapper over this. */
export function createPushClient(cb: PushCallbacks, env: PushEnv = browserEnv()): PushClient {
  const now = () => (env.now ? env.now() : Date.now());
  const storage = env.storage ?? null;
  const readStamp = (): {at: number; kid: string} | null => {
    try {
      const raw = storage?.getItem(STAMP_KEY);
      return raw ? (JSON.parse(raw) as {at: number; kid: string}) : null;
    } catch {
      return null;
    }
  };
  const writeStamp = (kid: string) => {
    try {
      storage?.setItem(STAMP_KEY, JSON.stringify({at: now(), kid}));
    } catch {
      /* per-device convenience only */
    }
  };
  const clearStamp = () => {
    try {
      storage?.removeItem(STAMP_KEY);
    } catch {
      /* ignore */
    }
  };

  const capability = (): PushStatus | null => {
    // iOS Safari outside the installed app has no PushManager at all: the useful answer is "install it", not "unsupported".
    if (isIOS(env) && !isStandalone(env)) return 'needs-install';
    if (!env.navigator.serviceWorker || !env.PushManager || !env.Notification) return 'unsupported';
    return null;
  };

  const registration = () => env.navigator.serviceWorker.ready;

  const persist = async (reg: ServiceWorkerRegistration, config: PushConfig): Promise<PushStatus> => {
    const sub = await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(config.publicKey) as BufferSource});
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      await sub.unsubscribe();
      throw new Error('incomplete push subscription');
    }
    try {
      await cb.save({
        endpoint: json.endpoint,
        keys: {p256dh: json.keys.p256dh, auth: json.keys.auth},
        vapid_kid: config.kid,
        expiration_time: json.expirationTime ?? null,
      });
    } catch (e) {
      await sub.unsubscribe(); // no orphan subscription the server does not know about
      throw e;
    }
    writeStamp(config.kid);
    return 'subscribed';
  };

  const getStatus = async (): Promise<PushStatus> => {
    const cap = capability();
    if (cap) return cap;
    const permission = env.Notification!.permission;
    if (permission === 'denied') return 'denied';
    if (permission !== 'granted') return 'default';
    const sub = await (await registration()).pushManager.getSubscription();
    return sub ? 'subscribed' : 'default';
  };

  const subscribe = async (): Promise<PushStatus> => {
    const cap = capability();
    if (cap) return cap;
    // First await on purpose: the prompt needs the user gesture, which a network call before it can consume (Safari).
    const permission = await env.Notification!.requestPermission();
    if (permission === 'denied') return 'denied';
    if (permission !== 'granted') return 'default';
    try {
      return await persist(await registration(), await cb.getConfig());
    } catch {
      return 'error';
    }
  };

  const unsubscribe = async (): Promise<PushStatus> => {
    const cap = capability();
    if (cap) return cap;
    clearStamp();
    const sub = await (await registration()).pushManager.getSubscription();
    if (sub) {
      // The server record goes first (it needs the token, which a logout still has); a failure is not fatal: the push
      // service answers 404/410 for a dead endpoint and the server then drops it.
      await cb.remove(sub.endpoint).catch(() => undefined);
      await sub.unsubscribe();
    }
    return getStatus();
  };

  const syncOnLoad = async (): Promise<PushStatus> => {
    const status = await getStatus();
    if (status !== 'subscribed') return status;
    try {
      const reg = await registration();
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return 'default';
      const config = await cb.getConfig();
      if (!sameKey(sub.options?.applicationServerKey, config.publicKey)) {
        await sub.unsubscribe(); // subscribed under an old key: the old one would be refused by the server
        return await persist(reg, config);
      }
      const stamp = readStamp();
      if (!stamp || stamp.kid !== config.kid || now() - stamp.at >= SYNC_INTERVAL_MS) return await persist(reg, config);
      return 'subscribed';
    } catch {
      return 'error';
    }
  };

  return {getStatus, subscribe, unsubscribe, syncOnLoad};
}
