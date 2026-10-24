/* DogEar native speech bridge — the Android shell's speech transport.
 *
 * In a plain browser this file does NOTHING: no interface, no shim,
 * behaviour identical to the app without it. It activates only when
 * the Android app shell has injected window.DogEarNative (a
 * @JavascriptInterface backed by the native SpeechService, which
 * speaks with the device's own TextToSpeech engine from a foreground
 * service — so reading continues with the app minimized or the
 * screen off, the way Audible-class readers behave).
 *
 * The seam is the speech transport, not the reader: reader-core reads
 * window.speechSynthesis when a reader is created, so installing a
 * speechSynthesis-shaped shim before that point routes the pinned,
 * untouched engine's chunks to the native service. Chunking,
 * highlighting, place persistence and the speech watchdog all keep
 * working exactly as written — the engine still owns the position;
 * the service only speaks and reports utterance lifecycle back.
 *
 * Beta.5 (app-first): state moved OUT of this shim. The native
 * PlayerCore is the one state machine; this file now also
 *   - reports the session (registerReader carries the document id
 *     + the reader's place-record key) and, at every speak(), the
 *     place record the engine just wrote ({i, n}) — that record is
 *     the position truth the core persists natively;
 *   - dispatches the core's player events (state snapshots,
 *     continue, captured audio, capture errors, marks changes)
 *     from the one event channel into the app's handlers.
 * The shim's own current/pausedFlag remain ONLY as the transport's
 * local mirror for Chrome-shaped semantics (N6), never as a second
 * authority: transport commands forward to the core, which decides.
 *
 * The shell also bundles this exact file as an APK asset and injects
 * it when the served page did not load it itself (the two deliveries
 * are the same bytes; the __dogearBridgeShell flag prevents a double
 * install). Keep the copies in sync — see android/README.md.
 */
