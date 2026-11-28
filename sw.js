// 離線快取與「新版本要使用者按了才換」。
// 只快取程式本身；名冊、休假、班表等資料一直都只存在瀏覽器的本機儲存，不經過這裡。
//
// 運作方式：
// - 平常一律用已存下的版本開啟（沒網路也能用，開啟速度也快）。
// - 瀏覽器每次開啟時會檢查 sw.js 有沒有變。build.js 每次產生 index.html 都會更新下面的 VERSION，
//   所以程式一改，sw.js 就跟著變；新版本在背景下載完成後「等待」，不會自己替換。
// - 頁面看到有新版本在等待，就顯示「有新版本」提示；使用者按「更新」才切換並重新載入。
const VERSION = '7a70a4ff5682be77'; // build.js 自動填入，請勿手改
const CACHE = 'roster-' + VERSION;
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })));
    // 從 v10.1 以前的「有網路就抓最新版」快取升級時，頁面本來就已是最新版，直接接手，不必再問一次。
    const keys = await caches.keys();
    if (keys.includes('roster-shell-v1')) await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'activate-update') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  if (new URL(request.url).pathname.endsWith('/sw.js')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(request, { ignoreSearch: true }) ||
      (request.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    if (hit) return hit;
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  })());
});
