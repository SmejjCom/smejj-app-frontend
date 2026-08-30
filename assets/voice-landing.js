// smejj.com — Sprachmodus fuer die Sprach-Landingpages (en/, fr/, es/, ...).
// Eigenstaendiges, additives Modul: schwebender Sprach-Button unten rechts oeffnet
// ein Overlay mit Zuhoeren -> Denken -> Vorlesen-Loop gegen die Chat-Bridge
// (CLIENT_ROUTES.api.agent). Free-only: Web Speech API + speechSynthesis, keine
// neuen Dienste. Bewaehrte Patterns aus assets/composer-tools.js portiert:
// Fail-Streak -> Tipp-Fallback (iOS/Safari), TTS-Unlock in der Klick-Geste,
// Barge-in mit Echo-Textfilter und Restart-Bremse. Startseite/App unberuehrt —
// das Modul initialisiert sich nur auf Seiten OHNE App-Composer (#startSend).
// Inhalt oeffentlich, Interaktion angemeldet: fuer Abgemeldete steht auf den
// Sprachseiten nur ein Anmelde-Knopf (Begruendung im Modulkopf dort).
import { darfSprechen, buildLoginCta } from "./voice-landing-signin.js?v=4";
import { CLIENT_ROUTES } from "./config.js";
// Stufe 1c: satzweises Vorlesen — erster Satz startet, waehrend der Rest streamt.
import { createSpeechQueue } from "./voice-speech-queue.js?v=emojifrei-20260825";
// Sende-Button (Pfeil nach oben, wie ChatGPT) fuer getippte Fragen in der Leiste.
import { bindTypedSend, SEND_ICON_SVG } from "./voice-typed-send.js?v=voice-send-20260721";
// Stufe 1e (Blitz-Paket): geteilter Echo-Filter, Mikrofonpegel-Unterbrechung
// und Verbindungs-Vorwaermer — schnellere Antworten, Unterbrechen wie ChatGPT.
import { normalizeSpeechText, isLikelyEcho, enoughForBarge } from "./voice-echo-filter.js";
import { createSpeechInterrupt } from "./voice-vad.js?v=blitz2-20260726";
import { warmUpAgentConnection } from "./voice-warmup.js";
// Stufe 2a: Interim-Waechter — Sprech-Ende ~1 s frueher erkennen und senden.
// OHNE ?v= — dieselbe Kennung wie in public/composer-tools.js. Zwei Kennungen
// waeren zwei Modulinstanzen mit getrenntem Zustand (check:module-queries).
// Der Cache wird ueber die Version in sw.js gebrochen, nicht ueber die Import-URL.
import { createSilenceWatchdog } from "./voice-endpoint.js";
// Stufe 3: Rueckfrage statt Blindantwort + Doppel-Sende-Schutz (geteilte Naht
// mit der Startseite; Muster aus dem ChatGPT-Live-Vergleich 2026-08-03).
import { sollNachfragen, clarifyLine, createDoppelschutz } from "./voice-clarify.js";
// Stufe 4 (Groq-Ohr): praezises Server-Transkript mit Web-Speech-Fallback.
import { createServerEar, createEarSend } from "./voice-ear.js";
import { buildReserveChatRequest } from "./chat-history-context.js";
import { appendVoiceTurn, buildAgentPayload } from "./voice-conversation.js";
// Stufe 3a: Denk-Laut, damit zwischen Frage und Antwort nicht nur Stille steht.
import { createThinkingCue } from "./voice-thinking-cue.js";
// Stufe B: Premium-Stimme (Server-TTS ueber WebAudio -> Echounterdrueckung greift,
// Unterbrechen wie ChatGPT). Fail-safe: ohne Worker bleibt die Browser-Stimme.
import { createPremiumVoice } from "./voice-premium-tts.js";
// Stufe A2: automatischer Neuversuch, wenn eine Salad-Replika ausfaellt.
import { fetchStreamWithRetry } from "./ai/fetch-retry.js";
import { bridgeAuthHeaders } from "./ai/chat-stream.js";

// Re-Export fuer bestehende Nutzer der bisherigen Modul-API.
export { normalizeSpeechText, isLikelyEcho, enoughForBarge };

const LANG_MAP = {
  de: "de-DE", en: "en-US", fr: "fr-FR", es: "es-ES", it: "it-IT",
  pt: "pt-PT", ru: "ru-RU", tr: "tr-TR", ja: "ja-JP", ko: "ko-KR",
  zh: "zh-CN", hi: "hi-IN", ar: "ar-SA", id: "id-ID", bn: "bn-BD"
};

