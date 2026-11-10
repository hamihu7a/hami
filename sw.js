/* Hami 工作台 Service Worker（v472）
   v415 起文档走「网络优先 + 超时回退缓存」，避免 CDN 旧副本滞留，主人不再反复刷到旧版。
   v472 治「打开越来越慢」：单文件已 2.1MB / gzip 617KB，每次打开都绕开缓存回源下载太重。
   - 距上次成功回源 < 3 分钟：普通打开直接吐缓存，不再发起整页回源（真·秒开）；
   - 超过 3 分钟：网络优先，900ms 没回来就先给缓存，后台下载完静默写缓存；
   - 强刷（Ctrl+F5 / 带 _v= / reload / no-store）：永远网络优先 8 秒，主人照样立刻拿最新版；
   - version.txt 永远 no-store 网络优先；sw.js 自身不缓存；跨域（云同步）完全不碰。
   v489：缓存名升级清掉滞留的旧版 HTML；_cb= 自检跳转纳入强刷判定，保证一次刷新必拿最新版。 */
var CACHE = 'hami-sw-v7';
var FRESH_MS = 3 * 60 * 1000;

self.addEventListener('install', function (e) { e.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function bust(u) {
  var s = u.split('#')[0];
  return s + (s.indexOf('?') >= 0 ? '&' : '?') + '__swf=' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}
function putInCache(req, resp) {
  try {
    if (resp && resp.ok && resp.type === 'basic') {
      var copy = resp.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
    }
  } catch (e) {}
}
function markFetched() {
  try { caches.open(CACHE).then(function (c) { c.put('__sw_lastfetch__', new Response(String(Date.now()))); }); } catch (e) {}
}
function freshEnough() {
  return caches.open(CACHE).then(function (c) { return c.match('__sw_lastfetch__'); })
    .then(function (r) { return r ? r.text() : '0'; })
    .then(function (t) { return Date.now() - (parseInt(t, 10) || 0) < FRESH_MS; })
    .catch(function () { return false; });
}
function networkFirst(req, patience) {
  return new Promise(function (resolve) {
    var settled = false;
    var finish = function (resp) { if (settled || !resp) return; settled = true; resolve(resp); };
    var net = fetch(bust(req.url), { cache: 'no-store' }).then(function (resp) {
      putInCache(req, resp); markFetched(); finish(resp); return resp;
    }).catch(function () { return null; });
    setTimeout(function () {
      if (settled) return;
      caches.match(req).then(function (hit) { finish(hit || null); }).catch(function () {});
    }, patience);
    net.then(function (resp) {
      if (resp) return;
      caches.match(req).then(function (hit) {
        if (hit) return finish(hit);
        return caches.match('./index.html').then(function (idx) { finish(idx || null); });
      }).catch(function () {});
    });
    setTimeout(function () { if (!settled) finish(Response.error()); }, patience + 10000);
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('sw.js') >= 0) return;

  if (url.pathname.indexOf('version.txt') >= 0) {
    e.respondWith(fetch(req, { cache: 'no-store' }).catch(function () { return caches.match(req); }));
    return;
  }
  var isDoc = req.mode === 'navigate' || req.destination === 'document';
  if (isDoc) {
    var force = /[?&](_v=|_cb=)/.test(req.url) || req.cache === 'reload' || req.cache === 'no-store';
    if (force) { e.respondWith(networkFirst(req, 8000)); return; }
    /* v489：文档导航一律后台静默换新；缓存只作离线兜底，绝不主动喂旧版给在线主人 */
    e.respondWith(freshEnough().then(function (fresh) {
      if (!fresh) return networkFirst(req, 900);
      return caches.match(req).then(function (hit) {
        return hit || networkFirst(req, 900);
      });
    }));
    return;
  }
  // 其它静态资源：缓存优先 + 后台更新
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req, { cache: 'reload' }).then(function (resp) {
        putInCache(req, resp); return resp;
      }).catch(function () { return hit || null; });
      return hit || net;
    })
  );
});
