export interface ReaderPushSubscription { endpoint: string; keys: { p256dh: string; auth: string } }
export function allowedPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname;
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash
      && (host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com"
        || host === "push.services.mozilla.com" || host === "web.push.apple.com"
        || host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com"));
  } catch { return false; }
}
export function parsePushSubscription(value: unknown): ReaderPushSubscription | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (typeof input.endpoint !== "string" || input.endpoint.length > 2048 || !allowedPushEndpoint(input.endpoint)) return null;
  if (!input.keys || typeof input.keys !== "object") return null;
  const keys = input.keys as Record<string, unknown>;
  if (typeof keys.p256dh !== "string" || typeof keys.auth !== "string") return null;
  const valid = (s: string, bytes: number) => {
    if (!/^[A-Za-z0-9_-]+={0,2}$/u.test(s)) return false;
    try { return atob(s.replace(/-/g, "+").replace(/_/g, "/")).length === bytes; } catch { return false; }
  };
  if (!valid(keys.p256dh, 65) || !valid(keys.auth, 16)) return null;
  if (atob(keys.p256dh.replace(/-/g, "+").replace(/_/g, "/")).charCodeAt(0) !== 4) return null;
  return { endpoint: input.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}
export async function pushSubscriptionId(origin: string, endpoint: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${origin}\n${endpoint}`));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}
