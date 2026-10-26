/* Hami 工作台 Service Worker（v415）
   历史：v386 上线，专治 GitHub Pages 国内链路慢——当时用「缓存优先 + 后台 revalidate」，
   但后台那次 fetch 命中的是 CDN 边缘节点最多 10 分钟的旧副本，
   于是把旧版又写回缓存，主人反复刷新都是旧版（v415 主人点名的问题）。

   v415 策略：
   - 页面文档（导航请求）：**网络优先**——带唯一查询串直取源站（CDN 必然未命中），
     快网 1 秒内就给最新版；慢网（GitHub 国内链路）1.6 秒超时后退回缓存秒开，
     后台继续下载，下次打开即新版。带 _v= 的显式刷新（点 ↻）给 8 秒耐心。
   - 其它同源 GET：缓存优先 + 后台更新（图片/字体等，照旧秒开）
   - version.txt：永远网络优先 no-store（版本检查必须拿真值）
   - sw.js 自身：不缓存
   - 跨域（Supabase 云同步等）：完全不碰
   - 断网：返回缓存页面壳，至少能打开看数据
   每次发新版把 CACHE 键 +1，旧缓存由 activate 自动清理 */
var CACHE = 'hami-sw-v3';

self.addEventListener('install', function (e) {
  e.waitUntil(self.skipWaiting());
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

// 给 URL 加唯一查询串：CDN 按完整 URL 缓存，唯一串 = 必然回源拿最新
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

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;              // 跨域不碰
  if (url.pathname.indexOf('sw.js') >= 0) return;              // SW 自身永远走网络

  // 版本锚点：永远拿网络真值，失败才回退缓存
  if (url.pathname.indexOf('version.txt') >= 0) {
    e.respondWith(fetch(req, { cache: 'no-store' }).catch(function () { return caches.match(req); }));
    return;
  }

  var isDoc = req.mode === 'navigate' || req.destination === 'document';

  if (isDoc) {
    // v415：文档走「网络优先 + 超时回退缓存」，网络那一趟带唯一查询串绕开 CDN 旧副本
    var patience = /[?&]_v=/.test(req.url) ? 8000 : 1600;      // 点 ↻ 的显式刷新给足时间
    e.respondWith(new Promise(function (resolve) {
      var settled = false;
      var finish = function (resp) { if (settled || !resp) return; settled = true; resolve(resp); };
      var net = fetch(bust(req.url), { cache: 'no-store' }).then(function (resp) {
        putInCache(req, resp);            // 成功就顺手把最新版写进缓存（下次秒开）
        finish(resp);
        return resp;
      }).catch(function () { return null; });

      // 慢网兜底：超时先给缓存，页面立刻能打开；后台下载完成后已写入缓存
      setTimeout(function () {
        if (settled) return;
        caches.match(req).then(function (hit) { finish(hit || null); }).catch(function () {});
      }, patience);

      // 写缓存是按原始 URL 存的，第二次进来就能命中
      net.then(function (resp) {
        if (resp) return;
        caches.match(req).then(function (hit) {
          if (hit) return finish(hit);
          return caches.match('./index.html').then(function (idx) { finish(idx || null); });
        }).catch(function () {});
      });
    }));
    return;
  }

  // 其它静态资源：缓存优先 + 后台更新（照旧秒开）
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req, { cache: 'reload' }).then(function (resp) {
        putInCache(req, resp);
        return resp;
      }).catch(function () { return hit || null; });
      return hit || net;
    })
  );
});