// Kompakte UI-Texte pro Sprache (Schluessel siehe stringsFor()).
const STRINGS = {
  de: { open: "Sprachmodus", listening: "Ich höre zu ...", thinking: "Einen Moment ...", speaking: "Ich spreche ...", typeHint: "Frage unten eintippen — die Antwort wird vorgelesen.", placeholder: "Frage schreiben ...", micDenied: "Mikrofon nicht erlaubt — Frage unten eintippen.", noAnswer: "Keine Antwort erhalten — ich höre weiter zu.", error: "Verbindung fehlgeschlagen — bitte erneut versuchen.", close: "Beenden", send: "Senden", signIn: "Anmelden und sprechen", signInHint: "Der Sprachmodus ist angemeldeten Nutzern vorbehalten." },
  en: { open: "Voice mode", listening: "I'm listening ...", thinking: "One moment ...", speaking: "I'm speaking ...", typeHint: "Type your question below — the answer will be read aloud.", placeholder: "Write a question ...", micDenied: "Microphone not allowed — type your question below.", noAnswer: "No answer received — still listening.", error: "Connection failed — please try again.", close: "Close", send: "Send", signIn: "Sign in to talk", signInHint: "Voice mode is reserved for signed-in users." },
  zh: { open: "语音模式", listening: "我在听 ...", thinking: "请稍等 ...", speaking: "我在说 ...", typeHint: "在下方输入问题——回答将朗读出来。", placeholder: "输入问题 ...", micDenied: "麦克风未授权——请在下方输入问题。", noAnswer: "未收到回答——继续聆听。", error: "连接失败——请重试。", close: "关闭", send: "发送", signIn: "登录后开始对话", signInHint: "语音模式仅向已登录用户开放。" },
  es: { open: "Modo de voz", listening: "Te escucho ...", thinking: "Un momento ...", speaking: "Estoy hablando ...", typeHint: "Escribe tu pregunta abajo: la respuesta se leera en voz alta.", placeholder: "Escribe una pregunta ...", micDenied: "Microfono no permitido: escribe tu pregunta abajo.", noAnswer: "Sin respuesta: sigo escuchando.", error: "Fallo de conexion: intentalo de nuevo.", close: "Cerrar", send: "Enviar", signIn: "Inicia sesion para hablar", signInHint: "El modo de voz es solo para usuarios con sesion iniciada." },
  ar: { open: "وضع الصوت", listening: "أنا أستمع ...", thinking: "لحظة من فضلك ...", speaking: "أنا أتحدث ...", typeHint: "اكتب سؤالك في الأسفل — سيُقرأ الجواب بصوت عالٍ.", placeholder: "اكتب سؤالاً ...", micDenied: "الميكروفون غير مسموح — اكتب سؤالك في الأسفل.", noAnswer: "لم يصل جواب — ما زلت أستمع.", error: "فشل الاتصال — حاول مرة أخرى.", close: "إغلاق", send: "إرسال", signIn: "سجّل الدخول للتحدث", signInHint: "وضع الصوت متاح للمستخدمين المسجّلين فقط." },
  fr: { open: "Mode vocal", listening: "Je vous ecoute ...", thinking: "Un instant ...", speaking: "Je parle ...", typeHint: "Ecrivez votre question ci-dessous — la reponse sera lue a voix haute.", placeholder: "Ecrire une question ...", micDenied: "Micro non autorise — ecrivez votre question ci-dessous.", noAnswer: "Pas de reponse — je continue d'ecouter.", error: "Echec de connexion — veuillez reessayer.", close: "Fermer", send: "Envoyer", signIn: "Se connecter pour parler", signInHint: "Le mode vocal est reserve aux utilisateurs connectes." },
  pt: { open: "Modo de voz", listening: "Estou a ouvir ...", thinking: "Um momento ...", speaking: "Estou a falar ...", typeHint: "Escreva a sua pergunta abaixo — a resposta sera lida em voz alta.", placeholder: "Escrever uma pergunta ...", micDenied: "Microfone nao permitido — escreva a pergunta abaixo.", noAnswer: "Sem resposta — continuo a ouvir.", error: "Falha de ligacao — tente novamente.", close: "Fechar", send: "Enviar", signIn: "Iniciar sessao para falar", signInHint: "O modo de voz e reservado a utilizadores com sessao iniciada." },
  ru: { open: "Голосовой режим", listening: "Я слушаю ...", thinking: "Секунду ...", speaking: "Я говорю ...", typeHint: "Введите вопрос ниже — ответ будет озвучен.", placeholder: "Напишите вопрос ...", micDenied: "Микрофон не разрешён — введите вопрос ниже.", noAnswer: "Ответ не получен — продолжаю слушать.", error: "Ошибка соединения — попробуйте ещё раз.", close: "Закрыть", send: "Отправить", signIn: "Войдите, чтобы говорить", signInHint: "Голосовой режим доступен только вошедшим пользователям." },
  tr: { open: "Ses modu", listening: "Dinliyorum ...", thinking: "Bir saniye ...", speaking: "Konusuyorum ...", typeHint: "Sorunuzu asagiya yazin — yanit sesli okunacak.", placeholder: "Bir soru yazin ...", micDenied: "Mikrofona izin yok — sorunuzu asagiya yazin.", noAnswer: "Yanit alinamadi — dinlemeye devam ediyorum.", error: "Baglanti hatasi — lutfen tekrar deneyin.", close: "Kapat", send: "Gönder", signIn: "Konusmak icin giris yap", signInHint: "Sesli mod yalnizca giris yapmis kullanicilar icindir." },
  ja: { open: "音声モード", listening: "聞いています ...", thinking: "少々お待ちください ...", speaking: "話しています ...", typeHint: "下に質問を入力してください——回答は読み上げられます。", placeholder: "質問を入力 ...", micDenied: "マイクが許可されていません——下に質問を入力してください。", noAnswer: "回答がありません——引き続き聞いています。", error: "接続に失敗しました——もう一度お試しください。", close: "閉じる", send: "送信", signIn: "ログインして話す", signInHint: "音声モードはログインしたユーザー専用です。" },
  ko: { open: "음성 모드", listening: "듣고 있어요 ...", thinking: "잠시만요 ...", speaking: "말하고 있어요 ...", typeHint: "아래에 질문을 입력하세요 — 답변을 소리 내어 읽어 드립니다.", placeholder: "질문 입력 ...", micDenied: "마이크가 허용되지 않았습니다 — 아래에 질문을 입력하세요.", noAnswer: "답변이 없습니다 — 계속 듣고 있어요.", error: "연결 실패 — 다시 시도해 주세요.", close: "닫기", send: "보내기", signIn: "로그인하고 대화하기", signInHint: "음성 모드는 로그인한 사용자만 이용할 수 있습니다." },
  it: { open: "Modalita vocale", listening: "Ti ascolto ...", thinking: "Un attimo ...", speaking: "Sto parlando ...", typeHint: "Scrivi la tua domanda qui sotto: la risposta sara letta ad alta voce.", placeholder: "Scrivi una domanda ...", micDenied: "Microfono non consentito: scrivi la domanda qui sotto.", noAnswer: "Nessuna risposta: continuo ad ascoltare.", error: "Connessione non riuscita: riprova.", close: "Chiudi", send: "Invia", signIn: "Accedi per parlare", signInHint: "La modalita vocale e riservata agli utenti che hanno effettuato l accesso." },
  hi: { open: "वॉइस मोड", listening: "मैं सुन रहा हूँ ...", thinking: "एक क्षण ...", speaking: "मैं बोल रहा हूँ ...", typeHint: "नीचे अपना प्रश्न लिखें — उत्तर ज़ोर से पढ़ा जाएगा।", placeholder: "प्रश्न लिखें ...", micDenied: "माइक्रोफ़ोन की अनुमति नहीं — नीचे प्रश्न लिखें।", noAnswer: "कोई उत्तर नहीं मिला — मैं सुनता रहूँगा।", error: "कनेक्शन विफल — कृपया पुनः प्रयास करें।", close: "बंद करें", send: "भेजें", signIn: "बात करने के लिए साइन इन करें", signInHint: "वॉइस मोड केवल साइन-इन उपयोगकर्ताओं के लिए है।" },
  id: { open: "Mode suara", listening: "Saya mendengarkan ...", thinking: "Sebentar ...", speaking: "Saya berbicara ...", typeHint: "Ketik pertanyaan Anda di bawah — jawaban akan dibacakan.", placeholder: "Tulis pertanyaan ...", micDenied: "Mikrofon tidak diizinkan — ketik pertanyaan di bawah.", noAnswer: "Tidak ada jawaban — masih mendengarkan.", error: "Koneksi gagal — silakan coba lagi.", close: "Tutup", send: "Kirim", signIn: "Masuk untuk berbicara", signInHint: "Mode suara hanya untuk pengguna yang sudah masuk." },
  bn: { open: "ভয়েস মোড", listening: "আমি শুনছি ...", thinking: "এক মুহূর্ত ...", speaking: "আমি বলছি ...", typeHint: "নীচে আপনার প্রশ্ন লিখুন — উত্তরটি জোরে পড়ে শোনানো হবে।", placeholder: "প্রশ্ন লিখুন ...", micDenied: "মাইক্রোফোনের অনুমতি নেই — নীচে প্রশ্ন লিখুন।", noAnswer: "কোনও উত্তর আসেনি — আমি শুনছি।", error: "সংযোগ ব্যর্থ — আবার চেষ্টা করুন।", close: "বন্ধ করুন", send: "পাঠান", signIn: "কথা বলতে সাইন ইন করুন", signInHint: "ভয়েস মোড শুধু সাইন-ইন করা ব্যবহারকারীদের জন্য।" }
};

