// 離線快取。只快取程式本身；名冊、休假、班表等資料一直都只存在瀏覽器的本機儲存，不經過這裡。
//
// 運作方式：
// - 開啟網頁時有網路就抓最新版（4 秒內沒回應或沒網路，才用上次存下的版本），
//   所以傳出去的班表連結、個人班表連結，任何人點開都是最新版。
// - 每次發布前 GitHub 會先跑自動測試，沒通過不會發布。
// - 已經開著的頁面不會被強制重新載入；新版本裝好後畫面下方顯示「網站已更新」，按「重新整理」才換。
// - build.js 每次產生 index.html 都會更新下面的 VERSION，瀏覽器據此發現新版本。
const VERSION = '6e2dc39800623d58'; // build.js 自動填入，請勿手改
const CACHE = 'roster-' + VERSION;
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE)
    .then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// 開啟頁面：網路優先，4 秒沒回應改用快取（網路回來後仍會更新快取）
async function page(request) {
  const cache = await caches.open(CACHE);
  const network = fetch(request, { cache: 'no-cache' }).then(response => {
    if (response.ok) cache.put('./index.html', response.clone());
    return response;
  });
  const timeout = new Promise(resolve => setTimeout(resolve, 4000));
  try {
    const fast = await Promise.race([network, timeout]);
    if (fast) return fast;
  } catch (_) {}
  return (await cache.match('./index.html')) || network;
}

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin || url.pathname.endsWith('/sw.js')) return;
  if (request.mode === 'navigate') { event.respondWith(page(request)); return; }
  event.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  }));
});
