import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createPushClient, type PushEnv} from './client';
import type {PushCallbacks, PushStatus} from './types';

export interface UsePushSubscriptionOptions extends PushCallbacks {
  /** Turn the load-time sync on once the app has a session. Default true. */
  enabled?: boolean
  /** Test seam; defaults to the browser globals. */
  env?: PushEnv
}

export interface UsePushSubscriptionResult {
  status: PushStatus | 'loading'
  /** Call inside a click handler. */
  subscribe: () => Promise<void>
  unsubscribe: () => Promise<void>
}

/** Subscription state and actions for one device. The status starts as `loading` until the first read. */
export function usePushSubscription(options: UsePushSubscriptionOptions): UsePushSubscriptionResult {
  const {enabled = true, env} = options;
  const [status, setStatus] = useState<PushStatus | 'loading'>('loading');
  // Callbacks change identity every render in most apps; the client must not be rebuilt for that.
  const cbRef = useRef<PushCallbacks>(options);
  cbRef.current = options;
  const client = useMemo(
    () =>
      createPushClient(
        {
          getConfig: () => cbRef.current.getConfig(),
          save: (r) => cbRef.current.save(r),
          remove: (e) => cbRef.current.remove(e),
        },
        env,
      ),
    [env],
  );

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    client
      .syncOnLoad()
      .then((s) => live && setStatus(s))
      .catch(() => live && setStatus('error'));
    return () => {
      live = false;
    };
  }, [client, enabled]);

  const subscribe = useCallback(async () => setStatus(await client.subscribe()), [client]);
  const unsubscribe = useCallback(async () => setStatus(await client.unsubscribe()), [client]);
  return {status, subscribe, unsubscribe};
}
