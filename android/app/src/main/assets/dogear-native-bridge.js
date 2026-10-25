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
 * 1.1.0 (voice-quality program, R2): the shim now SERIALIZES
 * speech the way Chrome does — one utterance dispatched to the
 * QUEUE_FLUSH native service at a time, the rest queued here —
 * and carries a per-utterance stall guard (re-dispatch once,
 * then a logged transport defect via DogEarBridge.defects()).
 * Before this, back-to-back speaks flushed each other
 * mid-sentence and the shim's single `current` discarded the
 * other pieces' lifecycle events entirely. Tests N13–N15.
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
  var current = null; // { id, utt, text, rate, lang, started, retried }
  var queue = [];     // utterances waiting behind `current` (beta.6)
  /* 1.1.0 hardening (F-B5-2): the last naturally-retired utterance
     and whether it was the document's final chunk. The service
     RETAINS a finished chunk as its held chunk, so a resume that
     lands in the boundary gap re-sounds THIS utterance — its
     'start' re-adopts the record below so the eventual 'end'
     still advances the engine; and a cancel that follows the
     final chunk's retirement is the engine's completion stopAll,
     routed to the core through the explicit stop door (see
     cancel()). */
  var lastRetired = null;
  var lastRetireWasFinal = false;
  var defects = [];   // transport stalls that never recovered (beta.6)
  var stallTimer = null;
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

  /* ------- beta.6: queue serialization + utterance stall guard ---
     WHY: the native SpeechService speaks QUEUE_FLUSH with one
     current slot, while Chrome's speechSynthesis QUEUES. A
     caller that speaks several utterances back-to-back (the old
     answer speaker did exactly that) had each piece flush the
     one before it — speech cut mid-sentence, and the shim's
     single `current` discarded the other pieces' lifecycle
     events, so nothing could even account for the loss. The
     shim now serializes the way Chrome does: one utterance is
     dispatched to the service at a time; the rest wait here,
     and lifecycle events reconcile 1:1 with utterances.

     The stall guard is the transport half of gate finding
     F-B5-2 (an utterance that starts — or is dispatched — and
     never sounds again): a dispatched utterance that produces
     neither start/end/error inside its window is re-dispatched
     ONCE (native stop + the same id/text); a second window of
     silence declares it stalled — the defect is logged in
     `defects` and the utterance's error fires, so its consumer
     recovers instead of waiting forever. While the transport
     is paused the window simply re-arms: paused speech is
     suspended, not stalled. The estimator mirrors
     speaker.js's (same floor/cap/margin, deliberately
     duplicated — this file must stand alone in the shell). */
  function stallWindowFor(rec) {
    var est = (String(rec.text || '').length / (9 * (rec.rate || 1))) * 1000;
    /* +6 s of slack over the speaker's identical estimator
       (device-proven race, 1.1.0 exercise ASK1): when the
       completing speaker drives an utterance it owns the
       first recovery — if this guard's window equals the
       speaker's, both fire together and the guard's
       re-dispatch collides with the speaker's cancel/re-speak.
       The guard is the READER path's watchdog (reader-core has
       no completion watchdog of its own); for speaker-driven
       utterances it is the backstop, and a backstop fires
       second. */
    return Math.min(66000, Math.max(4000, est + 2500 + 6000));
  }
  function armStall(rec) {
    disarmStall();
    try {
      stallTimer = setTimeout(function () { onStallWindow(rec); },
        stallWindowFor(rec));
    } catch (e) { stallTimer = null; }
  }
  function disarmStall() {
    if (stallTimer !== null) {
      try { clearTimeout(stallTimer); } catch (e) {}
      stallTimer = null;
    }
  }
  function onStallWindow(rec) {
    stallTimer = null;
    if (!current || current.id !== rec.id) return;
    if (pausedFlag) { armStall(rec); return; }
    if (!rec.retried) {
      rec.retried = true;
      try { NATIVE.stopPlayback(); } catch (e) {}
      try { NATIVE.speak(rec.id, rec.text, rec.rate, rec.lang); }
      catch (e) { declareStalled(rec); return; }
      armStall(rec);
      return;
    }
    declareStalled(rec);
  }
  function declareStalled(rec) {
    defects.push({
      kind: 'utterance-stalled',
      id: rec.id,
      chars: String(rec.text || '').length,
      at: Date.now(),
    });
    try {
      console.warn('DogEar bridge: utterance ' + rec.id + ' stalled (' +
        String(rec.text || '').length + ' chars, re-dispatch failed)');
    } catch (e) {}
    if (current && current.id === rec.id) {
      var r = current; current = null; pausedFlag = false;
      lastRetired = r;
      lastRetireWasFinal = (typeof r.i === 'number' &&
        typeof r.n === 'number' && r.n > 0 && r.i === r.n - 1);
      fireError(r);
      pumpQueue();
    }
  }
  function dispatch(rec) {
    lastRetired = null;
    lastRetireWasFinal = false;
    current = rec;
    pausedFlag = false;
    reportPlace(rec);
    try { NATIVE.speak(rec.id, rec.text, rec.rate, rec.lang); }
    catch (e) {
      current = null;
      fireError(rec);
      pumpQueue();
      return;
    }
    armStall(rec);
  }
  function pumpQueue() {
    if (current || !queue.length) return;
    dispatch(queue.shift());
  }

  /* The engine writes its place record ({i, n}) BEFORE speaking a
   * chunk (reader-core savePos runs at the head of its speak()), so
   * at shim-speak time the record names the chunk being spoken.
   * Report it to the core: native position truth, no engine change. */
  function reportPlace(forRec) {
    if (!sessionPlaceKey || typeof NATIVE.noteChunk !== 'function') return;
    try {
      var raw = null;
      try { raw = localStorage.getItem(sessionPlaceKey); } catch (e) {}
      if (!raw) return;
      var rec = JSON.parse(raw);
      if (rec && typeof rec.i === 'number') {
        // Stamp the utterance record with the chunk it carries:
        // the completion door keys on it (1.1.0). ONLY when the
        // record is fresh — the engine writes it in the same
        // synchronous stack as its speak(), so a fresh record
        // names THIS utterance; a stale one belongs to an older
        // reader chunk and must not stamp an answer utterance
        // that happens to dispatch later.
        if (forRec && typeof rec.t === 'number' &&
            Math.abs(Date.now() - rec.t) <= 250) {
          forRec.i = rec.i;
          forRec.n = typeof rec.n === 'number' ? rec.n : 0;
        }
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
        retried: false,
      };
      /* Chrome queues; the native service flushes. Serialize
         here so the two semantics meet (beta.6, Cause C). */
      if (current) { queue.push(rec); return; }
      dispatch(rec);
    },
    cancel: function () {
      queue.length = 0;
      disarmStall();
      current = null;
      pausedFlag = false;
      lastRetired = null;
      /* Completion door (1.1.0): reader-core signals a finished
         document ONLY by retiring its final chunk and then
         cancelling (stopAll(true)). That cancel — and no other —
         is a session end, so it reaches the core through the
         explicit stop verb; every other cancel is a routine
         engine reset and stays voice-only (the bridge's
         stopPlayback no longer enters the core at all). */
      if (lastRetireWasFinal) {
        lastRetireWasFinal = false;
        try { NATIVE.playerCommand('stop'); } catch (e) {}
      }
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
    pending: { get: function () {
      return !!((current && !current.started) || queue.length);
    } },
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
      else if (!current && lastRetired && ev.id === lastRetired.id) {
        /* Re-adoption (1.1.0): the service re-sounded its held
           chunk for a boundary resume. The record lives again so
           this utterance's end advances the engine exactly once. */
        current = lastRetired;
        lastRetired = null;
        lastRetireWasFinal = false;
        current.started = true;
        current.retried = false;
        armStall(current);
      }
    } else if (ev.t === 'end') {
      if (current && ev.id === current.id) {
        var r = current; current = null; pausedFlag = false;
        lastRetired = r;
        lastRetireWasFinal = (typeof r.i === 'number' &&
          typeof r.n === 'number' && r.n > 0 && r.i === r.n - 1);
        disarmStall(); fireEnd(r); pumpQueue();
      }
    } else if (ev.t === 'error') {
      if (current && ev.id === current.id) {
        var r2 = current; current = null; pausedFlag = false;
        lastRetired = r2;
        lastRetireWasFinal = (typeof r2.i === 'number' &&
          typeof r2.n === 'number' && r2.n > 0 && r2.i === r2.n - 1);
        disarmStall(); fireError(r2); pumpQueue();
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
    disarmStall();
    try { NATIVE.skipCurrent(); } catch (e) {}
    fireEnd(r); // the engine advances and speaks the next chunk
  }
  function skipPrev() {
    if (!current) return;
    var r = current; r.started = false; r.retried = false;
    disarmStall();
    try { NATIVE.skipCurrent(); } catch (e) {}
    try { NATIVE.speak(r.id, r.text, r.rate, r.lang); } catch (e) { fireError(r); return; }
    armStall(r);
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
    /* beta.6: the transport defect log — stalls the guard
       could not recover, each with the utterance id and size.
       A non-empty log after a session means speech was lost
       somewhere the accounting can point at. */
    defects: function () { return defects.slice(); },
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