export function pageLang() {
  const raw = typeof document !== "undefined" ? (document.documentElement.lang || "de") : "de";
  return raw.split("-")[0].toLowerCase();
}

export function stringsFor(lang) {
  return STRINGS[lang] || STRINGS.en;
}

export function speechLangFor(lang) {
  return LANG_MAP[lang] || "en-US";
}

// Das Gespraechsgedaechtnis des Sprach-Modus liegt in voice-conversation.js,
// damit es ohne Browser pruefbar ist. Re-Export, weil bestehende Aufrufer
// buildAgentPayload aus diesem Modul beziehen.
export { appendVoiceTurn, buildAgentPayload };

// SSE-Antwort der Bridge einsammeln (nur sichtbarer content, kein reasoning).
// onText (optional) erhaelt nach jedem Chunk den bisherigen Gesamttext (Stufe 1c).
export async function readAgentReply(response, onText) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    for (const event of events) {
      const text = event.split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");
      if (!text || text === "[DONE]") continue;
      try {
        reply += JSON.parse(text).choices?.[0]?.delta?.content || "";
      } catch {
        reply += text;
      }
    }
    onText?.(reply);
  }
  return reply.trim();
}

// Leiste (Schreibfeld + Mikrofon + Schliessen) fix am unteren Bildschirmrand —
// wie im freigegebenen Design; Logo/Status bleiben mittig (safe-area beachtet).
const CSS = `
#voiceLandingButton { position: fixed; inset-inline-end: 20px; inset-block-end: 20px; z-index: 60;
  width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;
  background: #101013; color: #6fe3da; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.28); }
#voiceLandingButton:hover { background: #1c1c22; }
#voiceLandingButton svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
#voiceLandingOverlay { position: fixed; inset: 0; z-index: 70; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 18px;
  padding: 24px 24px calc(150px + env(safe-area-inset-bottom, 0px));
  background: rgba(10, 10, 14, 0.94); backdrop-filter: blur(10px); color: #f2f2ef;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif; }
#voiceLandingOverlay[hidden] { display: none; }
.voice-landing-logo svg { width: 130px; height: 96px; }
.voice-landing-logo path { fill: none; stroke: #6fe3da; stroke-width: 22; stroke-linecap: round; stroke-linejoin: round; }
.voice-landing-logo circle { fill: #16544f; }
#voiceLandingOverlay[data-mode="listening"] .voice-landing-logo,
#voiceLandingOverlay[data-mode="speaking"] .voice-landing-logo { animation: voice-landing-pulse 1.6s ease-in-out infinite; }
@keyframes voice-landing-pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.06); opacity: 0.82; } }
#voiceLandingStatus { font-size: 19px; font-weight: 600; margin: 0; }
#voiceLandingTranscript { min-height: 26px; max-width: 640px; text-align: center; color: #b9b9b2; margin: 0; }
.voice-landing-hint { position: fixed; inset-inline: 0; margin-inline: auto;
  bottom: calc(88px + env(safe-area-inset-bottom, 0px));
  font-size: 13.5px; color: #8b8b84; text-align: center; max-width: 560px; }
.voice-landing-bar { position: fixed; inset-inline: 0; margin-inline: auto;
  bottom: calc(18px + env(safe-area-inset-bottom, 0px));
  display: flex; gap: 10px; align-items: center; width: min(640px, 92vw); }
.voice-landing-input-wrap { flex: 1; display: flex; align-items: center; gap: 6px;
  border-radius: 999px; border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.06); padding: 4px 5px 4px 18px; }
#voiceLandingInput { flex: 1; min-width: 0; border: none; background: transparent;
  color: #f2f2ef; padding: 8px 0; font-size: 15px; outline: none; }
#voiceLandingInput::placeholder { color: #8b8b84; }
#voiceLandingSend { width: 36px; height: 36px; border-radius: 50%; border: none; cursor: pointer; flex: none;
  background: transparent; color: #f2f2ef; display: flex; align-items: center; justify-content: center; }
#voiceLandingSend:hover { background: transparent; color: #ffffff; }
#voiceLandingSend:disabled { background: transparent; color: rgba(242, 242, 239, 0.35); cursor: default; }
#voiceLandingSend svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; }
#voiceLandingMic { width: 46px; height: 46px; border-radius: 50%; border: 1px solid rgba(255, 255, 255, 0.16); cursor: pointer;
  background: rgba(255, 255, 255, 0.06); color: #f2f2ef; display: flex; align-items: center; justify-content: center; flex: none; }
#voiceLandingMic:hover { background: rgba(255, 255, 255, 0.12); }
#voiceLandingOverlay[data-mode="listening"] #voiceLandingMic { color: #6fe3da; border-color: rgba(111, 227, 218, 0.6); }
#voiceLandingMic svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
#voiceLandingClose { width: 46px; height: 46px; border-radius: 50%; border: none; cursor: pointer;
  background: #ecece7; color: #101013; display: flex; align-items: center; justify-content: center; flex: none; }
#voiceLandingClose svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; }
`;

