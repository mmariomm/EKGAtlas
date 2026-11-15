//@frammento 32-pianta.js — La pianta della Stanza: PIANTA, misure dei letti, STANZA_PS/STANZA_ALTA, migraStanza.
  // La pianta della Stanza: una griglia di celle tutte uguali, 40 × 24. Un
  // letto prende 5 × 4 celle, una sedia 4 × 3, un'area almeno 5 × 3. Si
  // salvano solo celle intere: a qualunque misura la stanza si ridisegna
  // uguale, in scala. La sedia è un letto più piccolo (forma: "sedia").
  // Un letto può anche stare in una stanzetta sua («box»: il letto e la sua
  // cornice, 7 × 7) o essere una barella in attesa, stretta e in piedi (3 × 5).
  const PIANTA = { cols: 40, rows: 24, lw: 5, lh: 4, sw: 4, sh: 3, aw: 5, ah: 3, bw: 7, bh: 7, rw: 3, rh: 5 };
  const FORME = ["sedia", "box", "barella"];
  const misuraLetto = (l) => (l.forma === "sedia" ? { w: PIANTA.sw, h: PIANTA.sh } : l.forma === "box" ? { w: PIANTA.bw, h: PIANTA.bh }
    : l.forma === "barella" ? { w: PIANTA.rw, h: PIANTA.rh } : { w: PIANTA.lw, h: PIANTA.lh });
  // due rettangoli di celle si sovrappongono (con g > 0: stanno a meno di g celle)
  const troppoVicini = (a, b, g = 0) => a.c < b.c + b.w + g && b.c < a.c + a.w + g && a.r < b.r + b.h + g && b.r < a.r + a.h + g;
  // La stanza di partenza, dallo schizzo del PS: OBI, OSS e la sala
  // d'attesa, da sinistra a destra, con due celle vuote fra l'una e l'altra;
  // la seconda sala d'attesa sotto l'OBI. Si vede finché non c'è una stanza
  // salvata, e si salva al primo cambiamento. Gli id sono fissi: un paziente
  // messo in «OBI 1» ci resta anche prima che la stanza sia salvata.
  const STANZA_PS = {
    letti: [
      { id: "obi4", c: 0, r: 0, nome: "OBI 4" }, { id: "obi3", c: 5, r: 0, nome: "OBI 3" },
      { id: "obi2", c: 10, r: 0, nome: "OBI 2" }, { id: "obi1", c: 15, r: 0, nome: "OBI 1" },
      { id: "oss1", c: 22, r: 0, nome: "OSS 1" }, { id: "oss2", c: 27, r: 0, nome: "OSS 2" },
      { id: "oss3", c: 27, r: 4, nome: "OSS 3" }, { id: "oss4", c: 22, r: 4, nome: "OSS 4" },
    ],
    aree: [
      { id: "attesa", c: 34, r: 0, w: 6, h: 11, nome: "Sala attesa" },
      { id: "attesa2", c: 0, r: 6, w: 20, h: 5, nome: "Sala attesa 2" },
    ],
  };
  // L'Alta intensità, dallo schizzo del medico (dal basso): il Box (un letto
  // nella sua stanza), i letti 3, 2, 1 e la Rossa (la sala rossa, anche lei
  // un letto nella sua stanza); sopra, le sedie — tre in fila e la quarta
  // sopra la Rossa —; in alto a sinistra le due barelle dell'attesa.
  const STANZA_ALTA = {
    letti: [
      { id: "ab1", c: 0, r: 0, nome: "Attesa barellati 1", forma: "barella" }, { id: "ab2", c: 4, r: 0, nome: "Attesa barellati 2", forma: "barella" },
      { id: "as1", c: 8, r: 6, nome: "Sedia 1", forma: "sedia" }, { id: "as2", c: 13, r: 6, nome: "Sedia 2", forma: "sedia" },
      { id: "as3", c: 18, r: 6, nome: "Sedia 3", forma: "sedia" }, { id: "as4", c: 27, r: 6, nome: "Sedia 4", forma: "sedia" },
      { id: "box", c: 0, r: 10, nome: "Box", forma: "box" },
      { id: "a3", c: 8, r: 12, nome: "Letto 3" }, { id: "a2", c: 14, r: 12, nome: "Letto 2" }, { id: "a1", c: 20, r: 12, nome: "Letto 1" },
      { id: "rossa", c: 26, r: 10, nome: "Rossa", forma: "box" },
    ],
    aree: [],
  };
  // Una mappa per area (mappaDiArea): ognuna la sua stanza e i suoi posti.
  // La stanza di prima (stanza.v1, stanza.posti.v1) è diventata quella del PS.
  const MAPPE = {
    ps: { k: "ps", vista: "bassa", sala: "stanza.ps.v1", posti: "stanza.ps.posti.v1", base: STANZA_PS, nome: "del PS", rimette: "Rimette OBI, OSS e le sale d'attesa" },
    alta: { k: "alta", vista: "alta", sala: "stanza.alta.v1", posti: "stanza.alta.posti.v1", base: STANZA_ALTA, nome: "dell'Alta", rimette: "Rimette Box, letti, Rossa, sedie e barelle" },
  };
  const TUTTI_I_POSTI = () => Object.values(MAPPE).map((m) => m.posti);
  function migraStanza() {
    const c = (k) => { try { return localStorage.getItem(NS + k); } catch { return null; } };
    for (const [vec, nuo] of [["stanza.v1", MAPPE.ps.sala], ["stanza.posti.v1", MAPPE.ps.posti]]) {
      const v = c(vec);
      if (v == null) continue;
      if (c(nuo) == null) { try { localStorage.setItem(NS + nuo, v); } catch { continue; } }
      store.del(vec);
    }
  }

