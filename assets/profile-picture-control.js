// smejj.com — Profilbild-Steuerung auf der Kontoseite (#profile > Panel "Profil").
//
// Verantwortung: Markup + Bindung fuer Auswahl, Vorschau und Entfernen des
// Profilbilds. Die eigentliche Normalisierung und Speicherung liegt in
// public/profile-picture-store.js (Single Responsibility).

import { t } from "./i18n/ui.js?v=3";
import {
  MAX_EDGE,
  PROFILE_PICTURE_EVENT,
  clearProfilePicture,
  readProfilePicture,
  saveProfilePicture
} from "./profile-picture-store.js?v=1";

// Markup fuer das Profil-Panel. Output: HTML-String.
export function profilePictureMarkup() {
  return `<div class="account-picture">
    <span id="profilePicturePreview" class="profile-avatar is-empty" aria-hidden="true"></span>
    <div class="account-picture-body">
      <strong>${t("Profilbild")}</strong>
      <small>${t("Bleibt lokal auf diesem Gerät. Wird auf 256×256 verkleinert und nicht an Dritte übertragen.")}</small>
      <div class="account-picture-actions">
        <input id="profilePictureInput" type="file" accept="image/png,image/jpeg,image/webp" aria-label="${t("Profilbild auswählen")}">
        <label class="account-picture-choose" for="profilePictureInput">${t("Bild auswählen")}</label>
        <button id="profilePictureRemove" type="button">${t("Entfernen")}</button>
      </div>
    </div>
  </div>`;
}

// Verdrahtet Auswahl/Entfernen und haelt die Vorschau aktuell.
// Input: view (Element), report (Funktion fuer Statusmeldungen). Output: void.
export function initProfilePictureControl(view, report) {
  const input = view.querySelector("#profilePictureInput");
  const remove = view.querySelector("#profilePictureRemove");
  if (!input || !remove) return;
  const paint = () => renderPreview(view);
  paint();
  window.addEventListener(PROFILE_PICTURE_EVENT, paint);
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    const result = await saveProfilePicture(file);
    input.value = "";
    // Der Store liefert deutsche Quelltexte (fail-closed, ohne i18n-Abhaengigkeit);
    // uebersetzt wird erst hier an der Oberflaeche.
    if (!result.ok) return report(t(result.error));
    report(`${t("Profilbild lokal gespeichert")} (${MAX_EDGE}×${MAX_EDGE}, ${Math.round(result.bytes / 1024)} KB).`);
  });
  remove.addEventListener("click", () => {
    if (!readProfilePicture()) return report(t("Es ist kein Profilbild gespeichert."));
    clearProfilePicture();
    report(t("Profilbild entfernt. Es wird wieder die Initiale angezeigt."));
  });
}

// Zeichnet die Vorschau (Bild oder Initiale). Input: view. Output: void.
function renderPreview(view) {
  const preview = view.querySelector("#profilePicturePreview");
  if (!preview) return;
  const picture = readProfilePicture();
  const initial = (view.querySelector("#profileName")?.value || "").trim().charAt(0);
  preview.replaceChildren();
  preview.classList.toggle("has-picture", Boolean(picture));
  preview.classList.toggle("is-empty", !picture && !initial);
  if (!picture) {
    preview.textContent = initial;
    return;
  }
  const image = document.createElement("img");
  image.className = "profile-dock-image";
  image.src = picture;
  image.alt = "";
  preview.append(image);
}