const state = {
  active: false,
  fallback: false,
  failStreak: 0,
  listenStartedAt: 0,
  unlocked: false,
  recognition: null,
  bargeRecognition: null,
  bargeConfirmed: false,
  requestId: 0,
  speechQueue: null,
  interrupt: null,
  // Gespraechsgedaechtnis der laufenden Sprach-Sitzung (siehe appendVoiceTurn).
  // Beginnt mit jedem Oeffnen des Overlays neu: eine Sprach-Sitzung ist ein
  // eigenes Gespraech, kein Anhang an den getippten Chat.
  verlauf: []
};

// Mikrofonpegel-Ueberwachung beenden (Vorlese-Ende, Schliessen, vor Zuhoeren).
function stopInterrupt() {
  state.interrupt?.stop();
  state.interrupt = null;
}

// Haelt den Aktiv-Zustand des Sende-Buttons aktuell (gesetzt in buildUi).
let syncTypedSend = () => {};

const lang = pageLang();
const T = stringsFor(lang);
// Stufe 3: dieselbe erkannte Frage nicht zweimal senden (onresult UND onend liefern).
const doppelschutz = createDoppelschutz();
// Stufe 4: Server-Ohr (Groq Whisper ueber die Bridge) — fail-safe, siehe voice-ear.js.
const serverEar = createServerEar({ url: CLIENT_ROUTES.api.voiceTranscribe });
const earSend = createEarSend({
  ear: serverEar,
  istAktiv: () => state.active && !state.fallback,
  zeigeDenken: () => setStatus("thinking", T.thinking),
  zeigeTranskript: (text) => setTranscript(text),
  sollNachfragenFn: sollNachfragen,
  nachfragen: () => nachfragenStattSenden(),
  senden: (task) => sendTask(task)
});
const SPEECH_LANG = speechLangFor(lang);
const RecognitionCtor = typeof window !== "undefined"
  ? (window.SpeechRecognition || window.webkitSpeechRecognition || null)
  : null;

const $id = (id) => document.getElementById(id);
const setStatus = (mode, text) => {
  const overlay = $id("voiceLandingOverlay");
  if (overlay) overlay.dataset.mode = mode;
  const status = $id("voiceLandingStatus");
  if (status) status.textContent = text;
};
const setTranscript = (text) => {
  const node = $id("voiceLandingTranscript");
  if (node) node.textContent = text;
};

