# AGENTS.md - ctech-push-client (npm `@aoctech/push-client`)

## CTech Standards (mandatory)

Before writing, changing or reviewing any code or infra here, load the `ctech-dev-standards` skill (plugin
`ctech-skills`, repo github.com/artur-oliveira/ctech-skills). It is the single source of truth for backend,
frontend and infra. If anything in this file contradicts it, the skill wins and this file must be fixed.

**Reuse me, don't fork.** This is the one Web Push client for CTech SPAs: cache-free service worker, subscription
client and React hook. The sender is go-common `webpush`; the app owns its routes and storage. A product needing push
imports this package; it does not write its own worker or subscription code.

## Public API (`src/`)

- `usePushSubscription(options)` (`usePushSubscription.ts`): `{status, subscribe, unsubscribe}`; `options`: `getConfig`, `save`, `remove`, `enabled?`.
- `createPushClient(callbacks, env?)` (`client.ts`): `getStatus`, `subscribe`, `unsubscribe`, `syncOnLoad`.
- `registerServiceWorker()`, `onNavigateMessage(handler)`, `isIOS()`, `isStandalone()`, `urlBase64ToBytes()`, `SYNC_INTERVAL_MS`.
- `safePath()`, `isPayloadV1()`, types and `PUSH_PAYLOAD_VERSION`, `NAVIGATE_MESSAGE_TYPE` (`payload.ts`, `types.ts`).
- `dist/sw.js` (from `src/sw.js`, version stamped by `scripts/build-sw.mjs`), exported as `@aoctech/push-client/sw.js`.

## Rules

- `sw.js` never gets a `fetch` handler or Cache Storage; it is a classic script (no modules).
- `safePath` in `src/payload.ts` and in `src/sw.js` must stay in step; `test/contract.test.ts` enforces it.
- A payload contract change is a major release; keep `testdata/notification-v1.json` byte-identical with go-common.
- No visible em dash in text; no Claude attribution in commits.

## Mandatory Documentation Policy

**Every code change MUST be documented.** README for behavior, this file for API and rules.
