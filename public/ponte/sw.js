// PS Assist sull'iPhone — il service worker: tiene SOLO il guscio dell'app
// (i suoi file), così si apre subito anche con la rete lenta. I dati dei
// pazienti non passano mai di qui: viaggiano cifrati sulla presa del ponte e
// restano nella memoria della pagina.
const CASSA = "ponte-guscio-1";
const GUSCIO = ["./", "app.js", "app.css", "cripto.js", "etichetta.js", "jsqr.min.js", "manifest.webmanifest", "icona.svg", "icona-180.png", "icona-192.png", "icona-512.png"];
const DEL_GUSCIO = new Set(GUSCIO.map((f) => new URL(f, self.registration.scope).pathname));

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CASSA).then((c) => c.addAll(GUSCIO)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((k) => Promise.all(k.filter((x) => x !== CASSA).map((x) => caches.delete(x))))
    .then(() => self.clients.claim()));
});
// Prima la rete (un'app aggiornata arriva subito); la copia senza rete, o
// con una rete che in 3 secondi non risponde (l'app si apre lo stesso, e la
// rete, se arriva, aggiorna la copia per la volta dopo).
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== self.location.origin || !DEL_GUSCIO.has(u.pathname)) return;
  const rete = fetch(e.request).then((r) => {
    if (r.ok && r.type === "basic") { const copia = r.clone(); return caches.open(CASSA).then((c) => c.put(u.pathname, copia)).then(() => r, () => r); }
    return r;
  });
  e.waitUntil(rete.catch(() => {}));
  e.respondWith(caches.match(u.pathname).then((copia) => (copia
    ? Promise.race([rete.catch(() => copia), new Promise((ok) => setTimeout(() => ok(copia), 3000))])
    : rete.catch(() => Response.error()))));
});
