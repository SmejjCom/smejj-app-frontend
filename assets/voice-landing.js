// smejj.com — Sprachmodus fuer die Sprach-Landingpages (en/, fr/, es/, ...).
// Eigenstaendiges, additives Modul: schwebender Sprach-Button unten rechts oeffnet
// ein Overlay mit Zuhoeren -> Denken -> Vorlesen-Loop gegen die Chat-Bridge
// (CLIENT_ROUTES.api.agent). Free-only: Web Speech API + speechSynthesis, keine
// neuen Dienste. Bewaehrte Patterns aus assets/composer-tools.js portiert:
// Fail-Streak -> Tipp-Fallback (iOS/Safari), TTS-Unlock in der Klick-Geste,
// Barge-in mit Echo-Textfilter und Restart-Bremse. Startseite/App unberuehrt —
// das Modul initialisiert sich nur auf Seiten OHNE App-Composer (#startSend).
import { CLIENT_ROUTES } from "./config.js";

const LANG_MAP = {
  de: "de-DE", en: "en-US", fr: "fr-FR", es: "es-ES", it: "it-IT",
  pt: "pt-PT", ru: "ru-RU", tr: "tr-TR", ja: "ja-JP", ko: "ko-KR",
  zh: "zh-CN", hi: "hi-IN", ar: "ar-SA", id: "id-ID", bn: "bn-BD"
};

