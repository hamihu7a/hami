const CACHE = 'hami-cache-v1';
const NAV_KEY = 'hami-nav';

self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  // 打开页面：网络优先，成功则更新缓存；失败才回缓存（离线可开）
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req, { cache: 'no-store' }).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(NAV_KEY, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(NAV_KEY).then(function (r) { return r || fetch(req); });
      })
    );
    return;
  }

  // 同源静态资源：缓存优先，后台静默更新
  e.respondWith(
    caches.match(req).then(function (r) {
      var net = fetch(req, { cache: 'no-store' }).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return r; });
      return r || net;
    })
  );
});
