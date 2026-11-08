// SPDX-FileCopyrightText: 2026 2351485 ALBERTA INC.
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/* DogEar extension — content glue (Phase 1).
 *
 * Injected on the user's invocation only (activeTab). Mounts a DogEar bar
 * on the page and hands the page's article content to the PINNED
 * reader-core engine (vendor/reader-core, v0.3.0 — see PIN.json for
 * the local patches it carries). Playback uses the operating system's
 * ON-DEVICE voices only, via Web Speech speechSynthesis: the engine
 * never selects a network voice and never falls back to the browser
 * default, so no text is ever sent anywhere to be spoken. Nothing is
 * uploaded; there are no network calls in this file.
 *
 * Place-keeping records live in chrome.storage.local (the extension's
 * own storage, isolated from page scripts), written through the
 * storage adapter below; a place record left in the page's
 * localStorage by an earlier build is migrated once, on first read.
 * Listening time is metered locally toward 60 free minutes a day
 * (the allowance renews at local midnight; it was 600 minutes a
 * month until the owner's ruling of 2026-11-07 — the stored
 * monthly totals are not converted, the daily meter simply
 * starts fresh under its day key). The cross-surface unlock bridge
 * is still owed (see README): nothing in this extension can receive
 * the DogEar app's unlock, and no copy here claims it can.
 */
