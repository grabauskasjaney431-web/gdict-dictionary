/* G词典 Service Worker
   缓存策略（v13 起）：
   - 内容文件（index.html / data.js）：network-first —— 在线总是取最新，离线回落缓存。
     这样能穿透 CDN / HTTP 缓存，避免「词库更新了但页面还是旧数据」。
   - 静态资源（icons / manifest）：cache-first —— 快，且极少变动。
   更新机制：install 阶段自动 skipWaiting()，新版本装好立即激活，
   配合页面端 controllerchange 自动刷新，用户无需手动点「立即刷新」。
   （旧版死锁原因：waiting 的 SW 只能由 reg.waiting.postMessage 唤醒，
     而旧页面按钮把指令错误地发给了 controller，导致永远卡在 waiting。） */
const CACHE = "gd-v13";

const ASSETS = [
  "./",
  "./index.html",
  "./data.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())   // 关键：装好即激活，解开 waiting 死锁
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", e => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // 内容型资源（首页 / 页面 / 数据）需要「网络优先」，才能保证内容更新可见
  const p = url.pathname;
  const needsFresh = p.endsWith("/") || p.endsWith("/index.html") || p.endsWith("/data.js");

  if (needsFresh) {
    // network-first：在线取最新；离线或失败时回落缓存（忽略 ?v= 版本参数）
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          return res;
        }
        return caches.match(req, { ignoreSearch: true }).then(c => c || res);
      }).catch(() =>
        caches.match(req, { ignoreSearch: true })
          .then(c => c || caches.match("./index.html"))
      )
    );
    return;
  }

  // cache-first：静态资源
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match("./index.html"));
    })
  );
});