(function () {
  'use strict';

  if (window.__dogearBridgeShell) return; // already installed
  var NATIVE = window.DogEarNative;
  if (!NATIVE) return; // plain browser: nothing to do, ever

  var nextId = 1;
  var current = null; // { id, utt, text, rate, lang, started }
  var pausedFlag = false;
  var voicesChangedHandler = null;
  var voicesListeners = [];
  var sessionPlaceKey = null; // localStorage key of the reader's place record

  var fakeVoice = {
    name: 'Device voice',
    lang: String(navigator.language || 'en-US').replace('_', '-'),
    localService: true,
    default: true,
    voiceURI: 'dogear:device',
  };

  function fireEnd(rec) {
    if (rec && rec.utt && typeof rec.utt.onend === 'function') {
      try { rec.utt.onend({}); } catch (e) {}
    }
  }
  function fireError(rec) {
    if (rec && rec.utt && typeof rec.utt.onerror === 'function') {
      try { rec.utt.onerror({ error: 'synthesis-failed' }); } catch (e) {}
    }
  }

  /* The engine writes its place record ({i, n}) BEFORE speaking a
   * chunk (reader-core savePos runs at the head of its speak()), so
   * at shim-speak time the record names the chunk being spoken.
   * Report it to the core: native position truth, no engine change. */
  function reportPlace() {
    if (!sessionPlaceKey || typeof NATIVE.noteChunk !== 'function') return;
    try {
      var raw = null;
      try { raw = localStorage.getItem(sessionPlaceKey); } catch (e) {}
      if (!raw) return;
      var rec = JSON.parse(raw);
      if (rec && typeof rec.i === 'number') {
        NATIVE.noteChunk(rec.i, typeof rec.n === 'number' ? rec.n : 0);
      }
    } catch (e) {}
  }

  var shim = {
    getVoices: function () { return [fakeVoice]; },
    speak: function (utt) {
      var rec = {
        id: nextId++,
        utt: utt || {},
        text: String((utt && utt.text) || ''),
        rate: (utt && utt.rate) || 1,
        lang: (utt && utt.voice && utt.voice.lang) || fakeVoice.lang,
        started: false,
      };
      current = rec;
      pausedFlag = false;
      reportPlace();
      try { NATIVE.speak(rec.id, rec.text, rec.rate, rec.lang); }
      catch (e) { fireError(rec); }
    },
    cancel: function () {
      current = null;
      pausedFlag = false;
      try { NATIVE.stopPlayback(); } catch (e) {}
    },
    pause: function () {
      if (!current) return;
      pausedFlag = true;
      try { NATIVE.pausePlayback(); } catch (e) {}
    },
    resume: function () {
      // Chrome semantics: resume() only undoes a pause. The engine's
      // keep-alive calls resume() while playing — that must NOT
      // restart the chunk, so act only when actually paused.
      if (!current || !pausedFlag) return;
      pausedFlag = false;
      try { NATIVE.resumePlayback(); } catch (e) {}
    },
    addEventListener: function (type, fn) {
      if (type === 'voiceschanged' && typeof fn === 'function') voicesListeners.push(fn);
    },
    removeEventListener: function (type, fn) {
      if (type !== 'voiceschanged') return;
      voicesListeners = voicesListeners.filter(function (f) { return f !== fn; });
    },
  };
  Object.defineProperties(shim, {
    speaking: { get: function () { return !!current; } },
    pending: { get: function () { return !!(current && !current.started); } },
    paused: { get: function () { return pausedFlag; } },
    onvoiceschanged: {
      get: function () { return voicesChangedHandler; },
      set: function (fn) { voicesChangedHandler = (typeof fn === 'function') ? fn : null; },
    },
  });

  /* ------- native -> JS: utterance lifecycle + player events ------ */
  window.__dogearSpeechEvent = function (json) {
    var ev = null;
    try { ev = JSON.parse(json); } catch (e) { return; }
    if (!ev) return;
    if (ev.t === 'start') {
      if (current && ev.id === current.id) current.started = true;
    } else if (ev.t === 'end') {
      if (current && ev.id === current.id) {
        var r = current; current = null; pausedFlag = false; fireEnd(r);
      }
    } else if (ev.t === 'error') {
      if (current && ev.id === current.id) {
        var r2 = current; current = null; pausedFlag = false; fireError(r2);
      }
    } else if (ev.t === 'control') {
      handleControl(ev.action);
    } else if (ev.t === 'state' || ev.t === 'continue' || ev.t === 'audio' ||
               ev.t === 'audioError' || ev.t === 'marks') {
      // PlayerCore events: the app owns these (state reflection,
      // continue = open + seek, captured audio for its engine,
      // capture errors, marks re-render). Relay, never interpret.
      var app = window.DogEarApp;
      if (!app) return;
      try {
        if (ev.t === 'state' && typeof app.onPlayerState === 'function') app.onPlayerState(ev);
        else if (ev.t === 'continue' && typeof app.onContinueEvent === 'function') app.onContinueEvent(ev);
        else if (ev.t === 'audio' && typeof app.onCapturedAudio === 'function') app.onCapturedAudio(ev);
        else if (ev.t === 'audioError' && typeof app.onCaptureError === 'function') app.onCaptureError(ev);
        else if (ev.t === 'marks' && typeof app.onMarksChanged === 'function') app.onMarksChanged(ev);
      } catch (e) {}
    }
  };

  function skipNext() {
    if (!current) return;
    var r = current; current = null; pausedFlag = false;
    try { NATIVE.skipCurrent(); } catch (e) {}
    fireEnd(r); // the engine advances and speaks the next chunk
  }
  function skipPrev() {
    if (!current) return;
    var r = current; r.started = false;
    try { NATIVE.skipCurrent(); } catch (e) {}
    try { NATIVE.speak(r.id, r.text, r.rate, r.lang); } catch (e) { fireError(r); }
  }

  var reader = null;
  function handleControl(action) {
    // Controls are IDEMPOTENT, never toggles: the reader's play() is
    // a toggle, so a pause event applies only while playing and a
    // resume only while paused. A toggle echoed back by the service
    // (its own state changes, session churn, focus events) could
    // otherwise flip a correctly-playing reader to paused — seen in
    // the emulator proof, where the reader paused itself ~1 chunk
    // into every session while the service kept speaking.
    var st = null;
    if (reader && reader.getState) { try { st = reader.getState(); } catch (e) {} }
    if (action === 'pause') {
      if (reader && (st === 'playing' || st === null)) {
        try { reader.play(); } catch (e) {}
      }
    } else if (action === 'resume') {
      if (reader && st === 'paused') {
        try { reader.play(); } catch (e) {}
      }
    } else if (action === 'play') {
      // From the native bar / media session with a live session:
      // start (or resume) this reader. play() from idle starts at
      // the reader's held place; from paused it resumes.
      if (reader && st !== 'playing') {
        try { reader.play(); } catch (e) {}
      }
    } else if (action === 'playpause') {
      // Legacy event name: with state known it is the idempotent
      // form (pause if playing, resume if paused); without state
      // info it degrades to the reader's raw toggle.
      if (reader && (st === 'playing' || st === 'paused' || st === null)) {
        try { reader.play(); } catch (e) {}
      }
    } else if (action === 'stop') {
      if (reader) { try { reader.stop(); } catch (e) {} }
    } else if (action === 'next') {
      skipNext();
    } else if (action === 'prev') {
      skipPrev();
    }
  }

  window.DogEarBridge = {
    shell: true,
    registerReader: function (r, title, meta) {
      reader = r || null;
      try { NATIVE.setNowPlaying(title ? String(title) : 'DogEar'); } catch (e) {}
      // Beta.5: hand the core the session. meta = { docId, placeKey }
      // (older pages call with two args — the session report is
      // then skipped and the core simply has no document context).
      sessionPlaceKey = (meta && meta.placeKey) ? String(meta.placeKey) : null;
      if (typeof NATIVE.setSession === 'function') {
        try {
          if (r && meta && meta.docId) {
            var seedI = -1, seedN = 0;
            if (sessionPlaceKey) {
              try {
                var raw = localStorage.getItem(sessionPlaceKey);
                if (raw) {
                  var rec = JSON.parse(raw);
                  if (rec && typeof rec.i === 'number') seedI = rec.i;
                  if (rec && typeof rec.n === 'number') seedN = rec.n;
                }
              } catch (e) {}
            }
            NATIVE.setSession(String(meta.docId),
              title ? String(title) : '', seedI, seedN);
          } else if (!r && typeof NATIVE.clearSession === 'function') {
            NATIVE.clearSession();
          }
        } catch (e) {}
      }
    },
  };

  /* ------- install ------------------------------------------------- */
  var installed = false;
  try {
    Object.defineProperty(window, 'speechSynthesis', {
      value: shim, configurable: true, writable: true,
    });
    installed = (window.speechSynthesis === shim);
  } catch (e) { installed = false; }
  if (!installed) {
    // Could not take over the transport (non-configurable in this
    // WebView build): leave the page's own speech exactly as it was.
    // The app still works in the foreground; background reading is
    // simply unavailable, and nothing here pretends otherwise.
    try { console.warn('DogEar bridge: speechSynthesis is not replaceable in this WebView'); } catch (e) {}
    return;
  }
  // Some WebView builds expose a speechSynthesis object but no
  // SpeechSynthesisUtterance constructor — the reader engine builds
  // utterances with `new SpeechSynthesisUtterance(text)` and dies on
  // the constructor before speak() is ever reached (emulator proof,
  // 2026-10-22: the click produced the cancel but no speak, ever).
  // Supply the missing constructor: a plain utterance record the
  // shim's speak() already knows how to read. Native constructors
  // (Chrome, real browsers) are never touched.
  if (typeof window.SpeechSynthesisUtterance !== 'function') {
    window.SpeechSynthesisUtterance = function (text) {
      this.text = text == null ? '' : String(text);
      this.lang = '';
      this.voice = null;
      this.rate = 1;
      this.pitch = 1;
      this.volume = 1;
      this.onstart = null;
      this.onend = null;
      this.onerror = null;
      this.onpause = null;
      this.onresume = null;
      this.onmark = null;
      this.onboundary = null;
    };
  }
  window.__dogearBridgeShell = true;
  // If this script was injected after the app booted (shell fallback
  // delivery), the app's boot-time voice detection already judged the
  // WebView's bare speech API. Give it the chance to re-judge now
  // that a real voice exists behind the transport.
  if (window.DogEarApp && typeof window.DogEarApp.onBridgeInstalled === 'function') {
    try { window.DogEarApp.onBridgeInstalled(); } catch (e) {}
  }
})();
