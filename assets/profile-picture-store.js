// smejj.com — Profilbild-Speicher (lokal-first, fail-closed).
//
// Zweck: Profilbild lesen, normalisieren, speichern und loeschen.
// Bewusste Entscheidungen:
//   - Kein Gravatar/kein externer Dienst: eine E-Mail-Adresse (bzw. deren Hash)
//     an Dritte zu senden waere eine unnoetige Datenweitergabe. Das Bild bleibt
//     ausschliesslich auf diesem Geraet (localStorage).
//   - Harte Groessengrenzen: max. 256x256 Pixel, max. 100 KB Data-URL.
//     Damit bleibt der lokale Profil-Zustand klein und schnell.
//   - Fail-closed: unbekannter Typ, zu grosse Quelle oder unsauberer
//     Data-URL-Inhalt => kein Speichern, klare Fehlermeldung.
//
// Input/Output je Funktion siehe Kommentare.

export const PROFILE_PICTURE_KEY = "smejj.profile.picture.v1";
export const PROFILE_PICTURE_EVENT = "smejj:profile-picture-changed";
export const MAX_EDGE = 256;
export const MAX_BYTES = 100 * 1024;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const SAFE_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const QUALITY_STEPS = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4];

// Liest das gespeicherte Profilbild. Output: Data-URL oder "" (kein Bild).
// Ungueltige oder manipulierte Werte werden verworfen (fail-closed).
export function readProfilePicture() {
  try {
    const value = localStorage.getItem(PROFILE_PICTURE_KEY) || "";
    if (!value || value.length > MAX_BYTES * 2 || !SAFE_DATA_URL.test(value)) return "";
    return value;
  } catch {
    return "";
  }
}

// Entfernt das Profilbild lokal. Output: void. Loest PROFILE_PICTURE_EVENT aus.
export function clearProfilePicture() {
  try {
    localStorage.removeItem(PROFILE_PICTURE_KEY);
  } catch {
    /* Speicher nicht verfuegbar: nichts zu entfernen. */
  }
  announce("");
}

// Nimmt eine Bilddatei entgegen, normalisiert sie und speichert sie lokal.
// Input: File. Output: { ok: true, dataUrl, bytes } | { ok: false, error }.
export async function saveProfilePicture(file) {
  if (!file) return { ok: false, error: "Keine Datei ausgewaehlt." };
  if (!ALLOWED_TYPES.has(file.type)) return { ok: false, error: "Nur PNG, JPEG oder WebP sind erlaubt." };
  if (file.size > MAX_SOURCE_BYTES) return { ok: false, error: "Bild ist groesser als 8 MB. Bitte kleineres Bild waehlen." };
  let dataUrl;
  try {
    dataUrl = await normalize(file);
  } catch {
    return { ok: false, error: "Bild konnte nicht gelesen werden." };
  }
  if (!dataUrl || !SAFE_DATA_URL.test(dataUrl)) return { ok: false, error: "Bildformat wurde nicht akzeptiert." };
  if (dataUrl.length > MAX_BYTES) return { ok: false, error: "Bild bleibt auch komprimiert zu gross. Bitte anderes Bild waehlen." };
  try {
    localStorage.setItem(PROFILE_PICTURE_KEY, dataUrl);
  } catch {
    return { ok: false, error: "Lokaler Speicher ist voll. Profilbild wurde nicht gespeichert." };
  }
  announce(dataUrl);
  return { ok: true, dataUrl, bytes: dataUrl.length };
}

// Skaliert quadratisch (Mittenausschnitt) auf max. MAX_EDGE und komprimiert,
// bis die Data-URL unter MAX_BYTES liegt. Input: File. Output: Data-URL.
async function normalize(file) {
  const bitmap = await loadBitmap(file);
  const edge = Math.min(MAX_EDGE, Math.max(bitmap.width, bitmap.height, 1));
  const canvas = document.createElement("canvas");
  canvas.width = edge;
  canvas.height = edge;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas-context-missing");
  const source = Math.min(bitmap.width, bitmap.height);
  const sx = Math.max(0, (bitmap.width - source) / 2);
  const sy = Math.max(0, (bitmap.height - source) / 2);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, sx, sy, source, source, 0, 0, edge, edge);
  if (typeof bitmap.close === "function") bitmap.close();
  for (const type of ["image/webp", "image/jpeg"]) {
    for (const quality of QUALITY_STEPS) {
      const candidate = canvas.toDataURL(type, quality);
      if (candidate.startsWith(`data:${type}`) && candidate.length <= MAX_BYTES) return candidate;
    }
  }
  return "";
}

// Laedt die Datei als Bitmap. Nutzt createImageBitmap, faellt auf <img> zurueck.
async function loadBitmap(file) {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("image-decode-failed"));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Informiert alle Oberflaechen (Dock, Kontoseite) ueber den neuen Stand.
function announce(dataUrl) {
  window.dispatchEvent(new CustomEvent(PROFILE_PICTURE_EVENT, { detail: { dataUrl } }));
}
