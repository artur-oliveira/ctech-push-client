/** Payload contract version. A contract change is a major release and a new `data.v`. */
export const PUSH_PAYLOAD_VERSION = 1;

/** `postMessage` type the service worker sends to a focused window when a notification is clicked. */
export const NAVIGATE_MESSAGE_TYPE = 'ctech-push:navigate';

/** Server side VAPID config: the public key (base64url, uncompressed P-256 point) and its key id. */
export interface PushConfig {
  publicKey: string
  kid: string
}

/** What the app persists for a device. `keys` come from `PushSubscription.toJSON()`. */
export interface PushSubscriptionRecord {
  endpoint: string
  keys: { p256dh: string; auth: string }
  vapid_kid: string
  /** Epoch ms, null when the push service gave none. */
  expiration_time: number | null
}

export type PushStatus = 'unsupported' | 'needs-install' | 'default' | 'denied' | 'subscribed' | 'error'

/** Declarative Web Push notification body (WebKit format, v1). */
export interface PushNotificationV1 {
  title: string
  body?: string
  navigate?: string
  tag?: string
  lang?: string
  silent?: boolean
  data?: { v: number; id?: string; type?: string }
}

export interface PushPayloadV1 {
  web_push: 8030
  notification: PushNotificationV1
}

export interface PushCallbacks {
  /** VAPID config for this service and environment. */
  getConfig: () => Promise<PushConfig>
  /** Create or refresh this device's subscription on the server (idempotent upsert). */
  save: (record: PushSubscriptionRecord) => Promise<void>
  /** Remove this device's subscription on the server. */
  remove: (endpoint: string) => Promise<void>
}
