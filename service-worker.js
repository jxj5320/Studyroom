/*
 * 공부방_율 — 오프라인에서도 화면이 바로 뜨도록 하는 최소한의 서비스워커.
 * 같은 사이트(origin) 안의 정적 파일만 캐시하고, Anthropic API 호출처럼
 * 다른 origin으로 나가는 요청은 절대 건드리지 않는다(캐시도, 가로채기도 안 함).
 */
var CACHE_NAME = "sb-cache-v2";
var APP_SHELL = [
  "./",
  "./index.html",
  "./social.html",
  "./sb-shared.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(APP_SHELL); })
      .catch(function () {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) { return n !== CACHE_NAME; }).map(function (n) { return caches.delete(n); }));
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return; // POST(API 호출 등)는 건드리지 않음
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 다른 origin(Anthropic API 등)은 절대 가로채지 않음

  event.respondWith(
    fetch(req)
      .then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); }).catch(function () {});
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (cached) { return cached || caches.match("./index.html"); });
      })
  );
});
