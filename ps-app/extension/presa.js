/*
 * PS Assist — UNA presa WebSocket verso il ripetitore del ponte (/ponte/ws):
 * il battito, i tentativi, fino a quando tenerla. La stessa per il ponte
 * verso l'iPhone (ruolo `pc`) e per la stazione di stampa (`medico`,
 * `stazione`, e le stanze dell'abbinamento).
 *
 * Di solito vive nel documento fuori schermo (fuori.html, fuori.js), che
 * sopravvive ai riavvii del service worker: così una presa si apre una volta e
 * resta, invece di rifarsi a ogni risveglio. Su un Chrome senza
 * chrome.offscreen vive nel service worker (fuori-sw.js, il ripiego), come
 * fino alla 3.86.
 *
 * Le regole, le stesse ovunque:
 *   - battito: «ping» ogni 30 secondi (il ripetitore risponde «pong» da sé,
 *     senza svegliarsi); senza «pong» entro 15 secondi la presa è morta, e si
 *     riprova;
 *   - caduta: si riprova dopo 1 secondo, poi il doppio ogni volta, fino a 5
 *     minuti, col caso (±50 %: un ripetitore che torna non si vede arrivare
 *     tutti insieme); il conto ricomincia da capo solo dopo una presa rimasta
 *     su 2 minuti (una che cade ogni minuto non fa ripartire da 1 secondo);
 *   - 4001 (un'altra presa dello stesso ruolo ha preso il suo posto): nessun
 *     tentativo fino alla prossima richiesta (tieni);
 *   - 4403 (il ripetitore non vuole questa presa): ferma, «Scollegato»; solo
 *     un'altra stanza o una richiesta `subito` (un gesto) la riprova;
 *   - mai due: la vecchia si chiude (1000) prima di aprirne un'altra;
 *   - `fino`: l'ora oltre la quale non serve più, e si chiude da sé (null:
 *     finché qualcuno non dice altro). La decide il service worker (quando
 *     serve: ponte-sw.js, stazione-sw.js); qui si rispetta anche se lui dorme.
 */
