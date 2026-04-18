(function () {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  let didReloadForControllerChange = false;

  function requestSkipWaiting(worker) {
    if (!worker) return;
    try {
      worker.postMessage({ type: "skipWaiting" });
    } catch (error) {
      console.error("Failed to request service worker skipWaiting", error);
    }
  }

  function trackInstallingWorker(worker) {
    if (!worker) return;

    worker.addEventListener("statechange", function () {
      if (worker.state !== "installed") return;
      if (!navigator.serviceWorker.controller) return;
      requestSkipWaiting(worker);
    });
  }

  window.addEventListener("load", function () {
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (didReloadForControllerChange) return;
      didReloadForControllerChange = true;
      window.location.reload();
    });

    navigator.serviceWorker
      .register("/sw.js")
      .then(function (registration) {
        registration.update().catch(function (error) {
          console.error("Failed to update service worker registration", error);
        });

        if (registration.waiting && navigator.serviceWorker.controller) {
          requestSkipWaiting(registration.waiting);
        }

        if (registration.installing) {
          trackInstallingWorker(registration.installing);
        }

        registration.addEventListener("updatefound", function () {
          trackInstallingWorker(registration.installing);
        });
      })
      .catch(function (error) {
        console.error("Failed to register service worker", error);
      });
  });
})();
