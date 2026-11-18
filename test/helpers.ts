import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {vi} from 'vitest';

export const ORIGIN = 'https://dfe.test';
export const golden = JSON.parse(readFileSync(new URL('../testdata/notification-v1.json', import.meta.url), 'utf8'));

interface FakeWindow {
  url: string
  focused?: boolean
  focus: ReturnType<typeof vi.fn>
  postMessage: ReturnType<typeof vi.fn>
}

export function fakeWindow(url: string, focused = false): FakeWindow {
  return {url, focused, focus: vi.fn(() => Promise.resolve()), postMessage: vi.fn()};
}

/** Runs dist/sw.js in a sandbox whose `self` is a recording fake, and returns it with an event dispatcher. */
export function loadWorker(windows: FakeWindow[] = []) {
  const code = readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
  const handlers: Record<string, (e: unknown) => void> = {};
  const shown: {title: string; options: Record<string, unknown>}[] = [];
  const self = {
    location: {origin: ORIGIN},
    skipWaiting: vi.fn(),
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      handlers[type] = fn;
    },
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => {
        shown.push({title, options});
        return Promise.resolve();
      },
    },
    clients: {
      claim: vi.fn(() => Promise.resolve()),
      matchAll: vi.fn(() => Promise.resolve(windows)),
      openWindow: vi.fn(() => Promise.resolve(null)),
    },
  };
  vm.runInNewContext(code, {self, URL});
  const fire = async (type: string, extra: Record<string, unknown> = {}) => {
    const pending: Promise<unknown>[] = [];
    handlers[type]({...extra, waitUntil: (p: Promise<unknown>) => pending.push(p)});
    await Promise.all(pending);
  };
  const pushJSON = (value: unknown) => fire('push', {data: {json: () => value}});
  return {self, shown, fire, pushJSON, handlers};
}
