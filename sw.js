var CACHE_NAME = "soaz-inspeccion-v11";
var ASSETS = ["./", "./index.html", "./manifest.json"];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// Estrategia NETWORK-FIRST: siempre intenta traer la última versión de la red
// y solo usa la caché cuando no hay conexión. Así la app se actualiza sola.
self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    fetch(event.request).then(function (response) {
      if (response && response.status === 200 && response.type === "basic") {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(event.request, copy);
        });
      }
      return response;
    }).catch(function () {
      return caches.match(event.request).then(function (cached) {
        if (cached) {
          return cached;
        }
        if (event.request.mode === "navigate") {
          return caches.match("./index.html");
        }
        return new Response("Sin conexión", { status: 503 });
      });
    })
  );
});
