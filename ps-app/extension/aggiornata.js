// Dopo un aggiornamento (o «Ricarica estensione») il pannello di questa scheda è
// quello di prima, e non parla più con l'estensione: questa pillola lo dice, e
// un tocco riapre la pagina con la versione nuova. Mai da sola: nella pagina
// può esserci un testo non ancora mandato. La riapre con una GET dello stesso
// indirizzo (mai un «ricarica» che rimanderebbe un modulo), e solo se è
// l'indirizzo di una pagina da leggere; se no, dice di riaprirla dal gestionale.
// (La mette il service worker, aggiorna.js, nelle schede già aperte.)
(() => {
  if (document.getElementById("psassist-aggiornata")) return;
  const leggibile = !/[?&](ccsForm|Insert|Delete|Update)=/i.test(location.search);
  const h = document.createElement("div");
  h.id = "psassist-aggiornata";
  const r = h.attachShadow({ mode: "open" });
  r.innerHTML = `<style>button{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;border:0;border-radius:999px;
    padding:10px 16px;font:600 13px system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff;background:#0B5CAD;box-shadow:0 6px 20px rgba(9,42,74,.25);cursor:pointer}
    button:focus-visible{outline:2px solid #fff;outline-offset:-4px}</style>
    <button type="button">${leggibile ? "PS Assist aggiornata · Ricarica la pagina" : "PS Assist aggiornata · riapri la pagina dal gestionale"}</button>`;
  r.querySelector("button").addEventListener("click", () => {
    if (leggibile) location.assign(location.href.split("#")[0]);
    else h.remove();
  });
  (document.body || document.documentElement).appendChild(h);
})();