// Kompakte UI-Texte pro Sprache (Schluessel siehe stringsFor()).
const STRINGS = {
  de: { open: "Sprachmodus", listening: "Ich hoere zu ...", thinking: "Einen Moment ...", speaking: "Ich spreche ...", typeHint: "Frage unten eintippen — die Antwort wird vorgelesen.", placeholder: "Frage schreiben ...", micDenied: "Mikrofon nicht erlaubt — Frage unten eintippen.", noAnswer: "Keine Antwort erhalten — ich hoere weiter zu.", error: "Verbindung fehlgeschlagen — bitte erneut versuchen.", close: "Beenden" },
  en: { open: "Voice mode", listening: "I'm listening ...", thinking: "One moment ...", speaking: "I'm speaking ...", typeHint: "Type your question below — the answer will be read aloud.", placeholder: "Write a question ...", micDenied: "Microphone not allowed — type your question below.", noAnswer: "No answer received — still listening.", error: "Connection failed — please try again.", close: "Close" },
  zh: { open: "语音模式", listening: "我在听 ...", thinking: "请稍等 ...", speaking: "我在说 ...", typeHint: "在下方输入问题——回答将朗读出来。", placeholder: "输入问题 ...", micDenied: "麦克风未授权——请在下方输入问题。", noAnswer: "未收到回答——继续聆听。", error: "连接失败——请重试。", close: "关闭" },
  es: { open: "Modo de voz", listening: "Te escucho ...", thinking: "Un momento ...", speaking: "Estoy hablando ...", typeHint: "Escribe tu pregunta abajo: la respuesta se leera en voz alta.", placeholder: "Escribe una pregunta ...", micDenied: "Microfono no permitido: escribe tu pregunta abajo.", noAnswer: "Sin respuesta: sigo escuchando.", error: "Fallo de conexion: intentalo de nuevo.", close: "Cerrar" },
  ar: { open: "وضع الصوت", listening: "أنا أستمع ...", thinking: "لحظة من فضلك ...", speaking: "أنا أتحدث ...", typeHint: "اكتب سؤالك في الأسفل — سيُقرأ الجواب بصوت عالٍ.", placeholder: "اكتب سؤالاً ...", micDenied: "الميكروفون غير مسموح — اكتب سؤالك في الأسفل.", noAnswer: "لم يصل جواب — ما زلت أستمع.", error: "فشل الاتصال — حاول مرة أخرى.", close: "إغلاق" },
  fr: { open: "Mode vocal", listening: "Je vous ecoute ...", thinking: "Un instant ...", speaking: "Je parle ...", typeHint: "Ecrivez votre question ci-dessous — la reponse sera lue a voix haute.", placeholder: "Ecrire une question ...", micDenied: "Micro non autorise — ecrivez votre question ci-dessous.", noAnswer: "Pas de reponse — je continue d'ecouter.", error: "Echec de connexion — veuillez reessayer.", close: "Fermer" },
  pt: { open: "Modo de voz", listening: "Estou a ouvir ...", thinking: "Um momento ...", speaking: "Estou a falar ...", typeHint: "Escreva a sua pergunta abaixo — a resposta sera lida em voz alta.", placeholder: "Escrever uma pergunta ...", micDenied: "Microfone nao permitido — escreva a pergunta abaixo.", noAnswer: "Sem resposta — continuo a ouvir.", error: "Falha de ligacao — tente novamente.", close: "Fechar" },
  ru: { open: "Голосовой режим", listening: "Я слушаю ...", thinking: "Секунду ...", speaking: "Я говорю ...", typeHint: "Введите вопрос ниже — ответ будет озвучен.", placeholder: "Напишите вопрос ...", micDenied: "Микрофон не разрешён — введите вопрос ниже.", noAnswer: "Ответ не получен — продолжаю слушать.", error: "Ошибка соединения — попробуйте ещё раз.", close: "Закрыть" },
  tr: { open: "Ses modu", listening: "Dinliyorum ...", thinking: "Bir saniye ...", speaking: "Konusuyorum ...", typeHint: "Sorunuzu asagiya yazin — yanit sesli okunacak.", placeholder: "Bir soru yazin ...", micDenied: "Mikrofona izin yok — sorunuzu asagiya yazin.", noAnswer: "Yanit alinamadi — dinlemeye devam ediyorum.", error: "Baglanti hatasi — lutfen tekrar deneyin.", close: "Kapat" },
  ja: { open: "音声モード", listening: "聞いています ...", thinking: "少々お待ちください ...", speaking: "話しています ...", typeHint: "下に質問を入力してください——回答は読み上げられます。", placeholder: "質問を入力 ...", micDenied: "マイクが許可されていません——下に質問を入力してください。", noAnswer: "回答がありません——引き続き聞いています。", error: "接続に失敗しました——もう一度お試しください。", close: "閉じる" },
  ko: { open: "음성 모드", listening: "듣고 있어요 ...", thinking: "잠시만요 ...", speaking: "말하고 있어요 ...", typeHint: "아래에 질문을 입력하세요 — 답변을 소리 내어 읽어 드립니다.", placeholder: "질문 입력 ...", micDenied: "마이크가 허용되지 않았습니다 — 아래에 질문을 입력하세요.", noAnswer: "답변이 없습니다 — 계속 듣고 있어요.", error: "연결 실패 — 다시 시도해 주세요.", close: "닫기" },
  it: { open: "Modalita vocale", listening: "Ti ascolto ...", thinking: "Un attimo ...", speaking: "Sto parlando ...", typeHint: "Scrivi la tua domanda qui sotto: la risposta sara letta ad alta voce.", placeholder: "Scrivi una domanda ...", micDenied: "Microfono non consentito: scrivi la domanda qui sotto.", noAnswer: "Nessuna risposta: continuo ad ascoltare.", error: "Connessione non riuscita: riprova.", close: "Chiudi" },
  hi: { open: "वॉइस मोड", listening: "मैं सुन रहा हूँ ...", thinking: "एक क्षण ...", speaking: "मैं बोल रहा हूँ ...", typeHint: "नीचे अपना प्रश्न लिखें — उत्तर ज़ोर से पढ़ा जाएगा।", placeholder: "प्रश्न लिखें ...", micDenied: "माइक्रोफ़ोन की अनुमति नहीं — नीचे प्रश्न लिखें।", noAnswer: "कोई उत्तर नहीं मिला — मैं सुनता रहूँगा।", error: "कनेक्शन विफल — कृपया पुनः प्रयास करें।", close: "बंद करें" },
  id: { open: "Mode suara", listening: "Saya mendengarkan ...", thinking: "Sebentar ...", speaking: "Saya berbicara ...", typeHint: "Ketik pertanyaan Anda di bawah — jawaban akan dibacakan.", placeholder: "Tulis pertanyaan ...", micDenied: "Mikrofon tidak diizinkan — ketik pertanyaan di bawah.", noAnswer: "Tidak ada jawaban — masih mendengarkan.", error: "Koneksi gagal — silakan coba lagi.", close: "Tutup" },
  bn: { open: "ভয়েস মোড", listening: "আমি শুনছি ...", thinking: "এক মুহূর্ত ...", speaking: "আমি বলছি ...", typeHint: "নীচে আপনার প্রশ্ন লিখুন — উত্তরটি জোরে পড়ে শোনানো হবে।", placeholder: "প্রশ্ন লিখুন ...", micDenied: "মাইক্রোফোনের অনুমতি নেই — নীচে প্রশ্ন লিখুন।", noAnswer: "কোনও উত্তর আসেনি — আমি শুনছি।", error: "সংযোগ ব্যর্থ — আবার চেষ্টা করুন।", close: "বন্ধ করুন" }
};

