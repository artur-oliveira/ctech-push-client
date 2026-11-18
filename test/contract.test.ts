import {describe, expect, it} from 'vitest';
import {isPayloadV1, safePath} from '../src/payload';
import {golden, loadWorker, ORIGIN} from './helpers';

// The golden file is the contract between the sender (go-common webpush, which ships a byte-identical copy) and the worker.
describe('payload contract v1', () => {
  it('the golden payload satisfies the TypeScript contract', () => {
    expect(isPayloadV1(golden)).toBe(true);
    expect(golden.notification.data.v).toBe(1);
    expect(JSON.stringify(golden).length).toBeLessThanOrEqual(1024); // product budget (spec section 6)
  });

  it('rejects a payload outside the contract', () => {
    for (const bad of [null, {}, {web_push: 1}, {web_push: 8030, notification: {}}, {web_push: 8030, notification: {title: 'x', data: {v: 2}}}, {web_push: 8030, notification: {title: 'x', navigate: '//evil.test', data: {v: 1}}}]) {
      expect(isPayloadV1(bad)).toBe(false);
    }
  });

  it('safePath (page) and the worker agree on every navigate target', async () => {
    const cases = ['/', '/a/b?x=1#h', '//evil.test', '/\\evil.test', 'https://evil.test', 'javascript:alert(1)', '', '/a\u0000b', '/a b', `/${'x'.repeat(600)}`, 'relative', undefined, 42];
    for (const c of cases) {
      const w = loadWorker();
      await w.pushJSON({web_push: 8030, notification: {title: 't', navigate: c, data: {v: 1}}});
      expect((w.shown[0].options.data as {navigate: string}).navigate, String(c)).toBe(safePath(c, ORIGIN));
    }
  });
});
