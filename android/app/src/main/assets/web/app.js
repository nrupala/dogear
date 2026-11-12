// SPDX-FileCopyrightText: 2026 2351485 ALBERTA INC.
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/* DogEar web app shell. No accounts, no network except the one URL
   import the user explicitly asks for. Document bodies live in
   this browser's IndexedDB (chunked, on this device only); the
   document index and reading places live in localStorage. */
(function () {
  'use strict';

  var INDEX_KEY = 'dogearapp:docs:v1';
  var speechOK = ('speechSynthesis' in window);
  var voicesEmpty = false;  // settled: API present, but no usable voice
  var speechBroke = false;  // a Listen press produced no speech in time

  function $(id) { return document.getElementById(id); }

  /* ---------------- speech availability ----------------
     The defect the release gate blocked on (F-APP-2): a browser can
     expose speechSynthesis yet have NO usable voice. Playback then
     fails SILENTLY — utterances queue and never start, and the old
     warning only appeared when the API was absent entirely. Two
     app-layer defences (the engine stays untouched):
       1. Voice-availability detection — once the voice list has had
          time to settle, if it is empty, say so in BOTH views,
          before anyone presses Listen.
       2. A progression watchdog — if a Listen press produces no
          real speech (no utterance ever starts, or every utterance
          errors and the document is silently burned through), stop,
          restore the place, and show the warning. Keyed on speech
          progression, never on the speaking flag alone. */
  /* The bundled TTS pack is a voice of its own (spec item 7):
     when its files are verified on this device, a browser with
     no platform voice is NOT voiceless — the pack is precisely
     the cure for that state, and reading routes through its
     transport (openDoc / packVoiceActive). The pack's state
     lives in the voice-pack section below (ttsPack /
     ttsInstalled — hoisted vars, unset until boot creates them);
     its boot-status, download and delete paths call
     onTtsPackStateChanged so this machine re-judges live.
     Without the pack installed, every verdict in this section
     is exactly what it was before the pack existed. */
  function packHasVoice() {
    return !!(ttsPack && ttsInstalled);
  }
  function speechUsable() {
    if (packHasVoice()) return !speechBroke;
    return speechOK && !voicesEmpty && !speechBroke;
  }
  function noVoice() {
    // No speech voice exists at all: the API is absent, or it is
    // present and its voice list has settled empty — and the
    // TTS pack is not installed to speak instead. (A voice that
    // exists but failed a press is speechBroke — a different
    // state, owned by the watchdog, not by this one.)
    if (packHasVoice()) return false;
    return !speechOK || voicesEmpty;
  }
  function updateSpeechWarn() {
    var show = !speechUsable();
    var a = $('speechWarn'); if (a) a.hidden = !show;
    var b = $('speechWarnRead'); if (b) b.hidden = !show;
    refreshParaVoiceState();
  }
  /* The per-paragraph read controls in a no-voice state (Gate 28
     walk finding, 2026-11-07): the controls must not sit inert —
     they carry a visibly quiet state while no voice exists, and
     a tap answers at the control itself with the banner's words.
     The state hangs off #docBody so the rows rebuilt with every
     document inherit it, and refreshParaVoiceState runs from
     updateSpeechWarn, the one place every speech-state change
     already passes through. With a voice present nothing here
     changes anything. */
  function refreshParaVoiceState() {
    var body = $('docBody');
    if (!body) return;
    var quiet = noVoice();
    body.classList.toggle('no-voice', quiet);
    var btns = body.querySelectorAll('.para-from, .para-only');
    for (var i = 0; i < btns.length; i++) {
      if (quiet) btns[i].setAttribute('aria-disabled', 'true');
      else btns[i].removeAttribute('aria-disabled');
    }
    if (!quiet) {
      var notes = body.querySelectorAll('.para-novoice-note');
      for (var j = 0; j < notes.length; j++) {
        notes[j].parentNode.removeChild(notes[j]);
      }
    }
  }
  function noVoiceWords() {
    var b = $('speechWarnRead');
    var txt = b ? (b.textContent || '').replace(/\s+/g, ' ').trim() : '';
    return txt || 'This browser can\u2019t read aloud. It has no ' +
      'speech voice built in.';
  }
  function showParaNoVoiceNote(btn) {
    var body = $('docBody');
    if (body) {
      var old = body.querySelectorAll('.para-novoice-note');
      for (var i = 0; i < old.length; i++) {
        old[i].parentNode.removeChild(old[i]);
      }
    }
    var row = btn.parentNode;
    if (!row) return;
    var note = document.createElement('span');
    note.className = 'para-novoice-note';
    note.setAttribute('role', 'status');
    note.textContent = noVoiceWords();
    row.appendChild(note);
  }
  function initSpeechDetection() {
    if (!speechOK) { updateSpeechWarn(); return; }
    var synth = window.speechSynthesis;
    function haveVoices() {
      try { var vs = synth.getVoices(); return !!(vs && vs.length); }
      catch (e) { return false; }
    }
    if (haveVoices()) { updateSpeechWarn(); return; }
    // Voice lists commonly load asynchronously. Give the list a
    // moment to settle; if it is still empty, this browser has no
    // usable voice — say so now, not after a silent Listen. Keep
    // listening: a list that arrives late flips it back.
    var settled = false;
    try {
      synth.addEventListener('voiceschanged', function () {
        if (haveVoices()) {
          voicesEmpty = false;
          settled = true;
          updateSpeechWarn();
        }
      });
    } catch (e) {}
    setTimeout(function () {
      if (!settled && !haveVoices()) {
        voicesEmpty = true;
        updateSpeechWarn();
        // The verdict just landed: a reader opened during the
        // settle window was built on the platform transport —
        // if the pack is this browser's only voice, retarget it.
        retargetReaderTransport();
      }
    }, 1000);
  }

  /* The Android shell's speech bridge (native-bridge.js) may be
     injected after boot, when the shell falls back to its bundled
     copy: boot-time detection has then already judged the WebView's
     bare speech API (commonly voiceless). When the bridge lands, a
     real device voice exists behind the transport — clear the
     verdict and re-judge. In a plain browser this is never called. */
  window.DogEarApp = {
    onBridgeInstalled: function () {
      voicesEmpty = false;
      speechBroke = false;
      updateSpeechWarn();
      initSpeechDetection();
    },
    /* Beta.5 (app-first): the native PlayerCore's events, relayed
       by the bridge. The handlers are declared below (hoisted);
       the page reflects native state and answers native events —
       it no longer owns playback state in the shell. */
    onPlayerState: function (ev) { onPlayerState(ev); },
    onContinueEvent: function (ev) { onContinueEvent(ev); },
    onCapturedAudio: function (ev) { onCapturedAudio(ev); },
    onCaptureError: function (ev) { onCaptureError(ev); },
    onMarksChanged: function (ev) {
      if (current && ev && ev.docId === current.id) renderMarks();
    },
  };

  /* ---------------- start watchdog (round 2) ----------------
     Round 1 keyed this on the synth `speaking` flag and on the
     engine still being 'playing' at a 2 s deadline. Real-browser
     instrumentation (headless Chromium, zero voices, live app,
     2026-10-16) showed the actual defeat: with no usable voice
     every utterance errors `synthesis-failed` within ~30 ms, the
     engine's error handling advances chunk to chunk, and the whole
     document "finishes" in ~45 ms — the engine is back to 'idle'
     (and its completion path has CLEARED the saved place) long
     before any 2 s deadline, so a deadline check that requires
     'playing' stands down silently. `speaking` never read true.

     This watchdog is keyed on PROGRESSION — evidence that speech
     is really happening — never on the speaking flag alone:
       - a chunk genuinely ends (the progress bar advances), or the
         synth is observed speaking while the engine plays: real.
       - the engine returns to 'idle' during the watch without the
         user stopping it and without speech ever being observed:
         the burn-through above. Fail at once, restore the place
         the press started from, rebuild the reader on it.
       - still 'playing' at the deadline but speech never observed
         (and nothing is even queued): fail.
       - 'speaking' reads true but nothing progresses for a whole
         slow first chunk (~30 s): a phantom speaking state. Fail.
     User pause/stop disarms silently — those clicks are seen by
     the same delegated handler that arms the watch. */
  var wd = null;
  function wdDisarm() {
    if (!wd) return;
    if (wd.poll) clearInterval(wd.poll);
    if (wd.t1) clearTimeout(wd.t1);
    if (wd.t2) clearTimeout(wd.t2);
    wd = null;
  }
  function wdFillPct() {
    var m = $('readerMount');
    var f = m ? m.querySelector('.rc-fill') : null;
    var v = f ? parseFloat(f.style.width) : NaN;
    return isNaN(v) ? -1 : v;
  }
  function wdFail(w) {
    var reader = w.reader;
    wdDisarm();
    if (reader.getState() === 'playing') {
      try { reader.stop(); } catch (e) {} // stopAll(false): place kept
    }
    // If the failure moved or cleared the saved place (the engine's
    // error burn-through ends in its completion path, which clears
    // it), put back the exact record the press started from — the
    // user heard nothing, so their place must not move.
    var placeMoved = false;
    try {
      var key = placeKey(w.docId);
      if (localStorage.getItem(key) !== w.place) {
        placeMoved = true;
        if (w.place === null) localStorage.removeItem(key);
        else localStorage.setItem(key, w.place);
      }
    } catch (e) {}
    speechBroke = true;
    updateSpeechWarn();
    // The burn-through also reset the reader's own position to the
    // top. Rebuild the reader on the restored place so what is on
    // screen matches the place that was kept.
    if (placeMoved && current && current.id === w.docId) openDoc(w.docId);
  }
  function armWatchdog(reader) {
    wdDisarm();
    if (!current) return;
    // The watch's speech evidence comes from the transport THIS
    // reader is actually speaking through — never from a synth
    // the reader is not using. A pack-transport reader exists
    // where the platform API has no voice (the pack-rescued
    // state) or does not exist at all; keyed on the platform
    // synth, its evidence read permanently silent, and the 2 s
    // deadline false-fired wdFail on a cold first Kokoro
    // synthesis — the pack transport reports speaking from the
    // moment speak() is called, through synthesis and playback,
    // so a slow first synthesis now reads as speech in progress
    // (the slow-chunk grace), exactly as a platform voice does.
    // A genuinely stalled pack transport still fails: silent
    // burn-through reaches 'idle' unobserved, and a speaking
    // state that never progresses is still a phantom at the
    // slow-chunk deadline.
    var synth = (current.synthKind === 'pack' && ttsPack && ttsPack.transport)
      ? ttsPack.transport
      : (window.speechSynthesis || { speaking: false, pending: false });
    var w = wd = {
      reader: reader,
      docId: current.id,
      place: null,
      fill0: wdFillPct(),
      prog0: -1,
      everSpeaking: false,
      progressed: false,
      poll: null, t1: null, t2: null,
    };
    try { w.place = localStorage.getItem(placeKey(w.docId)); } catch (e) {}
    try { w.prog0 = reader.getProgress(); } catch (e) {}
    w.poll = setInterval(function () {
      if (wd !== w || !current || current.reader !== reader) { wdDisarm(); return; }
      var st;
      try { st = reader.getState(); } catch (e) { wdDisarm(); return; }
      if (synth.speaking) w.everSpeaking = true;
      if (wdFillPct() > w.fill0) w.progressed = true;
      if (w.progressed) {
        // A chunk genuinely ended: speech is real. If an earlier
        // failure had flagged speech as broken, this press proves
        // otherwise.
        if (speechBroke) { speechBroke = false; updateSpeechWarn(); }
        wdDisarm();
        return;
      }
      if (st === 'paused') { wdDisarm(); return; } // the user paused
      if (st === 'idle') {
        // The engine stopped on its own during the watch. If speech
        // was observed, it really spoke (a short remainder can
        // legitimately finish). If speech was NEVER observed, the
        // document was burned through by utterance errors — fail.
        if (w.everSpeaking) { wdDisarm(); return; }
        wdFail(w);
      }
    }, 150);
    w.t1 = setTimeout(function () {
      if (wd !== w) return;
      var st = reader.getState();
      if (st !== 'playing' || w.progressed) return; // poll decides idle
      if (w.everSpeaking || synth.speaking) {
        // Speech started; the first chunk is still speaking. Give
        // it a whole slow chunk to progress before calling the
        // speaking state a phantom.
        w.t2 = setTimeout(function () {
          if (wd !== w) return;
          var moved = false;
          try { moved = reader.getProgress() !== w.prog0; } catch (e) {}
          if (reader.getState() === 'playing' && !w.progressed && !moved) wdFail(w);
          else wdDisarm();
        }, 30000);
        return;
      }
      if (synth.pending) {
        // An utterance is queued but has not started — one grace
        // extension for slow speech start-up, then the verdict.
        w.t1 = setTimeout(function () {
          if (wd !== w) return;
          if (reader.getState() === 'playing' && !w.progressed &&
              !w.everSpeaking && !synth.speaking) wdFail(w);
          else if (reader.getState() === 'playing' && !w.progressed) wdDisarm();
        }, 2000);
        return;
      }
      // Playing for ~2 s, nothing spoken, nothing even queued:
      // this browser is not going to speak. Say so.
      wdFail(w);
    }, 2000);
  }

  /* ---------------- licence ----------------
     A licence is a signed key (see licence.js) pasted once and kept
     on this device. It unlocks the document formats — PDF, EPUB,
     Word, HTML files. Free formats (paste, links, .txt, .md) never
     look at it. Verification is local: this browser checks the
     signature itself; the key is never sent anywhere. If the
     licence module failed to load, gated formats stay locked and
     say so — fail closed, never silent. */
  var LICENCE_KEY = 'dogearapp:licence:v1';
  var licencePayload = null; // verified payload, or null

  function licenceAllows(kind) {
    return !!(window.DogEarLicence && licencePayload &&
      window.DogEarLicence.allows(licencePayload, kind));
  }
  function licenceUnlocksAll() {
    return !!(window.DogEarLicence && licencePayload &&
      window.DogEarLicence.unlocksAll &&
      window.DogEarLicence.unlocksAll(licencePayload));
  }
  function updateLicenceUI() {
    var state = $('licenceState');
    if (!state) return;
    if (licencePayload) {
      state.textContent = 'Licence active — ' + licencePayload.holder +
        '. PDF, EPUB, Word and HTML files are unlocked on this device.' +
        (licenceUnlocksAll()
          ? ' This licence also lifts the daily listening limit here.'
          : '');
      $('licenceForm').hidden = true;
      $('licenceRemove').hidden = false;
    } else {
      state.textContent = 'PDF, EPUB, Word and HTML files need a ' +
        'DogEar licence. Paste your licence key once — it is checked ' +
        'and kept only on this device.';
      $('licenceForm').hidden = false;
      $('licenceRemove').hidden = true;
    }
  }
  function initLicence() {
    var token = null;
    try { token = localStorage.getItem(LICENCE_KEY); } catch (e) {}
    if (token && window.DogEarLicence) {
      var res = window.DogEarLicence.verify(token);
      if (res.ok) licencePayload = res.payload;
      else {
        // A stored key that no longer verifies (expired, or the
        // signing key changed) is dropped, and the UI says the
        // licence is not active — never pretend otherwise.
        licencePayload = null;
        try { localStorage.removeItem(LICENCE_KEY); } catch (e) {}
      }
    }
    updateLicenceUI();
  }
  function wireLicence() {
    var apply = $('licenceApply');
    if (!apply) return;
    apply.addEventListener('click', function () {
      var token = $('licenceInput').value.trim();
      if (!token) { setMsg($('licenceMsg'), 'Paste your licence key first.', true); return; }
      if (!window.DogEarLicence) {
        setMsg($('licenceMsg'), 'The licence checker could not load. Reload the page and try again.', true);
        return;
      }
      var res = window.DogEarLicence.verify(token);
      if (!res.ok) { setMsg($('licenceMsg'), res.reason, true); return; }
      try { localStorage.setItem(LICENCE_KEY, token); } catch (e) {}
      licencePayload = res.payload;
      $('licenceInput').value = '';
      updateLicenceUI();
      refreshPlanUI();
      setMsg($('licenceMsg'), 'Licence accepted. The document formats are unlocked on this device.', false);
    });
    $('licenceRemove').addEventListener('click', function () {
      try { localStorage.removeItem(LICENCE_KEY); } catch (e) {}
      licencePayload = null;
      updateLicenceUI();
      refreshPlanUI();
      setMsg($('licenceMsg'), 'Licence removed from this device. The document formats are locked again.', false);
    });
  }

  /* ---------------- plan: unlock, meter, tips ----------------
     ONE unlocked state for the whole app, reached exactly two
     ways: a Play purchase (billing.js — restored on startup or
     bought in the app), or a verified owner licence
     (licenceUnlocksAll). Nothing else sets it. The meter reads
     this same state, so formats and minutes answer to one truth. */
  var CFG = window.DogEarConfig || {};
  var playUnlocked = false;
  var billing = null;
  var meter = null;

  function isUnlocked() { return playUnlocked || licenceUnlocksAll(); }

  function fmtMinutes(min) {
    min = Math.max(0, Math.round(min));
    if (min < 60) return min + (min === 1 ? ' minute' : ' minutes');
    var h = Math.floor(min / 60), m = min % 60;
    return h + (h === 1 ? ' hour' : ' hours') + (m ? ' ' + m + ' min' : '');
  }

  function refreshTipBox() {
    var box = $('tipBox');
    if (!box) return;
    var inApp = !!(billing && billing.isAvailable());
    var hasStripe = !!CFG.STRIPE_TIP_LINK;
    var link = $('tipStripe');
    if (link) {
      link.hidden = !hasStripe;
      if (hasStripe) link.href = CFG.STRIPE_TIP_LINK;
    }
    box.hidden = !(inApp || hasStripe);
  }

  function refreshPlanUI() {
    var state = $('planState');
    if (!state) return;
    var unlocked = isUnlocked();
    var available = !!(billing && billing.isAvailable());
    if (unlocked) {
      state.textContent = 'DogEar is unlocked on this device — listen ' +
        'as much as you like. Thank you.';
    } else if (meter) {
      var left = meter.remainingMinutes();
      if (left <= 0) {
        state.textContent = 'You\u2019ve used your free hour for ' +
          'today. Listening to new documents starts again ' +
          'tomorrow — or right away with the one-time unlock.';
      } else {
        state.textContent = 'Your plan: 1 hour of listening free ' +
          'every day. You\u2019ve used ' + fmtMinutes(meter.usedMinutes()) +
          ' — ' + fmtMinutes(left) + ' left today.';
      }
    }
    var ub = $('unlockBtn');
    if (ub) ub.hidden = !(available && !unlocked);
    var cb = $('capUnlockBtn');
    if (cb) cb.hidden = !(available && !unlocked);
    var wn = $('planWebNote');
    if (wn) wn.hidden = !(!available && !unlocked);
    var ap = $('aboutPlanState');
    if (ap) {
      ap.textContent = unlocked
        ? 'On this device: unlocked — no daily limit.'
        : (meter ? 'On this device: ' + fmtMinutes(meter.remainingMinutes()) +
            ' of free listening left today.' : '');
    }
    refreshTipBox();
    refreshVoicePanel();
  }

  function doUnlock(msgEl) {
    if (!billing) return;
    setMsg(msgEl, 'Opening Google Play\u2026', false);
    billing.buyUnlock().then(function (res) {
      if (res.ok) {
        playUnlocked = true;
        refreshPlanUI();
        setMsg(msgEl, 'Unlocked — thank you. The daily limit is off, for good.', false);
      } else if (res.cancelled) {
        setMsg(msgEl, '', false);
      } else {
        setMsg(msgEl, res.reason, true);
      }
    });
  }

  function wirePlan() {
    var ub = $('unlockBtn');
    if (ub) ub.addEventListener('click', function () { doUnlock($('planMsg')); });
    var cb = $('capUnlockBtn');
    if (cb) cb.addEventListener('click', function () { doUnlock($('capMsg')); });
  }

  function buildTipButtons() {
    var wrap = $('tipButtons');
    if (!wrap || !billing || !billing.isAvailable()) return;
    var skus = (CFG.SKUS && CFG.SKUS.tips) || [];
    billing.getDetails(skus).then(function (items) {
      wrap.innerHTML = '';
      (items || []).forEach(function (item) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'ghost';
        b.textContent = (item.title || 'Leave a tip') +
          (item.price ? ' · ' + item.price.currency + ' ' + item.price.value : '');
        b.addEventListener('click', function () {
          setMsg($('tipMsg'), 'Opening Google Play\u2026', false);
          billing.buyTip(item.itemId).then(function (res) {
            if (res.ok) setMsg($('tipMsg'), 'Thank you — truly. Tips keep DogEar being built.', false);
            else if (res.cancelled) setMsg($('tipMsg'), '', false);
            else setMsg($('tipMsg'), res.reason, true);
          });
        });
        wrap.appendChild(b);
      });
      refreshTipBox();
    });
  }

  /* ---------------- meter observation ----------------
     While a document is open, a once-a-second poll reads the
     furthest point reached — from the reader's own progress and
     from the saved place, whichever is further — and hands it to
     the meter. The meter counts only ground never heard before,
     so this poll can be generous: re-listening moves nothing.
     The poll NEVER touches playback. The cap is enforced only in
     openDoc, at the start of a document, never during one. */
  var meterWatch = null; // { id, totalMin, maxFrac, active, played, timer }
  function startMeterWatch(id, text) {
    stopMeterWatch();
    if (!meter || !window.DogEarMeter) return;
    var w = meterWatch = {
      id: id,
      totalMin: window.DogEarMeter.minutesForText(text, CFG.WORDS_PER_MINUTE),
      maxFrac: 0, active: false, played: false, timer: null,
    };
    // The saved place is the day's base for this document:
    // ground already covered before today is not charged
    // again; only progress past it counts.
    var p = loadPlace(id);
    var base = p && p.n > 0 ? Math.min(1, p.i / p.n) : 0;
    w.maxFrac = base;
    meter.begin(id, w.totalMin, base);
    w.timer = setInterval(pollMeter, 1000);
  }
  function pollMeter() {
    var w = meterWatch;
    if (!w || !current || current.id !== w.id) return;
    var frac = w.maxFrac;
    var p = loadPlace(w.id);
    if (p && p.n > 0) frac = Math.max(frac, Math.min(1, p.i / p.n));
    var st = null;
    if (current.reader) {
      try { st = current.reader.getState(); } catch (e) {}
      try { frac = Math.max(frac, current.reader.getProgress()); } catch (e) {}
      if (st === 'playing' || st === 'paused') w.active = true;
    }
    if (frac > w.maxFrac) {
      w.maxFrac = frac;
      meter.observe(w.id, frac, w.totalMin);
      refreshPlanUI();
    }
    // Completion: the engine clears the saved place ONLY when a
    // document has been heard to the end — a Stop keeps the
    // place, pausing keeps it, and the speech watchdog restores
    // it after a failure. So: playback was pressed this session,
    // the reader is idle now, and the place is gone — the
    // document finished, and it counts in full (past the cap
    // included: nothing here ever interrupts a document).
    if ((w.played || w.active) && st === 'idle' && !p && !speechBroke) {
      w.maxFrac = 1;
      meter.complete(w.id, w.totalMin);
      refreshPlanUI();
    }
  }
  function stopMeterWatch() {
    if (meterWatch && meterWatch.timer) clearInterval(meterWatch.timer);
    meterWatch = null;
  }

  /* ---------------- document store ----------------
     Large documents (owner's design, 2026-11-08): a document
     body is NEVER one string in localStorage — that store holds
     ~5-10 MB per origin in total, which was the real wall
     behind the old 10 MB file / 1,000,000-character refusals
     (both now removed; the honest limits are the free space on
     this device for the extracted words, and the time it takes
     to read them out of the file). Bodies live in IndexedDB as
     chunks of ~100,000 characters (or ~50 extracted pages /
     chapters, whichever comes first). localStorage keeps only
     the document index and the reading places.
     Where IndexedDB does not exist (older WebViews, headless
     harnesses), the same chunk layout falls back to chunked
     localStorage keys — still chunked, never one string — and
     where even that is missing, to memory for the session.
     Reading window-loads the chunks around the reading place;
     a document whose import is unfinished keeps the part that
     landed and says so plainly until the same file is picked
     once more to finish it. */
  function loadIndex() {
    try { return JSON.parse(localStorage.getItem(INDEX_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function saveIndex(ix) {
    try { localStorage.setItem(INDEX_KEY, JSON.stringify(ix)); } catch (e) {}
  }
  function bodyKey(id) { return 'dogearapp:doc:' + id; }
  function placeKey(id) { return 'dogearapp:place:' + id; }
  function gplaceKey(id) { return 'dogearapp:gplace:' + id; }
  function newId() {
    return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function indexEntry(id) {
    var ix = loadIndex(), found = null;
    ix.forEach(function (d) { if (d.id === id) found = d; });
    return found;
  }
  function updateIndexEntry(id, patch) {
    var ix = loadIndex();
    ix.forEach(function (d) {
      if (d.id === id) { for (var k in patch) d[k] = patch[k]; }
    });
    saveIndex(ix);
  }

  /* ---- chunk math (pure; shared by import, migration, tests) ---- */
  var CHUNK_TARGET = 100000;   // ~100K characters per stored chunk
  var CHUNK_SEGMENTS = 50;     // or ~50 extracted pages/chapters
  function docParagraphs(text) {
    return String(text || '').split(/\n{2,}/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }
  function splitLongParagraph(p, target) {
    if (p.length <= target) return [p];
    var out = [], rest = p;
    while (rest.length > target) {
      var cut = rest.lastIndexOf('. ', target);
      if (cut < target * 0.4) cut = rest.lastIndexOf(' ', target);
      if (cut < target * 0.4) cut = target;
      out.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) out.push(rest);
    return out;
  }
  /* Split a whole text into stored chunks. Paragraphs are the
     unit: a chunk never cuts a paragraph unless the paragraph
     alone exceeds the target, in which case it is cut at
     sentence ends. Joining chunk texts with '\n\n' reproduces
     docParagraphs(text).join('\n\n') exactly. Each chunk
     records the global paragraph it starts at, so any chunk
     can be placed in the document without reading the rest. */
  function splitIntoChunks(text, target) {
    target = target || CHUNK_TARGET;
    var units = [];
    docParagraphs(text).forEach(function (p) {
      splitLongParagraph(p, target).forEach(function (u) { units.push(u); });
    });
    var chunks = [], cur = [], curLen = 0, start = 0;
    function flush() {
      if (!cur.length) return;
      chunks.push({ text: cur.join('\n\n'), paraStart: start, paraCount: cur.length });
      start += cur.length; cur = []; curLen = 0;
    }
    units.forEach(function (u) {
      if (cur.length && curLen + 2 + u.length > target) flush();
      cur.push(u); curLen += (curLen ? 2 : 0) + u.length;
      if (curLen >= target) flush();
    });
    flush();
    return chunks;
  }
  /* Packer: folds a stream of extracted segments (one PDF page,
     one EPUB chapter, one text block) into stored chunks,
     emitting each chunk the moment it fills — so the first
     chunk is stored, and readable, while the rest of the file
     is still being extracted. */
  function createPacker(onChunk) {
    var pending = [], pendingLen = 0, segments = 0, nextPara = 0, emitted = 0;
    function emit() {
      if (!pending.length) return Promise.resolve();
      var text = pending.join('\n\n');
      var packed = splitIntoChunks(text);
      pending = []; pendingLen = 0; segments = 0;
      var chain = Promise.resolve();
      packed.forEach(function (c) {
        c.paraStart = nextPara;
        nextPara += c.paraCount;
        var idx = emitted++;
        chain = chain.then(function () { return onChunk(c, idx); });
      });
      return chain;
    }
    return {
      push: function (segmentText, unit) {
        var paras = docParagraphs(segmentText);
        if (!paras.length) return Promise.resolve();
        paras.forEach(function (p) {
          splitLongParagraph(p, CHUNK_TARGET).forEach(function (u) {
            pending.push(u); pendingLen += u.length + 2;
          });
        });
        /* The segment count is the page/chapter rule (~50
           pages or chapters per chunk); a plain text block is
           not a page and never trips it — character count
           governs there. */
        if (unit === 'page' || unit === 'chapter') segments++;
        if (pendingLen >= CHUNK_TARGET || segments >= CHUNK_SEGMENTS) return emit();
        return Promise.resolve();
      },
      flush: function () { return emit(); },
      get emitted() { return emitted; },
    };
  }

  /* ---- the chunk store (IndexedDB first) ---- */
  var DocStore = (function () {
    var DB_NAME = 'dogear-docs';
    var cache = {};   // id -> { meta, chunks: {idx: record} }
    var dbPromise = null;
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
    function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
    function chunkKey(id, idx) { return 'dogearapp:chunk:' + id + ':' + idx; }
    function metaKey(id) { return 'dogearapp:chunkmeta:' + id; }
    function hasIdb() {
      try { return typeof indexedDB !== 'undefined' && !!indexedDB; }
      catch (e) { return false; }
    }
    function backend() {
      if (hasIdb()) return 'indexeddb';
      try { if (window.localStorage) return 'local'; } catch (e) {}
      return 'memory';
    }
    function openDb() {
      if (!hasIdb()) return Promise.resolve(null);
      if (dbPromise) return dbPromise;
      dbPromise = new Promise(function (resolve) {
        var req;
        try { req = indexedDB.open(DB_NAME, 1); } catch (e) { resolve(null); return; }
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs');
          if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      });
      return dbPromise;
    }
    function idbPut(store, key, val) {
      return openDb().then(function (db) {
        if (!db) return false;
        return new Promise(function (resolve) {
          try {
            var tx = db.transaction(store, 'readwrite');
            tx.objectStore(store).put(val, key);
            tx.oncomplete = function () { resolve(true); };
            tx.onerror = function () { resolve(false); };
          } catch (e) { resolve(false); }
        });
      });
    }
    function idbGet(store, key) {
      return openDb().then(function (db) {
        if (!db) return null;
        return new Promise(function (resolve) {
          try {
            var rq = db.transaction(store, 'readonly').objectStore(store).get(key);
            rq.onsuccess = function () { resolve(rq.result || null); };
            rq.onerror = function () { resolve(null); };
          } catch (e) { resolve(null); }
        });
      });
    }
    function idbDel(store, key) {
      return openDb().then(function (db) {
        if (!db) return;
        try { db.transaction(store, 'readwrite').objectStore(store).delete(key); } catch (e) {}
      });
    }
    function slot(id) {
      if (!cache[id]) cache[id] = { meta: null, chunks: {} };
      return cache[id];
    }
    function getMetaSync(id) {
      var s = cache[id];
      if (s && s.meta) return s.meta;
      var raw = lsGet(metaKey(id));
      if (raw) {
        try {
          var m = JSON.parse(raw);
          slot(id).meta = m;
          return m;
        } catch (e) {}
      }
      return null;
    }
    function setMeta(id, meta) {
      slot(id).meta = meta;
      lsSet(metaKey(id), JSON.stringify(meta));
      idbPut('docs', id, meta);
      return Promise.resolve(meta);
    }
    function getMeta(id) {
      var m = getMetaSync(id);
      if (m) return Promise.resolve(m);
      return idbGet('docs', id).then(function (v) {
        if (v) slot(id).meta = v;
        return v || null;
      });
    }
    function putChunk(id, idx, record) {
      var s = slot(id);
      s.chunks[idx] = record;
      /* The chunk TEXT lives in exactly one durable place:
         IndexedDB where it exists (localStorage keeps only the
         small meta card — mirroring bodies there would rebuild
         the very wall this design removes); the chunked
         localStorage keys only where IndexedDB does not. The
         in-memory cache serves same-session synchronous reads
         either way. */
      if (backend() !== 'indexeddb') {
        if (!lsSet(chunkKey(id, idx), record.text)) s.writeFailed = true;
      }
      return idbPut('chunks', id + ':' + idx, record).then(function () { return record; });
    }
    function getChunkSync(id, idx) {
      var s = cache[id];
      if (s && s.chunks[idx]) return s.chunks[idx];
      var meta = getMetaSync(id);
      var text = lsGet(chunkKey(id, idx));
      if (text !== null && meta && meta.chunks && meta.chunks[idx]) {
        var rec = { text: text, paraStart: meta.chunks[idx].s, paraCount: meta.chunks[idx].n };
        slot(id).chunks[idx] = rec;
        return rec;
      }
      if (text !== null && meta) {
        // Meta without a chunk map (should not happen): the
        // paragraph offset is derived from earlier chunk sizes.
        return { text: text, paraStart: -1, paraCount: docParagraphs(text).length };
      }
      return null;
    }
    function getChunk(id, idx) {
      var r = getChunkSync(id, idx);
      if (r) return Promise.resolve(r);
      return idbGet('chunks', id + ':' + idx).then(function (v) {
        if (v) slot(id).chunks[idx] = v;
        return v || null;
      });
    }
    function chunkCount(id) {
      var m = getMetaSync(id);
      return m ? (m.chunkCount || 0) : 0;
    }
    function getTextSync(id) {
      var m = getMetaSync(id);
      if (!m || !m.chunkCount) return null;
      var parts = [];
      for (var i = 0; i < m.chunkCount; i++) {
        var c = getChunkSync(id, i);
        if (!c) return null;
        parts.push(c.text);
      }
      return parts.join('\n\n');
    }
    function getText(id) {
      var t = getTextSync(id);
      if (t !== null) return Promise.resolve(t);
      return getMeta(id).then(function (m) {
        if (!m || !m.chunkCount) return null;
        var parts = new Array(m.chunkCount);
        var chain = Promise.resolve();
        var missing = false;
        for (var i = 0; i < m.chunkCount; i++) {
          (function (idx) {
            chain = chain.then(function () {
              return getChunk(id, idx).then(function (c) {
                if (!c) missing = true; else parts[idx] = c.text;
              });
            });
          })(i);
        }
        return chain.then(function () { return missing ? null : parts.join('\n\n'); });
      });
    }
    /* The text of the chunks that have LANDED so far (import
       may still be running): search and questions see a
       document grow chunk by chunk, never waiting for the end. */
    function getLoadedTextSync(id) {
      var m = getMetaSync(id);
      if (!m || !m.chunkCount) return '';
      var parts = [];
      for (var i = 0; i < m.chunkCount; i++) {
        var c = getChunkSync(id, i);
        if (!c) break;
        parts.push(c.text);
      }
      return parts.join('\n\n');
    }
    function deleteDoc(id) {
      var m = getMetaSync(id);
      var n = m ? (m.chunkCount || 0) : 0;
      for (var i = 0; i < n; i++) {
        lsDel(chunkKey(id, i));
        idbDel('chunks', id + ':' + i);
      }
      lsDel(metaKey(id));
      idbDel('docs', id);
      delete cache[id];
      return Promise.resolve();
    }
    /* Plain search over the chunks present on this device —
       the same loaded-chunks view retrieval answers from. */
    function searchLoaded(id, query) {
      var q = String(query || '').toLowerCase();
      if (!q) return [];
      var m = getMetaSync(id);
      if (!m) return [];
      var hits = [];
      for (var i = 0; i < (m.chunkCount || 0); i++) {
        var c = getChunkSync(id, i);
        if (!c) break;
        var paras = docParagraphs(c.text);
        for (var p = 0; p < paras.length; p++) {
          var at = paras[p].toLowerCase().indexOf(q);
          if (at !== -1) {
            hits.push({
              chunk: i,
              para: (c.paraStart >= 0 ? c.paraStart : 0) + p,
              snippet: paras[p].slice(Math.max(0, at - 40), at + q.length + 60),
            });
          }
        }
      }
      return hits;
    }
    /* Migration: documents saved by older DogEar live as one
       localStorage string per document. Copy each into chunks
       (read-through keeps serving it until the copy verifies),
       then remove the old string — the words move house, none
       are lost. Runs at boot; safe to run again. */
    function migrateLegacy() {
      var ix = loadIndex();
      var done = [];
      var chain = Promise.resolve();
      ix.forEach(function (d) {
        chain = chain.then(function () {
          if (getMetaSync(d.id)) return;
          var legacy = null;
          try { legacy = localStorage.getItem(bodyKey(d.id)); } catch (e) {}
          if (!legacy) return;
          var chunks = splitIntoChunks(legacy);
          var writes = Promise.resolve();
          chunks.forEach(function (c, ci) {
            writes = writes.then(function () { return putChunk(d.id, ci, c); });
          });
          return writes.then(function () {
            var meta = {
              chunkCount: chunks.length, totalChars: 0, totalParas: 0,
              complete: true, migratedFrom: 'localStorage',
              chunks: chunks.map(function (c) { return { s: c.paraStart, n: c.paraCount }; }),
            };
            chunks.forEach(function (c) {
              meta.totalChars += c.text.length;
              meta.totalParas += c.paraCount;
            });
            return setMeta(d.id, meta).then(function () {
              if (getTextSync(d.id) === docParagraphs(legacy).join('\n\n')) {
                try { localStorage.removeItem(bodyKey(d.id)); } catch (e) {}
                done.push(d.id);
              }
            });
          });
        });
      });
      return chain.then(function () { return done; });
    }
    return {
      backend: backend,
      getMetaSync: getMetaSync, getMeta: getMeta, setMeta: setMeta,
      putChunk: putChunk, getChunkSync: getChunkSync, getChunk: getChunk,
      chunkCount: chunkCount,
      getTextSync: getTextSync, getText: getText,
      getLoadedTextSync: getLoadedTextSync,
      deleteDoc: deleteDoc, searchLoaded: searchLoaded,
      migrateLegacy: migrateLegacy,
      _cache: cache,
    };
  })();

  /* The body of a document, wherever it lives now: chunks
     first, the pre-chunk localStorage string as read-through
     for anything not yet migrated. Null when neither has it. */
  function getBodyTextSync(id) {
    var t = DocStore.getTextSync(id);
    if (t !== null) return t;
    try { return localStorage.getItem(bodyKey(id)); } catch (e) { return null; }
  }
  function loadGPlace(id) {
    try {
      var p = JSON.parse(localStorage.getItem(gplaceKey(id)) || 'null');
      if (p && typeof p.para === 'number' && typeof p.paras === 'number' && p.paras > 0) return p;
    } catch (e) {}
    return null;
  }
  function saveGPlace(id, para, paras) {
    try {
      localStorage.setItem(gplaceKey(id),
        JSON.stringify({ para: para, paras: paras, t: Date.now() }));
    } catch (e) {}
  }

  /* Clarity item 11 (owner's ruling, 2026-11-10): the READING
     track's own position record. The reading track and the
     answering (Talk/Q&A) track used to share one position
     tracker: an answer spoken through the shared transport, or
     a native Continue event carrying a chunk the answering
     track had moved, could replace the place Continue resumed
     from — the reading place was lost. The two tracks are now
     isolated: this record is written ONLY by reading-track
     position events (the reader's own position reports, and
     deliberate reading steering through seekToChunk), and
     Continue resolves from it. The answering track may read
     the reader's position to anchor a note; it never writes
     here. Paragraph units, like the gplace record. */
  function readPlaceKey(id) { return 'dogearapp:readplace:' + id; }
  function loadReadPlace(id) {
    try {
      var p = JSON.parse(localStorage.getItem(readPlaceKey(id)) || 'null');
      if (p && typeof p.para === 'number' && typeof p.paras === 'number' && p.paras > 0) return p;
    } catch (e) {}
    return null;
  }
  function saveReadPlace(id, para, paras) {
    try {
      localStorage.setItem(readPlaceKey(id),
        JSON.stringify({ para: para, paras: paras, t: Date.now() }));
    } catch (e) {}
  }

  /* Add a complete in-memory text (paste, link import): it is
     stored chunked like everything else. There is no size
     refusal any more — the honest failure is the device
     itself saying its storage is full. */
  function addDocument(title, text, kind) {
    text = (text || '').replace(/\s+$/, '');
    if (!text.replace(/\s+/g, '')) return { error: 'That document has no readable text in it.' };
    var id = newId();
    var chunks = splitIntoChunks(text);
    for (var i = 0; i < chunks.length; i++) {
      DocStore.putChunk(id, i, chunks[i]);
    }
    var meta = {
      chunkCount: chunks.length, totalChars: 0, totalParas: 0, complete: true,
      chunks: chunks.map(function (c) { return { s: c.paraStart, n: c.paraCount }; }),
    };
    chunks.forEach(function (c) {
      meta.totalChars += c.text.length;
      meta.totalParas += c.paraCount;
    });
    DocStore.setMeta(id, meta);
    var slotAfter = DocStore._cache[id];
    if ((slotAfter && slotAfter.writeFailed) ||
        (DocStore.getTextSync(id) === null && chunks.length)) {
      DocStore.deleteDoc(id);
      return { error: 'This device\'s storage is full, so the document could not be kept here.' };
    }
    var ix = loadIndex();
    ix.unshift({
      id: id, title: title || 'Untitled document', kind: kind || 'text',
      addedAt: Date.now(), complete: true,
      chunkCount: meta.chunkCount, totalChars: meta.totalChars, totalParas: meta.totalParas,
    });
    saveIndex(ix);
    return { id: id };
  }

  /* Streaming import (files): extraction hands over segments;
     the packer stores chunks as they fill; the index entry
     exists — and the document can be opened and heard — from
     the FIRST chunk, with `complete` false and a plain
     still-loading state until the walk finishes. If the app
     is closed mid-import the file handle dies with it: the
     landed chunks persist, and finishing asks once for the
     same file (resumeStreamingImport skips the chunks whose
     words already match what is stored). */
  var activeImports = {};   // id -> { promise, fileName }
  function runStreamingImport(id, kind, buffer, opts) {
    opts = opts || {};
    var skipChunks = opts.skipChunks || 0;
    var meta = DocStore.getMetaSync(id) || {
      chunkCount: 0, totalChars: 0, totalParas: 0, complete: false, chunks: [],
    };
    var packer = createPacker(function (chunk, idx) {
      if (idx < skipChunks) {
        var have = DocStore.getChunkSync(id, idx);
        if (have && have.text === chunk.text) return Promise.resolve();
        // The re-picked file's words differ from this chunk on:
        // what is stored no longer matches the file, so the
        // import restarts honestly from here.
        skipChunks = idx;
        meta.chunkCount = idx;
      }
      return DocStore.putChunk(id, idx, chunk).then(function () {
        meta.chunkCount = Math.max(meta.chunkCount, idx + 1);
        meta.chunks[idx] = { s: chunk.paraStart, n: chunk.paraCount };
        meta.totalChars = 0; meta.totalParas = 0;
        for (var ci = 0; ci < meta.chunkCount; ci++) {
          var c = DocStore.getChunkSync(id, ci);
          if (c) { meta.totalChars += c.text.length; meta.totalParas += c.paraCount; }
        }
        meta.complete = false;
        DocStore.setMeta(id, meta);
        updateIndexEntry(id, {
          complete: false, chunkCount: meta.chunkCount,
          totalChars: meta.totalChars, totalParas: meta.totalParas,
        });
        if (typeof opts.onChunk === 'function') opts.onChunk(idx, meta);
      }).then(function () {
        /* Yield after every stored chunk: a huge import must
           never starve the page — the listener is already
           reading the first parts while this runs, and the
           still-loading state is a real, visible state, not a
           moment between two microtasks. */
        return new Promise(function (res) { setTimeout(res, 0); });
      });
    });
    var ingest = window.DogEarIngest;
    if (!ingest || !ingest.extractStreaming) {
      return Promise.reject(new Error('The document reader could not be loaded. Try reloading the page.'));
    }
    return ingest.extractStreaming(kind, buffer, function (segment, info) {
      return packer.push(segment, info && info.unit);
    }).then(function (ex) {
      return packer.flush().then(function () { return ex; });
    }).then(function (ex) {
      if (packer.emitted === 0 || meta.chunkCount === 0) {
        throw new Error('That document has no readable text in it.');
      }
      meta.complete = true;
      DocStore.setMeta(id, meta);
      updateIndexEntry(id, {
        complete: true, chunkCount: meta.chunkCount,
        totalChars: meta.totalChars, totalParas: meta.totalParas,
        title: (ex && ex.title) || indexEntry(id).title,
      });
      return { id: id, meta: meta };
    });
  }
  function startFileImport(file, kind, buffer) {
    var id = newId();
    var name = file.name.replace(/\.[^.]+$/, '');
    var ix = loadIndex();
    ix.unshift({
      id: id, title: name, kind: 'file', addedAt: Date.now(),
      complete: false, chunkCount: 0, totalChars: 0, totalParas: 0,
      fileName: file.name, fileKind: kind,
    });
    saveIndex(ix);
    DocStore.setMeta(id, { chunkCount: 0, totalChars: 0, totalParas: 0, complete: false, chunks: [] });
    var p = runStreamingImport(id, kind, buffer, {
      onChunk: function (idx, meta) {
        setMsg($('uploadMsg'), 'Reading ' + file.name + ' — part ' + (idx + 1) +
          ' is saved on this device. You can open it and start listening now; ' +
          'the rest is still loading.', false);
        renderLibrary();
        if (current && current.id === id) {
          refreshImportBanner();
          // A view opened on the first chunk alone converts
          // to a windowed view as soon as a second chunk lands.
          if (!current.chunked) extendOpenWindowToLanded(id);
        }
      },
    }).then(function () {
      setMsg($('uploadMsg'), 'Added. It is in your list below.', false);
      renderLibrary();
      if (current && current.id === id) {
        refreshImportBanner();
        extendOpenWindowToLanded(id);
      }
    }).catch(function (e) {
      var landed = DocStore.chunkCount(id);
      if (landed > 0) {
        setMsg($('uploadMsg'), 'Reading stopped partway — the first ' +
          landed + (landed === 1 ? ' part is' : ' parts are') +
          ' saved on this device and in your list below. Open the document ' +
          'and pick this file once more to finish it.', true);
      } else {
        setMsg($('uploadMsg'), (e && e.message) || 'That file could not be read.', true);
        removeDocument(id);
      }
      renderLibrary();
    });
    activeImports[id] = { promise: p, fileName: file.name };
    return id;
  }
  function resumeStreamingImport(id, file, buffer) {
    var entry = indexEntry(id);
    if (!entry) return Promise.reject(new Error('That document is not in your list any more.'));
    if (entry.fileName && file.name !== entry.fileName) {
      return Promise.reject(new Error('That is a different file (' + file.name +
        '). Pick ' + entry.fileName + ' — the same file you started with — to finish this document.'));
    }
    var kind = entry.fileKind || (window.DogEarIngest
      ? window.DogEarIngest.kindForFile(file.name, file.type) : null);
    if (!kind) return Promise.reject(new Error('DogEar cannot read that kind of file.'));
    var have = DocStore.chunkCount(id);
    return runStreamingImport(id, kind, buffer, {
      skipChunks: have,
      onChunk: function () { refreshImportBanner(); renderLibrary(); },
    }).then(function (r) {
      renderLibrary();
      refreshImportBanner();
      extendOpenWindowToLanded(id);
      return r;
    });
  }

  function removeDocument(id) {
    DocStore.deleteDoc(id);
    try {
      localStorage.removeItem(bodyKey(id));
      localStorage.removeItem(placeKey(id));
      localStorage.removeItem(gplaceKey(id));
      localStorage.removeItem(readPlaceKey(id));
    } catch (e) {}
    saveIndex(loadIndex().filter(function (d) { return d.id !== id; }));
  }
  function loadPlace(id) {
    try {
      var p = JSON.parse(localStorage.getItem(placeKey(id)) || 'null');
      if (p && typeof p.i === 'number' && typeof p.n === 'number' && p.n > 0) return p;
    } catch (e) {}
    return null;
  }

  /* ---------------- home / library ---------------- */
  /* Destructive acts ask first, in plain words that name the
     consequence (full-life-cycle law, 2026-11-10: removal is
     designed in, and the UI states what it does). A surface
     that cannot ask (no confirm available) counts as a No —
     nothing is ever deleted on a maybe. */
  function askConfirm(words) {
    try { return window.confirm(words) === true; }
    catch (e) { return false; }
  }
  function renderLibrary() {
    var ix = loadIndex();
    var list = $('docList');
    list.innerHTML = '';
    $('emptyLib').style.display = ix.length ? 'none' : '';
    ix.forEach(function (d) {
      var li = document.createElement('li');
      var left = document.createElement('div');
      var t = document.createElement('div'); t.className = 't'; t.textContent = d.title;
      var meta = document.createElement('div'); meta.className = 'meta';
      meta.textContent = new Date(d.addedAt).toLocaleDateString(undefined,
        { year: 'numeric', month: 'short', day: 'numeric' });
      left.appendChild(t); left.appendChild(meta);
      var p = loadPlace(d.id);
      var gp = loadGPlace(d.id);
      if (gp && (!p || !p.n)) p = { i: gp.para, n: gp.paras };
      else if (gp && d.totalParas) p = { i: gp.para, n: gp.paras };
      var chip = document.createElement('span');
      if (d.complete === false) {
        chip.className = 'chip';
        chip.textContent = 'Still loading · part saved';
      } else if (p && p.i > 0 && p.i < p.n) {
        chip.className = 'chip';
        chip.textContent = 'Resume · ' + Math.round((p.i / p.n) * 100) + '%';
      } else {
        chip.className = 'chip plain';
        chip.textContent = 'Not started';
      }
      /* Clarity items 6+7: the library row is the management
         home's front door — one grouped set of labelled text
         buttons, same treatment throughout: Read (opens in the
         reading view; the row tap's twin), Listen (opens
         straight into the listening view), Manage (the
         per-document sheet: open/continue, its notes, its
         details, Remove). Row-tap-opens is unchanged. */
      var actions = document.createElement('div');
      actions.className = 'doc-actions';
      var read = document.createElement('button');
      read.type = 'button'; read.className = 'ghost';
      read.textContent = 'Read';
      read.title = 'Read ' + (d.title || 'document');
      read.setAttribute('aria-label',
        'Read ' + (d.title || 'document'));
      read.addEventListener('click', function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        docView = 'read';
        openDoc(d.id);
      });
      var listen = document.createElement('button');
      listen.type = 'button'; listen.className = 'ghost';
      listen.textContent = 'Listen';
      listen.title = 'Listen to ' + (d.title || 'document');
      listen.setAttribute('aria-label',
        'Listen to ' + (d.title || 'document'));
      listen.addEventListener('click', function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        docView = 'listen';
        openDoc(d.id);
      });
      var manage = document.createElement('button');
      manage.type = 'button'; manage.className = 'ghost doc-manage';
      manage.textContent = 'Manage';
      manage.title = 'Manage ' + (d.title || 'document');
      manage.setAttribute('aria-label',
        'Manage ' + (d.title || 'document'));
      manage.addEventListener('click', function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        renderManageSheet(d);
      });
      actions.appendChild(read);
      actions.appendChild(listen);
      actions.appendChild(manage);
      li.addEventListener('click', function () {
        docView = 'read';
        openDoc(d.id);
      });
      li.appendChild(left); li.appendChild(chip);
      li.appendChild(actions);
      list.appendChild(li);
    });
  }

  /* Clarity item 1: ONE remove behaviour everywhere — the
     patch-2 confirm words, shared by the Manage sheet and the
     reader's remove button. The confirm names the consequence
     plainly: the document's only copy is on this device. */
  function removeDocWithConfirm(d) {
    if (!d || !d.id) return;
    if (!askConfirm('Remove \u201c' + (d.title || 'Untitled document') +
      '\u201d from DogEar? It will be deleted from the app. This ' +
      'cannot be undone \u2014 to get it back, you would have to ' +
      'upload the document again.')) return;
    var wasOpen = !!(current && current.id === d.id);
    if (wasOpen) closeReader();
    removeDocument(d.id);
    closeManageSheet();
    if (wasOpen) showHome(); else renderLibrary();
  }

  /* The conversation exchanges that belong to one document
     (the answering track's notes about it), by its title —
     the same keying the Notes views group by. */
  function docConvEntries(title) {
    if (!title) return [];
    return loadConv().filter(function (e) {
      return e && e.doc === title;
    });
  }

  /* Clarity item 7: the per-document Manage sheet — the
     library as management home. Open/Continue, this document's
     notes (count + go), its details (added, size, place), and
     Remove under the shared confirm. */
  var manageDocId = null;
  function closeManageSheet() {
    manageDocId = null;
    var sh = $('manageSheet');
    if (sh) sh.hidden = true;
  }
  function renderManageSheet(d) {
    var sh = $('manageSheet');
    if (!sh || !d) return;
    manageDocId = d.id;
    $('manageTitle').textContent = d.title || 'Untitled document';
    var p = loadPlace(d.id);
    var gp = loadGPlace(d.id);
    var when = new Date(d.addedAt).toLocaleDateString(undefined,
      { year: 'numeric', month: 'short', day: 'numeric' });
    var sm = DocStore.getMetaSync ? DocStore.getMetaSync(d.id) : null;
    var chars = (sm && sm.totalChars) || d.totalChars || 0;
    var size = chars
      ? ' \u00b7 about ' + Math.max(1, Math.round(chars / 1000)) +
        'k characters'
      : '';
    var pp = gp ? { i: gp.para, n: gp.paras } : p;
    var prog = 'Not started';
    if (pp && pp.n > 0 && pp.i > 0) {
      prog = 'Place kept at paragraph ' + (pp.i + 1) + ' of ' +
        pp.n + ' (' + Math.round((pp.i / pp.n) * 100) + '%)';
    }
    $('manageDetails').textContent = 'Added ' + when + size +
      ' \u00b7 ' + prog;
    var n = docConvEntries(d.title).length;
    $('manageNotesLine').textContent = n
      ? n + (n === 1 ? ' note' : ' notes') +
        ' from your talks about this document.'
      : 'No notes from talks about this document yet.';
    var nb = $('manageNotesBtn');
    if (nb) nb.hidden = n === 0;
    $('manageOpenBtn').textContent =
      pp && pp.i > 0 ? 'Continue' : 'Open';
    sh.hidden = false;
    if (sh.scrollIntoView) sh.scrollIntoView();
  }
  function wireManageSheet() {
    var open = $('manageOpenBtn');
    if (open) open.addEventListener('click', function () {
      if (!manageDocId) return;
      var id = manageDocId;
      closeManageSheet();
      docView = 'read';
      openDoc(id);
    });
    var notes = $('manageNotesBtn');
    if (notes) notes.addEventListener('click', function () {
      closeManageSheet();
      var nh = $('notesHome');
      if (nh && nh.scrollIntoView) nh.scrollIntoView();
    });
    var rm = $('manageRemoveBtn');
    if (rm) rm.addEventListener('click', function () {
      if (!manageDocId) return;
      var d = indexEntry(manageDocId);
      removeDocWithConfirm(d || {
        id: manageDocId,
        title: $('manageTitle').textContent,
      });
    });
    var close = $('manageCloseBtn');
    if (close) close.addEventListener('click', closeManageSheet);
  }

  /* ---------------- clarity: dual view (item 8) ----------------
     One document, two arrangements of the SAME controls. Read
     is the document-first arrangement that has always shipped;
     Listen is player-first: the text and the marks box step
     back and the transport grows (CSS under #readView.view-
     listen in app.css). Nothing is rebuilt and no control is
     duplicated — a class on the view flips the arrangement,
     so playback state, the place and the session are identical
     on both sides of the switch. */
  function setDocView(v) {
    docView = v === 'listen' ? 'listen' : 'read';
    applyDocView();
  }
  function applyDocView() {
    var rv = $('readView');
    if (rv) rv.classList.toggle('view-listen', docView === 'listen');
    var rb = $('viewReadBtn'), lb = $('viewListenBtn');
    if (rb) rb.setAttribute('aria-pressed', docView === 'read' ? 'true' : 'false');
    if (lb) lb.setAttribute('aria-pressed', docView === 'listen' ? 'true' : 'false');
  }
  function wireViewSwitch() {
    var rb = $('viewReadBtn'), lb = $('viewListenBtn');
    if (rb) rb.addEventListener('click', function () { setDocView('read'); });
    if (lb) lb.addEventListener('click', function () { setDocView('listen'); });
    var sb = $('docSheetBtn');
    if (sb) sb.addEventListener('click', function () {
      var sh = $('docSheet');
      if (!sh) return;
      var open = sh.hidden;
      sh.hidden = !open;
      sb.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) renderDocSheet();
    });
  }

  /* ------------- clarity: This-document sheet (item 9) --------
     Jump-to-paragraph (contents), the document's marks, and
     the document's notes in one place, each entry actionable
     where it sits: contents and marks go to their paragraph;
     notes delete in place under the patch-2 confirm. Marks
     carry no delete here — the web layer has no delete-mark
     API (marks are removed in the app) — so they offer Go
     only, never a dead control. */
  function renderDocSheet() {
    var sh = $('docSheet');
    if (!sh || !current) return;
    var list = $('sheetContents');
    if (list) {
      list.innerHTML = '';
      var paras = [];
      try {
        paras = current.reader && current.reader.getParagraphs
          ? current.reader.getParagraphs() : [];
      } catch (e) {}
      if (!paras.length) {
        var none = document.createElement('li');
        none.className = 'sheet-empty';
        none.textContent = 'No contents to show yet.';
        list.appendChild(none);
      }
      paras.forEach(function (pg) {
        var li = document.createElement('li');
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'ghost sheet-go';
        var globalIx = (current.chunked ? current.winParaStart : 0) +
          pg.index;
        b.textContent = 'Paragraph ' + (globalIx + 1) + ' — ' +
          String(pg.text || '').slice(0, 60) + '\u2026';
        b.title = 'Go to paragraph ' + (globalIx + 1);
        b.setAttribute('aria-label',
          'Go to paragraph ' + (globalIx + 1));
        b.addEventListener('click', function () {
          if (current && current.reader) {
            try {
              current.reader.seekToParagraph(pg.index, {});
            } catch (e) {}
          }
        });
        li.appendChild(b);
        list.appendChild(li);
      });
    }
    var marks = $('sheetMarks');
    if (marks) {
      marks.innerHTML = '';
      var items = [];
      try {
        if (window.DogEarNative && current) {
          var mk = window.DogEarNative.getMarks(current.id) || {};
          ['bookmarks', 'notes', 'tags'].forEach(function (k) {
            (mk[k] || []).forEach(function (m) {
              items.push({ chunk: m.chunk, kind: k.replace(/s$/, ''), text: m.text });
            });
          });
          if (mk.favorite) items.push({ chunk: 0, kind: 'favorite', text: 'Marked as a favourite' });
        }
      } catch (e) {}
      if (!items.length) {
        var nm = document.createElement('li');
        nm.className = 'sheet-empty';
        nm.textContent = 'No marks in this document yet.';
        marks.appendChild(nm);
      }
      items.forEach(function (it) {
        var li = document.createElement('li');
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'ghost sheet-go';
        b.textContent = it.kind + ' \u2014 part ' + (it.chunk + 1) +
          (it.text ? ': ' + String(it.text).slice(0, 60) : '');
        b.title = 'Go to part ' + (it.chunk + 1);
        b.setAttribute('aria-label', 'Go to part ' + (it.chunk + 1));
        b.addEventListener('click', function () {
          seekToChunk(it.chunk, it.kind + ' \u2014 part ' + (it.chunk + 1) + '.');
        });
        li.appendChild(b);
        marks.appendChild(li);
      });
    }
    renderSheetNotes();
  }
  function renderSheetNotes() {
    var box = $('sheetNotes');
    if (!box || !current) return;
    box.innerHTML = '';
    var meta = indexEntry(current.id);
    var entries = meta ? docConvEntries(meta.title) : [];
    if (!entries.length) {
      var none = document.createElement('li');
      none.className = 'sheet-empty';
      none.textContent = 'No notes about this document yet.';
      box.appendChild(none);
      return;
    }
    entries.forEach(function (e) {
      var li = document.createElement('li');
      var txt = document.createElement('div');
      txt.className = 'note-text';
      var bits = [];
      if (e.concept) bits.push(e.concept);
      if (e.a) bits.push(e.a);
      txt.textContent = bits.join(' — ') || 'Talk note';
      var del = document.createElement('button');
      del.type = 'button'; del.className = 'ghost note-del';
      del.textContent = 'Delete';
      del.title = 'Delete this note';
      del.setAttribute('aria-label', 'Delete this note');
      del.addEventListener('click', function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        if (!askConfirm('Delete this note? The conversation ' +
          'exchange it came from is removed too.')) return;
        deleteConvEntries([e]);
        renderSheetNotes();
      });
      li.appendChild(txt);
      li.appendChild(del);
      box.appendChild(li);
    });
  }

  /* ------------- clarity: Now-listening bar (item 8) ----------
     Leaving for the library while listening keeps the session
     (showHome defers the teardown); this slim bar is the way
     back in, and the pause/stop for the session, from the
     library itself. It exists only while a session is live. */
  function readerSessionLive() {
    /* A session is live while the reader positively reports
       playing or paused. An UNREADABLE state — the read throws,
       or the phone's player answers nothing for a moment —
       also counts as live: closing a reader is destructive, so
       it never runs on an unknown. (The native bridge keeps
       the same doctrine for its controls.) Only a reader that
       positively reports a finished state lets navigation
       close it. Owner's rule, 2026-11-11: reading continues
       unless there is a real reason for it to stop. */
    if (!current || !current.reader) return false;
    var st;
    try { st = current.reader.getState(); }
    catch (e) { return true; }
    if (typeof st !== 'string') return true;
    return st === 'playing' || st === 'paused';
  }
  function refreshNowBar() {
    var bar = $('nowBar');
    if (!bar) return;
    var read = $('readView');
    if (!readerSessionLive() || (read && !read.hidden)) {
      bar.hidden = true;
      return;
    }
    /* The bar belongs to whichever non-reading screen is up —
       the library or About — so the session stays reachable
       (pause / stop / tap back in) from both. It is re-hosted
       as needed; its wiring travels with the element. */
    var about = $('aboutView');
    var home = $('homeView');
    var host = (about && !about.hidden) ? about
      : (home && !home.hidden) ? home : null;
    if (!host) { bar.hidden = true; return; }
    if (bar.parentNode !== host) host.appendChild(bar);
    var meta = indexEntry(current.id);
    var title = $('nowBarTitle');
    if (title) {
      title.textContent = 'Now listening \u2014 ' +
        (meta ? meta.title : 'document');
    }
    var tog = $('nowBarToggle');
    if (tog) {
      var playing = false;
      try { playing = current.reader.getState() === 'playing'; } catch (e) {}
      tog.textContent = playing ? 'Pause' : 'Resume';
      tog.title = playing ? 'Pause the reading' : 'Resume the reading';
      tog.setAttribute('aria-label', tog.title);
    }
    bar.hidden = false;
  }
  function wireNowBar() {
    var tog = $('nowBarToggle');
    if (tog) tog.addEventListener('click', function () {
      if (current && current.reader) {
        try { current.reader.play(); } catch (e) {}
      }
      refreshNowBar();
    });
    var stop = $('nowBarStop');
    if (stop) stop.addEventListener('click', function () {
      if (current && current.reader) {
        try { current.reader.stop(); } catch (e) {}
      }
      closeReader();
      refreshNowBar();
      renderLibrary();
    });
    var title = $('nowBarTitle');
    if (title) title.addEventListener('click', function () {
      if (!current) return;
      $('homeView').hidden = true;
      $('aboutView').hidden = true;
      $('readView').hidden = false;
      docView = 'listen';
      applyDocView();
      window.scrollTo(0, 0);
    });
  }

  /* ---------------- add flows ---------------- */
  function setMsg(el, text, isErr) {
    el.textContent = text || '';
    el.classList.toggle('err', !!isErr);
  }
  function finishAdd(res, msgEl) {
    if (res.error) { setMsg(msgEl, res.error, true); return; }
    setMsg(msgEl, 'Added. It is in your list below.', false);
    renderLibrary();
  }
  function titleFromText(text) {
    var line = (text || '').split('\n').map(function (s) { return s.trim(); })
      .filter(Boolean)[0] || 'Untitled document';
    return line.replace(/^#+\s*/, '').slice(0, 120);
  }

  function wireAddPanel() {
    $('addBtn').addEventListener('click', function () {
      var p = $('addPanel');
      p.hidden = !p.hidden;
      if (!p.hidden) $('pasteTitle').focus();
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      tab.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
          t.classList.toggle('on', t === tab);
        });
        Array.prototype.forEach.call(document.querySelectorAll('.tabpane'), function (pane) {
          pane.hidden = pane.getAttribute('data-pane') !== tab.getAttribute('data-tab');
        });
      });
    });
    $('pasteAdd').addEventListener('click', function () {
      var text = $('pasteText').value;
      var title = $('pasteTitle').value.trim() || titleFromText(text);
      var res = addDocument(title, text, 'paste');
      if (!res.error) { $('pasteText').value = ''; $('pasteTitle').value = ''; }
      finishAdd(res, $('pasteMsg'));
    });
    $('fileInput').addEventListener('change', function () {
      var f = $('fileInput').files && $('fileInput').files[0];
      if (!f) return;
      var input = $('fileInput');
      var done = function () { input.value = ''; };
      /* No file-size refusal: DogEar takes the file whatever
         its size — the real limits are the free space on this
         device for the words in it, and the time it takes to
         read them out (the upload pane says so plainly). The
         import streams: parts are stored as they are read, and
         listening can start on the first part. */
      var ingest = window.DogEarIngest;
      var kind = null;
      if (ingest) kind = ingest.kindForFile(f.name, f.type);
      else if (/\.html?$/i.test(f.name)) kind = 'html';
      else if (/\.md$/i.test(f.name) || /\.markdown$/i.test(f.name)) kind = 'md';
      else if (/\.txt$/i.test(f.name)) kind = 'txt';
      if (!kind) {
        setMsg($('uploadMsg'), 'DogEar cannot read that kind of file. ' +
          'It reads .txt, .md, .html, PDF, EPUB and Word (.docx) files.', true);
        done(); return;
      }
      var gated = ingest ? ingest.isGated(kind) : kind === 'html';
      if (gated && !licenceAllows(kind)) {
        // Loud, never silent (the F-APP-2 lesson, applied to money):
        // name the lock, name the fix, point at the key box below.
        var names = { pdf: 'PDF', epub: 'EPUB', docx: 'Word (.docx)', html: 'HTML' };
        setMsg($('uploadMsg'), names[kind] + ' files need a DogEar licence. ' +
          'Paste your licence key in the box below — once is enough — then choose the file again.', true);
        var li = $('licenceInput');
        if (li) li.focus();
        done(); return;
      }
      setMsg($('uploadMsg'), 'Reading ' + f.name + '…', false);
      var reader = new FileReader();
      reader.onload = function () {
        var name = f.name.replace(/\.[^.]+$/, '');
        if (!ingest) {
          // Fallback path (ingest module failed to load): only the
          // plain kinds can be here — read as text, as the app did
          // before document formats existed.
          var raw = String(reader.result || '');
          var res = kind === 'html'
            ? addDocument(extractFromHtml(raw).title || name, extractFromHtml(raw).text, 'file')
            : addDocument(titleFromText(raw) === 'Untitled document' ? name : titleFromText(raw), raw, 'file');
          finishAdd(res, $('uploadMsg'));
          done();
          return;
        }
        // Streaming import: the document appears in the list
        // from its first stored part and can be opened and
        // heard while the rest is still being read.
        startFileImport(f, kind, reader.result);
        done();
      };
      reader.onerror = function () { setMsg($('uploadMsg'), 'That file could not be read.', true); done(); };
      if (ingest) reader.readAsArrayBuffer(f);
      else reader.readAsText(f);
    });
    var resumeInput = $('resumeFileInput');
    if (resumeInput) resumeInput.addEventListener('change', function () {
      var f = resumeInput.files && resumeInput.files[0];
      resumeInput.value = '';
      if (!f || !current) return;
      var id = current.id;
      setImportMsg('Reading ' + f.name + ' again to finish this document…', false);
      var rdr = new FileReader();
      rdr.onload = function () {
        resumeStreamingImport(id, f, rdr.result).then(function () {
          setImportMsg('', false);
        }).catch(function (e) {
          setImportMsg((e && e.message) || 'That file could not be read.', true);
        });
      };
      rdr.onerror = function () { setImportMsg('That file could not be read.', true); };
      rdr.readAsArrayBuffer(f);
    });
    var resumeBtn = $('resumeImportBtn');
    if (resumeBtn) resumeBtn.addEventListener('click', function () {
      if (resumeInput) resumeInput.click();
    });
    $('urlFetch').addEventListener('click', function () {
      var url = $('urlInput').value.trim();
      if (!url) { setMsg($('urlMsg'), 'Paste the page address first.', true); return; }
      var btn = $('urlFetch');
      btn.disabled = true;
      setMsg($('urlMsg'), 'Fetching the page…', false);
      fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url }),
      }).then(function (r) { return r.json(); }).then(function (data) {
        btn.disabled = false;
        if (!data || !data.ok) {
          setMsg($('urlMsg'), (data && data.error) || 'That page could not be fetched.', true);
          return;
        }
        var res = addDocument(data.title || titleFromText(data.text), data.text, 'link');
        if (!res.error) $('urlInput').value = '';
        finishAdd(res, $('urlMsg'));
      }).catch(function () {
        btn.disabled = false;
        setMsg($('urlMsg'), 'The fetch failed — check your connection and try again.', true);
      });
    });
  }

  /* Safe HTML → text for uploaded .html files: the file is parsed in an
     inert document (DOMParser never runs scripts), then only text is
     taken out of it, block by block. Nothing from the file is rendered. */
  function extractFromHtml(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var title = doc.title ? doc.title.trim() : '';
    var blocks = [];
    var seen = [];
    Array.prototype.forEach.call(
      doc.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote'), function (el) {
        if (seen.some(function (s) { return s.contains(el); })) return;
        var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) { blocks.push(t); seen.push(el); }
      });
    if (!blocks.length && doc.body) {
      var t = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) blocks.push(t);
    }
    return { title: title, text: blocks.join('\n\n') };
  }

  /* ---------------- reading view ---------------- */
  var current = null; // { id, reader } (+ window fields for chunked docs)
  var docView = 'read'; // clarity item 8: 'read' | 'listen' — the
  // open document's arrangement; entry points choose it, the
  // Read|Listen switch flips it, playback logic never reads it.

  /* The still-loading state that rides a document whose import
     has not finished: plain words, what has landed, and — when
     no import is running — the one action that finishes it:
     pick the same file once more. Shown in the reading view;
     the library row carries the short form. */
  function setImportMsg(text, isErr) {
    var el = $('importMsg');
    if (el) setMsg(el, text, isErr);
  }
  function refreshImportBanner() {
    var box = $('importState');
    if (!box) return;
    var entry = current ? indexEntry(current.id) : null;
    if (!entry || entry.complete !== false) { box.hidden = true; return; }
    var sm = DocStore.getMetaSync(entry.id);
    var parts = sm ? (sm.chunkCount || 0) : (entry.chunkCount || 0);
    var running = !!activeImports[entry.id];
    var txt = $('importStateText');
    if (txt) {
      txt.textContent = running
        ? 'Still loading — part ' + Math.max(1, parts) + ' of this document ' +
          'is saved on this device, and more is on its way. You can read ' +
          'and listen to what is here while the rest loads.'
        : 'Still loading — the first ' + Math.max(1, parts) +
          (parts === 1 ? ' part' : ' parts') + ' of this document ' +
          (parts === 1 ? 'is' : 'are') + ' saved on this device, and you can ' +
          'read and listen to ' + (parts === 1 ? 'it' : 'them') + ' now. ' +
          'To finish the document, pick the same file once more — ' +
          'DogEar picks up where it left off.';
    }
    var btn = $('resumeImportBtn');
    if (btn) btn.hidden = running;
    box.hidden = false;
  }

  /* Windowed reading for multi-chunk documents: only the
     stored chunks around the reading place are turned into
     page paragraphs and handed to the reader — the whole body
     is never in memory or in the DOM. The window is up to
     three chunks (~300K characters, hours of listening); the
     place is kept at paragraph granularity across the whole
     document (gplace), and the window extends by a chunk —
     rebuilt at the same paragraph — as listening nears its
     edge, including chunks that land while it is open. */
  var WINDOW_CHUNKS = 3;
  var WINDOW_EDGE_PARAS = 25;
  function windowParasSync(id, startChunk, endChunk) {
    var paras = [], paraStart = null;
    for (var ci = startChunk; ci < endChunk; ci++) {
      var c = DocStore.getChunkSync(id, ci);
      if (!c) return null;
      if (paraStart === null) paraStart = c.paraStart;
      docParagraphs(c.text).forEach(function (p) { paras.push(p); });
    }
    return { paras: paras, paraStart: paraStart || 0 };
  }
  function openDocWindowed(id, meta, sm, range, anchorPara, wasPlaying) {
    if (!meta) { renderLibrary(); return; }
    var totalParas = sm.totalParas || 0;
    if (typeof anchorPara !== 'number') {
      var gp0 = loadGPlace(id);
      anchorPara = gp0 ? Math.min(gp0.para, Math.max(0, totalParas - 1)) : 0;
    }
    if (!range) {
      var anchorChunk = 0;
      (sm.chunks || []).forEach(function (cm, ci) {
        if (cm && cm.s <= anchorPara) anchorChunk = ci;
      });
      var half = Math.floor(WINDOW_CHUNKS / 2);
      var sc = Math.max(0, Math.min(anchorChunk - half, sm.chunkCount - WINDOW_CHUNKS));
      range = { start: sc, end: Math.min(sm.chunkCount, sc + WINDOW_CHUNKS) };
    }
    var win = windowParasSync(id, range.start, range.end);
    if (!win) {
      // Chunks live in IndexedDB and are not in this session's
      // cache yet: load the window, then open for real.
      var loads = [];
      for (var ci2 = range.start; ci2 < range.end; ci2++) loads.push(DocStore.getChunk(id, ci2));
      Promise.all(loads).then(function () {
        var sm2 = DocStore.getMetaSync(id) || sm;
        openDocWindowed(id, indexEntry(id), sm2, range, anchorPara, wasPlaying);
      });
      return;
    }
    closeReader();
    duplexStop();
    $('homeView').hidden = true;
    $('aboutView').hidden = true;
    $('readView').hidden = false;
    $('docTitle').textContent = meta.title;
    applyDocView();
    var docSheet0 = $('docSheet');
    if (docSheet0) docSheet0.hidden = true;
    updateSpeechWarn();
    refreshBattNotice();
    var gp = loadGPlace(id);
    var gated = !!(meter && !meter.canStart(id, !!(gp && gp.para > 0)));
    var capEl = $('capNotice');
    if (capEl) capEl.hidden = !gated;
    var body = $('docBody');
    body.innerHTML = '';
    win.paras.forEach(function (para, li) {
      var p = para.replace(/\s+/g, ' ').trim();
      if (!p) return;
      var el;
      if (/^#{1,3}\s/.test(p)) {
        el = document.createElement('h2');
        el.textContent = p.replace(/^#{1,3}\s*/, '');
      } else {
        el = document.createElement('p');
        el.textContent = p;
      }
      body.appendChild(el);
      var row = document.createElement('div');
      row.className = 'para-actions';
      var from = document.createElement('button');
      from.type = 'button';
      from.className = 'ghost para-from';
      from.setAttribute('data-para', String(win.paraStart + li));
      from.textContent = 'Read from here';
      var only = document.createElement('button');
      only.type = 'button';
      only.className = 'ghost para-only';
      only.setAttribute('data-para', String(win.paraStart + li));
      only.textContent = 'Read this only';
      row.appendChild(from);
      row.appendChild(only);
      body.appendChild(row);
    });
    refreshParaVoiceState();
    window.scrollTo(0, 0);
    var reader = null;
    var usePack = packVoiceActive();
    // current is seated BEFORE the reader is created: the
    // reader reports its first position during creation, and
    // the window's position handler reads the window fields.
    current = {
      id: id, reader: null, synthKind: usePack ? 'pack' : 'platform',
      chunked: true, winStartChunk: range.start, winEndChunk: range.end,
      winParaStart: win.paraStart, extending: false,
    };
    if ((speechOK || usePack) && window.ReaderCore && !gated) {
      var readerOpts = {
        root: body,
        mount: $('readerMount'),
        storageKey: null,   // the paragraph place below owns persistence here
        voiceURI: loadVoicePref(),
        speeds: READER_SPEEDS,
        onPosition: function (pos) { onWindowPosition(pos); },
        onRangeEnd: function () {
          rangeMsgScope = null;
          setRangeMsg('That is the end of the part you chose. ' +
            'Your place is kept there.');
        },
        onVoicesChanged: function () { refreshVoicePicker(); },
      };
      if (usePack) {
        readerOpts.synth = ttsPack.transport;
        readerOpts.UtteranceCtor = ttsPack.Utterance;
      }
      reader = window.ReaderCore.create(readerOpts);
      current.reader = reader;
      if (reader) syncReaderSpeed();
    }
    refreshImportBanner();
    refreshVoicePicker();
    if (reader) {
      var localAnchor = Math.max(0, Math.min(anchorPara - win.paraStart,
        (reader.getParagraphCount ? reader.getParagraphCount() : 1) - 1));
      if (localAnchor > 0) {
        try { reader.seekToParagraph(localAnchor, {}); } catch (e) {}
      }
      try {
        updatePlacePin(globalPos(reader.getPosition()));
      } catch (e) {}
      if (wasPlaying) { try { reader.play(); } catch (e) {} }
    }
    if (reader) startMeterWatch(id, DocStore.getLoadedTextSync(id) || '');
    refreshVoicePanel();
    if (window.DogEarBridge) {
      try {
        window.DogEarBridge.registerReader(reader, meta.title,
          { docId: id, placeKey: placeKey(id) });
      } catch (e) {}
    }
    renderMarks();
  }
  function globalPos(localPos) {
    if (!localPos || !current || !current.chunked) return localPos;
    var sm = DocStore.getMetaSync(current.id);
    return {
      index: localPos.index, count: localPos.count,
      paragraph: current.winParaStart + localPos.paragraph,
      paragraphs: sm ? (sm.totalParas || localPos.paragraphs) : localPos.paragraphs,
      progress: localPos.progress, state: localPos.state, range: localPos.range,
    };
  }
  function onWindowPosition(pos) {
    if (!current || !current.chunked) return;
    var g = globalPos(pos);
    saveGPlace(current.id, g.paragraph, g.paragraphs);
    // The ReaderCore-shaped place record mirrors the paragraph
    // place for the surfaces that read it (library chip, meter):
    // for a windowed document the unit IS the paragraph.
    try {
      localStorage.setItem(placeKey(current.id),
        JSON.stringify({ i: g.paragraph, n: g.paragraphs, t: Date.now(), para: true }));
    } catch (e) {}
    updatePlacePin(g);
    saveReadPlace(current.id, g.paragraph, g.paragraphs);
    syncNavButtons(g);
    syncRangeMsg(g);
    refreshNowBar();
    maybeExtendWindow(pos);
  }
  /* A chunk landed for the document that is OPEN: if the
     window's end was the old end of the landed text, the
     window grows to take in what has arrived (rebuilt at the
     same paragraph, playing state kept) — a document opened
     on its first chunk must not stay a one-chunk document
     after the rest of it is on the device. */
  function extendOpenWindowToLanded(id) {
    if (!current || current.id !== id || !current.reader) return;
    var sm = DocStore.getMetaSync(id);
    if (!sm || sm.chunkCount <= 1) return;
    if (current.chunked && current.winEndChunk >= sm.chunkCount) return;
    // Also the conversion case: the document was opened when
    // only its first chunk had landed, so it was rendered as a
    // plain single-chunk document; now that more of it is on
    // the device, it reopens windowed at the same paragraph.
    var pos = current.reader.getPosition();
    var globalPara = current.chunked
      ? current.winParaStart + (pos ? pos.paragraph : 0)
      : (pos ? pos.paragraph : 0);
    var wasPlaying = current.reader.getState() === 'playing';
    openDocWindowed(id, indexEntry(id), sm, null, globalPara, wasPlaying);
  }

  var extendTimer = null;
  function maybeExtendWindow(pos) {
    if (!current || !current.chunked || current.extending || !current.reader) return;
    // Playback only: a seek or a rebuild also reports position,
    // and extending on those would cascade window rebuilds.
    if (pos.state !== 'playing') return;
    var sm = DocStore.getMetaSync(current.id);
    if (!sm) return;
    var needNext = pos.paragraph >= pos.paragraphs - WINDOW_EDGE_PARAS &&
      current.winEndChunk < sm.chunkCount;
    var needPrev = pos.paragraph <= WINDOW_EDGE_PARAS && current.winStartChunk > 0;
    if (!needNext && !needPrev) return;
    /* The rebuild is DEFERRED out of this callback: position
       reports fire from inside the reader's own speak/seek
       calls, and rebuilding the reader reentrantly — inside
       its own dispatch — leaves the old reader to finish
       dispatching an utterance into a world that has replaced
       it. Decided here, executed a tick later, revalidated
       then: the listener hears the current paragraph's start
       once more after an extension, and nothing else moves. */
    if (extendTimer) return;
    var idAtSchedule = current.id;
    extendTimer = setTimeout(function () {
      extendTimer = null;
      if (!current || current.id !== idAtSchedule || !current.chunked || !current.reader) return;
      var sm2 = DocStore.getMetaSync(idAtSchedule);
      if (!sm2) return;
      var pos2 = current.reader.getPosition();
      var goNext = pos2.paragraph >= pos2.paragraphs - WINDOW_EDGE_PARAS &&
        current.winEndChunk < sm2.chunkCount;
      var goPrev = pos2.paragraph <= WINDOW_EDGE_PARAS && current.winStartChunk > 0;
      if (!goNext && !goPrev) return;
      current.extending = true;
      var globalPara = current.winParaStart + pos2.paragraph;
      var wasPlaying = current.reader.getState() === 'playing';
      var range = {
        start: goPrev ? Math.max(0, current.winStartChunk - 1) : current.winStartChunk,
        end: goNext ? Math.min(sm2.chunkCount, current.winEndChunk + 1) : current.winEndChunk,
      };
      openDocWindowed(idAtSchedule, indexEntry(idAtSchedule), sm2, range, globalPara, wasPlaying);
    }, 0);
  }

  function openDoc(id) {
    var meta = indexEntry(id);
    var sm = DocStore.getMetaSync(id);
    if (sm && sm.chunkCount > 1) { openDocWindowed(id, meta, sm); return; }
    var text = getBodyTextSync(id);
    if (sm && sm.chunkCount > 0 && text === null) {
      // IndexedDB-backed body, not in this session's cache yet.
      DocStore.getText(id).then(function () { openDoc(id); });
      return;
    }
    if (!meta || !text) { renderLibrary(); return; }
    closeReader();
    duplexStop();
    $('homeView').hidden = true;
    $('aboutView').hidden = true;
    $('readView').hidden = false;
    $('docTitle').textContent = meta.title;
    applyDocView();
    var docSheet1 = $('docSheet');
    if (docSheet1) docSheet1.hidden = true;
    updateSpeechWarn();
    refreshBattNotice();
    // The day's start gate — the ONLY place the meter can say
    // no, and it says it here, before any listening begins: at
    // the cap, a document not yet begun opens for reading on
    // screen but gets no Listen control, with the reason and the
    // way out shown above it. A document with a saved place, or
    // begun today, is a continuation and is never gated.
    var savedPlace = loadPlace(id);
    var gated = !!(meter &&
      !meter.canStart(id, !!(savedPlace && savedPlace.i > 0)));
    var capEl = $('capNotice');
    if (capEl) capEl.hidden = !gated;
    var body = $('docBody');
    body.innerHTML = '';
    text.split(/\n{2,}/).forEach(function (para) {
      var p = para.replace(/\s+/g, ' ').trim();
      if (!p) return;
      var el;
      if (/^#{1,3}\s/.test(p)) {
        el = document.createElement('h2');
        el.textContent = p.replace(/^#{1,3}\s*/, '');
      } else {
        el = document.createElement('p');
        el.textContent = p;
      }
      body.appendChild(el);
    });
    // 1.7.0 navigation: a plain action row after every block —
    // a SIBLING of the block, never inside it, so the button
    // words are never read aloud. The row carries no bare text
    // (the words live inside the buttons), so the engine's
    // orphan scan never mistakes a row for a paragraph.
    var navKids = Array.prototype.slice.call(body.children);
    var paraIx = 0;
    navKids.forEach(function (el) {
      if (el.tagName !== 'P' && el.tagName !== 'H2') return;
      var row = document.createElement('div');
      row.className = 'para-actions';
      var from = document.createElement('button');
      from.type = 'button';
      from.className = 'ghost para-from';
      from.setAttribute('data-para', String(paraIx));
      from.textContent = 'Read from here';
      var only = document.createElement('button');
      only.type = 'button';
      only.className = 'ghost para-only';
      only.setAttribute('data-para', String(paraIx));
      only.textContent = 'Read this only';
      row.appendChild(from);
      row.appendChild(only);
      el.after(row);
      paraIx++;
    });
    refreshParaVoiceState();
    window.scrollTo(0, 0);
    var skipNoticeEl = $('skipNotice');
    if (skipNoticeEl) skipNoticeEl.hidden = true; // per document
    var reader = null;
    var usePack = packVoiceActive();
    // The pack transport needs no platform speech API: with the
    // pack driving, the reader is built even where speechOK is
    // false — the pack IS this browser's voice.
    if ((speechOK || usePack) && window.ReaderCore && !gated) {
      var readerOpts = {
        root: body,
        mount: $('readerMount'),
        storageKey: placeKey(id),
        voiceURI: loadVoicePref(),
        speeds: READER_SPEEDS,
        onPosition: function (pos) {
          updatePlacePin(pos);
          saveReadPlace(id, pos.paragraph, pos.paragraphs);
          syncNavButtons(pos);
          syncRangeMsg(pos);
          refreshNowBar();
        },
        onRangeEnd: function () {
          rangeMsgScope = null;
          setRangeMsg('That is the end of the part you chose. ' +
            'Your place is kept there.');
        },
        onChunkSkipped: function () {
          // The voice pack's recovery ladder was exhausted for
          // one chunk and the reader skipped it (reader-core
          // fires this once per reader): say so where the
          // listener is looking, in plain words.
          var n = $('skipNotice');
          if (n) n.hidden = false;
        },
        onVoicesChanged: function () { refreshVoicePicker(); },
      };
      if (usePack) {
        // Reader-core 0.4.0 seam: the pack transport drives the
        // reader; its synthetic localService voices pass the
        // reader's on-device filter unchanged, and the default
        // resolves to af_heart (first, en-US) through the
        // reader's own default-voice rule.
        readerOpts.synth = ttsPack.transport;
        readerOpts.UtteranceCtor = ttsPack.Utterance;
      }
      reader = window.ReaderCore.create(readerOpts);
      if (reader) syncReaderSpeed();
    }
    current = { id: id, reader: reader, synthKind: usePack ? 'pack' : 'platform' };
    refreshImportBanner();
    refreshVoicePicker();
    try {
      updatePlacePin(reader ? reader.getPosition() : null);
    } catch (e) {}
    if (reader) startMeterWatch(id, text);
    refreshVoicePanel();
    // Android shell: hand the native side this reader + title so the
    // playback notification / lock-screen controls drive THIS reader.
    // No-op in any browser (DogEarBridge exists only in the shell).
    // Beta.5: the meta carries the document id + place-record key so
    // the native PlayerCore holds the session and the position.
    if (window.DogEarBridge) {
      try {
        window.DogEarBridge.registerReader(reader, meta.title,
          { docId: id, placeKey: placeKey(id) });
      } catch (e) {}
    }
    renderMarks();
  }
  function closeReader() {
    wdDisarm();
    /* The microphone dies with the reader: duplex listening
       exists to guard this session's speech, and a torn-down
       session leaves nothing for it to guard (owner ruling
       2026-11-11: the mic must not stay hot beyond the talk
       it serves). */
    duplexStop();
    if (extendTimer) { clearTimeout(extendTimer); extendTimer = null; }
    stopMeterWatch();
    if (window.DogEarBridge) {
      try { window.DogEarBridge.registerReader(null); } catch (e) {}
    }
    if (current && current.reader) { try { current.reader.destroy(); } catch (e) {} }
    current = null;
    $('readerMount').innerHTML = '';
  }
  function showHome() {
    /* Clarity item 8: going home while listening does NOT kill
       the session — the Now-listening bar keeps it reachable
       (pause/stop/tap back in). The teardown is deferred until
       the session ends on its own (the bar's refresh then finds
       it idle and closes it), is stopped from the bar, or
       another document opens (openDoc closes as before). */
    if (!readerSessionLive()) closeReader();
    $('readView').hidden = true;
    $('aboutView').hidden = true;
    $('homeView').hidden = false;
    closeManageSheet();
    renderLibrary();
    refreshPlanUI();
    refreshNowBar();
    if (!readerSessionLive() && current) {
      // A deferred session ended while the library was up.
      closeReader();
      refreshNowBar();
      renderLibrary();
    }
  }

  /* ---------------- voice models (two-way voice) ----------------
     The panel lives on the reading screen, under the reader. It
     is a MODEL PICKER: a shelf of speech-recognition models the
     listener chooses from (MyMilo's pattern) — each model a
     user-chosen download under its own licence, shown on the
     shelf before download, all riding on one shared runtime.
     Nothing about reading changes with any of this.
     The panel is honest in every state: locked (what it is, that
     it comes with the unlock — NO rows, NO buttons that can only
     fail), nothing installed (choose a model; the recommended
     one is marked), partial (finish the download), downloading
     (real progress from the fetch stream), installed (Talk for
     the model in use; Use/Delete per row). With no model
     installed, nothing in this section runs and reading is
     exactly as it was before voice models existed.
     Talk flow: pause the reader if it is playing, listen on the
     device, transcribe on the device, then either steer the
     reader (voice commands) or answer a question by QUOTING the
     open document (retrieval.js). If the reader was playing and
     the outcome was not itself a playback command, playback
     resumes afterwards. Answers are also shown on screen, for
     the moments speaking aloud is not possible. */
  var voice = null;           // DogEarVoicePack instance
  var voiceDownloading = false;
  var voiceDownloadingId = null;
  var voiceListening = null;  // { stop } while capturing
  var voiceModelInstalled = false; // panel's last known truth (beta.6: feeds the self-model's Talk answer)
  var voiceBusy = false;      // engine starting
  var voiceRefreshSeq = 0;
  var ttsPack = null;         // DogEarTtsPack instance (bundled studio voices)
  var ttsInstalled = false;   // TTS pack files verified on this device
  var ttsDownloading = false;
  var ttsPackBytes = 0;       // registry size, for the picker entry
  var ttsRuntimeBytes = 0;    // shared runtime size, for the picker entry
  var ttsRuntimePresent = false; // shared runtime already on this device
  var packSpeaker = null;     // DogEarSpeaker over the pack transport

  function fmtMB(bytes) {
    if (!bytes) return '';
    var mb = bytes / 1048576;
    return (mb >= 100 ? Math.round(mb) : Math.round(mb * 10) / 10) + ' MB';
  }
  function setVoiceMsg(text, isErr) { setMsg($('voiceMsg'), text, isErr); }
  function registryModelSize(model) {
    if (typeof model.totalBytes === 'number') return model.totalBytes;
    return (model.files || []).reduce(function (a, f) { return a + f.bytes; }, 0);
  }
  /* The size the picker names for the pack download: the same
     bytes the download itself counts. The download fetches the
     shared runtime with the pack when the runtime is not on
     this device yet — fetched once, it then serves every
     model — so a first download is the two together, and the
     offer says so; with the runtime already here, the pack's
     own size is the whole download. (Naming the pack's size
     alone understated the first download: the progress line
     counts both, and the two numbers disagreed.) */
  function ttsDownloadSizeNote() {
    if (!ttsPackBytes) return '';
    if (!ttsRuntimePresent && ttsRuntimeBytes) {
      return ' (' + fmtMB(ttsPackBytes + ttsRuntimeBytes) +
        ' in all \u2014 the pack plus the shared runtime, fetched once)';
    }
    return ' (' + fmtMB(ttsPackBytes) + ')';
  }
  function registryModelById(reg, id) {
    for (var i = 0; i < reg.models.length; i++) {
      if (reg.models[i].id === id) return reg.models[i];
    }
    return null;
  }

  function buildVoiceRow(model, status, selectedId) {
    var row = document.createElement('div');
    row.className = 'voicemodel';
    row.setAttribute('data-model', model.id);
    var size = status.totalBytes || registryModelSize(model);
    var head = document.createElement('p');
    head.className = 'vmhead';
    head.textContent = model.label + ' \u2014 ' + fmtMB(size);
    if (model.recommended) {
      head.appendChild(document.createTextNode(' '));
      var badge = document.createElement('span');
      badge.className = 'chip';
      badge.textContent = 'Recommended';
      head.appendChild(badge);
    }
    row.appendChild(head);
    var guide = document.createElement('p');
    guide.className = 'vmguide';
    guide.textContent = model.kind === 'tts'
      ? (model.guidance || '')
      : (model.guidance || '') +
        (model.measuredWer != null
          ? ' In our 24-question test it misheard about ' +
            Math.round(model.measuredWer * 100) + '% of words.'
          : ' Not measured on our bench yet.');
    row.appendChild(guide);
    if (model.license && model.license.name) {
      var lic = document.createElement('p');
      lic.className = 'vmlic fine';
      lic.appendChild(document.createTextNode('Model licence: '));
      if (model.license.url) {
        var a = document.createElement('a');
        a.href = model.license.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = model.license.name;
        lic.appendChild(a);
      } else {
        lic.appendChild(document.createTextNode(model.license.name));
      }
      row.appendChild(lic);
    }
    if (status.state === 'partial') {
      var part = document.createElement('p');
      part.className = 'fine';
      part.textContent = 'Partly on this device (' +
        fmtMB(status.bytesPresent) + ' of ' + fmtMB(size) +
        ') \u2014 finishing the download picks up where it left off.';
      row.appendChild(part);
    }
    /* Capability gate (voicepack.modelRunnableHere, evidence
       2026-10-22): a model the in-app engine cannot safely run
       gets NO download/use button \u2014 a button that can only
       kill the app is worse than no button. The reason stands
       on the row; Delete stays, so a copy fetched before the
       gate can still be reclaimed. */
    var runnable = !voice || voice.modelRunnableHere(model);
    if (!runnable) {
      var gate = document.createElement('p');
      gate.className = 'vmgate fine';
      gate.textContent = voice.gateReason;
      row.appendChild(gate);
    }
    var btnrow = document.createElement('div');
    btnrow.className = 'btnrow';
    var action = document.createElement('button');
    action.type = 'button';
    var isSelected = model.id === selectedId;
    if (model.kind === 'tts' && status.state === 'installed') {
      /* The voice pack is not a Talk model: no Use button. Its
         voices are chosen in the reading-voice picker above. */
      action.textContent = 'On this device';
      action.className = 'primary vm-action';
      action.setAttribute('data-action', 'inuse');
      action.disabled = true;
    } else if (status.state === 'installed' && isSelected) {
      action.textContent = 'In use';
      action.className = 'primary vm-action';
      action.setAttribute('data-action', 'inuse');
      action.disabled = true;
    } else if (status.state === 'installed') {
      action.textContent = 'Use this model';
      action.className = 'ghost vm-action';
      action.setAttribute('data-action', 'use');
      action.disabled = voiceDownloading;
      (function (id) {
        action.addEventListener('click', function () { onVoiceUse(id); });
      })(model.id);
    } else {
      action.textContent = voiceDownloading && voiceDownloadingId === model.id
        ? 'Downloading\u2026'
        : (status.state === 'partial' ? 'Finish download' : 'Download');
      action.className = 'primary vm-action';
      action.setAttribute('data-action', 'download');
      action.disabled = voiceDownloading;
      (function (id) {
        action.addEventListener('click', function () { onVoiceDownload(id); });
      })(model.id);
    }
    if (runnable) btnrow.appendChild(action);
    if (status.state === 'installed' || status.state === 'partial') {
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'ghost danger vm-delete';
      del.textContent = 'Delete';
      del.disabled = voiceDownloading;
      (function (id, label) {
        del.addEventListener('click', function () { onVoiceDeleteModel(id, label); });
      })(model.id, model.label);
      btnrow.appendChild(del);
    }
    row.appendChild(btnrow);
    return row;
  }

  function refreshVoicePanel() {
    var box = $('voiceBox');
    if (!box) return;
    if (!voice) { box.hidden = true; return; }
    box.hidden = false;
    var st = $('voiceState'), talk = $('voiceTalkBtn'),
        prog = $('voiceProgress'), modelsEl = $('voiceModels'),
        storageEl = $('voiceStorage');
    /* Clarity item 5 (Milo friction 6): the locked Talk panel
       used to be a wall — heading + explainer, no way forward.
       It now carries one clear next action to the unlock path
       (visible exactly while locked; the handler is wired with
       the Talk controls). */
    var vub = $('voiceUnlockBtn');
    if (vub) vub.hidden = isUnlocked();
    if (!isUnlocked()) {
      st.textContent = 'Talk to the reader, and ask questions about ' +
        'the document you have open \u2014 two-way voice is part of the ' +
        'DogEar unlock. After unlocking, you choose a speech model ' +
        '(Tiny, Base, Small, Medium or Large) and download it once; ' +
        'it then listens on this device only: your voice is never ' +
        'uploaded, and answers are read straight from your ' +
        'document\u2019s own words.';
      if (modelsEl) modelsEl.innerHTML = '';
      if (storageEl) storageEl.hidden = true;
      var brainLocked = $('brainBox');
      if (brainLocked) brainLocked.hidden = true;
      var convLocked = $('convBox');
      if (convLocked) convLocked.hidden = true;
      var notesLocked = $('notesBox');
      if (notesLocked) notesLocked.hidden = true;
      talk.hidden = true;
      prog.hidden = true;
      return;
    }
    var brainBoxEl = $('brainBox');
    if (brainBoxEl) brainBoxEl.hidden = false;
    var convBoxEl = $('convBox');
    if (convBoxEl) convBoxEl.hidden = false;
    var notesBoxEl = $('notesBox');
    if (notesBoxEl) notesBoxEl.hidden = false;
    var seq = ++voiceRefreshSeq;
    Promise.all([voice.getRegistry(), voice.getSelectedModelId()])
      .then(function (pair) {
        var reg = pair[0], selectedId = pair[1];
        return Promise.all(reg.models.map(function (m) {
          return voice.status(m.id);
        })).then(function (statuses) {
          return { reg: reg, selectedId: selectedId, statuses: statuses };
        });
      }).then(function (ctx) {
        if (seq !== voiceRefreshSeq) return;
        var reg = ctx.reg, selectedId = ctx.selectedId, statuses = ctx.statuses;
        var selModel = registryModelById(reg, selectedId) || reg.models[0];
        var selStatus = statuses[reg.models.indexOf(selModel)];
        if (voiceDownloading) {
          var dlModel = registryModelById(reg, voiceDownloadingId);
          st.textContent = 'Downloading the ' +
            (dlModel ? dlModel.label : 'voice') + ' model\u2026';
          prog.hidden = false;
          talk.hidden = true;
        } else {
          prog.hidden = true;
          if (selStatus && selStatus.state === 'installed' &&
              voice.modelRunnableHere(selModel)) {
            st.textContent = 'The ' + selModel.label + ' voice model ' +
              'is on this device \u2014 speech is recognized here, never ' +
              'uploaded. Tap Talk, then say a command (\u201cpause\u201d, ' +
              '\u201cgo back\u201d, \u201cstart over\u201d) or ask a question about ' +
              'this document.';
            voiceModelInstalled = true;
            talk.hidden = false;
            scheduleWarmVoice();
          } else if (selStatus && selStatus.state === 'installed') {
            st.textContent = 'The ' + selModel.label + ' voice model ' +
              'is on this device, but it is not offered in the app ' +
              'yet \u2014 it needs more memory than the in-app voice ' +
              'engine can safely use. Choose Tiny or Base below.';
            talk.hidden = true;
          } else {
            var anyInstalled = statuses.some(function (s, i) {
              return s.state === 'installed' &&
                voice.modelRunnableHere(reg.models[i]);
            });
            voiceModelInstalled = anyInstalled;
            st.textContent = anyInstalled
              ? 'The ' + selModel.label + ' model is not on this ' +
                'device yet \u2014 download it below, or use a model ' +
                'that is already here. Your voice is recognized on ' +
                'the device and is never uploaded.'
              : 'Two-way voice needs a speech model that runs on ' +
                'this device. Choose a model below \u2014 it downloads ' +
                'once, stays on this device, and can be removed here ' +
                'at any time. Your voice is recognized on the device ' +
                'and is never uploaded.';
            talk.hidden = true;
          }
        }
        if (modelsEl) {
          modelsEl.innerHTML = '';
          reg.models.forEach(function (m, i) {
            modelsEl.appendChild(buildVoiceRow(m, statuses[i], selectedId));
          });
        }
        if (storageEl) {
          var runtimeBytes = (reg.runtime.files || [])
            .reduce(function (a, f) { return a + f.bytes; }, 0);
          var runtimePresent = statuses.some(function (s) {
            return s.runtimePresent;
          });
          var onDevice = statuses.reduce(function (a, s) {
            return a + (s.state === 'installed' ? s.totalBytes : 0);
          }, 0) + (runtimePresent ? runtimeBytes : 0);
          storageEl.hidden = !(onDevice > 0);
          if (onDevice > 0) {
            storageEl.textContent = 'Voice models on this device: ' +
              fmtMB(onDevice);
          }
        }
      }).catch(function () {
        if (seq !== voiceRefreshSeq) return;
        st.textContent = 'The voice model shelf could not be loaded ' +
          'just now \u2014 check your connection and reopen this document.';
        talk.hidden = true;
      });
  }

  function refreshAboutVoice() {
    var el = $('aboutVoiceState');
    if (!el || !voice) return;
    if (!isUnlocked()) {
      el.textContent = 'On this device: two-way voice comes with ' +
        'the DogEar unlock \u2014 it is not unlocked here.';
      return;
    }
    Promise.all([voice.getRegistry(), voice.getSelectedModelId()])
      .then(function (pair) {
        var reg = pair[0], selectedId = pair[1];
        var model = registryModelById(reg, selectedId) || reg.models[0];
        return voice.status(model.id).then(function (s) {
          el.textContent = s.state === 'installed' &&
              !voice.modelRunnableHere(model)
            ? 'On this device: the ' + model.label + ' voice model ' +
              'is downloaded, but it is not offered in the app yet ' +
              '\u2014 it needs more memory than the in-app voice ' +
              'engine can safely use. Tiny and Base run safely here.'
            : s.state === 'installed'
            ? 'On this device: the ' + model.label + ' voice model ' +
              'is downloaded' +
              (s.totalBytes ? ' (' + fmtMB(s.totalBytes) + ')' : '') +
              ' and in use \u2014 remove it any time from a ' +
              'document\u2019s reading screen.'
            : 'On this device: no voice model is downloaded. ' +
              'You choose and download a model from any ' +
              'document\u2019s reading screen.';
        });
      }).catch(function () {});
  }

  function disableVoiceRowButtons() {
    var modelsEl = $('voiceModels');
    if (!modelsEl) return;
    Array.prototype.forEach.call(
      modelsEl.querySelectorAll('button'), function (b) { b.disabled = true; });
  }

  function onVoiceDownload(modelId) {
    if (!voice || voiceDownloading) return;
    voiceDownloading = true;
    voiceDownloadingId = modelId;
    disableVoiceRowButtons();
    var talk = $('voiceTalkBtn');
    if (talk) talk.hidden = true;
    refreshVoicePanel();
    voice.download(modelId, function (p) {
      var prog = $('voiceProgress');
      if (prog && p.totalBytes > 0) {
        prog.hidden = false;
        prog.max = p.totalBytes;
        prog.value = p.doneBytes;
      }
      setVoiceMsg('Downloading the voice model \u2014 ' + fmtMB(p.doneBytes) +
        ' of ' + fmtMB(p.totalBytes) + '\u2026', false);
    }).then(function (r) {
      voiceDownloading = false;
      voiceDownloadingId = null;
      var prog = $('voiceProgress');
      if (prog) prog.hidden = true;
      if (r.ok && ttsPack && modelId === ttsPack.modelId) {
        ttsInstalled = true;
        ttsRuntimePresent = true; // the download brought it (or it was here)
        setVoiceMsg('The DogEar voice pack is on this device. ' +
          'Choose a pack voice in the reading voice list \u2014 ' +
          'Heart is the default.', false);
        onTtsPackStateChanged();
        refreshVoicePicker();
      } else if (r.ok) {
        setVoiceMsg('The voice model is on this device. Tap Talk to DogEar to use it.', false);
      } else {
        setVoiceMsg(r.reason, !r.cancelled);
      }
      refreshVoicePanel();
      refreshAboutVoice();
    });
  }

  function onVoiceUse(modelId) {
    if (!voice || voiceDownloading) return;
    voice.setSelectedModelId(modelId);
    setVoiceMsg('', false);
    refreshVoicePanel();
    refreshAboutVoice();
  }

  function onVoiceDeleteModel(modelId, label) {
    if (!voice || voiceDownloading) return;
    voice.getSelectedModelId().then(function (selectedId) {
      return voice.removeModel(modelId).then(function () {
        var ans = $('voiceAnswer');
        if (ans) ans.hidden = true;
        var heard = $('voiceHeard');
        if (heard) heard.hidden = true;
        if (selectedId === modelId) {
          setVoiceMsg('The ' + label + ' model is removed. Reading is unchanged.', false);
        } else {
          setVoiceMsg('The ' + label + ' model is removed.', false);
        }
        if (ttsPack && modelId === ttsPack.modelId) {
          ttsInstalled = false;
          refreshVoicePicker();
          if (current && current.synthKind === 'pack') {
            rebuildReaderForVoiceChange();
          }
          onTtsPackStateChanged();
        }
        refreshVoicePanel();
        refreshAboutVoice();
      });
    });
  }

  /* Speak text aloud with the device voice. Beta.6 (R2): the
     completing speaker (speaker.js) owns this now — pieces are
     spoken one at a time, each awaited, with a stall watchdog,
     one re-speak recovery, and a completion ledger. The old
     queue-everything-at-once body survives only as the fallback
     for a build where the speaker module failed to load. An
     incomplete job is surfaced to the listener in words (R3):
     shown, and spoken once as a single short line. */
  function speakAloud(text) {
    if (!speechUsable() || !('speechSynthesis' in window)) return false;
    /* Duplex (item 10): remember what DogEar itself is about
       to say (the echo fingerprint) and make sure duplex
       listening is live while the answer speaks. */
    duplexSpokenText = String(text);
    duplexSpokenAt = Date.now();
    duplexStart();
    /* 1.7.0: answers speak in the listener's chosen reading
       voice (the reader's resolved voice), when there is one. */
    var chosenVoice = null;
    try {
      chosenVoice = current && current.reader
        ? current.reader.getVoice() : null;
    } catch (e) {}
    var fxNow = fxGet();
    var spk = answerSpeaker();
    if (spk) {
      spk.speak(text, {
        voice: chosenVoice || undefined,
        rate: fxNow.speed, pitch: fxNow.pitch, volume: fxNow.volume,
      })
        .then(function (job) {
        /* Lane 3 (duplex refinement): the echo fingerprint's
           grace runs from when the speech ENDS, not from when
           it started — a long answer is still speaking long
           after it began, and its tail must stay recognisable
           as DogEar's own voice. */
        duplexSpokenAt = Date.now();
        if (job && !job.completed && !job.aborted && job.lost > 0) {
          onSpeechIncomplete(job);
        }
        /* The sound this answer armed the microphone for has
           ended; if nothing else is sounding, the mic's
           warrant ends with it (duplexIdleStop, by duplexStop). */
        duplexIdleStop();
      });
      return true;
    }
    try {
      var synth = window.speechSynthesis;
      synth.cancel();
      var parts = String(text).match(/[^.!?]+[.!?]+["\u201d]?\s*|[^.!?]+$/g) || [String(text)];
      var queue = [];
      parts.forEach(function (p) {
        p = p.trim();
        while (p.length > 240) {
          var cut = p.lastIndexOf(' ', 240);
          if (cut < 80) cut = 240;
          queue.push(p.slice(0, cut));
          p = p.slice(cut).trim();
        }
        if (p) queue.push(p);
      });
      queue.forEach(function (q) {
        var u = new SpeechSynthesisUtterance(q);
        u.rate = fxNow.speed;
        try { u.pitch = fxNow.pitch; } catch (e) {}
        try { u.volume = Math.min(1, fxNow.volume); } catch (e) {}
        if (chosenVoice) { try { u.voice = chosenVoice; } catch (e) {} }
        synth.speak(u);
      });
      return true;
    } catch (e) { return false; }
  }

  var SPEECH_INCOMPLETE_LINE = 'The voice stopped before ' +
    'finishing that — the speech engine dropped part of it. ' +
    'The full words are on the screen. Ask me again, or keep ' +
    'reading.';
  function onSpeechIncomplete(job) {
    setVoiceMsg(SPEECH_INCOMPLETE_LINE, true);
    /* One short raw utterance for the notice — deliberately
       NOT routed through the speaker (a notice about the
       speaker must not recurse into it). If the transport is
       truly dead this fails silently and the shown line is
       the record; the job's ledger entry is the defect. */
    try {
      var u = new SpeechSynthesisUtterance(
        'The voice stopped before finishing that. The full ' +
        'words are on the screen.');
      var nfx = fxGet();
      u.rate = nfx.speed;
      try { u.pitch = nfx.pitch; } catch (e) {}
      try { u.volume = Math.min(1, nfx.volume); } catch (e) {}
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  /* Beta.6 (R3): a failure in the Talk loop is SPOKEN as well
     as shown — a voice user who hears silence learns nothing.
     The answer box keeps the same words for the eyes. */
  function sayFailure(line) {
    setVoiceMsg(line, true);
    speakAloud(line);
  }

  function resumeIf(wasPlaying) {
    if (wasPlaying && current && current.reader &&
        current.reader.getState() !== 'playing') {
      try { current.reader.play(); } catch (e) {}
    }
  }

  function seekToChunk(ni, label, opts) {
    var p = current && loadPlace(current.id);
    var ans = $('voiceAnswer');
    ans.hidden = false;
    if (!p || !current.reader) {
      ans.textContent = 'Start listening first \u2014 once the reader ' +
        'has a place in this document, your voice can move it.';
      return;
    }
    ni = Math.max(0, Math.min(p.n - 1, ni));
    var wasPlaying = current.reader.getState() === 'playing';
    if (current.chunked) saveGPlace(current.id, ni, p.n);
    try {
      localStorage.setItem(placeKey(current.id),
        JSON.stringify({ i: ni, n: p.n, t: p.t }));
    } catch (e) {}
    /* Clarity item 11: deliberate reading steering (voice
       back/forward, a mark jump) moves the READING track, so
       its own record follows — written from the reopened
       reader's reported paragraph below. A position arriving
       from a Continue event (opts.fromContinue) does NOT write
       here: that event consumes the reading record, it never
       writes it — letting it write is how an answering-track
       position used to replace the reading place. */
    var id = current.id;
    openDoc(id);
    if (wasPlaying && current && current.reader) {
      try { current.reader.play(); } catch (e) {}
    }
    if (!(opts && opts.fromContinue) && current && current.reader) {
      try {
        var np = current.reader.getPosition();
        if (np) {
          var sm2 = DocStore.getMetaSync(id);
          saveReadPlace(id,
            current.chunked
              ? current.winParaStart + np.paragraph
              : np.paragraph,
            current.chunked
              ? (sm2 && sm2.totalParas) || np.paragraphs
              : np.paragraphs);
        }
      } catch (e) {}
    }
    ans = $('voiceAnswer');
    ans.hidden = false;
    ans.textContent = label;
  }

  function runVoiceControl(action) {
    var ans = $('voiceAnswer');
    ans.hidden = false;
    var r = current && current.reader;
    if (!r) {
      ans.textContent = 'This document has no Listen control right ' +
        'now, so voice commands can\u2019t steer it.';
      return;
    }
    var st = r.getState();
    if (action === 'play' || action === 'resume') {
      if (st !== 'playing') r.play();
      ans.textContent = action === 'resume' ? 'Resumed.' : 'Listening.';
    } else if (action === 'pause') {
      if (st === 'playing') r.play();  // play toggles
      ans.textContent = 'Paused.';
    } else if (action === 'stop') {
      r.stop();
      ans.textContent = 'Stopped.';
    } else if (action === 'back') {
      var p1 = loadPlace(current.id);
      seekToChunk((p1 ? p1.i : 0) - 4, 'Back a bit.');
    } else if (action === 'forward') {
      var p2 = loadPlace(current.id);
      seekToChunk((p2 ? p2.i : 0) + 4, 'Forward a bit.');
    } else if (action === 'startover') {
      seekToChunk(0, 'Back to the start.');
    }
  }

  /* Beta.6 (R1): the context the self-model composes from —
     only what this page actually knows, at this moment. */
  function selfContext() {
    return {
      config: CFG,
      unlocked: isUnlocked(),
      surface: (window.DogEarNative ? 'app' : 'browser'),
      modelInstalled: voiceModelInstalled,
    };
  }

  /* Beta.6 response units (R4). Every spoken answer is built
     the same way — lead, content, offer — so a listener always
     hears a complete unit, never a fragment:
       refusal: the refusal + the document's own reason + an
                offer that names what CAN be done;
       quote:   the lead + the document's words + a closer
                offering the natural next step;
       self:    the self-model's section (which ends with its
                own offer);
       unknown: the guidance, SPOKEN (it was shown-only).     */
  function handleHeard(text, wasPlaying) {
    var heard = $('voiceHeard');
    if (heard) {
      heard.hidden = false;
      heard.textContent = 'You said: \u201c' + text + '\u201d';
    }
    var intent = voice.parseIntent(text);
    if (intent.type === 'control') {
      setVoiceMsg('', false);
      runVoiceControl(intent.action);
      return;
    }
    var ans = $('voiceAnswer');
    /* R1: questions about the APP ITSELF route to the
       self-model, before the document is ever consulted —
       checked for question AND unknown shapes ("help"), and
       never for commands (handled above). */
    var selfTopic = (window.DogEarSelfModel && intent.type !== 'control')
      ? window.DogEarSelfModel.match(text) : null;
    if (selfTopic) {
      var selfLine = window.DogEarSelfModel.answerFor(selfTopic, selfContext());
      ans.hidden = false;
      ans.textContent = selfLine;
      setVoiceMsg('', false);
      speakAloud(selfLine);
      recordExchange(text, selfLine);
      resumeIf(wasPlaying);
      return;
    }
    if (intent.type === 'question' && current) {
      /* Questions are answered from the chunks on this device:
         the whole document when it has fully landed, the part
         that has landed so far while it is still loading — the
         answer grows with the document, honestly. */
      var bodyText = getBodyTextSync(current.id);
      if (bodyText === null || bodyText === undefined) {
        bodyText = DocStore.getLoadedTextSync(current.id);
      }
      var res = voice.ask(bodyText || '', intent.text);
      ans.hidden = false;
      if (!res.ok) {
        sayFailure(res.reason);
      } else if (res.refused) {
        var line = 'I couldn\u2019t find that in this document. ' +
          (res.refusal ? res.refusal.reason : '') +
          ' Ask me about something the document does cover \u2014 ' +
          'or say \u201ccontinue\u201d and I will keep reading.';
        ans.textContent = line;
        speakAloud(line);
        recordExchange(intent.text, line);
      } else {
        /* 1.7.0: if the listener named their own answer model,
           it composes the answer FROM these passages (the
           refusal gates above have already run — a refused
           question never reaches it). Any failure falls back
           to the quotation, so the loop always closes. */
        var brain = loadBrain();
        if (brain) {
          ans.textContent = 'Asking your model\u2026';
          /* Lane 3 (duplex refinement): arm duplex for the
             THINKING phase too. Duplex used to arm only when
             something spoke (speakAloud / reader play), so a
             first question's answer could not be barged in on
             while it was forming — the monitor did not exist
             yet. Arming here makes onset-abort work from the
             first question on. */
          duplexStart();
          /* Duplex (item 10): a barge-in aborts this call and
             bumps the generation; a stale answer — aborted or
             merely late — then closes quietly instead of
             speaking over the listener's new words. */
          var gen = ++duplexGen;
          var ctrl = (typeof AbortController !== 'undefined')
            ? new AbortController() : null;
          answerAbort = ctrl;
          brainAnswer(brain, intent.text, res.passages, res.quote,
              ctrl ? ctrl.signal : null)
            .then(function (composed) {
              if (gen !== duplexGen) { resumeIf(wasPlaying); return; }
              answerAbort = null;
              ans.textContent = composed;
              speakAloud(composed + ' Ask me something else ' +
                'about it, or say \u201ccontinue\u201d to keep reading.');
              recordExchange(intent.text, composed);
              resumeIf(wasPlaying);
            }, function () {
              if (gen !== duplexGen) { resumeIf(wasPlaying); return; }
              answerAbort = null;
              ans.textContent = 'From the document: \u201c' + res.quote + '\u201d';
              speakAloud('Here is what the document says. ' + res.quote +
                ' That is what it says. Ask me something else about ' +
                'it, or say \u201ccontinue\u201d to keep reading.');
              recordExchange(intent.text,
                'From the document: \u201c' + res.quote + '\u201d');
              resumeIf(wasPlaying);
            });
          return;
        }
        ans.textContent = 'From the document: \u201c' + res.quote + '\u201d';
        speakAloud('Here is what the document says. ' + res.quote +
          ' That is what it says. Ask me something else about ' +
          'it, or say \u201ccontinue\u201d to keep reading.');
        recordExchange(intent.text,
          'From the document: \u201c' + res.quote + '\u201d');
      }
      resumeIf(wasPlaying);
      return;
    }
    if (intent.type === 'question' && !current) {
      /* No document open: the honest unit — what is missing
         and what to do — instead of the generic fall-through. */
      var noDoc = 'There is no document open, so I can only ' +
        'answer questions about myself just now. Open a ' +
        'document and ask me about it \u2014 or ask me what I ' +
        'am, what the buttons do, or how Talk works.';
      ans.hidden = false;
      ans.textContent = noDoc;
      setVoiceMsg('', false);
      speakAloud(noDoc);
      resumeIf(wasPlaying);
      return;
    }
    var unknown = 'I heard that, but I don\u2019t know how to do it. Try ' +
      '\u201cpause\u201d, \u201cgo back\u201d or \u201cstart over\u201d \u2014 or ask a question ' +
      'about this document.';
    sayFailure(unknown);
    resumeIf(wasPlaying);
  }

  /* ---------------- Talk: capture paths (beta.5) ----------------
     In the Android shell, capture is NATIVE (PlayerCore +
     AudioRecord): the voice is silenced by the state machine
     before the microphone opens, and the press itself can never be
     starved by this page's renderer work — the beta.4 phone
     finding. The captured samples return through onCapturedAudio
     and feed the SAME transcription path below; the engine, the
     shelf and the honest failure classes are unchanged. In a plain
     browser (no DogEarNative.startCapture), the page capture from
     beta.4 runs exactly as before. */
  var nativeCapturePending = null; // { wasPlaying } for a page-started native capture
  var nativeVoiceState = 'idle';    // last PlayerCore voice state seen

  function nativeCaptureAvailable() {
    return !!(window.DogEarNative &&
      typeof window.DogEarNative.startCapture === 'function');
  }

  function transcribeAndHandle(samples, wasPlaying) {
    setVoiceMsg('Heard you \u2014 working it out on this device\u2026', false);
    voice.transcribe(samples).then(function (tr) {
      if (!tr.ok || !tr.text) {
        sayFailure(tr.ok
          ? 'I couldn\u2019t make that out \u2014 try again, a little closer to the microphone.'
          : tr.reason);
        resumeIf(wasPlaying);
        return;
      }
      setVoiceMsg('', false);
      handleHeard(tr.text, wasPlaying);
    });
  }

  function decodePcm16(b64) {
    try {
      var bin = atob(b64);
      var n = Math.floor(bin.length / 2);
      var out = new Float32Array(n);
      for (var i = 0; i < n; i++) {
        var v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
        if (v > 32767) v -= 65536;
        out[i] = v / 32768;
      }
      return out;
    } catch (e) { return null; }
  }

  var CAPTURE_CLASS_COPY = {
    permission: 'The microphone is blocked. DogEar needs your permission to listen \u2014 nothing is recorded without it.',
    /* Beta.6 (R3 census #7): the native capture emits this
       class when Android must be ASKED — in beta.5 it had no
       entry here and fell through to the generic 'error' text,
       the wrong words for the state. */
    'permission-needed': 'DogEar needs the microphone permission before it can listen. If Android is asking, tap Allow \u2014 nothing is recorded without your permission. If no prompt appears, check DogEar\u2019s permissions in Android Settings, under Apps.',
    busy: 'The microphone could not be opened \u2014 it may be busy with another app. Close anything using the microphone and try again. Your permission is not the problem.',
    none: 'No microphone was found on this device, so Talk cannot listen here. Reading aloud still works as always.',
    error: 'Listening was interrupted before it could start \u2014 the microphone never opened. Nothing was recorded. Tap Talk and try once more.',
  };

  function onCapturedAudio(ev) {
    var pending = nativeCapturePending;
    nativeCapturePending = null;
    voiceListening = null;
    var t = $('voiceTalkBtn');
    if (t) t.textContent = 'Talk to DogEar';
    var wasPlaying = pending ? pending.wasPlaying : !!ev.resumeAfter;
    var samples = decodePcm16(ev.b64 || '');
    if (!samples) {
      sayFailure('What was recorded could not be read back \u2014 ' +
        'the recording arrived damaged. Nothing was kept. ' +
        'Tap Talk and try once more.');
      resumeIf(wasPlaying);
      return;
    }
    if (!voice) {
      sayFailure('There is no voice model on this device yet \u2014 ' +
        'choose one on the voice shelf first, then Talk.');
      resumeIf(wasPlaying);
      return;
    }
    if (voice.engineReady()) { transcribeAndHandle(samples, wasPlaying); return; }
    setVoiceMsg('Starting the listener \u2014 the speech model loads ' +
      'from the pack on this device\u2026', false);
    voice.loadEngine().then(function (r) {
      if (!r.ok) {
        sayFailure(r.reason);
        resumeIf(wasPlaying);
        return;
      }
      transcribeAndHandle(samples, wasPlaying);
    });
  }

  function onCaptureError(ev) {
    var pending = nativeCapturePending;
    nativeCapturePending = null;
    voiceListening = null;
    var t = $('voiceTalkBtn');
    if (t) t.textContent = 'Talk to DogEar';
    var wasPlaying = pending ? pending.wasPlaying : !!ev.resumeAfter;
    sayFailure(CAPTURE_CLASS_COPY[ev['class']] || CAPTURE_CLASS_COPY.error);
    resumeIf(wasPlaying);
  }

  function onPlayerState(ev) {
    nativeVoiceState = ev.voice || 'idle';
    var line = $('nativeState');
    if (!line) return;
    var show = !!ev.docId;
    line.hidden = !show;
    if (!show) return;
    var word = ev.playback === 'playing' ? 'Reading aloud'
      : ev.playback === 'paused' ? 'Paused'
      : ev.playback === 'stopped' ? 'Stopped' : 'Ready';
    var pos = (ev.chunks > 0 && ev.chunk >= 0)
      ? ' \u2014 part ' + (ev.chunk + 1) + ' of ' + ev.chunks : '';
    line.textContent = word + pos +
      (ev.voice === 'listening' ? ' \u00B7 Listening\u2026' : '');
  }

  function onContinueEvent(ev) {
    if (!ev || !ev.docId) return;
    /* Clarity item 11 (owner's ruling): Continue resumes the
       READING track from the reading track's own record. The
       native event's chunk used to be trusted unconditionally
       — but in the shell the answering track speaks through
       the same player, and its speech can move the chunk that
       event carries; seeking there replaced the reading place
       with the answer's place. When a reading record exists it
       governs: open at the kept place (openDoc reads the place
       records) and play — the event's chunk is not sought and
       not written. The native chunk is still trusted for the
       one case it was added for: the page has NO reading
       record at all (its storage lost the copy), where it
       re-seeds exactly as before. */
    var rp = loadReadPlace(ev.docId);
    if (rp) {
      if (!current || current.id !== ev.docId) openDoc(ev.docId);
      if (!current || current.id !== ev.docId) return;
      if (current.reader && current.reader.getState() !== 'playing') {
        try { current.reader.play(); } catch (e) {}
      }
      return;
    }
    // If the page lost its own place record (its storage is a
    // second copy of this truth), re-seed it from the native one —
    // the native record is the authority now.
    if (!loadPlace(ev.docId) && ev.chunks > 0) {
      try {
        localStorage.setItem(placeKey(ev.docId), JSON.stringify(
          { i: ev.chunk, n: ev.chunks, t: Date.now() }));
      } catch (e) {}
    }
    if (!current || current.id !== ev.docId) openDoc(ev.docId);
    if (!current || current.id !== ev.docId) return;
    seekToChunk(ev.chunk || 0, 'Continuing where you left off.',
      { fromContinue: true });
    if (current.reader && current.reader.getState() !== 'playing') {
      try { current.reader.play(); } catch (e) {}
    }
  }

  /* ---------------- reading voice picker (1.7.0) ----------------
     One picker for every voice source on the device, DogEar
     first: DogEar's own chosen voice (the engine's on-device
     pick — the lead entry and the default when nothing has
     been chosen), then the system default, then each other
     on-device voice the platform exposes. In the Android shell
     the native bridge also names the phone's speech engines
     (Google, Samsung, and any other) — addable at engine level;
     a WebView cannot say which engine a speechSynthesis voice
     belongs to, so browser voices are listed by their own
     names only. The choice persists as a plain preference on
     this device, and switching voice applies to the CURRENT
     unit — the reading position never moves. Free throughout:
     DogEar has no paid voice tier. */
  var VOICE_PREF_KEY = 'dogearapp:voice-uri:v1';
  function loadVoicePref() {
    try { return localStorage.getItem(VOICE_PREF_KEY) || 'dogear:default'; }
    catch (e) { return 'dogear:default'; }
  }
  function saveVoicePref(uri) {
    try { localStorage.setItem(VOICE_PREF_KEY, uri); } catch (e) {}
  }
  /* Voice effects (quick-win lane, 2026-11-10): the listener's
     speed / pitch / volume / warmth — one device-local record
     (voicefx.js) beside the voice choice. The panel in the
     Reading voice box is one view of it; the reader's own
     Speed select is the other; the two are kept in step, and
     every speech surface reads the record, so a change lands
     on the next utterance without restarting anything. */
  var voiceFx = (window.DogEarVoiceFx && window.DogEarVoiceFx.default)
    ? window.DogEarVoiceFx.default() : null;
  function fxGet() {
    if (voiceFx) return voiceFx.get();
    return { speed: 1, pitch: 1, volume: 1, warmth: 0 };
  }
  function fxSet(patch) {
    if (voiceFx) voiceFx.set(patch);
    return fxGet();
  }
  var READER_SPEEDS = (window.DogEarVoiceFx && window.DogEarVoiceFx.SPEEDS)
    || [0.8, 1, 1.25, 1.5];
  /* The reader's Speed select is reader-core's own control:
     seed it from the saved setting (the speeds offered are
     ours, passed in readerOpts) and keep the record in step
     when the listener changes it there. Reader-core reads the
     select at every chunk, so a change applies to the next
     chunk — playback never restarts mid-sentence. */
  function syncReaderSpeed() {
    var mount = $('readerMount');
    var sel = mount ? mount.querySelector('.rc-rate') : null;
    if (!sel) return;
    var want = String(fxGet().speed);
    if (sel.value !== want) sel.value = want;
    if (!sel.__fxWired) {
      sel.__fxWired = true;
      sel.addEventListener('change', function () {
        var v = parseFloat(sel.value);
        if (isFinite(v)) { fxSet({ speed: v }); refreshVoiceFxPanel(); }
      });
    }
  }
  function refreshVoiceFxPanel() {
    var fx = fxGet();
    var sp = $('fxSpeed');
    if (sp) {
      if (!sp.options.length && window.DogEarVoiceFx) {
        window.DogEarVoiceFx.SPEEDS.forEach(function (s) {
          var o = document.createElement('option');
          o.value = String(s);
          o.textContent = String(s) + '\u00D7';
          sp.appendChild(o);
        });
      }
      var want = String(window.DogEarVoiceFx
        ? window.DogEarVoiceFx.nearestSpeed(fx.speed) : fx.speed);
      if (sp.value !== want) sp.value = want;
    }
    var pi = $('fxPitch'), pv = $('fxPitchVal');
    if (pi) pi.value = String(fx.pitch);
    if (pv) pv.textContent = fx.pitch.toFixed(2);
    var vo = $('fxVolume'), vv = $('fxVolumeVal');
    var pct = Math.round(fx.volume * 100);
    if (vo) vo.value = String(pct);
    if (vv) vv.textContent = pct + '%' + (pct > 100 ? ' (boost)' : '');
    var wa = $('fxWarmth'), wv = $('fxWarmthVal');
    var wpct = Math.round(fx.warmth * 100);
    if (wa) wa.value = String(wpct);
    if (wv) wv.textContent = wpct + '%';
  }
  var fxWired = false;
  function wireVoiceFx() {
    if (fxWired) return;
    fxWired = true;
    var sp = $('fxSpeed');
    if (sp) sp.addEventListener('change', function () {
      var v = parseFloat(sp.value);
      if (isFinite(v)) fxSet({ speed: v });
      syncReaderSpeed();
      refreshVoiceFxPanel();
    });
    var pi = $('fxPitch');
    if (pi) pi.addEventListener('input', function () {
      var v = parseFloat(pi.value);
      if (isFinite(v)) fxSet({ pitch: v });
      refreshVoiceFxPanel();
    });
    var vo = $('fxVolume');
    if (vo) vo.addEventListener('input', function () {
      var v = parseFloat(vo.value);
      if (isFinite(v)) fxSet({ volume: v / 100 });
      refreshVoiceFxPanel();
    });
    var wa = $('fxWarmth');
    if (wa) wa.addEventListener('input', function () {
      var v = parseFloat(wa.value);
      if (isFinite(v)) fxSet({ warmth: v / 100 });
      refreshVoiceFxPanel();
    });
  }
  /* The bundled TTS voice pack drives reading when the chosen
     voice is a pack voice — or when the default is chosen and
     the pack is installed, in which case the reader's own
     default rule resolves af_heart from the transport's list. */
  function packVoiceActive() {
    if (!ttsPack || !ttsInstalled) return false;
    var pref = loadVoicePref();
    if (pref === 'dogear:default' || ttsPack.isPackVoiceUri(pref)) return true;
    // The pack is the only voice this browser has: the saved
    // preference names platform voices and there are none, so
    // the pack drives reading until a platform voice exists.
    return !speechOK || voicesEmpty;
  }
  /* Answers speak through the pack when it drives reading, so
     the answering voice is the reading voice (1.7.0's rule) even
     when no reader is open; otherwise the platform speaker. */
  function answerSpeaker() {
    if (!window.DogEarSpeaker) return null;
    if (packVoiceActive()) {
      if (!packSpeaker) {
        packSpeaker = window.DogEarSpeaker.create({
          synth: ttsPack.transport,
          UtteranceCtor: ttsPack.Utterance,
        });
      }
      return packSpeaker;
    }
    return window.DogEarSpeaker.default();
  }
  function rebuildReaderForVoiceChange() {
    if (!current || !current.reader) return;
    var id = current.id;
    closeReader();
    openDoc(id);
  }
  /* A reader built on one transport while the state now calls
     for the other is rebuilt on the right one (the saved place
     restores the position, so the switch loses nothing). A
     reader already on the called-for transport is left alone. */
  function retargetReaderTransport() {
    if (!current || !current.reader || !current.synthKind) return;
    var want = packVoiceActive() ? 'pack' : 'platform';
    if (current.synthKind !== want) rebuildReaderForVoiceChange();
  }
  /* The TTS pack's install state changed — the boot-time status
     landed, a download finished, or a delete finished: the
     no-voice machine re-judges live (banner, dimmed controls,
     in-row notes), an open reader retargets to the transport
     the new state calls for, and a stale speechBroke verdict —
     earned against the platform voices — is cleared when the
     pack arrives, the onBridgeInstalled precedent: a new voice
     source clears the old failure verdict. On delete the
     verdict stands; only the voiceless state returns. */
  function onTtsPackStateChanged() {
    if (ttsInstalled) speechBroke = false;
    updateSpeechWarn();
    retargetReaderTransport();
  }
  function installTtsPack() {
    if (!ttsPack || ttsDownloading) return;
    ttsDownloading = true;
    setVoiceMsg('Downloading the DogEar voice pack\u2026', false);
    ttsPack.download(function (p) {
      var prog = $('voiceProgress');
      if (prog && p.totalBytes > 0) {
        prog.hidden = false;
        prog.max = p.totalBytes;
        prog.value = p.doneBytes;
      }
      if (p.totalBytes > 0) {
        setVoiceMsg('Downloading the DogEar voice pack \u2014 ' +
          fmtMB(p.doneBytes) + ' of ' + fmtMB(p.totalBytes) + '\u2026', false);
      }
    }).then(function (r) {
      ttsDownloading = false;
      var prog = $('voiceProgress');
      if (prog) prog.hidden = true;
      if (r.ok) {
        ttsInstalled = true;
        ttsRuntimePresent = true; // the download brought it (or it was here)
        saveVoicePref(window.DogEarTtsPack.voiceUri('af_heart'));
        setVoiceMsg('The DogEar voice pack is on this device. ' +
          'Heart is your reading voice now \u2014 it works offline, ' +
          'and you can change or remove it here any time.', false);
        rebuildReaderForVoiceChange();
        onTtsPackStateChanged();
      } else {
        setVoiceMsg(r.reason, !r.cancelled);
      }
      refreshVoicePicker();
      refreshVoicePanel();
    });
  }
  function refreshVoicePicker() {
    var sel = $('voicePick');
    if (!sel) return;
    wireVoiceFx();
    refreshVoiceFxPanel();
    var pref = loadVoicePref();
    sel.innerHTML = '';
    function addGroup(label) {
      var g = document.createElement('optgroup');
      g.label = label;
      sel.appendChild(g);
      return g;
    }
    function addOpt(parent, value, label) {
      var o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      parent.appendChild(o);
    }
    var reader = current && current.reader;
    var resolved = null;
    try { resolved = reader ? reader.getVoice() : null; } catch (e) {}
    var dogLabel = 'DogEar voice';
    if (resolved && resolved.voiceURI &&
        resolved.voiceURI.indexOf('pack:') === 0 && resolved.name) {
      dogLabel = resolved.name;
    } else if (resolved && resolved.name && resolved.name !== 'DogEar voice') {
      dogLabel += ' \u2014 ' + resolved.name;
    }
    if (ttsPack) {
      var pg = addGroup('DogEar voice pack');
      if (ttsInstalled) {
        ttsPack.voices.forEach(function (v) {
          addOpt(pg, v.voiceURI, v.label + ' (' + v.lang + ')');
        });
      } else {
        addOpt(pg, 'pack:install', 'Download the DogEar voice pack' +
          ttsDownloadSizeNote() + ' \u2014 free');
      }
    }
    addOpt(addGroup('DogEar'), 'dogear:default', dogLabel);
    var dev = addGroup('This device');
    addOpt(dev, 'system:default', 'System default voice');
    var voices = [];
    try {
      voices = reader ? reader.getVoices()
        : (('speechSynthesis' in window) ? window.speechSynthesis.getVoices() : []);
    } catch (e) {}
    var seen = {};
    (voices || []).forEach(function (v) {
      if (!v || !v.voiceURI || v.localService === false) return;
      if (v.voiceURI.indexOf('pack:') === 0) return; // pack group above
      if (v.voiceURI === 'dogear:device' || seen[v.voiceURI]) return;
      seen[v.voiceURI] = true;
      addOpt(dev, v.voiceURI, v.name + (v.lang ? ' (' + v.lang + ')' : ''));
    });
    var N = window.DogEarNative;
    if (N && typeof N.getTtsEnginesJson === 'function') {
      try {
        var engines = JSON.parse(N.getTtsEnginesJson() || '[]');
        if (engines && engines.length) {
          var eg = addGroup('Speech engines on this phone');
          engines.forEach(function (en) {
            if (en && en.package) {
              addOpt(eg, 'android-engine:' + en.package,
                (en.label || en.package) + ' \u2014 its own voice');
            }
          });
        }
      } catch (e) {}
    }
    sel.value = pref;
    if (sel.value !== pref) sel.value = 'dogear:default';
  }
  function onVoicePickChange() {
    var sel = $('voicePick');
    if (!sel) return;
    if (sel.value === 'pack:install') {
      refreshVoicePicker(); // the select returns to the saved pref
      installTtsPack();
      return;
    }
    var before = current ? current.synthKind : null;
    saveVoicePref(sel.value);
    var after = packVoiceActive() ? 'pack' : 'platform';
    if (current && current.reader && before && before !== after) {
      /* Crossing between the platform synth and the pack
         transport rebuilds the reader on the other transport —
         the saved place record restores the reading position,
         so the switch never loses the listener's place. */
      rebuildReaderForVoiceChange();
      return;
    }
    if (current && current.reader) {
      try { current.reader.setVoice(sel.value); } catch (e) {}
    }
    refreshVoicePicker();
  }

  /* The saved pin, shown in the document at paragraph
     granularity (1.7.0 spec item 6): where you are, and how to
     move the pin before resuming. */
  /* Clarity item 2 (Milo friction 1): reader-core sets the
     prev/next buttons' disabled flags at CHUNK granularity —
     after Next moved the display to paragraph 2 inside chunk 0,
     Previous stayed disabled. Worse, seekToUnit's idle branch
     never calls setPlay() at all, so after an idle Next tap
     neither the flags nor the play label were refreshed. The
     controls must reflect the actual PARAGRAPH position on
     every position-change path, so the app corrects the flags
     — and mirrors the core's own play-label rule (item 4) —
     from the reported position after every position event.
     During a scoped (range) read the core's own state governs
     — a range is one unit and its ends are the scope's ends. */
  function syncNavButtons(pos) {
    if (!pos || pos.range) return;
    var mount = $('readerMount');
    if (!mount) return;
    var prev = mount.querySelector('.rc-prev');
    var next = mount.querySelector('.rc-next');
    if (prev) prev.disabled = !(pos.paragraph > 0);
    if (next) next.disabled = !(pos.paragraph < pos.paragraphs - 1);
    var play = mount.querySelector('.rc-play');
    if (play) {
      var label = pos.state === 'playing' ? '\u23f8 Pause'
        : pos.state === 'paused' ? '\u25b6 Resume'
        : (pos.index > 0 ? '\u25b6 Resume' : '\u{1F50A} Listen');
      if (play.textContent !== label) play.textContent = label;
    }
  }

  /* Clarity item 3 (Milo friction 2): the scoped-reading line
     ("Reading only paragraph N.") outlived its scope — it was
     still on screen after playback stopped and the position
     moved. The line now has an owner: while a scope is live
     the reader reports pos.range; the first position event
     with no range means the scope has ended (stopped, finished,
     or sought away), and the stale line clears. The range-end
     message ("That is the end of the part you chose…") is a
     different line and is never cleared here. */
  var rangeMsgScope = null; // { para } | { selection: true } | null
  function syncRangeMsg(pos) {
    if (!rangeMsgScope || !pos) return;
    if (pos.range) return; // the scope is still live
    var el = $('rangeMsg');
    if (el && el.textContent.indexOf('Reading only') === 0) {
      setRangeMsg('');
    }
    rangeMsgScope = null;
  }

  function updatePlacePin(pos) {
    var pin = $('placePin');
    if (!pin) return;
    if (pos && pos.paragraphs) {
      /* Clarity item 4 (Milo friction 5): the helper must name
         the action the play button actually offers in this
         state — reader-core's own labels are: playing → Pause,
         paused → Resume, idle → Resume when a later chunk is
         current, Listen at the start. The words below mirror
         those labels exactly, so helper and button never
         contradict. */
      var action;
      if (pos.state === 'playing') {
        action = 'DogEar is reading from there — press Pause ' +
          'to stop it there';
      } else if (pos.state === 'paused') {
        action = 'Press Resume to continue there';
      } else if (pos.index > 0) {
        action = 'Press Resume to continue there';
      } else {
        action = 'Press Listen to continue there';
      }
      pin.textContent = 'Your place: paragraph ' + (pos.paragraph + 1) +
        ' of ' + pos.paragraphs + '. ' + action + ', or move ' +
        'your place with Read from here on any paragraph.';
    } else {
      pin.textContent = '';
    }
  }
  function setRangeMsg(text) { setMsg($('rangeMsg'), text, false); }

  /* Warm Talk (1.7.0, spec item 8): when the selected speech
     model is on this device, start the engine in the
     background — off the first-paint path — so a Talk tap is
     listening at once instead of paying the model load between
     tap and microphone. One warm attempt per model per
     session; a failed warm frees the slot so a later document
     open retries, and the tap path keeps its own spoken
     failure lines either way. */
  var warmModelId = null;
  function scheduleWarmVoice() {
    if (!voice || !isUnlocked() || voice.engineReady()) return;
    voice.getSelectedModelId().then(function (id) {
      if (!id || warmModelId === id || voice.engineReady()) return;
      warmModelId = id;
      var warm = function () {
        if (!voice) return;
        voice.warmEngine().then(function (r) {
          if (!r || !r.ok) warmModelId = null;
        });
      };
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(warm, { timeout: 3000 });
      } else {
        setTimeout(warm, 900);
      }
    });
  }

  /* ---------------- your own answer model (1.7.0) ----------------
     The built-in brain is retrieval + quotation: no key, no
     account, nothing leaves the device, and it cannot invent
     an answer. A listener MAY name their own model service
     instead — an endpoint and a key of theirs, stored on this
     device only and sent only to the endpoint they typed.
     When one is set, a question is answered in composed words
     FROM the passages retrieval found; the retrieval honesty
     gates run first, so a question the document does not
     answer is refused before any model is asked, and any
     failure of the model service falls back to the quotation
     — the ask loop always closes. */
  var BRAIN_KEYS = {
    endpoint: 'dogearapp:brain:endpoint',
    key: 'dogearapp:brain:key',
    model: 'dogearapp:brain:model',
  };
  function loadBrain() {
    try {
      var ep = localStorage.getItem(BRAIN_KEYS.endpoint);
      var k = localStorage.getItem(BRAIN_KEYS.key);
      if (!ep || !k) return null;
      return { endpoint: ep, key: k,
        model: localStorage.getItem(BRAIN_KEYS.model) || '' };
    } catch (e) { return null; }
  }
  function brainAnswer(brain, question, passages, quote, signal) {
    var context = '';
    if (passages && passages.length) {
      context = passages.map(function (p) { return p.text || ''; })
        .join('\n').slice(0, 6000);
    }
    if (!context) context = quote || '';
    var body = {
      model: brain.model || 'default',
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'You answer questions about a ' +
          'document using only the passage provided. If the ' +
          'passage does not answer the question, say the document ' +
          'does not say. Answer in at most three short sentences, ' +
          'in plain words, suitable for reading aloud.' },
        { role: 'user', content: 'Passage from the document:\n' +
          context + '\n\nQuestion: ' + question },
      ],
    };
    return fetch(brain.endpoint, {
      method: 'POST',
      signal: signal || undefined,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + brain.key,
      },
      body: JSON.stringify(body),
    }).then(function (r) {
      if (!r.ok) throw new Error('model service http ' + r.status);
      return r.json();
    }).then(function (j) {
      var t = j && j.choices && j.choices[0] && j.choices[0].message &&
        j.choices[0].message.content;
      if (!t || !String(t).trim()) throw new Error('empty answer');
      return String(t).trim();
    });
  }
  function wireBrain() {
    var box = $('brainBox');
    if (!box) return;
    var b = loadBrain();
    if (b) {
      $('brainEndpoint').value = b.endpoint;
      $('brainKey').value = b.key;
      $('brainModel').value = b.model;
    }
    $('brainSave').addEventListener('click', function () {
      var ep = $('brainEndpoint').value.trim();
      var k = $('brainKey').value.trim();
      if (!ep || !k) {
        setMsg($('brainMsg'), 'Enter both the service address ' +
          'and your key \u2014 or Remove to go back to DogEar\u2019s ' +
          'built-in answers.', true);
        return;
      }
      try {
        localStorage.setItem(BRAIN_KEYS.endpoint, ep);
        localStorage.setItem(BRAIN_KEYS.key, k);
        localStorage.setItem(BRAIN_KEYS.model, $('brainModel').value.trim());
      } catch (e) {}
      setMsg($('brainMsg'), 'Saved on this device. Questions ' +
        'will be answered by your model, from the passages ' +
        'DogEar finds.', false);
    });
    $('brainClear').addEventListener('click', function () {
      try {
        localStorage.removeItem(BRAIN_KEYS.endpoint);
        localStorage.removeItem(BRAIN_KEYS.key);
        localStorage.removeItem(BRAIN_KEYS.model);
      } catch (e) {}
      $('brainEndpoint').value = '';
      $('brainKey').value = '';
      $('brainModel').value = '';
      setMsg($('brainMsg'), 'Removed. DogEar answers by quoting ' +
        'your document again.', false);
    });
  }

  /* ============ "Save this conversation" (1.7.0, item 11) ==
     While the listener talks with DogEar about a document,
     both sides are logged as one conversation record: the
     question as transcribed, DogEar's spoken answer, and the
     passage under discussion at that moment (the reader's own
     position). The record lives ONLY on this device
     (localStorage) until the listener exports it — nothing
     uploads by itself, and recording is the listener's
     visible choice (the toggle in the panel). Exports are
     built on-device: Word (.docx), Markdown, plain text and
     publishable HTML — no cloud conversion. */
  var CONV_KEY = 'dogearapp:conv:v1';
  var CONV_ON_KEY = 'dogearapp:conv:on';
  function convOn() {
    try { return localStorage.getItem(CONV_ON_KEY) !== '0'; }
    catch (e) { return true; }
  }
  function loadConv() {
    try {
      var v = JSON.parse(localStorage.getItem(CONV_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function saveConv(list) {
    try { localStorage.setItem(CONV_KEY, JSON.stringify(list)); }
    catch (e) {}
    refreshConvPanel();
    refreshNotesPanel();
    renderSheetNotes();
  }
  function recordExchange(question, answer) {
    if (!convOn()) return;
    var anchor = { para: -1, paragraphs: 0, passage: '' };
    try {
      if (current && current.reader &&
          typeof current.reader.getPosition === 'function') {
        var pos = current.reader.getPosition();
        anchor.para = pos.paragraph;
        anchor.paragraphs = pos.paragraphs;
        var paras = current.reader.getParagraphs();
        var p = paras && paras[pos.paragraph];
        if (p && p.text) anchor.passage = String(p.text).slice(0, 160);
      }
    } catch (e) {}
    var docTitle = '';
    if (current) {
      try {
        var idx = JSON.parse(
          localStorage.getItem('dogearapp:docs:v1') || '[]');
        var rec = idx.find(function (d) { return d.id === current.id; });
        docTitle = (rec && rec.title) || 'Untitled';
      } catch (e) { docTitle = 'Untitled'; }
    }
    var list = loadConv();
    list.push({
      t: new Date().toISOString(),
      doc: docTitle,
      q: String(question || ''),
      a: String(answer || ''),
      para: anchor.para,
      paragraphs: anchor.paragraphs,
      passage: anchor.passage,
    });
    if (list.length > 500) list = list.slice(list.length - 500);
    saveConv(list);
  }
  function convAnchorLine(e) {
    if (e.para >= 0) {
      return 'At paragraph ' + (e.para + 1) +
        (e.paragraphs ? ' of ' + e.paragraphs : '') +
        (e.passage ? ': \u201c' + e.passage + '\u201d' : '');
    }
    return 'No passage anchor (no document passage under discussion).';
  }
  function convTitle(list) {
    var docTitle = (list[0] && list[0].doc) || 'a document';
    return 'Conversation about \u201c' + docTitle + '\u201d';
  }
  function convText() {
    var list = loadConv();
    var out = [convTitle(list), 'Saved from DogEar on this device.', ''];
    list.forEach(function (e, i) {
      out.push('Exchange ' + (i + 1) + ' \u2014 ' + convAnchorLine(e));
      out.push('You: ' + e.q);
      out.push('DogEar: ' + e.a);
      out.push('');
    });
    return out.join('\n');
  }
  function convMarkdown() {
    var list = loadConv();
    var out = ['# ' + convTitle(list), '',
      '_Saved from DogEar on this device._', ''];
    list.forEach(function (e, i) {
      out.push('## Exchange ' + (i + 1));
      out.push('');
      out.push('_' + convAnchorLine(e) + '_');
      out.push('');
      out.push('**You:** ' + e.q);
      out.push('');
      out.push('**DogEar:** ' + e.a);
      out.push('');
    });
    return out.join('\n');
  }
  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function convHtml() {
    var list = loadConv();
    var parts = ['<!DOCTYPE html>', '<html lang="en">', '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>' + escHtml(convTitle(list)) + '</title>',
      '<style>body{font-family:Georgia,serif;max-width:42em;margin:2em auto;' +
      'padding:0 1em;line-height:1.55;color:#1c2733}h1{font-size:1.5em}' +
      '.anchor{color:#5a6b7a;font-style:italic}.you{font-weight:bold}' +
      'article{border-top:1px solid #d8dee4;padding:1em 0}</style>',
      '</head>', '<body>',
      '<h1>' + escHtml(convTitle(list)) + '</h1>',
      '<p>Saved from DogEar on this device.</p>'];
    list.forEach(function (e, i) {
      parts.push('<article>');
      parts.push('<h2>Exchange ' + (i + 1) + '</h2>');
      parts.push('<p class="anchor">' + escHtml(convAnchorLine(e)) + '</p>');
      parts.push('<p><span class="you">You:</span> ' + escHtml(e.q) + '</p>');
      parts.push('<p><strong>DogEar:</strong> ' + escHtml(e.a) + '</p>');
      parts.push('</article>');
    });
    parts.push('</body>', '</html>');
    return parts.join('\n');
  }
  /* Minimal .docx writer: a stored (uncompressed) ZIP with
     the three parts Word needs. Written by hand so the export
     works fully offline, like everything else in DogEar. */
  var CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = [];
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        CRC_TABLE[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function utf8Bytes(s) {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(s);
    }
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) {
        out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        var cp = 0x10000 + ((c - 0xD800) << 10) +
          (s.charCodeAt(++i) - 0xDC00);
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F),
          0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
      } else {
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F),
          0x80 | (c & 0x3F));
      }
    }
    return new Uint8Array(out);
  }
  function zipStored(files) {
    var enc = { encode: utf8Bytes };
    var chunks = [];
    var central = [];
    var offset = 0;
    files.forEach(function (f) {
      var data = enc.encode(f.text);
      var name = enc.encode(f.name);
      var crc = crc32(data);
      var local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(8, 0, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      chunks.push(new Uint8Array(local.buffer), name, data);
      var cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, data.length, true);
      cen.setUint32(24, data.length, true);
      cen.setUint16(28, name.length, true);
      cen.setUint32(42, offset, true);
      central.push(new Uint8Array(cen.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var cenSize = central.reduce(function (a, c) { return a + c.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cenSize, true);
    end.setUint32(16, offset, true);
    return new Blob(chunks.concat(central, [new Uint8Array(end.buffer)]),
      { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }
  function escXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function convDocxBlob() {
    var list = loadConv();
    var ps = [];
    function para(text, style, bold) {
      var rPr = bold ? '<w:rPr><w:b/></w:rPr>' : '';
      var pPr = style ? '<w:pPr><w:pStyle w:val="' + style + '"/></w:pPr>' : '';
      ps.push('<w:p>' + pPr + '<w:r>' + rPr +
        '<w:t xml:space="preserve">' + escXml(text) + '</w:t></w:r></w:p>');
    }
    para(convTitle(list), 'Title');
    para('Saved from DogEar on this device.');
    list.forEach(function (e, i) {
      para('Exchange ' + (i + 1), 'Heading1');
      para(convAnchorLine(e));
      para('You: ' + e.q, null, true);
      para('DogEar: ' + e.a);
    });
    var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body>' + ps.join('') + '</w:body></w:document>';
    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>';
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>';
    return zipStored([
      { name: '[Content_Types].xml', text: contentTypes },
      { name: '_rels/.rels', text: rels },
      { name: 'word/document.xml', text: documentXml },
    ]);
  }
  function downloadBlob(name, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function refreshConvPanel() {
    var count = $('convCount');
    if (count) {
      var n = loadConv().length;
      count.textContent = n === 0
        ? 'Nothing saved yet. Ask DogEar about the document and the conversation appears here.'
        : n + (n === 1 ? ' exchange' : ' exchanges') +
          ' saved on this device.';
    }
    var tgl = $('convToggle');
    if (tgl) {
      tgl.textContent = 'Save this conversation: ' + (convOn() ? 'On' : 'Off');
      tgl.setAttribute('aria-pressed', convOn() ? 'true' : 'false');
    }
  }
  /* ============ Notes from this conversation (lane 3, Pro) ==
     The Director's definition of Pro ends with "help the
     user create notes". The session record above is the raw
     material; this path turns it into a structured notes
     document — built from the SAME record (no parallel
     store), on-device, no network:
       - one entry per concept discussed, where the concept
         is named in the conversation's own terms (the
         question, with its question-words stripped);
       - each concept anchored to the passage it came from
         (the record's own anchor), so a note can always be
         traced back to the place in the document;
       - concepts in READING order (by anchored paragraph),
         the order the document presents them — not the
         order they happened to be asked about;
       - exportable in the record's own four formats. */
  function notesConcept(e) {
    var c = String(e.q || '').trim().replace(/[?.!\s]+$/, '');
    c = c.replace(/^(please\s+)?(tell me|describe|explain|name|list)\s+/i, '');
    c = c.replace(/^(what|who|whom|whose|when|where|why|how|which)\s+(is|are|was|were|does|do|did)\s+/i, '');
    c = c.replace(/^(what|who|whom|whose|when|where|why|how|which)\s+/i, '');
    c = c.replace(/^(is|are|was|were|does|do|did|can|could|should|would)\s+/i, '');
    c = c.replace(/^the\s+/i, '');
    c = c.replace(/\s+(of|in|on|at|to|for|about|from)$/i, '');
    if (!c) return 'Discussion';
    return c.charAt(0).toUpperCase() + c.slice(1);
  }
  function notesKeyPoint(e) {
    var a = String(e.a || '').trim();
    var m = /^[^.!?]+[.!?]+/.exec(a);
    var first = (m ? m[0] : a).trim();
    return first.length > 220 ? first.slice(0, 217) + '\u2026' : first;
  }
  function notesGroups() {
    var list = loadConv();
    var groups = [];
    var byPara = {};
    list.forEach(function (e) {
      var key = (typeof e.para === 'number' && e.para >= 0)
        ? 'p' + e.para : 'none';
      if (!byPara[key]) {
        byPara[key] = {
          para: (typeof e.para === 'number' ? e.para : -1),
          paragraphs: e.paragraphs || 0,
          passage: e.passage || '',
          entries: [],
        };
        groups.push(byPara[key]);
      }
      byPara[key].entries.push(e);
    });
    groups.sort(function (a, b) {
      var pa = a.para < 0 ? Number.MAX_SAFE_INTEGER : a.para;
      var pb = b.para < 0 ? Number.MAX_SAFE_INTEGER : b.para;
      return pa - pb;
    });
    return groups;
  }
  function notesTitle(list) {
    var docTitle = (list[0] && list[0].doc) || 'a document';
    return 'Notes on \u201c' + docTitle + '\u201d';
  }
  function notesAnchorLine(g) {
    if (g.para >= 0) {
      return 'At paragraph ' + (g.para + 1) +
        (g.paragraphs ? ' of ' + g.paragraphs : '') +
        (g.passage ? ': \u201c' + g.passage + '\u201d' : '');
    }
    return 'No passage anchor (no document passage under discussion).';
  }
  function notesText() {
    var list = loadConv();
    var out = [notesTitle(list),
      'Notes from your conversation with DogEar, made on this device.', ''];
    notesGroups().forEach(function (g) {
      g.entries.forEach(function (e) {
        out.push(notesConcept(e));
        out.push(notesAnchorLine(g));
        out.push('Key point: ' + notesKeyPoint(e));
        out.push('You asked: ' + e.q);
        out.push('DogEar: ' + e.a);
        out.push('');
      });
    });
    return out.join('\n');
  }
  function notesMarkdown() {
    var list = loadConv();
    var out = ['# ' + notesTitle(list), '',
      '_Notes from your conversation with DogEar, made on this device._', ''];
    notesGroups().forEach(function (g) {
      g.entries.forEach(function (e) {
        out.push('## ' + notesConcept(e));
        out.push('');
        out.push('_' + notesAnchorLine(g) + '_');
        out.push('');
        out.push('**Key point:** ' + notesKeyPoint(e));
        out.push('');
        out.push('**You asked:** ' + e.q);
        out.push('');
        out.push('**DogEar:** ' + e.a);
        out.push('');
      });
    });
    return out.join('\n');
  }
  function notesHtml() {
    var list = loadConv();
    var parts = ['<!DOCTYPE html>', '<html lang="en">', '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>' + escHtml(notesTitle(list)) + '</title>',
      '<style>body{font-family:Georgia,serif;max-width:42em;margin:2em auto;' +
      'padding:0 1em;line-height:1.55;color:#1c2733}h1{font-size:1.5em}' +
      '.anchor{color:#5a6b7a;font-style:italic}.you{font-weight:bold}' +
      'article{border-top:1px solid #d8dee4;padding:1em 0}</style>',
      '</head>', '<body>',
      '<h1>' + escHtml(notesTitle(list)) + '</h1>',
      '<p>Notes from your conversation with DogEar, made on this device.</p>'];
    notesGroups().forEach(function (g) {
      g.entries.forEach(function (e) {
        parts.push('<article>');
        parts.push('<h2>' + escHtml(notesConcept(e)) + '</h2>');
        parts.push('<p class="anchor">' + escHtml(notesAnchorLine(g)) + '</p>');
        parts.push('<p><strong>Key point:</strong> ' +
          escHtml(notesKeyPoint(e)) + '</p>');
        parts.push('<p><span class="you">You asked:</span> ' +
          escHtml(e.q) + '</p>');
        parts.push('<p><strong>DogEar:</strong> ' + escHtml(e.a) + '</p>');
        parts.push('</article>');
      });
    });
    parts.push('</body>', '</html>');
    return parts.join('\n');
  }
  function notesDocxBlob() {
    var list = loadConv();
    var ps = [];
    function para(text, style, bold) {
      var rPr = bold ? '<w:rPr><w:b/></w:rPr>' : '';
      var pPr = style ? '<w:pPr><w:pStyle w:val="' + style + '"/></w:pPr>' : '';
      ps.push('<w:p>' + pPr + '<w:r>' + rPr +
        '<w:t xml:space="preserve">' + escXml(text) + '</w:t></w:r></w:p>');
    }
    para(notesTitle(list), 'Title');
    para('Notes from your conversation with DogEar, made on this device.');
    notesGroups().forEach(function (g) {
      g.entries.forEach(function (e) {
        para(notesConcept(e), 'Heading1');
        para(notesAnchorLine(g));
        para('Key point: ' + notesKeyPoint(e));
        para('You asked: ' + e.q, null, true);
        para('DogEar: ' + e.a);
      });
    });
    var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body>' + ps.join('') + '</w:body></w:document>';
    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>';
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>';
    return zipStored([
      { name: '[Content_Types].xml', text: contentTypes },
      { name: '_rels/.rels', text: rels },
      { name: 'word/document.xml', text: documentXml },
    ]);
  }
  function refreshNotesPanel() {
    var n = loadConv().length;
    var count = $('notesCount');
    if (count) {
      count.textContent = n === 0
        ? 'No notes yet. Talk with DogEar about the document first — ' +
          'the concepts you discuss become notes here.'
        : 'Notes are ready from ' + n + (n === 1 ? ' exchange' : ' exchanges') +
          ', in reading order.';
    }
    renderNotesHome();
  }
  /* The Notes home (2026-11-11, full life cycle): the notes
     live on the LIBRARY view too, not only inside an open
     document — the actual content, readable in the app:
     concept, key point and the passage anchor, in reading
     order (notesGroups() order). One note = one exchange, the
     same unit the export builders render; deleting a note
     deletes that exchange from the record, so the list, the
     reader panel and every export agree afterwards — no
     parallel store, no tombstones. */
  function deleteConvEntries(entries) {
    if (!entries || !entries.length) return;
    /* The entries arrive from a notesGroups() load; the
       record is re-read here, so identity is by VALUE — the
       full record serialised — matched one-for-one, so two
       identical exchanges still delete one at a time. */
    var keys = entries.map(function (e) { return JSON.stringify(e); });
    saveConv(loadConv().filter(function (e) {
      var at = keys.indexOf(JSON.stringify(e));
      if (at === -1) return true;
      keys.splice(at, 1);
      return false;
    }));
  }
  function renderNotesHome() {
    var list = $('notesHomeList');
    if (!list) return;
    var groups = notesGroups();
    var total = 0;
    groups.forEach(function (g) { total += g.entries.length; });
    var countEl = $('notesHomeCount');
    if (countEl) {
      countEl.textContent = total === 0
        ? 'No notes yet. Talk with DogEar about a document \u2014 ' +
          'the concepts you discuss become notes here.'
        : total + (total === 1 ? ' note' : ' notes') + ', in reading order.';
    }
    list.innerHTML = '';
    groups.forEach(function (g) {
      g.entries.forEach(function (e) {
        var li = document.createElement('li');
        var left = document.createElement('div');
        var t = document.createElement('div'); t.className = 't';
        t.textContent = notesConcept(e);
        var kp = document.createElement('div'); kp.className = 'meta';
        kp.textContent = notesKeyPoint(e);
        var an = document.createElement('div'); an.className = 'meta';
        an.textContent = notesAnchorLine(g);
        left.appendChild(t); left.appendChild(kp); left.appendChild(an);
        var del = document.createElement('button');
        del.type = 'button'; del.className = 'ghost note-delete';
        del.textContent = 'Delete';
        del.setAttribute('aria-label',
          'Delete the note \u201c' + notesConcept(e) + '\u201d');
        del.addEventListener('click', function () {
          if (!askConfirm('Delete this note? The conversation ' +
            'exchange it came from is removed too.')) return;
          deleteConvEntries([e]);
        });
        li.appendChild(left); li.appendChild(del);
        list.appendChild(li);
      });
    });
  }
  function wireNotes() {
    var box = $('notesBox');
    if (!box) return;
    $('notesTxt').addEventListener('click', function () {
      downloadBlob('dogear-notes.txt',
        new Blob([notesText()], { type: 'text/plain' }));
    });
    $('notesMd').addEventListener('click', function () {
      downloadBlob('dogear-notes.md',
        new Blob([notesMarkdown()], { type: 'text/markdown' }));
    });
    $('notesHtml').addEventListener('click', function () {
      downloadBlob('dogear-notes.html',
        new Blob([notesHtml()], { type: 'text/html' }));
    });
    $('notesDocx').addEventListener('click', function () {
      downloadBlob('dogear-notes.docx', notesDocxBlob());
    });
    /* The Notes home carries the same four exports plus the
       life-cycle exits (per-note delete lives in the list
       itself, rendered by renderNotesHome). Clear-all is the
       conversation clear, labelled for what it does to the
       notes — the record is one, so the notes empty with it. */
    var homeTxt = $('notesHomeTxt');
    if (homeTxt) homeTxt.addEventListener('click', function () {
      downloadBlob('dogear-notes.txt',
        new Blob([notesText()], { type: 'text/plain' }));
    });
    var homeMd = $('notesHomeMd');
    if (homeMd) homeMd.addEventListener('click', function () {
      downloadBlob('dogear-notes.md',
        new Blob([notesMarkdown()], { type: 'text/markdown' }));
    });
    var homeHtml = $('notesHomeHtml');
    if (homeHtml) homeHtml.addEventListener('click', function () {
      downloadBlob('dogear-notes.html',
        new Blob([notesHtml()], { type: 'text/html' }));
    });
    var homeDocx = $('notesHomeDocx');
    if (homeDocx) homeDocx.addEventListener('click', function () {
      downloadBlob('dogear-notes.docx', notesDocxBlob());
    });
    var homeClear = $('notesHomeClear');
    if (homeClear) homeClear.addEventListener('click', function () {
      if (!askConfirm('Clear all notes? Every note is deleted, ' +
        'and the conversation exchanges they came from are ' +
        'removed too. This cannot be undone.')) return;
      saveConv([]);
    });
    refreshNotesPanel();
  }

  function wireConv() {
    var box = $('convBox');
    if (!box) return;
    $('convToggle').addEventListener('click', function () {
      try {
        localStorage.setItem(CONV_ON_KEY, convOn() ? '0' : '1');
      } catch (e) {}
      refreshConvPanel();
    });
    $('convTxt').addEventListener('click', function () {
      downloadBlob('dogear-conversation.txt',
        new Blob([convText()], { type: 'text/plain' }));
    });
    $('convMd').addEventListener('click', function () {
      downloadBlob('dogear-conversation.md',
        new Blob([convMarkdown()], { type: 'text/markdown' }));
    });
    $('convHtml').addEventListener('click', function () {
      downloadBlob('dogear-conversation.html',
        new Blob([convHtml()], { type: 'text/html' }));
    });
    $('convDocx').addEventListener('click', function () {
      downloadBlob('dogear-conversation.docx', convDocxBlob());
    });
    $('convClear').addEventListener('click', function () {
      saveConv([]);
    });
    refreshConvPanel();
  }

  /* ============ Engineered duplex (1.7.0, item 10) ========
     While DogEar reads or answers, the duplex monitor (in
     the voice pack) keeps the microphone live — but only
     where the platform confirms echo cancellation; without
     it the monitor refuses and DogEar stays turn-based.
     Speech onset cancels a speaking answer and aborts an
     answer still forming (generation counter: a stale answer
     never speaks). Reading pauses at onset and the assembled
     utterance is re-planned through the ordinary handleHeard
     path, so the reading place stays coherent. Partials that
     match what DogEar itself is saying are discarded as
     echo — DogEar never transcribes its own voice into a
     command. */
  var duplexMon = null;
  var duplexStarting = false;
  /* Whether the monitor is wanted at all right now. A stop
     that lands while the monitor is still STARTING (its
     getUserMedia promise in flight) must not miss it: the
     start's completion consults this flag and retires a
     monitor nobody wants anymore instead of arming it into
     a backgrounded app (found by the W5 suite check,
     2026-11-11). */
  var duplexWanted = false;
  var duplexGen = 0;
  var answerAbort = null;
  var duplexBuf = '';
  var duplexBufTimer = null;
  var duplexPausedReader = false;
  var duplexSpokenText = '';
  var duplexSpokenAt = 0;
  /* Lane 3 (duplex refinement): the turn-based fallback must
     be VISIBLE. When the monitor refuses, the listener is
     told once — in plain words, in the voice message line —
     that duplex is off and why; the flag clears the next
     time duplex actually arms, so a later refusal (a device
     change, headphones unplugged) is told again. */
  var duplexOffNoted = false;
  /* If an onset is followed by no words at all (a cough, a
     door, a false trigger), the reading it paused resumes on
     this timer instead of sitting paused forever. Any
     partial — real words are on their way — clears it; the
     flush owns the resume from there. */
  var duplexResumeTimer = null;
  function duplexWords(s) {
    return String(s || '').toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(function (w) { return w.length >= 3; });
  }
  function duplexSpeakerActive() {
    try {
      return !!((window.DogEarSpeaker &&
        window.DogEarSpeaker.default().active()) ||
        (packSpeaker && packSpeaker.active()));
    } catch (e) { return false; }
  }
  /* Echo immunity (lane 3 refinement). A partial is DogEar's
     own voice when its words live in something DogEar is
     saying or just said:
       — the answer being spoken: word-containment against
         the spoken-answer fingerprint, live WHILE the
         speaker is active however long the answer runs (the
         old 6 s window was measured from speech START and
         expired mid-answer — lane-3 probe P4), plus a 6 s
         grace after it ends;
       — the reading itself: the paragraphs around the
         reading position, in ANY reader state — the onset
         that hears the echo PAUSES the reader, so gating
         this source on 'playing' dropped it at exactly the
         moment it was needed (lane-3 probe P2). Reading echo
         must additionally be near-verbatim (bigram
         containment): a genuine question ABOUT the paragraph
         shares its words but not its word order, and must
         still get through. */
  function isEchoText(text) {
    var words = duplexWords(text);
    if (!words.length) return true;
    var sources = [];
    if (duplexSpokenText &&
        (duplexSpeakerActive() ||
         Date.now() - duplexSpokenAt < 6000)) {
      sources.push({ text: duplexSpokenText, verbatim: false });
    }
    try {
      if (current && current.reader) {
        var pos = current.reader.getPosition();
        var paras = current.reader.getParagraphs();
        if (paras && pos) {
          for (var k = pos.paragraph - 1; k <= pos.paragraph + 1; k++) {
            if (paras[k] && paras[k].text) {
              sources.push({ text: paras[k].text, verbatim: true });
            }
          }
        }
      }
    } catch (e) {}
    if (!sources.length) return false;
    for (var s = 0; s < sources.length; s++) {
      var srcWords = duplexWords(sources[s].text);
      if (!srcWords.length) continue;
      var srcSet = new Set(srcWords);
      var hit = 0;
      words.forEach(function (w) { if (srcSet.has(w)) hit++; });
      if ((hit / words.length) < 0.8) continue;
      if (!sources[s].verbatim) return true;
      /* Verbatim sources are judged on the UNfiltered word
         stream (short words kept): a question about the
         paragraph collapses onto its word order once short
         words are dropped, so the filtered stream cannot
         tell echo from enquiry. A partial that opens with a
         question word is the listener asking, not the
         passage playing — it is echo only if it is the
         passage read back almost word for word. */
      var all = String(text || '').toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
        .filter(function (w) { return w.length >= 2; });
      var srcAll = String(sources[s].text || '').toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
        .filter(function (w) { return w.length >= 2; });
      if (!all.length || !srcAll.length) continue;
      var srcAllSet = new Set(srcAll);
      var aHit = 0;
      all.forEach(function (w) { if (srcAllSet.has(w)) aHit++; });
      var containment = aHit / all.length;
      if (containment < 0.8) continue;
      if (all.length < 2) return true;
      var srcBigrams = new Set();
      for (var b = 0; b + 1 < srcAll.length; b++) {
        srcBigrams.add(srcAll[b] + ' ' + srcAll[b + 1]);
      }
      var bHit = 0;
      for (var p = 0; p + 1 < all.length; p++) {
        if (srcBigrams.has(all[p] + ' ' + all[p + 1])) bHit++;
      }
      var bigrams = bHit / (all.length - 1);
      var interrogative = /^(what|who|whom|whose|when|where|why|how|which|is|are|was|were|do|does|did|can|could|should|would)\b/
        .test(String(text || '').toLowerCase().trim()) ||
        String(text).indexOf('?') >= 0;
      if (interrogative) {
        if (containment >= 0.95 && bigrams >= 0.9) return true;
        continue;
      }
      if (bigrams >= 0.6) return true;
    }
    return false;
  }
  function duplexOnOnset() {
    if (duplexSpeakerActive()) {
      try { window.DogEarSpeaker.default().cancel(); } catch (e) {}
      if (packSpeaker) { try { packSpeaker.cancel(); } catch (e) {} }
    }
    if (answerAbort) {
      duplexGen++;
      try { answerAbort.abort(); } catch (e) {}
      answerAbort = null;
    }
    try {
      if (current && current.reader &&
          current.reader.getState() === 'playing') {
        current.reader.play();   // pause; the place is kept
        duplexPausedReader = true;
      }
    } catch (e) {}
    duplexBuf = '';
    if (duplexBufTimer) {
      clearTimeout(duplexBufTimer);
      duplexBufTimer = null;
    }
    /* No words followed this onset within the grace: it was
       a cough or a door, not a barge-in — give the reading
       back. The place never moved; this only un-pauses. */
    if (duplexResumeTimer) clearTimeout(duplexResumeTimer);
    duplexResumeTimer = setTimeout(function () {
      duplexResumeTimer = null;
      if (duplexPausedReader && !duplexBuf) {
        duplexPausedReader = false;
        resumeIf(true);
      }
    }, 3000);
  }
  function duplexFlush() {
    duplexBufTimer = null;
    var text = duplexBuf.trim();
    duplexBuf = '';
    var wasPlaying = duplexPausedReader;
    duplexPausedReader = false;
    if (!text || isEchoText(text)) {
      if (wasPlaying) resumeIf(true);
      return;
    }
    handleHeard(text, wasPlaying);
  }
  function duplexOnPartial(text) {
    if (!text || isEchoText(text)) return;
    if (duplexResumeTimer) {
      clearTimeout(duplexResumeTimer);
      duplexResumeTimer = null;
    }
    duplexBuf += (duplexBuf ? ' ' : '') + text;
    if (duplexBufTimer) clearTimeout(duplexBufTimer);
    duplexBufTimer = setTimeout(duplexFlush, 1200);
  }
  function duplexStart() {
    if (!voice || duplexMon || duplexStarting) return;
    if (!voice.startDuplexMonitor || !voice.engineReady ||
        !voice.engineReady()) return;
    duplexStarting = true;
    duplexWanted = true;
    voice.startDuplexMonitor({
      onOnset: duplexOnOnset,
      onPartial: duplexOnPartial,
    }).then(function (mon) {
      duplexStarting = false;
      if (mon && mon.ok && !duplexWanted) {
        /* A stop landed while this monitor was starting:
           retire it unarmed rather than leaving a live
           microphone in a surface that already let go. */
        try { mon.stop(); } catch (e) {}
        return;
      }
      if (mon && mon.ok) {
        duplexMon = mon;
        duplexOffNoted = false;
        setVoiceMsg('Duplex listening is on \u2014 talk over ' +
          'DogEar and it will stop and listen.', false);
        return;
      }
      /* mon.ok false: duplex stays off and Talk remains
         turn-based. Lane 3: that self-disable is SAID, in
         plain words, once — a silent fallback reads as a
         broken feature, not a designed floor. */
      if (!duplexOffNoted) {
        duplexOffNoted = true;
        if (mon && mon.reason === 'no-echo-cancellation') {
          setVoiceMsg('Duplex listening is off on this device: ' +
            'it cannot cancel the echo of DogEar\u2019s own voice, ' +
            'so DogEar stays turn-based here \u2014 it listens only ' +
            'when you tap Talk, so it never talks over itself.',
            false);
        } else {
          setVoiceMsg('Duplex listening is not available here ' +
            '(the microphone could not be opened for it), so ' +
            'DogEar stays turn-based: it listens only when you ' +
            'tap Talk.', false);
        }
      }
    }, function () { duplexStarting = false; });
  }
  function duplexStop() {
    duplexWanted = false;
    if (duplexMon) {
      try { duplexMon.stop(); } catch (e) {}
      duplexMon = null;
    }
    if (duplexBufTimer) {
      clearTimeout(duplexBufTimer);
      duplexBufTimer = null;
    }
    if (duplexResumeTimer) {
      clearTimeout(duplexResumeTimer);
      duplexResumeTimer = null;
    }
    duplexBuf = '';
    duplexPausedReader = false;
  }
  /* The mic's warrant is the sound it guards. When a spoken
     answer has ended and nothing else is sounding — the
     reader is not playing, no speaker is active, no
     deliberate capture is live — the duplex monitor stops:
     the microphone is per-talk, never per-session (owner
     ruling 2026-11-11: "the mic should not stay hot beyond
     what I talk to it"). A follow-up question re-arms the
     monitor when its answer forms or speaks, exactly as the
     first question's did. */
  function duplexIdleStop() {
    if (voiceListening) return;
    try {
      if (current && current.reader &&
          current.reader.getState() === 'playing') return;
    } catch (e) {}
    if (duplexSpeakerActive()) return;
    duplexStop();
  }
  /* The app leaving the foreground ends every live
     microphone hold in the same moment — the duplex monitor
     and a deliberate capture alike. The owner's case
     (2026-11-11): he switched apps to dictate a message
     elsewhere and DogEar, still holding the microphone,
     heard it instead of the app he was speaking to. An app
     in the background has no talk to guard. Reading is not
     touched: speech that belongs to the reader keeps its
     own background life, as ruled. Only the mic drops. */
  function wireMicLifecycle() {
    function dropMic() {
      duplexStop();
      if (voiceListening) {
        var cap = voiceListening;
        voiceListening = null;
        try { cap.stop(); } catch (e) {}
      }
    }
    document.addEventListener('pagehide', dropMic);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) dropMic();
    });
  }

  /* Navigation wiring (1.7.0): the voice picker, the
     per-paragraph buttons (delegated on #docBody — they are
     rebuilt with every document), the selected-text Read this
     only button, and the brain settings. */
  function wireNav() {
    var sel = $('voicePick');
    if (sel) sel.addEventListener('change', onVoicePickChange);
    if ('speechSynthesis' in window && window.speechSynthesis) {
      try {
        window.speechSynthesis.addEventListener('voiceschanged',
          refreshVoicePicker);
      } catch (e) {}
    }
    var body = $('docBody');
    if (body) {
      body.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.classList) return;
        var isFrom = t.classList.contains('para-from');
        var isOnly = t.classList.contains('para-only');
        if (!isFrom && !isOnly) return;
        var ix = parseInt(t.getAttribute('data-para') || '-1', 10);
        if (!(ix >= 0)) return;
        if (noVoice()) { showParaNoVoiceNote(t); return; }
        if (!current || !current.reader) {
          setRangeMsg('Listening is not available for this ' +
            'document just now.');
          return;
        }
        // In a windowed (multi-chunk) document the buttons carry
        // the GLOBAL paragraph number; the reader knows only the
        // window's local numbering.
        var localIx = current.chunked ? ix - current.winParaStart : ix;
        if (!(localIx >= 0)) return;
        if (isFrom) {
          current.reader.seekToParagraph(localIx, { resume: true });
          rangeMsgScope = null;
          setRangeMsg('');
        } else {
          current.reader.playRangeParagraphs(localIx, localIx);
          rangeMsgScope = { para: ix };
          setRangeMsg('Reading only paragraph ' + (ix + 1) + '.');
        }
        if (current.reader.getState() === 'playing') {
          armWatchdog(current.reader);
        }
      });
    }
    var selBtn = $('readSelectionBtn');
    if (selBtn) {
      selBtn.addEventListener('click', function () {
        if (!current || !current.reader) {
          setRangeMsg('Open a document first.');
          return;
        }
        var r = current.reader.playSelection();
        if (!(r === true || (r && r.ok))) {
          setRangeMsg('Select some text in the document first ' +
            '\u2014 then tap Read this only.');
        } else {
          rangeMsgScope = { selection: true };
          setRangeMsg('Reading only the part you selected.');
          if (current.reader.getState() === 'playing') {
            armWatchdog(current.reader);
          }
        }
      });
    }
    wireBrain();
    wireConv();
    wireNotes();
  }

  function onTalk() {
    if (!voice) return;
    /* Beta.6: an answer still speaking must not talk over the
       capture — cancel it before any listening begins. (In the
       shell the native core also silences TTS before capture;
       in a browser this cancel is the only guard.) */
    if (window.DogEarSpeaker) {
      try { window.DogEarSpeaker.default().cancel(); } catch (e) {}
    }
    if (packSpeaker) { try { packSpeaker.cancel(); } catch (e) {} }
    /* Duplex yields the microphone to the deliberate Talk
       capture — one listener at a time. */
    duplexStop();
    if (voiceListening) { voiceListening.stop(); return; }
    // A capture started from the NATIVE bar is live: this tap is
    // its stop (the bar and the page are two surfaces, one machine).
    if (nativeVoiceState === 'listening' && nativeCaptureAvailable()) {
      try { window.DogEarNative.stopCapture(); } catch (e) {}
      return;
    }
    if (voiceBusy || !current) return;
    var wasPlaying = !!(current.reader &&
      current.reader.getState() === 'playing');
    if (wasPlaying) { try { current.reader.play(); } catch (e) {} }
    var beginNative = function () {
      setVoiceMsg('Listening \u2014 say a command or ask about this ' +
        'document, then tap Talk again when you are done.', false);
      var talk = $('voiceTalkBtn');
      if (talk) talk.textContent = 'Done \u2014 stop listening';
      nativeCapturePending = { wasPlaying: wasPlaying };
      try { window.DogEarNative.startCapture(); } catch (e) {
        nativeCapturePending = null;
        sayFailure(CAPTURE_CLASS_COPY.error);
        resumeIf(wasPlaying);
        return;
      }
      voiceListening = {
        stop: function () {
          try { window.DogEarNative.stopCapture(); } catch (e) {}
        },
      };
    };
    var begin = function () {
      if (nativeCaptureAvailable()) { beginNative(); return; }
      setVoiceMsg('Listening \u2014 say a command or ask about this ' +
        'document, then tap Talk again when you are done.', false);
      var talk = $('voiceTalkBtn');
      if (talk) talk.textContent = 'Done \u2014 stop listening';
      var cap = voice.startListening({ maxMs: 20000 });
      voiceListening = cap;
      cap.done.then(function (res) {
        voiceListening = null;
        var t = $('voiceTalkBtn');
        if (t) t.textContent = 'Talk to DogEar';
        if (!res.ok) {
          sayFailure(res.reason);
          resumeIf(wasPlaying);
          return;
        }
        transcribeAndHandle(res.samples, wasPlaying);
      });
    };
    if (voice.engineReady()) { begin(); return; }
    voiceBusy = true;
    setVoiceMsg('Starting the listener \u2014 the speech model loads ' +
      'from the pack on this device\u2026', false);
    voice.loadEngine().then(function (r) {
      voiceBusy = false;
      if (!r.ok) {
        sayFailure(r.reason);
        resumeIf(wasPlaying);
        return;
      }
      begin();
    });
  }

  /* ---------------- marks (native store, page render) ----------------
     Bookmarks / notes / tags / favorites live in the native store
     (PlayerCore + MarksStore) so they can be made DURING speech
     from the native bar; this panel is the page's read-back: it
     renders the open document's marks and seeks on tap. In a plain
     browser there is no native store and the panel stays hidden. */
  function renderMarks() {
    var box = $('marksBox'), list = $('marksList'), st = $('marksState');
    if (!box || !list) return;
    var N = window.DogEarNative;
    if (!N || typeof N.getMarks !== 'function' || !current) {
      box.hidden = true;
      return;
    }
    var m = null;
    try { m = JSON.parse(N.getMarks(current.id)); } catch (e) {}
    if (!m) { box.hidden = true; return; }
    var items = [];
    (m.bookmarks || []).forEach(function (b) {
      items.push({ chunk: b.chunk, kind: 'Bookmark',
        text: b.label || ('Part ' + (b.chunk + 1)) });
    });
    (m.notes || []).forEach(function (n) {
      items.push({ chunk: n.chunk, kind: 'Note', text: n.text });
    });
    (m.tags || []).forEach(function (tg) {
      items.push({ chunk: tg.chunk, kind: 'Tag', text: tg.tag });
    });
    items.sort(function (a, b) { return a.chunk - b.chunk; });
    if (!items.length && !m.favorite && !m.saved) { box.hidden = true; return; }
    box.hidden = false;
    if (st) {
      var bits = [];
      if (m.favorite) bits.push('\u2605 This document is a favorite.');
      if (m.saved) bits.push('Saved place: part ' + (m.saved.chunk + 1) + '.');
      st.textContent = bits.join(' ');
      st.hidden = !bits.length;
    }
    list.innerHTML = '';
    items.forEach(function (it) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ghost';
      btn.textContent = it.kind + ' \u00B7 part ' + (it.chunk + 1) + ' \u2014 ' + it.text;
      btn.addEventListener('click', function () {
        seekToChunk(it.chunk, it.kind + ' \u2014 part ' + (it.chunk + 1) + '.');
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  /* ---------------- battery hint (Android shell) ----------------
     Shown once, in the reader, only inside the Android app and
     only while the phone's battery mode can still kill background
     reading (the Samsung app-sleep class, 2026-10-22). The shell
     bridge answers the state and opens the system setting; the
     page never nags twice \u2014 asking or dismissing is remembered. */
  var BATT_HINT_KEY = 'dogearapp:batt-hint:v1';
  function refreshBattNotice() {
    var box = $('battNotice');
    if (!box) return;
    var show = false;
    try {
      var native = window.DogEarNative;
      if (native &&
          typeof native.isIgnoringBatteryOptimizations === 'function' &&
          !localStorage.getItem(BATT_HINT_KEY)) {
        show = !native.isIgnoringBatteryOptimizations();
      }
    } catch (e) { show = false; }
    box.hidden = !show;
  }
  function wireBattNotice() {
    var allow = $('battAllowBtn'), dis = $('battDismissBtn');
    if (allow) allow.addEventListener('click', function () {
      try { localStorage.setItem(BATT_HINT_KEY, 'asked'); } catch (e) {}
      var box = $('battNotice');
      if (box) box.hidden = true;
      try { window.DogEarNative.requestBatteryExemption(); } catch (e) {}
    });
    if (dis) dis.addEventListener('click', function () {
      try { localStorage.setItem(BATT_HINT_KEY, 'dismissed'); } catch (e) {}
      refreshBattNotice();
    });
  }

  function wireVoice() {
    // Downloads, Use and Delete live on the picker rows (rendered
    // by refreshVoicePanel); only Talk is a standing button.
    var talk = $('voiceTalkBtn');
    if (talk) talk.addEventListener('click', onTalk);
    /* Clarity item 5: the locked Talk panel's next step goes to
       the unlock path for this surface — in the app, the plan
       box's unlock button; on the web, the licence-key box
       (unlock is sold in the Play app; keys are entered here).
       No purchase flow is added to the web surface. */
    var vub = $('voiceUnlockBtn');
    if (vub) vub.addEventListener('click', function () {
      showHome();
      var ub = $('unlockBtn');
      if (ub && !ub.hidden) {
        if (ub.scrollIntoView) ub.scrollIntoView();
        try { ub.focus(); } catch (e) {}
        return;
      }
      var p = $('addPanel');
      if (p && p.hidden) {
        var ab = $('addBtn');
        if (ab) ab.click();
      }
      var tab = document.querySelector('.tab[data-tab="upload"]');
      if (tab) tab.click();
      var li = $('licenceInput');
      if (li) {
        if (li.scrollIntoView) li.scrollIntoView();
        try { li.focus(); } catch (e) {}
      }
    });
  }

  /* ---------------- about ---------------- */
  function showAbout() {
    /* The same rule as going home (clarity item 8), which this
       door was missing until 2026-11-11: opening About while
       listening does NOT end the session. The teardown is
       deferred, and the Now-listening bar follows to About so
       pause / stop / back-in stay reachable. Only a session
       that has positively ended is closed here. (Owner-found:
       About killed a live reading outright.) */
    if (!readerSessionLive()) closeReader();
    $('readView').hidden = true;
    $('homeView').hidden = true;
    $('aboutView').hidden = false;
    window.scrollTo(0, 0);
    refreshPlanUI();
    refreshAboutVoice();
    refreshNowBar();
  }
  function wireAbout() {
    var ab = $('aboutBtn');
    if (ab) ab.addEventListener('click', showAbout);
    var back = $('aboutBackBtn');
    if (back) back.addEventListener('click', showHome);
    var av = $('appVersion');
    if (av) av.textContent = CFG.APP_VERSION || '—';
    var ev = $('engineVersion');
    if (ev && window.ReaderCore) ev.textContent = window.ReaderCore.VERSION;
    var send = $('reqSend');
    if (!send) return;
    send.addEventListener('click', function () {
      var text = $('reqText').value.trim();
      if (!text) { setMsg($('reqMsg'), 'Write your request first.', true); return; }
      send.disabled = true;
      setMsg($('reqMsg'), 'Sending\u2026', false);
      fetch('/api/improvement-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text,
          contact: $('reqContact').value.trim() || undefined,
          appVersion: CFG.APP_VERSION,
        }),
      }).then(function (r) {
        return r.json().then(function (d) { return { status: r.status, data: d }; });
      }).then(function (res) {
        send.disabled = false;
        if (res.data && res.data.ok) {
          $('reqText').value = '';
          $('reqContact').value = '';
          setMsg($('reqMsg'), 'Sent — thank you. We read every request.', false);
        } else {
          setMsg($('reqMsg'), (res.data && res.data.error) ||
            'That could not be sent just now. Nothing was kept — try again in a little while.', true);
        }
      }).catch(function () {
        send.disabled = false;
        setMsg($('reqMsg'), 'That could not be sent — check your connection and try again.', true);
      });
    });
    wireReport();
  }

  /* The problem-report form (About). The form lists what will be
     sent BEFORE the button is pressed — the typed words plus
     product, app version and surface — and the payload below is
     exactly that list, nothing more: no document, no
     conversation, no history. Nothing is sent until the press. */
  function reportSurface() {
    return window.DogEarNative ? 'Android' : 'web';
  }
  function wireReport() {
    var rv = $('repVersion');
    if (rv) rv.textContent = CFG.APP_VERSION || '—';
    var rs = $('repSurface');
    if (rs) rs.textContent = reportSurface();
    var send = $('repSend');
    if (!send) return;
    send.addEventListener('click', function () {
      var what = $('repWhat').value.trim();
      if (!what) { setMsg($('repMsg'), 'Say what happened first.', true); return; }
      send.disabled = true;
      setMsg($('repMsg'), 'Sending\u2026', false);
      fetch('/api/report-problem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          what: what,
          expected: $('repExpected').value.trim() || undefined,
          email: $('repEmail').value.trim() || undefined,
          appVersion: CFG.APP_VERSION,
          surface: reportSurface(),
        }),
      }).then(function (r) {
        return r.json().then(function (d) { return { status: r.status, data: d }; });
      }).then(function (res) {
        send.disabled = false;
        if (res.data && res.data.ok && typeof res.data.issue === 'number') {
          $('repWhat').value = '';
          $('repExpected').value = '';
          $('repEmail').value = '';
          setMsg($('repMsg'), 'Thank you — your report is #' + res.data.issue + '.', false);
        } else {
          setMsg($('repMsg'), (res.data && res.data.error) ||
            'That could not be sent just now. Nothing was kept — try again in a little while.', true);
        }
      }).catch(function () {
        send.disabled = false;
        setMsg($('repMsg'), 'That could not be sent — check your connection and try again.', true);
      });
    });
  }

  /* ---------------- install (PWA) ---------------- */
  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    $('installBtn').hidden = false; // shown ONLY when the browser offers install
  });
  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    $('installBtn').hidden = true;
  });

  /* Test surface for the large-document lane (the headless
     batteries exercise the same code the page runs, the
     ingest module's _-prefixed precedent). */
  window.DogEarDocStore = DocStore;
  window.DogEarLargeDocs = {
    CHUNK_TARGET: CHUNK_TARGET,
    splitIntoChunks: splitIntoChunks,
    createPacker: createPacker,
    docParagraphs: docParagraphs,
    startFileImport: startFileImport,
    resumeStreamingImport: resumeStreamingImport,
    openDocWindowed: openDocWindowed,
    refreshImportBanner: refreshImportBanner,
  };

  /* ---------------- boot ----------------
     Guarded: boot wires listeners and stateful modules, so it
     must run exactly once even if a host ever delivers the
     event twice — a doubled boot would double-wire purchases. */
  var booted = false;
  document.addEventListener('DOMContentLoaded', function () {
    if (booted) return;
    booted = true;
    initSpeechDetection();
    // The engine's buttons live inside the mount; their own click
    // handlers run before this delegated one sees the click bubble
    // up, so the reader state read here is the state the press
    // produced. A press that starts playback arms the watchdog; a
    // Stop press (or a press that pauses) disarms it — the user's
    // own stop is never mistaken for a speech failure.
    $('readerMount').addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.classList) return;
      if (t.classList.contains('rc-stop')) {
        wdDisarm();
        duplexStop();
        // 1.1.0: a press on the reader's own Stop button is an
        // explicit user stop — it reaches the native core through
        // the playerCommand door. (The engine's synth.cancel no
        // longer carries stop authority: it is a routine reset,
        // and routing it into the core is what turned a Resume
        // into a Stop in the beta.5 reproof, cycle 18.)
        if (window.DogEarNative && window.DogEarNative.playerCommand) {
          try { window.DogEarNative.playerCommand('stop'); } catch (e) {}
        }
        return;
      }
      if (!t.classList.contains('rc-play')) return;
      if (current && current.reader && current.reader.getState() === 'playing') {
        armWatchdog(current.reader);
        duplexStart();
      } else {
        wdDisarm();
      }
      if (meterWatch && current && current.reader &&
          current.reader.getState() === 'playing') {
        meterWatch.played = true;
      }
    });
    initLicence();
    wireLicence();
    wireAddPanel();
    renderLibrary();
    // Move any pre-chunk (localStorage-string) document bodies
    // into the chunk store. Read-through in openDoc covers the
    // moments before this lands; when it finishes, the library
    // re-renders with chunk-era places.
    DocStore.migrateLegacy().then(function () { renderLibrary(); })
      .catch(function () {});
    // Plan wiring comes after the licence is read: the meter's
    // unlock state and the owner's licence are the same question.
    if (window.DogEarMeter) {
      meter = window.DogEarMeter.create({ unlocked: isUnlocked });
    }
    wirePlan();
    wireAbout();
    wireNav();
    wireMicLifecycle();
    wireBattNotice();
    wireManageSheet();
    wireViewSwitch();
    wireNowBar();
    if (window.DogEarVoicePack && window.DogEarRetrieval) {
      voice = window.DogEarVoicePack.create({
        config: CFG,
        isUnlocked: isUnlocked,
      });
      wireVoice();
      if (window.DogEarTtsPack) {
        ttsPack = window.DogEarTtsPack.create({
          config: CFG,
          voicePack: voice,
          fxProvider: function () { return fxGet(); },
        });
        ttsPack.status().then(function (s) {
          ttsInstalled = !!(s && s.state === 'installed');
          ttsRuntimePresent = !!(s && s.runtimePresent);
          onTtsPackStateChanged();
          refreshVoicePicker();
        }).catch(function () {});
      }
      voice.getRegistry().then(function (reg) {
        var ttsEntry = reg ? registryModelById(reg,
          CFG.TTS_PACK_MODEL_ID || 'kokoro-82m-q8') : null;
        if (ttsEntry) ttsPackBytes = registryModelSize(ttsEntry);
        ttsRuntimeBytes = ((reg && reg.runtime && reg.runtime.files) || [])
          .reduce(function (a, f) { return a + f.bytes; }, 0);
        refreshVoicePanel();
        refreshAboutVoice();
        refreshVoicePicker();
      }, function () {
        refreshVoicePanel();
      });
    }
    refreshPlanUI();
    if (window.DogEarBilling) {
      billing = window.DogEarBilling.create({
        onUnlock: function () { playUnlocked = true; refreshPlanUI(); },
      });
      if (billing.isUnlocked()) playUnlocked = true;
      billing.init().then(function (st) {
        if (st && st.unlocked) playUnlocked = true;
        refreshPlanUI();
        buildTipButtons();
      });
    }
    $('backBtn').addEventListener('click', showHome);
    $('removeDocBtn').addEventListener('click', function () {
      /* Clarity item 1: the reader's remove used to delete with
         NO confirmation while the library asked first. One
         behaviour everywhere — the shared confirm + helper. */
      if (current) {
        var meta = indexEntry(current.id);
        removeDocWithConfirm(meta || {
          id: current.id,
          title: $('docTitle').textContent,
        });
      }
    });
    $('installBtn').addEventListener('click', function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () {
        deferredPrompt = null;
        $('installBtn').hidden = true;
      });
    });
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    }
  });
})();