// Sprachen ohne Leerzeichen-Wortgrenzen (Barge-in-Schwelle ueber Zeichenlaenge).
const NO_SPACE_LANGS = new Set(["zh", "ja"]);
const BARGE_MIN_WORDS = 3;
const BARGE_MIN_CHARS = 4;

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

export function normalizeSpeechText(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Echo-Heuristik (wie composer-tools.js): Gehoertes, das (nahezu) vollstaendig in
// der gerade vorgelesenen Antwort vorkommt, ist eigenes Lautsprecher-Echo.
export function isLikelyEcho(heardText, spokenText) {
  const heard = normalizeSpeechText(heardText);
  if (!heard) return true;
  const spoken = normalizeSpeechText(spokenText);
  if (spoken.includes(heard)) return true;
  const spokenWords = new Set(spoken.split(" "));
  const heardWords = heard.split(" ");
  const matches = heardWords.filter((word) => spokenWords.has(word)).length;
  return matches / heardWords.length >= 0.6;
}

// Rausch-Schutz: genug Substanz fuer eine echte Unterbrechung?
export function enoughForBarge(text, lang) {
  const normalized = normalizeSpeechText(text);
  if (NO_SPACE_LANGS.has(lang)) return normalized.replace(/\s/g, "").length >= BARGE_MIN_CHARS;
  return normalized.split(" ").filter(Boolean).length >= BARGE_MIN_WORDS;
}

export function buildAgentPayload(task, lang) {
  return { task, model: "smejj 1.0", files: [], preferences: { uiLanguage: lang } };
}

// SSE-Antwort der Bridge einsammeln (nur sichtbarer content, kein reasoning).
export async function readAgentReply(response) {
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
  }
  return reply.trim();
}

