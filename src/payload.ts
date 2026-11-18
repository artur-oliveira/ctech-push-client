import {PUSH_PAYLOAD_VERSION, type PushPayloadV1} from './types';

const DEFAULT_PATH = '/';
const MAX_PATH = 512;
const MAX_TITLE = 120;
const MAX_BODY = 240;

/**
 * Only a path of this origin: starts with a single "/", no backslash or control character, resolves to the same origin.
 * Anything else becomes "/". Mirrors `safePath` in sw.js; test/contract.test.ts keeps the two in step.
 */
export function safePath(value: unknown, origin: string = globalThis.location?.origin ?? 'http://localhost'): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH) return DEFAULT_PATH;
  if (value[0] !== '/' || value[1] === '/' || value[1] === '\\') return DEFAULT_PATH;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return DEFAULT_PATH;
  try {
    return new URL(value, origin).origin === origin ? value : DEFAULT_PATH;
  } catch {
    return DEFAULT_PATH;
  }
}

/** True for a v1 payload the service worker will show as sent (used by producers' tests and the golden file). */
export function isPayloadV1(value: unknown): value is PushPayloadV1 {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<PushPayloadV1>;
  const n = p.notification;
  if (p.web_push !== 8030 || !n || typeof n !== 'object') return false;
  if (typeof n.title !== 'string' || n.title.length === 0 || n.title.length > MAX_TITLE) return false;
  if (n.body !== undefined && (typeof n.body !== 'string' || n.body.length > MAX_BODY)) return false;
  if (n.navigate !== undefined && safePath(n.navigate) !== n.navigate) return false;
  return n.data?.v === PUSH_PAYLOAD_VERSION;
}
