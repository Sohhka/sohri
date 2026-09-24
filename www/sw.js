/* Service worker de la version web (iPhone, ou navigateur) : garde une copie de tous les fichiers
   de l'appli pour qu'elle fonctionne hors connexion. La liste des fichiers (FILES) et la version
   (VERSION) sont ajoutées à la place du repère ci-dessous par tools/build-web.js, à chaque mise en
   ligne. Pas utilisé par l'appli Android, dont les fichiers sont déjà dans l'APK. */
/* @precache */
var CACHE = 'sohri-' + (typeof VERSION === 'string' ? VERSION : 'dev');
var PRECACHE = typeof FILES !== 'undefined' ? FILES : [];

/* Copie de tous les fichiers, demandés au serveur et non au cache du navigateur (GitHub Pages
   autorise 10 minutes de cache : une mise à jour pourrait sinon mélanger ancienne et nouvelle version). */
self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return cache.addAll(PRECACHE.map(function (url) { return new Request(url, { cache: 'reload' }); }));
  }));
});

/* Nouvelle version active : les copies des versions précédentes sont effacées. */
self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (key) {
      return key.indexOf('sohri-') === 0 && key !== CACHE;
    }).map(function (key) { return caches['delete'](key); }));
  }).then(function () { return self.clients.claim(); }));
});

/* La page demande d'utiliser tout de suite la nouvelle version (bouton « Mettre à jour »). */
self.addEventListener('message', function (event) {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

/* Fichiers de l'appli : la copie locale d'abord (hors connexion), sinon le réseau. */
self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(caches.open(CACHE).then(function (cache) {
    return cache.match(request.mode === 'navigate' ? './' : request, { ignoreSearch: true }).then(function (cached) {
      return cached || fetch(request);
    });
  }));
});
