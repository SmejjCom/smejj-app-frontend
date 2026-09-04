// smejj.com — API-Bereich: die vier Listen-Aktionen (loeschen, entfernen, umbenennen,
// umschalten) und die Aktivitaets-Anzeige. Ausgelagert aus api-center-surface.js, weil die
// 800-Zeilen-Regel des Projekts (check:guidelines) sonst reisst — die Flaeche war auf 813
// Zeilen gewachsen. Verhalten unveraendert; die Funktionen bekommen ihre Umgebung als
// "hof" (alleEintraege, laden, melde) uebergeben, statt sie aus dem Modul zu ziehen.
import { t } from "./i18n/ui.js?v=3";
import { api, escapeHtml } from "./api-center-helfer.js?v=1";

export async function loescheEndgueltig(root, zustand, id, hof) {
  const eintrag = hof.alleEintraege(zustand).find((e) => e.id === id);
  const name = eintrag ? `\n${eintrag.name}` : "";
  if (!confirm(`${t("Endgültig löschen? Der Schlüssel verschwindet komplett und kann nicht zurückgeholt werden. Programme mit diesem Schlüssel bekommen danach 401.")}${name}`)) return;
  try {
    await api(`${DEV_PREFIX}/${encodeURIComponent(id)}/delete`, { method: "POST", body: {} });
    await hof.laden(root, zustand);
    hof.melde(root, t("Schlüssel endgültig gelöscht."));
  } catch (error) {
    hof.melde(root, fehlerText(error), true);
  }
}

export async function entferne(root, zustand, id, hof) {
  const eintrag = hof.alleEintraege(zustand).find((e) => e.id === id);
  if (!confirm(`${t("Verbindung wirklich entfernen?")}${eintrag ? ` (${eintrag.name})` : ""}`)) return;
  try {
    await api(`${BYOK_PREFIX}/${encodeURIComponent(id)}/remove`, { method: "POST", body: {} });
    const byok = zustand.byok;
    if (byok && !byok.fehler && localStorage.getItem(MODELL_KEY) === `key:${id}`) localStorage.removeItem(MODELL_KEY);
    await hof.laden(root, zustand);
    hof.melde(root, t("Verbindung wurde entfernt."));
  } catch (error) {
    hof.melde(root, fehlerText(error), true);
  }
}

export async function umbenenne(root, zustand, id, hof) {
  schliessePopovers(root);
  const eintrag = hof.alleEintraege(zustand).find((e) => e.id === id);
  if (!eintrag) return;
  const name = prompt(t("Neuer Name für den Schlüssel"), eintrag.name);
  if (name === null) return;
  if (!name.trim()) return hof.melde(root, t("Der Name darf nicht leer sein."), true);
  try {
    await api(`${DEV_PREFIX}/${encodeURIComponent(id)}/rename`, { method: "POST", body: { name: name.trim() } });
    await hof.laden(root, zustand);
    hof.melde(root, t("Name geändert."));
  } catch (error) {
    hof.melde(root, fehlerText(error), true);
  }
}

export async function schalteUm(root, zustand, id, hof) {
  schliessePopovers(root);
  const eintrag = hof.alleEintraege(zustand).find((e) => e.id === id);
  if (!eintrag) return;
  const aktiv = !!eintrag.inaktiv;
  try {
    await api(`${DEV_PREFIX}/${encodeURIComponent(id)}/toggle`, { method: "POST", body: { aktiv } });
    await hof.laden(root, zustand);
    hof.melde(root, aktiv ? t("Schlüssel aktiviert.") : t("Schlüssel deaktiviert — Aufrufe bekommen jetzt 401."));
  } catch (error) {
    hof.melde(root, fehlerText(error), true);
  }
}

export function zeigeAktivitaet(root, zustand, id, hof) {
  schliessePopovers(root);
  const eintrag = hof.alleEintraege(zustand).find((e) => e.id === id);
  if (!eintrag) return;
  const zeilen = [
    [t("Zuletzt genutzt"), eintrag.zuletztBenutzt || t("Nie")],
    [t("Anfragen"), zahl(eintrag.nutzungAnfragen)],
    [t("Token"), zahl(eintrag.nutzungToken)],
    [t("Erstellt"), eintrag.erstellt || "—"],
    [t("Läuft ab"), eintrag.laeuftAb || t("Unbefristet")]
  ];
  const pop = root.querySelector(`[data-ac-zeile="${cssEscape(id)}"] .ac-popover`);
  if (!pop) return;
  pop.innerHTML = `<div class="ac-aktivitaet">
    <div class="ac-pop-head">${escapeHtml(eintrag.name)}</div>
    ${zeilen.map(([label, wert]) => `<div class="ac-aktivitaet-zeile"><span>${escapeHtml(label)}</span><b>${escapeHtml(String(wert))}</b></div>`).join("")}
  </div>`;
  pop.hidden = false;
}

// ---- Formular absenden --------------------------------------------------------