const CSS = `
#voiceLandingButton { position: fixed; inset-inline-end: 20px; inset-block-end: 20px; z-index: 60;
  width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;
  background: #101013; color: #6fe3da; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.28); }
#voiceLandingButton:hover { background: #1c1c22; }
#voiceLandingButton svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
#voiceLandingOverlay { position: fixed; inset: 0; z-index: 70; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 18px; padding: 24px;
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
.voice-landing-hint { font-size: 13.5px; color: #8b8b84; text-align: center; max-width: 560px; }
.voice-landing-bar { display: flex; gap: 10px; align-items: center; width: min(640px, 92vw); margin-top: 8px; }
#voiceLandingInput { flex: 1; border-radius: 999px; border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.06); color: #f2f2ef; padding: 12px 18px; font-size: 15px; outline: none; }
#voiceLandingInput::placeholder { color: #8b8b84; }
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
  requestId: 0
};

const lang = pageLang();
const T = stringsFor(lang);
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

function speak(text, { onstart, onend } = {}) {
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
  state.fallback = true;
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
      if (isLikelyEcho(heard, spokenText)) return;
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
    if (!("speechSynthesis" in window) || !window.speechSynthesis.speaking) return;
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

function listen() {
  if (!state.active || state.fallback) return;
  stopBargeListener();
  setStatus("listening", T.listening);
  setTranscript("");
  const recognition = new RecognitionCtor();
  recognition.lang = SPEECH_LANG;
  recognition.continuous = false;
  recognition.interimResults = true;
  state.recognition = recognition;
  let finalTranscript = "";
  recognition.onresult = (event) => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result.isFinal) finalTranscript += result[0]?.transcript || "";
      else interim += result[0]?.transcript || "";
    }
    setTranscript((finalTranscript + interim).trim());
  };
  recognition.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      enterFallback(T.micDenied);
    }
  };
  recognition.onend = () => {
    // Nach abort() (z. B. getippte Frage) feuert onend trotzdem — nur die noch
    // aktive Erkennung darf den Loop fortsetzen, sonst hoert sie parallel zum
    // Vorlesen weiter und nimmt das eigene Echo als Frage auf.
    if (state.recognition !== recognition) return;
    state.recognition = null;
    if (!state.active || state.fallback) return;
    const task = finalTranscript.trim();
    if (task) {
      state.failStreak = 0;
      sendTask(task);
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
  } catch {
    enterFallback(T.typeHint);
  }
}

async function sendTask(task) {
  if (!state.active) return;
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
  let reply = "";
  try {
    const response = await fetch(CLIENT_ROUTES.api.agent, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildAgentPayload(task, lang))
    });
    if (response.ok && response.body) reply = await readAgentReply(response);
  } catch {
    reply = "";
  }
  if (!state.active || state.requestId !== requestId) return;
  if (!reply) {
    if (state.fallback) {
      setStatus("muted", T.error);
      return;
    }
    setStatus("listening", T.noAnswer);
    listen();
    return;
  }
  setStatus("speaking", T.speaking);
  speak(reply, {
    onstart: () => startBargeListener(reply),
    onend: () => {
      if (!state.active) return;
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
}

// --- Overlay / Einstieg ---------------------------------------------------------

function closeOverlay() {
  state.active = false;
  state.fallback = false;
  state.failStreak = 0;
  state.requestId += 1;
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
  unlockSpeechSynthesis();
  const input = $id("voiceLandingInput");
  if (input) input.value = "";
  overlay.hidden = false;
  if (!RecognitionCtor) {
    enterFallback(T.typeHint);
    return;
  }
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
    + `<input id="voiceLandingInput" type="text" autocomplete="off" placeholder="${T.placeholder}">`
    + `<button id="voiceLandingClose" type="button" aria-label="${T.close}" title="${T.close}">`
    + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
    + "</button></div>";
  document.body.appendChild(overlay);

  button.addEventListener("click", openOverlay);
  $id("voiceLandingClose").addEventListener("click", closeOverlay);
  $id("voiceLandingInput").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const task = event.currentTarget.value.trim();
    if (!task) return;
    event.currentTarget.value = "";
    stopSpeaking();
    sendTask(task); // loest laufende Erkennung selbst ab (Guard gegen onend-Race)
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.active) closeOverlay();
  });
  if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
}

export function initVoiceLanding() {
  if (typeof document === "undefined") return;
  // Nur auf Landingpages ohne App-Composer aktiv werden (Doppel-Systeme vermeiden).
  if (document.querySelector("#startSend") || $id("voiceLandingButton")) return;
  if (!("speechSynthesis" in window)) return;
  buildUi();
}

if (typeof document !== "undefined" && document.body) {
  initVoiceLanding();
} else if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", initVoiceLanding);
}