function pickVoice() {
  const voices = window.speechSynthesis.getVoices() || [];
  return voices.find((voice) => voice.lang === SPEECH_LANG)
    || voices.find((voice) => (voice.lang || "").startsWith(lang))
    || null;
}

// Stufe B: Premium-Stimme des Servers (WebAudio) — Verfuegbarkeit wird beim
// Oeffnen geprueft; jeder Fehler faellt lautlos auf die Browser-Stimme zurueck.
const premiumVoice = createPremiumVoice({
  statusUrl: CLIENT_ROUTES.api.voiceStatus,
  ttsUrl: CLIENT_ROUTES.api.voiceTts,
  lang
});
let premiumVoiceOn = false;

function speak(text, { onstart, onend } = {}) {
  if (state.active && premiumVoiceOn && text) {
    premiumVoice.speak(text, { onstart, onend }).catch(() => {
      premiumVoiceOn = false; // Worker weg -> Rest der Sitzung Browser-Stimme
      speakWithBrowser(text, { onstart, onend });
    });
    return;
  }
  speakWithBrowser(text, { onstart, onend });
}

function speakWithBrowser(text, { onstart, onend } = {}) {
  if (!("speechSynthesis" in window) || !text) {
    onend?.();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = SPEECH_LANG;
  const voice = pickVoice();
  if (voice) utterance.voice = voice;
  utterance.onstart = () => onstart?.();
  utterance.onend = () => onend?.();
  utterance.onerror = () => onend?.();
  window.speechSynthesis.speak(utterance);
  try {
    window.speechSynthesis.resume(); // Safari-Suspend-Bug
  } catch {
    // resume ist nur fuer Safari noetig.
  }
}

function stopSpeaking() {
  // Auch die satzweise Vorlese-Queue abbrechen (Barge-in, Schliessen, neue Frage).
  state.speechQueue?.cancel();
  state.speechQueue = null;
  premiumVoice.cancel();
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

// iOS/Safari: TTS einmal innerhalb der Klick-Geste freischalten (leise Utterance).
function unlockSpeechSynthesis() {
  if (state.unlocked || !("speechSynthesis" in window)) return;
  state.unlocked = true;
  try {
    const utterance = new SpeechSynthesisUtterance(" ");
    utterance.volume = 0;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Unlock ist optional (Chrome/Edge brauchen ihn nicht).
  }
}

function enterFallback(message) {
  serverEar.cancel();
  state.fallback = true;
  stopInterrupt();
  stopBargeListener();
  try {
    state.recognition?.abort?.();
  } catch {
    // Recognition war bereits gestoppt.
  }
  state.recognition = null;
  setStatus("muted", message || T.typeHint);
  $id("voiceLandingInput")?.focus();
}

// --- Barge-in (Port aus composer-tools.js, inkl. Restart-Bremse) --------------

function stopBargeListener() {
  const recognition = state.bargeRecognition;
  state.bargeRecognition = null;
  state.bargeConfirmed = false;
  try {
    recognition?.abort?.();
  } catch {
    // Recognition war bereits gestoppt.
  }
}

function startBargeListener(spokenText, failStreak = 0) {
  if (!RecognitionCtor || !state.active || state.fallback) return;
  stopBargeListener();
  const recognition = new RecognitionCtor();
  recognition.lang = SPEECH_LANG;
  recognition.continuous = true;
  recognition.interimResults = true;
  state.bargeRecognition = recognition;
  const startedAt = Date.now();
  let finalTranscript = "";
  recognition.onresult = (event) => {
    if (state.bargeRecognition !== recognition) return;
    let interim = "";
    let sawFinal = false;
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result.isFinal) {
        finalTranscript += result[0]?.transcript || "";
        sawFinal = true;
      } else {
        interim += result[0]?.transcript || "";
      }
    }
    const heard = `${finalTranscript} ${interim}`.trim();
    if (!state.bargeConfirmed) {
      if (!enoughForBarge(heard, lang)) return;
      // spokenText darf ein Getter sein (Stufe 1c: waechst satzweise mit).
      if (isLikelyEcho(heard, typeof spokenText === "function" ? spokenText() : spokenText)) return;
      state.bargeConfirmed = true;
      stopSpeaking();
      setStatus("listening", T.listening);
    }
    setTranscript(heard);
    if (sawFinal) {
      try {
        recognition.stop();
      } catch {
        // Recognition war bereits gestoppt.
      }
    }
  };
  recognition.onerror = () => {
    // Barge-in ist optional — Fehler duerfen den Loop nicht stoeren.
  };
  recognition.onend = () => {
    if (state.bargeRecognition !== recognition) return;
    state.bargeRecognition = null;
    if (!state.active || state.fallback) {
      state.bargeConfirmed = false;
      return;
    }
    if (state.bargeConfirmed) {
      state.bargeConfirmed = false;
      const task = finalTranscript.trim();
      if (task) {
        sendTask(task);
        return;
      }
      listen();
      return;
    }
    // Stufe 1c: In den kurzen Pausen zwischen zwei Saetzen ist speechSynthesis
    // kurz still — die aktive Queue haelt den Barge-Listener trotzdem am Leben.
    const queueActive = state.speechQueue?.isActive?.() === true;
    if ((!("speechSynthesis" in window) || !window.speechSynthesis.speaking) && !queueActive) return;
    const nextStreak = Date.now() - startedAt < 1500 ? failStreak + 1 : 0;
    if (nextStreak >= 3) return;
    startBargeListener(spokenText, nextStreak);
  };
  try {
    recognition.start();
  } catch {
    state.bargeRecognition = null; // z. B. iOS: kein paralleles Hoeren.
  }
}

