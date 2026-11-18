# @aoctech/push-client

Web Push for CTech apps: a service worker with no cache, the subscription client, and a React hook. The sender side is
`gopkg.aoctech.app/api-commons/webpush` (go-common). Design: `ctech-dfe/docs/specs/2026-11-17-web-push.md`.

Peer dependency: `react >= 18`. Node >= 24 to build and test.

## Install the worker

The worker must be served from the app origin root. Copy it at build time (it is a plain script, no build step):

```json
{"scripts": {"prebuild": "cp node_modules/@aoctech/push-client/dist/sw.js public/sw.js"}}
```

Add a test in the app that compares `public/sw.js` with `node_modules/@aoctech/push-client/dist/sw.js` byte for byte, so
the copy never drifts. The worker has **no `fetch` handler and no Cache Storage**: a deploy never meets a stale bundle.

```ts
import {registerServiceWorker} from '@aoctech/push-client';
useEffect(() => { void registerServiceWorker(); }, []); // scope "/", updateViaCache "none"
```

## Subscribe

```tsx
const push = usePushSubscription({
  enabled: !!session,                               // after login
  getConfig: () => api.get('/push/config'),         // {publicKey, kid}
  save: (record) => api.put('/push/subscriptions', record),
  remove: (endpoint) => api.delete('/push/subscriptions', {endpoint}),
});
// push.status: 'loading' | 'unsupported' | 'needs-install' | 'default' | 'denied' | 'subscribed' | 'error'
<button onClick={() => void push.subscribe()}>Ativar notificações</button> // the click is the user gesture
```

- `subscribe()` asks permission first and only then loads the config, because the prompt needs the click gesture.
- On app load the hook never prompts: it re-subscribes when the server VAPID key changed and re-saves at most once every
  24 h per device (stamp in `localStorage`, a per-device convenience).
- Call `unsubscribe()` on logout: it removes the server record (best effort) and the browser subscription.
- iOS only supports push for an installed PWA (16.4+): outside it the status is `needs-install`.
- Route notification clicks with `onNavigateMessage((path) => router.push(path))`; the path is always same-origin.

Framework-free core: `createPushClient({getConfig, save, remove})` with `getStatus`, `subscribe`, `unsubscribe`,
`syncOnLoad`.

## Payload contract (v1)

Declarative Web Push shape. The worker reads the same fields in every browser; `data.v` versions the contract.

```json
{"web_push": 8030, "notification": {"title": "...", "body": "...", "navigate": "/path", "tag": "...", "lang": "pt-BR",
 "silent": false, "data": {"v": 1, "id": "...", "type": "..."}}}
```

- `navigate` is a same-origin path (`/x`, never `//x`); anything else becomes `/`.
- Title is cut at 120 characters, body at 240, tag at 64; an unreadable payload becomes "Nova atualização no CTech".
- A notification is always shown (Chrome requires it; Safari revokes the subscription after silent pushes). It is shown
  silently when an app window is focused, because the WebSocket toast already told the user.
- `testdata/notification-v1.json` is the golden file. go-common `webpush/testdata/notification-v1.json` must stay
  byte-identical; the contract test here and the one there both read it.

## Versioning and release

`dist/sw.js` carries `SW_VERSION` stamped from `package.json`; any byte change makes the browser update the worker.
A payload contract change is a major release with a new `data.v`, and the worker keeps accepting the old `v` for one version.
Publish with a GitHub Release (npm trusted publishing, same workflow as `ctech-ws-client`).

```
npm test   # lint (tsc strict, node --check) + build + vitest
```

MIT.
