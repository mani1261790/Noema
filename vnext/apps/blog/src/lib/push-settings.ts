import { createUpdatesActionTracker } from "./updates-analytics";
export async function initializePushSettings(): Promise<void> {
  const root = document.querySelector<HTMLElement>("[data-push-settings]"); if (!root) return;
  const status = root.querySelector<HTMLElement>("[data-push-status]")!;
  const help = root.querySelector<HTMLElement>("[data-push-help]")!;
  const enable = root.querySelector<HTMLButtonElement>("[data-enable-push]")!;
  const disable = root.querySelector<HTMLButtonElement>("[data-disable-push]")!;
  const track = createUpdatesActionTracker(new URL(location.href));
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & {standalone?: boolean}).standalone;
  if (ios && !standalone) { status.textContent = "ホーム画面のNoemaから通知を登録できます。"; help.textContent = "下の手順でホーム画面に追加し、アイコンから開き直してください。"; return; }
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    status.textContent = "このブラウザはプッシュ通知に対応していません。"; return;
  }
  let registration: ServiceWorkerRegistration;
  let publicKey: string;
  let subscription: PushSubscription | null = null;
  let registered = false;
  const request = async (method: string, data: unknown) => {
    const response = await fetch("/api/push/subscription", {method, headers: {"Content-Type":"application/json"}, body: JSON.stringify(data), signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error("通知設定を保存できませんでした。時間をおいてもう一度お試しください。");
    return response.json() as Promise<{active?: boolean}>;
  };
  function render() {
    enable.hidden = registered || Notification.permission === "denied";
    disable.hidden = !subscription;
    status.textContent = registered && Notification.permission === "granted" ? "この端末で新着記事の通知を受け取っています。" : "この端末の通知はオフです。";
    help.textContent = Notification.permission === "denied" ? "通知がブロックされています。端末やブラウザのサイト設定から通知を許可してください。" : "";
  }
  try {
    const response = await fetch("/api/push/subscription", {signal: AbortSignal.timeout(10000)});
    const config = await response.json() as {enabled: boolean; publicKey: string};
    if (!response.ok || !config.enabled || !config.publicKey) throw new Error("通知は現在準備中です。時間をおいてもう一度お試しください。");
    publicKey = config.publicKey;
    await navigator.serviceWorker.register("/sw.js", {scope:"/", updateViaCache:"none"});
    registration = await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("ページを開き直して、もう一度お試しください。")), 10000))]);
    subscription = await registration.pushManager.getSubscription();
    if (subscription) registered = Boolean((await request("POST", {...subscription.toJSON(), action:"status"})).active);
    render();
  } catch (error) { status.textContent = error instanceof Error ? error.message : "通知設定を確認できませんでした。"; return; }
  enable.addEventListener("click", async () => {
    enable.disabled = true; disable.disabled = true;
    try {
      // Permission must be requested directly inside the reader's button gesture.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { render(); return; }
      // Activate the push-capable update even if another tab keeps the old worker alive.
      const updating = registration.installing ?? registration.waiting;
      if (updating && updating.state !== "activated") {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => { updating.removeEventListener("statechange", changed); reject(new Error("ページを開き直して通知を登録してください。")); }, 15000);
          const changed = () => {
            if (updating.state === "installed") updating.postMessage({type:"ACTIVATE_PUSH"});
            if (updating.state === "activated") { clearTimeout(timeout); updating.removeEventListener("statechange", changed); resolve(); }
          };
          updating.addEventListener("statechange", changed); changed();
        });
      }
      const bytes = Uint8Array.from(atob(publicKey.replace(/-/g,"+").replace(/_/g,"/")), c => c.charCodeAt(0));
      subscription ??= await registration.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:bytes });
      await request("POST", subscription.toJSON());
      registered = true; render(); void track?.();
    } catch (error) {
      render();
      status.textContent = error instanceof Error ? error.message : "通知を登録できませんでした。もう一度お試しください。";
    } finally { enable.disabled = false; disable.disabled = false; }
  });
  disable.addEventListener("click", async () => {
    if (!subscription) return;
    enable.disabled = true; disable.disabled = true;
    try {
      await request("DELETE", subscription.toJSON());
      registered = false;
      await subscription.unsubscribe(); subscription = null;
      render(); status.textContent = "この端末の通知を解除しました。";
    } catch (error) { render(); status.textContent = error instanceof Error ? error.message : "解除できませんでした。もう一度お試しください。"; }
    finally { enable.disabled = false; disable.disabled = false; }
  });
}
