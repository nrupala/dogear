/* DogEar extension — content glue (Phase 1).
 *
 * Injected on the user's invocation only (activeTab). Mounts a DogEar bar
 * on the page and hands the page's article content to the PINNED
 * reader-core engine (vendor/reader-core, v0.2.0 — the same pin the web
 * app carries; shells pin reader-core, they never fork it). Playback is
 * the operating system's own voices via Web Speech speechSynthesis,
 * exactly the owner's design: the extension invokes the built-in voice
 * and the engine starts working. Nothing is uploaded; there are no
 * network calls in this file.
 *
 * Place-keeping reuses reader-core's own storage record (per page), and
 * listening time is metered locally toward the same 600 free minutes a
 * month every DogEar surface shares (see README — the cross-surface
 * meter/unlock bridge is the one named piece of plumbing still owed;
 * until it lands, this meter enforces the same allowance inside the
 * extension and says so).
 */
(function () {
  'use strict';
  if (window.__dogearExtLoaded) return;
  window.__dogearExtLoaded = true;

  var FREE_SECONDS = 600 * 60; // 600 free listening minutes per month
  var reader = null;
  var mode = null; // 'page' | 'selection'
  var bar = null;
  var mountEl = null;
  var selEl = null;
  var noteEl = null;
  var meterEl = null;
  var meterTimer = null;
  var lastTick = 0;

  function monthKey() {
    var d = new Date();
    return (
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
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

  function fmtMinutes(sec) {
    return Math.floor(sec / 60) + ' of 600 free minutes used this month';
  }

  function updateMeterLine() {
    if (!meterEl) return;
    storageGet(['dogearMeter', 'dogearUnlocked']).then(function (o) {
      var m = o.dogearMeter || {};
      var used = m[monthKey()] || 0;
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
      mountEl = selEl = noteEl = meterEl = null;
    }
  }

  function capStop() {
    if (reader) {
      try {
        reader.stop();
      } catch (e) {}
    }
    showNote(
      'Your 600 free minutes for this month are used up. DogEar\u2019s ' +
        'one-time unlock (US$24.99) in the DogEar app removes the limit — ' +
        'the device\u2019s voices are never sold; the charge is for heavy ' +
        'use of the app.'
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
        var m = o.dogearMeter || {};
        var k = monthKey();
        m[k] = (m[k] || 0) + delta;
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
      return false;
    }
    destroyReader();
    showNote('');
    reader = window.ReaderCore.create({
      root: root,
      mount: mountEl,
      storageKey:
        newMode === 'page'
          ? 'dogear:place:' + location.pathname
          : 'dogear:place:selection:' + location.pathname,
      labels: {
        listen: 'Listen',
        pause: 'Pause',
        resume: 'Resume',
        stop: 'Stop reading',
        speed: 'Speed',
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

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.dogear !== true) return;
    var ok = true;
    switch (msg.cmd) {
      case 'read-page':
        ok = startPage();
        break;
      case 'read-selection':
        ok = startSelection(msg.text || '');
        break;
      case 'toggle':
        if (reader) reader.play();
        else ok = startPage();
        break;
      case 'stop':
        if (reader) reader.stop();
        break;
      case 'state':
        break;
      default:
        ok = false;
    }
    sendResponse({
      ok: ok,
      state: reader ? reader.getState() : 'none',
      progress: reader ? reader.getProgress() : 0,
      version: window.ReaderCore ? window.ReaderCore.VERSION : null,
    });
    return true;
  });
})();
