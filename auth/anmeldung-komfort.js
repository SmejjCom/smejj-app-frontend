// smejj.com — E-Mail-Bestaetigung ohne oeffentliche Kontoauskunft.
import { API_ORIGIN } from "../config.js?v=2026102671";
const email = document.querySelector("#profileEmail");
const hilfe = document.querySelector("#verificationHelp");
const output = document.querySelector("#profileOutput");
function zeigen() { if (hilfe) hilfe.hidden = !email?.value.trim(); }
email?.addEventListener("input", zeigen);
zeigen();
document.querySelector("#correctEmail")?.addEventListener("click", () => {
  email?.focus(); email?.select();
  if (output) output.textContent = "Adresse korrigieren und anschließend erneut fortfahren. Ein bereits erstelltes Konto wird dadurch nicht umbenannt.";
});
document.querySelector("#resendVerification")?.addEventListener("click", async event => {
  if (!email?.reportValidity() || !email.value.trim()) { email?.focus(); return; }
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const response = await fetch(`${API_ORIGIN}/api/auth/email/verify/resend`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.value.trim() })
    });
    if (!response.ok) throw new Error("nicht_erreichbar");
    output.textContent = "Falls für diese Adresse eine Bestätigung aussteht, wurde ein neuer Link angefordert. Prüfe auch den Spamordner.";
  } catch { output.textContent = "Die Bestätigungsmail konnte gerade nicht angefordert werden. Bitte versuche es später erneut."; }
  finally { button.disabled = false; }
});