// --- Zuhoeren -> Senden -> Vorlesen -------------------------------------------

// Stufe 3: Rueckfrage statt Blindantwort — ein fast sicher verhoertes Transkript
// geht NICHT an den Server; die Seite sagt hoerbar Bescheid und hoert weiter zu.
function nachfragenStattSenden() {
  const aktive = state.recognition;
  state.recognition = null;
  try {
    aktive?.abort?.();
  } catch {
    // Recognition war bereits gestoppt.
  }
  setStatus("speaking", T.speaking);
  speak(clarifyLine(lang), {
    onend: () => {
      if (state.active && !state.fallback) listen();
    }
  });
}

function listen() {
  if (!state.active || state.fallback) return;
  // Mikrofon fuer die Erkennung freigeben (Pegel-Detektor und Barge-Listener
  // duerfen nicht parallel laufen, sonst scheitert recognition.start() mobil).
  stopInterrupt();
  stopBargeListener();
  setStatus("listening", T.listening);
  setTranscript("");
  const recognition = new RecognitionCtor();
  recognition.lang = SPEECH_LANG;
  recognition.continuous = false;
  recognition.interimResults = true;
  state.recognition = recognition;
  let finalTranscript = "";
  // Stufe 3: beste Konfidenz der finalen Ergebnisse (NaN = Browser liefert keine).
  let bestConfidence = NaN;
  // Stufe 2a: Kommen bei vorhandenem Text ~850 ms keine neuen Zwischen-
  // ergebnisse, das Erkennungs-Ende sofort erzwingen (stop -> finales Ergebnis)
  // statt die 1-2 s Browser-Endpause abzuwarten.
  const watchdog = createSilenceWatchdog(() => {
    if (state.recognition !== recognition) return;
    try {
      recognition.stop();
    } catch {
      // Recognition war bereits gestoppt.
    }
  });
  recognition.onresult = (event) => {
    let interim = "";
    let sawFinal = false;
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result.isFinal) {
        finalTranscript += result[0]?.transcript || "";
        sawFinal = true;
        const c = result[0]?.confidence;
        if (Number.isFinite(c)) bestConfidence = Number.isFinite(bestConfidence) ? Math.max(bestConfidence, c) : c;
      } else {
        interim += result[0]?.transcript || "";
      }
    }
    const heard = (finalTranscript + interim).trim();
    setTranscript(heard);
    // Stufe 3a: den TEXT uebergeben statt nur "da ist etwas". Der Waechter
    // wartet dadurch kurz nach einem fertigen Satz und laenger nach einem
    // Bindewort — statt immer starre 850 ms (voice-endpoint.js: idleFor).
    watchdog.update(heard);
    // Stufe 1e: Beim finalen Ergebnis SOFORT senden statt auf onend zu warten —
    // sendTask loest die Erkennung selbst ab (Identitaets-Guard in onend).
    const task = finalTranscript.trim();
    if (sawFinal && task && state.recognition === recognition) {
      watchdog.stop();
      state.failStreak = 0;
      // Laufende Erkennung abloesen — earSend wartet aufs Server-Ohr.
      state.recognition = null;
      try { recognition.abort(); } catch { /* bereits gestoppt */ }
      earSend(task, bestConfidence);
    }
  };
  recognition.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      enterFallback(T.micDenied);
    }
  };
  recognition.onend = () => {
    watchdog.stop();
    // Nach abort() (z. B. getippte Frage) feuert onend trotzdem — nur die noch
    // aktive Erkennung darf den Loop fortsetzen, sonst hoert sie parallel zum
    // Vorlesen weiter und nimmt das eigene Echo als Frage auf.
    if (state.recognition !== recognition) return;
    state.recognition = null;
    if (!state.active || state.fallback) return;
    const task = finalTranscript.trim();
    if (task) {
      state.failStreak = 0;
      earSend(task, bestConfidence);
      return;
    }
    if (Date.now() - state.listenStartedAt < 1500) {
      state.failStreak += 1;
      if (state.failStreak >= 3) {
        enterFallback(T.typeHint);
        return;
      }
    } else {
      state.failStreak = 0;
    }
    listen();
  };
  state.listenStartedAt = Date.now();
  try {
    recognition.start();
    serverEar.start(); // Stufe 4: parallel aufnehmen (leise, fail-safe)
  } catch {
    enterFallback(T.typeHint);
  }
}