(function () {
  'use strict';
  if (window.__dogearExtLoaded) return;
  window.__dogearExtLoaded = true;

  var FREE_SECONDS = 60 * 60; // 60 free listening minutes per day
  var NO_VOICE_MESSAGE =
    'No on-device voice found on this device \u2014 DogEar reads ' +
    'locally only, so it won\u2019t send your text to a network voice.';
  var reader = null;
  var mode = null; // 'page' | 'selection'
  var bar = null;
  var mountEl = null;
  var selEl = null;
  var noteEl = null;
  var meterEl = null;
  var posEl = null;
  var meterTimer = null;
  var lastTick = 0;
  // The element the listener last right-clicked (captured before
  // the browser menu opens). It is how "Read from here" knows its
  // sentence (or paragraph) once DogEar is running on the page; a first-ever
  // right-click happens before this script is injected, so it
  // carries no target — that case is answered honestly in
  // doFromHere().
  var lastContextEl = null;
  // The press point rides along: when the hit target carries no
  // sentence (the paragraph element itself — the gap between two
  // sentence spans, a line's unpainted stretch), the engine's
  // geometry resolves the sentence on the point's line instead of
  // silently defaulting to the paragraph (the owner's live retest
  // finding, 2026-11-07).
  var lastContextPoint = null;
  document.addEventListener(
    'contextmenu',
    function (e) {
      lastContextEl = e.target || null;
      lastContextPoint =
        e && isFinite(e.clientX) && isFinite(e.clientY)
          ? { x: e.clientX, y: e.clientY }
          : null;
    },
    true
  );

  function dayKey() {
    var d = new Date();
    return (
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0')
    );
  }

  function storageGet(keys) {
    return new Promise(function (res) {
      try {
        chrome.storage.local.get(keys, function (o) {
          res(o || {});
        });
      } catch (e) {
        res({});
      }
    });
  }

  function storageSet(obj) {
    return new Promise(function (res) {
      try {
        chrome.storage.local.set(obj, function () {
          res();
        });
      } catch (e) {
        res();
      }
    });
  }

  // ---- place storage: chrome.storage.local, never the host page -----
  // reader-core persists synchronously; this adapter serves it from an
  // in-memory copy seeded from chrome.storage.local and writes every
  // change straight back. Place records therefore live in the
  // extension's own storage, where page scripts cannot read or tamper
  // with them.
  function makeStorageAdapter(key, seed) {
    var cache = seed == null ? null : String(seed);
    return {
      getItem: function () {
        return cache;
      },
      setItem: function (k, v) {
        cache = String(v);
        var o = {};
        o[key] = cache;
        storageSet(o);
      },
      removeItem: function () {
        cache = null;
        var o = {};
        o[key] = null;
        storageSet(o);
      },
    };
  }

  // Seed value for a place record. Reads chrome.storage.local first;
  // if the record is not there yet, a record written by an earlier
  // build into the page's localStorage (under the same key) is
  // migrated once: copied into chrome.storage.local and removed from
  // the page, so the place survives the move and the page copy is gone.
  function loadPlace(key) {
    return storageGet([key]).then(function (o) {
      if (o[key] != null) return o[key];
      var legacy = null;
      try {
        legacy = window.localStorage.getItem(key);
      } catch (e) {}
      if (legacy == null) return null;
      var setObj = {};
      setObj[key] = legacy;
      return storageSet(setObj).then(function () {
        try {
          window.localStorage.removeItem(key);
        } catch (e) {}
        return legacy;
      });
    });
  }

  function fmtMinutes(sec) {
    return Math.floor(sec / 60) + ' of 60 free minutes used today';
  }

  function updateMeterLine() {
    if (!meterEl) return;
    storageGet(['dogearMeter', 'dogearUnlocked']).then(function (o) {
      var m = o.dogearMeter || {};
      var used = m[dayKey()] || 0;
      meterEl.textContent = o.dogearUnlocked
        ? 'Unlocked — listening is unlimited.'
        : fmtMinutes(used) + '.';
    });
  }

  function showNote(text) {
    if (!noteEl) return;
    noteEl.textContent = text;
    noteEl.hidden = !text;
  }

  function ensureBar() {
    if (bar) {
      bar.hidden = false;
      return bar;
    }
    bar = document.createElement('div');
    bar.id = 'dogear-ext-bar';
    bar.innerHTML =
      '<div class="dge-head">' +
      '<span class="dge-brand">DogEar</span>' +
      '<span class="dge-tag">Document in, place kept, resume anywhere.</span>' +
      '<button type="button" class="dge-close" aria-label="Close DogEar">×</button>' +
      '</div>' +
      '<div class="dge-note" hidden></div>' +
      '<div class="dge-mount"></div>' +
      '<div class="dge-pos" role="status"></div>' +
      '<div class="dge-sel" hidden></div>' +
      '<div class="dge-foot">' +
      '<span>Reads with your computer\u2019s own voice — nothing is uploaded.</span>' +
      '<span class="dge-meter"></span>' +
      '<span>DogEar by 2351485 ALBERTA INC. (AIMLDS)</span>' +
      '</div>';
    document.documentElement.appendChild(bar);
    mountEl = bar.querySelector('.dge-mount');
    selEl = bar.querySelector('.dge-sel');
    noteEl = bar.querySelector('.dge-note');
    meterEl = bar.querySelector('.dge-meter');
    posEl = bar.querySelector('.dge-pos');
    bar
      .querySelector('.dge-close')
      .addEventListener('click', function () {
        teardown();
      });
    updateMeterLine();
    return bar;
  }

  function destroyReader() {
    if (reader) {
      try {
        reader.destroy();
      } catch (e) {}
      reader = null;
    }
    mode = null;
    stopMeter();
  }

  function teardown() {
    destroyReader();
    if (bar) {
      bar.remove();
      bar = null;
      mountEl = selEl = noteEl = meterEl = posEl = null;
    }
  }

  function updatePosLine(pos) {
    if (!posEl) return;
    posEl.textContent =
      pos && pos.paragraphs
        ? 'Paragraph ' + (pos.paragraph + 1) + ' of ' + pos.paragraphs
        : '';
  }

  // The paragraph index of an element the listener pointed at,
  // resolved against the live reader's own paragraph map.
  function paragraphIndexFor(el) {
    if (!reader || !el) return null;
    var paras = reader.getParagraphs();
    for (var i = 0; i < paras.length; i++) {
      var pel = paras[i].element;
      if (pel && (pel === el || pel.contains(el))) return paras[i].index;
    }
    return null;
  }

  function capStop() {
    if (reader) {
      try {
        reader.stop();
      } catch (e) {}
    }
    // Exactly what the meter enforces, no more: the allowance is
    // daily (the meter is keyed by local calendar day) and renews at
    // midnight. The message deliberately does NOT point at
    // the DogEar app unlock: the bridge that would let this extension
    // receive it is not built, so the unlock cannot lift this limit
    // here today.
    showNote(
      'Your 60 free minutes for today are used up. The free ' +
        'allowance renews at midnight.'
    );
  }

  function startMeter() {
    stopMeter();
    lastTick = Date.now();
    meterTimer = setInterval(function () {
      var now = Date.now();
      var delta = (now - lastTick) / 1000;
      lastTick = now;
      if (!reader || reader.getState() !== 'playing') return;
      storageGet(['dogearMeter', 'dogearUnlocked']).then(function (o) {
        var k = dayKey();
        // Only today's total is kept: earlier keys (whole months
        // under the retired monthly meter, or past days) are
        // dropped on write, so the stored map never grows and a
        // legacy monthly total can never be read as today's.
        var m = {};
        m[k] = ((o.dogearMeter || {})[k] || 0) + delta;
        storageSet({ dogearMeter: m }).then(updateMeterLine);
        if (!o.dogearUnlocked && m[k] >= FREE_SECONDS) capStop();
      });
    }, 5000);
  }

  function stopMeter() {
    if (meterTimer) {
      clearInterval(meterTimer);
      meterTimer = null;
    }
  }

  function engineMissing() {
    showNote(
      'The DogEar reader engine could not start on this page. Some pages ' +
        'block extensions from running; try another page.'
    );
  }

  function startReader(root, newMode) {
    ensureBar();
    if (!window.ReaderCore) {
      engineMissing();
      return Promise.resolve(false);
    }
    destroyReader();
    showNote('');
    var placeKey =
      newMode === 'page'
        ? 'dogear:place:' + location.pathname
        : 'dogear:place:selection:' + location.pathname;
    // The place record is seeded from chrome.storage.local before the
    // engine is created (the engine reads its resume point once, at
    // create time, through the adapter). The listener's voice
    // choice rides along the same way.
    return Promise.all([
      loadPlace(placeKey),
      storageGet(['dogearVoiceUri']),
    ]).then(function (pair) {
      var seed = pair[0];
      var voiceURI =
        (pair[1] && pair[1].dogearVoiceUri) || 'dogear:default';
      reader = window.ReaderCore.create({
        root: root,
        mount: mountEl,
        storageKey: placeKey,
        storage: makeStorageAdapter(placeKey, seed),
        // The browser's own context menu must survive on the page
        // — it carries DogEar's Read from here / Read this only —
        // so the engine's own right-click gesture stays off here.
        navGestures: false,
        voiceURI: voiceURI,
        onPosition: function (pos) {
          updatePosLine(pos);
        },
        onNoLocalVoice: function () {
          showNote(NO_VOICE_MESSAGE);
        },
        labels: {
          listen: 'Listen',
          pause: 'Pause',
          resume: 'Resume',
          stop: 'Stop reading',
          speed: 'Speed',
          prev: 'Previous paragraph',
          next: 'Next paragraph',
          seek: 'Choose where to listen',
        },
      });
      if (!reader) {
        engineMissing();
        return false;
      }
      mode = newMode;
      reader.play();
      startMeter();
      updateMeterLine();
      return true;
    });
  }

  function pageRoot() {
    return (
      document.querySelector('article') ||
      document.querySelector('main') ||
      document.body
    );
  }

  function startPage() {
    selEl && (selEl.hidden = true);
    if (reader && mode === 'page') {
      reader.play(); // toggles pause/resume
      return true;
    }
    return startReader(pageRoot(), 'page');
  }

  function startSelection(text) {
    text = String(text || '').replace(/\s+/g, ' ').trim();
    if (!text) {
      ensureBar();
      showNote(
        'Nothing is selected. Highlight the passage you want read, then ' +
          'choose \u201CRead selection with DogEar\u201D again.'
      );
      return false;
    }
    ensureBar();
    selEl.innerHTML = '';
    text
      .split(/(?<=[.!?])\s+/)
      .reduce(function (paras, sentence) {
        var last = paras[paras.length - 1];
        if (!last || last.length > 600) {
          paras.push(sentence);
        } else {
          paras[paras.length - 1] = last + ' ' + sentence;
        }
        return paras;
      }, [])
      .forEach(function (p) {
        var el = document.createElement('p');
        el.textContent = p;
        selEl.appendChild(el);
      });
    selEl.hidden = false;
    return startReader(selEl, 'selection');
  }

  // "Read from here": start at the place the listener
  // right-clicked — the SENTENCE under the point when it lands
  // inside one (the engine's seekFromNode rule), else its
  // paragraph. With no tracked target (the first-ever
  // right-click on a page DogEar has not run on yet) the reader
  // starts the page and says how to aim it — it never guesses a
  // paragraph.
  function doFromHere() {
    if (
      reader &&
      lastContextEl &&
      reader.seekFromNode(lastContextEl,
        { resume: true, point: lastContextPoint }) >= 0
    ) {
      showNote('');
      return true;
    }
    var ix = paragraphIndexFor(lastContextEl);
    if (ix == null) {
      showNote(
        'DogEar is reading this page. Right-click any paragraph ' +
          'and choose \u201CRead from here with DogEar\u201D to start ' +
          'from that paragraph.'
      );
      return false;
    }
    showNote('');
    reader.seekToParagraph(ix, { resume: true });
    return true;
  }

  // "Read this only": read just the selected passage, in place,
  // when a page reader is live; otherwise fall back to the
  // selection reader (the same words, in the DogEar bar).
  function doThisOnly(text) {
    if (reader && mode === 'page') {
      var r = reader.playSelection();
      if (r === true || (r && r.ok)) {
        showNote('Reading only the part you selected.');
        return true;
      }
    }
    return startSelection(text || '');
  }

  // Only the extension's own background worker may drive the reader:
  // the sender must be this extension, the message must carry the
  // dogear flag, and the command must be on the allowlist.
  var COMMANDS = {
    'read-page': true,
    'read-selection': true,
    'read-from-here': true,
    'read-this-only': true,
    'next-paragraph': true,
    'prev-paragraph': true,
    'seek-fraction': true,
    'set-voice': true,
    voices: true,
    toggle: true,
    stop: true,
    state: true,
  };

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.dogear !== true) return;
    if (!sender || sender.id !== chrome.runtime.id) return;
    if (!COMMANDS[msg.cmd]) return;
    var respond = function (ok) {
      sendResponse({
        ok: ok,
        state: reader ? reader.getState() : 'none',
        progress: reader ? reader.getProgress() : 0,
        position: reader && reader.getPosition ? reader.getPosition() : null,
        voiceURI: reader && reader.getVoiceURI ? reader.getVoiceURI() : null,
        voices:
          msg.cmd === 'voices' && reader ? reader.getVoices() : undefined,
        version: window.ReaderCore ? window.ReaderCore.VERSION : null,
      });
    };
    var pending;
    switch (msg.cmd) {
      case 'read-page':
        pending = startPage();
        break;
      case 'read-selection':
        pending = startSelection(msg.text || '');
        break;
      case 'read-from-here':
        if (reader && mode === 'page') {
          pending = doFromHere();
        } else {
          pending = Promise.resolve(startPage()).then(function () {
            return reader && mode === 'page' ? doFromHere() : false;
          });
        }
        break;
      case 'read-this-only':
        pending = doThisOnly(msg.text || '');
        break;
      case 'next-paragraph':
        pending = reader ? reader.nextParagraph() !== false : false;
        break;
      case 'prev-paragraph':
        pending = reader ? reader.previousParagraph() !== false : false;
        break;
      case 'seek-fraction':
        if (reader) {
          reader.seekFraction(parseFloat(msg.fraction) || 0);
          pending = true;
        } else {
          pending = false;
        }
        break;
      case 'set-voice':
        storageSet({
          dogearVoiceUri: msg.voiceURI || 'dogear:default',
        });
        if (reader) reader.setVoice(msg.voiceURI || 'dogear:default');
        pending = true;
        break;
      case 'voices':
        pending = true;
        break;
      case 'toggle':
        if (reader) {
          reader.play();
          pending = true;
        } else {
          pending = startPage();
        }
        break;
      case 'stop':
        if (reader) reader.stop();
        pending = true;
        break;
      case 'state':
        pending = true;
        break;
    }
    // startPage/startSelection may resolve asynchronously (the place
    // record is loaded from chrome.storage.local first).
    Promise.resolve(pending).then(
      function (ok) {
        respond(ok !== false);
      },
      function () {
        respond(false);
      }
    );
    return true;
  });
})();
