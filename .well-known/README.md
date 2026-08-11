# Associated Domains — smejj.com

Diese Dateien verknuepfen smejj.com mit den nativen Apps, damit Apple Password
AutoFill (iOS/macOS) und Google Credential Manager (Android) Passkeys anbieten.
Fuer **Web-Passkeys** (Safari/Chrome) werden sie NICHT gebraucht — die funktionieren
sofort. Erst fuer die nativen iOS/Android-Apps muessen die Platzhalter ersetzt werden.

## apple-app-site-association
- `REPLACE_APPLE_TEAM_ID` → Apple Developer Team-ID (Membership-Seite).
- `com.smejj.app` → tatsaechliche Bundle-ID der iOS-App (Capacitor-Projekt).
- In der iOS-App unter Signing & Capabilities die Associated Domain
  `webcredentials:smejj.com` (und optional `applinks:smejj.com`) eintragen.
- Wird ohne Dateiendung und als valides JSON ausgeliefert (GitHub Pages ok).

## assetlinks.json
- `com.smejj.app` → Android-Paketname.
- `REPLACE_ANDROID_SIGNING_SHA256_FINGERPRINT` → SHA-256 des Signaturschluessels
  (`keytool -list -v -keystore <keystore>` oder Play App Signing).
- Mehrere Fingerprints (Debug + Release/Play) koennen als Liste ergaenzt werden.

Nach dem Ersetzen erneut deployen; Verknuepfung pruefen:
- Apple: https://app-site-association.cdn-apple.com/a/v1/smejj.com
- Google: https://developers.google.com/digital-asset-links/tools/generator