async function sendTask(task, { getippt = false } = {}) {
  if (!state.active) return;
  // Stufe 3: erkannte Duplikate nicht doppelt senden (onresult UND onend
  // koennen dieselbe Aeusserung liefern). Getippte Fragen sind Absicht.
  if (!getippt && doppelschutz.blockiert(task)) {
    stopBargeListener();
    const doppelt = state.recognition;
    state.recognition = null;
    try {
      doppelt?.abort?.();
    } catch {
      // Recognition war bereits gestoppt.
    }
    listen();
    return;
  }
  stopBargeListener();
  // Laufende Erkennung abloesen (abort -> onend wird durch den Guard ignoriert).
  const active = state.recognition;
  state.recognition = null;
  try {
    active?.abort?.();
  } catch {
    // Recognition war bereits gestoppt.
  }
  const requestId = state.requestId + 1;
  state.requestId = requestId;
  setStatus("thinking", T.thinking);
  setTranscript(task);
  // Stufe 1c: satzweises Vorlesen — die Ausgabe beginnt mit dem ersten fertigen
  // Satz, waehrend der Rest der Antwort noch streamt (voice-speech-queue.js).
  stopSpeaking();
  // Stufe 3a: Der Denk-Laut wird weiter unten scharf gemacht. Er muss hier
  // bereits deklariert sein, weil onQueueStart ihn entschaerft — und
  // onQueueStart kann feuern, bevor die Zuweisung durchgelaufen ist.
  let cue = null;
  const queue = createSpeechQueue({
    speakFn: speak,
    stopFn: () => { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); },
    eagerFirst: true,
    onQueueStart: () => {
      if (!state.active || state.requestId !== requestId) return;
      // Ab hier ist wirklich Ton zu hoeren — der Denk-Laut wird nicht mehr
      // gebraucht und darf auf keinen Fall noch dazwischenreden.
      cue?.disarm();
      setStatus("speaking", T.speaking);
      // Echo-Filter vergleicht live gegen alles bereits Gesprochene (Getter).
      startBargeListener(() => queue.spokenText());
      // Stufe 1e: Mikrofonpegel-Detektor stoppt das Vorlesen sofort, wenn der
      // Nutzer dazwischenspricht — auch dort, wo keine parallele Erkennung laeuft.
      stopInterrupt();
      // Stufe 2a: Zwei-Ebenen-Ausloeser — in den Sprechpausen zwischen zwei
      // Saetzen ist der Lautsprecher still, dort reicht normales Sprechen.
      state.interrupt = createSpeechInterrupt(() => {
        if (!state.active || state.fallback || state.requestId !== requestId) return;
        if (state.bargeConfirmed) return; // Wort-Barge-in hat schon uebernommen.
        stopSpeaking();
        listen();
      }, { isTtsActive: () => premiumVoice.isSpeaking() || (("speechSynthesis" in window) && window.speechSynthesis.speaking === true) });
    },
    onQueueEnd: () => {
      if (!state.active || state.requestId !== requestId) return;
      stopInterrupt();
      if (state.bargeConfirmed) return; // Barge-Listener uebernimmt.
      stopBargeListener();
      if (state.fallback) {
        setStatus("muted", T.typeHint);
        return;
      }
      // Sperrfrist gegen das eigene Echo am Satzende (wie composer-tools.js).
      setTimeout(() => {
        if (state.active && !state.fallback && !state.bargeConfirmed) listen();
      }, 450);
    }
  });
  state.speechQueue = queue;
  // Stufe 3a: Braucht die Antwort laenger als 700 ms, sagt die Sprachwelle
  // hoerbar Bescheid statt zu schweigen — dieselbe Zeile, die oben schon im
  // Status steht, in allen 14 Sprachen bereits uebersetzt. Ist der Server
  // schnell, wird der Laut nie gesprochen (disarm in onQueueStart).
  cue = createThinkingCue({
    delayMs: 700,
    antwortLaeuft: () => queue.isCancelled() || queue.spokenText().length > 0,
    sagen: () => {
      if (!state.active || state.requestId !== requestId) return;
      queue.sayAhead(T.thinking);
    }
  });
  cue.arm();
  let reply = "";
  let streamed = "";
  try {
    // Stufe A2: Bei stummer/ausgefallener Replika sofort neu versuchen.
    // Der Reserve-Endpunkt bekommt seine eigene Anfrageform: sein Stand kennt
    // `history` in /api/agent nicht und wuerde den Verlauf wegwerfen
    // (buildReserveChatRequest in chat-history-context.js erklaert die Messung).
    const nutzlast = buildAgentPayload(task, lang, state.verlauf);
    const response = await fetchStreamWithRetry([
      { url: CLIENT_ROUTES.api.agent, body: JSON.stringify(nutzlast) },
      { url: CLIENT_ROUTES.api.chatFallback, body: JSON.stringify(buildReserveChatRequest(nutzlast)) }
    ], {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bridgeAuthHeaders() },
      body: JSON.stringify(nutzlast)
    });
    if (response.ok && response.body) {
      reply = await readAgentReply(response, (partial) => {
        streamed = partial;
        if (state.active && state.requestId === requestId) queue.push(partial);
      });
    }
  } catch {
    reply = "";
  }
  // Stufe 3a: Ab hier ist die Antwort da (oder ausgeblieben). In BEIDEN Faellen
  // darf der Denk-Laut nicht mehr feuern — sonst spricht die Sprachwelle
  // "Einen Moment ..." in eine bereits laufende Antwort oder ins Zuhoeren hinein.
  cue.disarm();
  if (!state.active || state.requestId !== requestId) {
    queue.cancel();
    return;
  }
  if (!reply) {
    queue.cancel();
    if (state.fallback) {
      setStatus("muted", T.error);
      return;
    }
    setStatus("listening", T.noAnswer);
    listen();
    return;
  }
  // Wendung erst JETZT merken: nur eine wirklich gelieferte Antwort gehoert in
  // den Verlauf. Waere sie oben schon eingetragen, truege ein abgebrochener
  // oder verworfener Durchlauf eine Antwort ein, die nie gesprochen wurde.
  state.verlauf = appendVoiceTurn(appendVoiceTurn(state.verlauf, "user", task), "assistant", streamed || reply);
  // Stream fertig: Rest in die Queue (gleiche, ungetrimmte Textbasis wie push),
  // onQueueEnd schliesst den Loop ab.
  queue.flush(streamed || reply);
}