(function (g) {
  "use strict";
  // (i test possono accorciarli: fuori.js, «fuoriRegola»)
  const PRESA = { battito: 30e3, pong: 15e3, primo: 1e3, max: 300e3, tenuta: 120e3 };
  const ora = () => Date.now();
  const TETTO = 2 ** 31 - 1;   // (setTimeout non va oltre)

  class PresaWs {
    // eventi: { dati(ArrayBuffer), stato(stato) }
    constructor(nome, eventi = {}) {
      Object.assign(this, { nome, eventi, url: "", ws: null, su: false, pari: false, fino: 0, fermo: 0, aperta: 0, ver: 0,
        tentativi: 0, prossimo: 0, entrate: 0, codice: 0, tRiprova: 0, tPong: 0, tFino: 0 });
      this.tBattito = setInterval(() => this.battito(), PRESA.battito);
    }
    // tenuta: aperta, in apertura, o in attesa del prossimo tentativo
    get tenuta() { return !!this.url; }
    // Com'è adesso, con un numero che cresce a ogni sguardo (`ver`): chi lo riceve per due strade
    // (la risposta a «tieni», un messaggio) tiene il più nuovo, mai uno vecchio arrivato dopo.
    stato() {
      return { nome: this.nome, url: this.url, su: this.su, pari: this.pari, fino: this.fino, fermo: this.fermo, codice: this.codice,
        collego: !!this.ws && !this.su, prossimo: this.prossimo, aperta: this.aperta, entrate: this.entrate, ver: ++this.ver };
    }
    dici() { try { this.eventi.stato && this.eventi.stato(this.stato()); } catch { /* chi ascolta non c'è più */ } }
    // Serve verso `url` fino a `fino` (ms; null = senza scadenza; 0 o passato = chiudi).
    // Ogni richiesta toglie il fermo di un 4001; `subito` non aspetta il prossimo tentativo, e riprova anche dopo un 4403.
    tieni(url, fino, subito = false) {
      if (!url || fino === 0 || (fino != null && !(fino > ora()))) return this.chiudi();
      clearTimeout(this.tFino); this.tFino = 0;
      this.fino = fino == null ? null : fino;
      if (fino != null) this.tFino = setTimeout(() => { this.tFino = 0; if (this.fino != null && this.fino <= ora() + 50) this.chiudi(); }, Math.min(TETTO, fino - ora()));
      if (url !== this.url) {
        this.chiudiPresa();
        clearTimeout(this.tRiprova); this.tRiprova = 0; this.prossimo = 0;
        Object.assign(this, { url, tentativi: 0, fermo: 0, codice: 0 });
      }
      if (this.fermo === 4403 && !subito) return this.dici();
      if (this.ws) return this.dici();                        // aperta, o si sta aprendo
      if (this.tRiprova && !subito) return this.dici();       // un tentativo già in programma: si aspetta lui
      this.fermo = 0;
      this.apri();
    }
    // non serve più: chiusa, e nessun tentativo
    chiudi() {
      clearTimeout(this.tFino); this.tFino = 0;
      clearTimeout(this.tRiprova); this.tRiprova = 0;
      const cera = !!this.url || !!this.ws;
      Object.assign(this, { url: "", fino: 0, prossimo: 0, tentativi: 0, fermo: 0 });
      this.chiudiPresa();
      if (cera) this.dici();
    }
    chiudiPresa() {
      const ws = this.ws;
      this.ws = null; this.su = false; this.pari = false; this.aperta = 0;
      clearTimeout(this.tPong); this.tPong = 0;
      if (ws) {
        ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
        try { ws.close(1000, "fine"); } catch { /* già chiusa */ }
      }
    }
    apri() {
      clearTimeout(this.tRiprova); this.tRiprova = 0; this.prossimo = 0;
      this.chiudiPresa();
      let ws;
      try { ws = new WebSocket(this.url); } catch { this.riprova(); this.dici(); return; }
      ws.binaryType = "arraybuffer";
      this.ws = ws; this.entrate++;
      ws.onopen = () => { if (this.ws !== ws) return; this.su = true; this.aperta = ora(); this.codice = 0; this.dici(); };
      ws.onmessage = (ev) => {
        if (this.ws !== ws) return;
        if (ev.data === "pong") { clearTimeout(this.tPong); this.tPong = 0; return; }
        if (typeof ev.data === "string") {
          let m = null;
          try { m = JSON.parse(ev.data); } catch { return; }
          if (m && typeof m.pari === "boolean" && m.pari !== this.pari) { this.pari = m.pari; this.dici(); }
          return;
        }
        try { this.eventi.dati && this.eventi.dati(ev.data); } catch { /* chi ascolta non c'è più */ }
      };
      ws.onclose = (ev) => {
        if (this.ws !== ws) return;
        this.caduta(ev && ev.code);
      };
    }
    // caduta (o morta senza dirlo): si riprova, se serve ancora e se il ripetitore non ha detto di no
    caduta(codice) {
      const durata = this.aperta ? ora() - this.aperta : 0;
      this.chiudiPresa();
      this.codice = codice || 0;
      if (durata >= PRESA.tenuta) this.tentativi = 0;
      if (codice === 4001 || codice === 4403) this.fermo = codice;
      else this.riprova();
      this.dici();
    }
    riprova() {
      clearTimeout(this.tRiprova); this.tRiprova = 0; this.prossimo = 0;
      if (!this.url) return;
      const b = Math.min(PRESA.max, PRESA.primo * 2 ** Math.min(this.tentativi++, 20));
      const ms = Math.max(50, Math.round(b * (0.5 + Math.random())));
      this.prossimo = ora() + ms;
      this.tRiprova = setTimeout(() => {
        this.tRiprova = 0; this.prossimo = 0;
        if (this.url && !this.ws) { this.apri(); this.dici(); }
      }, ms);
    }
    manda(f) {
      const ws = this.ws;
      if (!ws || !this.su || ws.readyState !== 1) return false;
      try { ws.send(f); return true; } catch { return false; }
    }
    battito() {
      const ws = this.ws;
      if (!ws || !this.su || ws.readyState !== 1 || this.tPong) return;
      try { ws.send("ping"); } catch { return; }
      this.tPong = setTimeout(() => { this.tPong = 0; if (this.ws === ws) this.caduta(0); }, PRESA.pong);
    }
    // (i test accorciano il battito: l'intervallo si rifà)
    ribatti() { clearInterval(this.tBattito); this.tBattito = setInterval(() => this.battito(), PRESA.battito); }
  }

  g.PRESA = PRESA;
  g.PresaWs = PresaWs;
})(globalThis);
