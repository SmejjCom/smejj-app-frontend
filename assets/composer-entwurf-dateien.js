// smejj.com — begrenzter lokaler Entwurf, Originaldateien bleiben auf dem Geraet.
const DB = "smejj.com-composer-drafts", STORE = "drafts";
export function entwurfIdentitaet(speicher = globalThis.localStorage) {
  try { const s = JSON.parse(speicher.getItem("smejj.session.v1") || "{}"); const p = JSON.parse(speicher.getItem("smejj.profile.v1") || "{}"); return s.authenticated ? "user:" + (s.userId || s.email || p.email || "local") : "guest"; } catch { return "guest"; }
}
export function gueltigerEntwurf(value, jetzt = Date.now()) {
  return value && Number.isFinite(value.at) && jetzt - value.at < 86400000 && Array.isArray(value.files) && value.files.length <= 12
    && value.files.reduce((n, f) => n + (f.size || 0), 0) <= 50 * 1024 * 1024;
}
export function oeffneEntwurfDB(idb = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    if (!idb) { reject(new Error("Lokaler Dateispeicher nicht verfügbar")); return; }
    const r = idb.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
export async function entwurfTransaktion(db, value, key = entwurfIdentitaet()) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, value === undefined ? "readonly" : "readwrite");
    const r = value === undefined ? tx.objectStore(STORE).get(key) : tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve(r.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
export async function initDateiEntwurf(annehmen) {
  const feld = () => document.querySelector("#probierFeld, #code.view.is-active #codeAufgabe, #startMessage");
  if (!feld()) return;
  const identitaet = entwurfIdentitaet();
  let db, wiederherstellen = true, timer, kette = Promise.resolve();
  const hinweis = () => {
    let node = document.getElementById("dateiEntwurfWarnung");
    if (!node) { node = document.createElement("p"); node.id = "dateiEntwurfWarnung"; node.setAttribute("role", "status"); feld()?.parentElement.append(node); }
    node.textContent = "Entwurf kann auf diesem Gerät nicht gesichert werden. Bitte vor dem Schließen senden oder Dateien später erneut auswählen.";
  };
  const speichern = () => {
    if (wiederherstellen || !db || entwurfIdentitaet() !== identitaet) return Promise.resolve(false);
    const texts = {};
    for (const input of document.querySelectorAll("#probierFeld, #startMessage, #codeAufgabe")) texts[input.id] = input.value;
    const textChips = window.smejjTextAnhaenge?.liste?.() || [];
    if (Object.values(texts).some(text => text.length > 200000) || textChips.reduce((n, c) => n + c.text.length, 0) > 200000) { hinweis(); return Promise.resolve(false); }
    const bestand = window.smejjAnhangChips;
    const files = [...(bestand?.anhangListe?.() || []), ...(bestand?.versandListe?.() || [])].map(a => a.file);
    const value = { at: Date.now(), texts, textChips, files };
    kette = kette.then(() => entwurfTransaktion(db, value, identitaet)).then(() => true).catch(() => { hinweis(); return false; });
    return kette;
  };
  window.smejjSichereDateiEntwurf = speichern;
  const plane = () => { clearTimeout(timer); timer = setTimeout(speichern, 80); };
  document.addEventListener("input", e => { if (["probierFeld", "startMessage", "codeAufgabe"].includes(e.target.id)) plane(); });
  window.addEventListener("smejj:anhang-geaendert", plane);
  window.addEventListener("smejj:task-status", plane);
  window.addEventListener("pagehide", speichern);
  document.addEventListener("visibilitychange", () => { if (document.hidden) void speichern(); });
  try {
    db = await oeffneEntwurfDB();
    let data = await entwurfTransaktion(db, undefined, identitaet);
    try {
      if (identitaet !== "guest" && sessionStorage.getItem("smejj.gastAnhangUebernahme.v1") === "ja") {
        data = await entwurfTransaktion(db, undefined, "guest"); sessionStorage.removeItem("smejj.gastAnhangUebernahme.v1");
      }
    } catch {}
    if (gueltigerEntwurf(data)) {
      // Tippen/Auswahl waehrend des asynchronen Lesens hat Vorrang.
      const input = feld();
      if (!input.value && (data.texts?.[input.id] || data.texts?.probierFeld)) { input.value = data.texts[input.id] || data.texts.probierFeld; input.dispatchEvent(new Event("input", { bubbles: true })); }
      if (!window.smejjAnhangChips?.anhangListe?.().length && data.files.length) await annehmen(data.files, input);
      window.smejjTextAnhaenge?.wiederherstellen?.(data.textChips, input);
    }
  } catch { hinweis(); }
  wiederherstellen = false;
  if (document.getElementById("probierFeld") && window.smejjAnhangChips?.anhangListe?.().length) window.dispatchEvent(new Event("smejj:gast-anhang"));

  await speichern();
}