// --- Overlay / Einstieg ---------------------------------------------------------

function closeOverlay() {
  serverEar.cancel();
  state.active = false;
  state.fallback = false;
  state.failStreak = 0;
  state.requestId += 1;
  stopInterrupt();
  stopBargeListener();
  try {
    state.recognition?.abort?.();
  } catch {
    // Recognition war bereits gestoppt.
  }
  state.recognition = null;
  stopSpeaking();
  const overlay = $id("voiceLandingOverlay");
  if (overlay) overlay.hidden = true;
}

function openOverlay() {
  const overlay = $id("voiceLandingOverlay");
  if (!overlay || !("speechSynthesis" in window)) return;
  state.active = true;
  state.fallback = false;
  state.failStreak = 0;
  state.verlauf = [];
  // Stufe 1e: Verbindung zum Antwort-Server schon jetzt aufbauen —
  // die erste Antwort startet dadurch spuerbar frueher.
  warmUpAgentConnection();
  unlockSpeechSynthesis();
  // Stufe B: Premium-Stimme pruefen (laeuft der Server-TTS-Worker?) — asynchron,
  // bis dahin und bei jedem Fehler gilt unveraendert die Browser-Stimme.
  premiumVoiceOn = false;
  premiumVoice.isAvailable().then((up) => {
    if (state.active) premiumVoiceOn = up === true;
  }).catch(() => {});
  const input = $id("voiceLandingInput");
  if (input) input.value = "";
  syncTypedSend();
  overlay.hidden = false;
  if (!RecognitionCtor) {
    enterFallback(T.typeHint);
    return;
  }
  listen();
}

// Mikrofon-Button in der unteren Leiste: Tipp-Fallback verlassen und wieder
// zuhoeren (gleiche Klick-Geste schaltet TTS frei, wie beim Oeffnen).
function restartListening() {
  if (!state.active) return;
  unlockSpeechSynthesis();
  stopSpeaking();
  if (!RecognitionCtor) {
    enterFallback(T.micDenied);
    return;
  }
  state.fallback = false;
  state.failStreak = 0;
  listen();
}

function buildUi() {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const button = document.createElement("button");
  button.id = "voiceLandingButton";
  button.type = "button";
  button.setAttribute("aria-label", T.open);
  button.title = T.open;
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>';
  document.body.appendChild(button);

  const overlay = document.createElement("div");
  overlay.id = "voiceLandingOverlay";
  overlay.hidden = true;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", T.open);
  overlay.innerHTML = '<div class="voice-landing-logo" aria-hidden="true"><svg viewBox="0 0 220 160">'
    + '<path d="M82 30 L38 80 L82 130"/><circle cx="106" cy="63" r="11"/>'
    + '<path d="M138 30 L182 80 L138 130"/><circle cx="114" cy="97" r="11"/>'
    + '</svg></div>'
    + '<p id="voiceLandingStatus"></p>'
    + '<p id="voiceLandingTranscript" aria-live="polite"></p>'
    + `<p class="voice-landing-hint">${T.typeHint}</p>`
    + '<div class="voice-landing-bar">'
    + '<div class="voice-landing-input-wrap">'
    + `<input id="voiceLandingInput" type="text" autocomplete="off" placeholder="${T.placeholder}">`
    + `<button id="voiceLandingSend" type="button" aria-label="${T.send}" title="${T.send}" disabled>${SEND_ICON_SVG}</button>`
    + '</div>'
    + `<button id="voiceLandingMic" type="button" aria-label="${T.open}" title="${T.open}">`
    + '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>'
    + "</button>"
    + `<button id="voiceLandingClose" type="button" aria-label="${T.close}" title="${T.close}">`
    + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
    + "</button></div>";
  document.body.appendChild(overlay);

  button.addEventListener("click", openOverlay);
  $id("voiceLandingClose").addEventListener("click", closeOverlay);
  $id("voiceLandingMic").addEventListener("click", restartListening);
  // Enter und Sende-Button (Pfeil nach oben, wie ChatGPT) senden identisch;
  // sendTask loest die laufende Erkennung selbst ab (Guard gegen onend-Race).
  syncTypedSend = bindTypedSend({
    input: $id("voiceLandingInput"),
    send: $id("voiceLandingSend"),
    onSubmit: (task) => {
      stopSpeaking();
      sendTask(task, { getippt: true });
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.active) closeOverlay();
  });
  if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
}

export function initVoiceLanding() {
  if (typeof document === "undefined") return;
  // Nur auf Landingpages ohne App-Composer aktiv werden (Doppel-Systeme vermeiden).
  if (document.querySelector("#startSend") || $id("voiceLandingButton") || $id("voiceLandingSignIn")) return;
  // Die 15 Sprachseiten sind seit dem 2026-08-04 oeffentlich (auth-gate.js
  // laesst sie durch), damit Suchbesucher den Inhalt ueberhaupt sehen. Der
  // Sprachmodus dahinter ruft aber den Modell-Router und die Sprach-Server —
  // also kostenpflichtige Routen. Fuer Abgemeldete steht deshalb ein
  // Anmelde-Knopf statt der Bedienung: Inhalt oeffentlich, Interaktion nicht.
  if (!darfSprechen()) { buildLoginCta(T); return; }
  if (!("speechSynthesis" in window)) return;
  buildUi();
}

if (typeof document !== "undefined" && document.body) {
  initVoiceLanding();
} else if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", initVoiceLanding);
}
