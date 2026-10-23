/* Hami 工作台 Service Worker（v386）——专治 GitHub Pages 国内链路 ~12KB/s
   策略：同源 GET 一律 cache-first + 后台 revalidate。
   - 第一次访问：走网络，顺手写入缓存（这一次照旧慢，绕不开）
   - 第二次起：先吐缓存（秒开），后台默默拉最新版，内容有变就换缓存（下次打开即新版）
   - version.txt：永远网络优先 no-store（版本检查必须拿真值，不能被缓存骗）
   - 跨域请求（Supabase 云同步等）：完全不碰
   - 断网兜底：返回缓存里的页面壳，至少能打开看数据
   每次发新版把 CACHE 键 +1（hami-sw-v1 → v2），旧缓存由 activate 自动清理 */
var CACHE = 'hami-sw-v2';

self.addEventListener('install', function (e) {
  // install 不预下载大文件（否则首次注册后白等一轮 150s）；skipWaiting 让新 SW 尽快接班
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

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                        // 只缓存 GET
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;         // 跨域不碰（云同步/接口）
  if (url.pathname.indexOf('version.txt') >= 0) {          // 版本锚点永远拿网络真值
    e.respondWith(
      fetch(req, { cache: 'no-store' }).catch(function () { return caches.match(req); })
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req, { cache: 'reload' }).then(function (resp) {   // reload 绕开浏览器 600s 文档缓存
        if (resp && resp.ok && resp.type === 'basic') {
          var copy = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return resp;
      }).catch(function () {
        return hit || caches.match('./index.html');   // 断网兜底：缓存或页面壳
      });
      return hit || net;                               // 有缓存先吐（秒开），没有才走网络
    })
  );
});
