/*
 * Licensed to Nrupal Akolkar under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance with the
 * License. You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
(function (global, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    global.ReaderCore = factory();
  }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // 0.3.0 (DogEar navigation + voice, 2026-11-07; local pin, pending
  // upstream — see PIN.json). Carries the 0.2.1 invariants (on-device
  // voices ONLY; caller-supplied storage adapter; refusal via
  // opts.onNoLocalVoice when no local voice exists) and adds, on the
  // same chunk-index position model:
  //   - paragraph map: every chunk knows its paragraph; blocks carry
  //     data-rc-para; the spoken paragraph is highlighted and scrolled
  //     into view (follow-along);
  //   - seek: a scrubbable position control + seekToUnit /
  //     seekToParagraph / seekFraction (fraction -> nearest unit);
  //   - skip: nextParagraph / previousParagraph;
  //   - ranges: playRangeParagraphs / playSelection stop AT the range
  //     end and keep the place there;
  //   - gestures: right-click or long-press starts reading from the
  //     point (opts.navGestures) — at the SENTENCE under the point
  //     when it lands inside one, else at the paragraph start;
  //   - sentence starts: seekFromNode / seekToSentence /
  //     sentenceAt resolve a pointed start (the shells'
  //     read-from-here) to the sentence containing the point, with
  //     the paragraph as the fallback for a point on the paragraph
  //     itself. playSelection already starts at its anchor sentence;
  //   - pointed-start robustness (owner's live retest, 2026-11-07):
  //     a press whose hit target is the paragraph element itself
  //     (the space between two sentence spans, a line's unpainted
  //     stretch) no longer silently degrades to the paragraph when
  //     the caller passes the press point (opts.point {x, y} on
  //     seekFromNode; the engine's own gestures pass theirs): the
  //     sentence on the point's line, nearest the point, wins. A
  //     target element wrapping part of ONE sentence (an inline
  //     element on a real page) resolves to that sentence too.
  //     playSelection falls back to the last selection this reader
  //     observed (tracked on selectionchange) when the live
  //     selection is already gone — on touch devices tapping the
  //     shell's button collapses the selection before the click
  //     arrives, so the live read alone can never succeed there.
  //     The "select some text first" refusal now means no selection
  //     was EVER observed inside this reader;
  //   - voice choice: opts.voiceURI ('dogear:default' | 'system:default'
  //     | a voiceURI) + setVoice(), which keeps the unit index;
  //   - opts.onPosition(info) reports {index, count, paragraph,
  //     paragraphs, progress, state, range} whenever position moves.
  var VERSION = '0.3.0';

  var DEFAULTS = {
    // CSS selector for readable blocks, in document order.
    blockSelector: 'h1,h2,p,li',
    // Blocks matching this are never read (chrome, code, references, ...).
    excludeSelector: 'aside,nav,footer,script,style',
    // localStorage key for last-read-point resume; null disables persistence.
    storageKey: null,
    // Optional synchronous storage adapter ({getItem,setItem,removeItem})
    // used instead of the page's localStorage for the place record —
    // extension shells pass a chrome.storage.local-backed adapter so
    // place-keeping never touches host-page storage. Default null =
    // localStorage, as before.
    storage: null,
    // Optional callback fired when playback is refused because no
    // on-device voice exists on this machine. The shell owns the user
    // message; the engine owns the refusal.
    onNoLocalVoice: null,
    // On-device voices only (0.2.1 invariant). A shell may explicitly
    // opt out with localOnly:false; no DogEar shell does.
    localOnly: true,
    // Voice selection: 'dogear:default' (the engine's on-device pick),
    // 'system:default' (the platform default voice), or a voiceURI
    // from getVoices(). Android bridge URIs ('android:...') pass
    // through to the native transport untouched.
    voiceURI: 'dogear:default',
    // Optional position observer (see header). Fired on every move.
    onPosition: null,
    // Optional callback when a read-this-only range finishes.
    onRangeEnd: null,
    // Right-click / long-press starts reading at the pointed
    // sentence (or the paragraph, when the point is the paragraph).
    navGestures: true,
    // Max characters per speech chunk.
    chunkSize: 240,
    // Keep-alive: re-assert playback every N ms (defeats mobile speech cutoffs).
    keepAliveMs: 8000,
    // Playback speeds offered.
    speeds: [0.8, 1, 1.25, 1.5],
    labels: { listen: 'Listen', pause: 'Pause', resume: 'Resume', stop: 'Stop reading', speed: 'Speed', seek: 'Reading position', prev: 'Previous paragraph', next: 'Next paragraph' },
  };

  function unitForFraction(f, n) {
    f = Number(f);
    if (!isFinite(f)) f = 0;
    f = Math.min(1, Math.max(0, f));
    n = Math.floor(Number(n) || 0);
    if (n <= 0) return 0;
    return Math.round(f * (n - 1));
  }

  function create(options) {
    var opts = {};
    for (var k in DEFAULTS) opts[k] = DEFAULTS[k];
    if (options) for (var j in options) opts[j] = options[j];

    var root = typeof opts.root === 'string' ? document.querySelector(opts.root) : opts.root;
    var mount = typeof opts.mount === 'string' ? document.querySelector(opts.mount) : opts.mount;
    if (!root || !mount) throw new Error('ReaderCore: root and mount elements are required');
    if (!('speechSynthesis' in window)) { mount.style.display = 'none'; return null; }

    var synth = window.speechSynthesis;

    // ---- controls ---------------------------------------------------------
    var speedOpts = opts.speeds.map(function (s) {
      return '<option value="' + s + '"' + (s === 1 ? ' selected' : '') + '>' + s + '\u00D7</option>';
    }).join('');
    mount.innerHTML =
      '<div class="rc-row">' +
      '<button type="button" class="rc-prev" aria-label="' + opts.labels.prev + '">\u23EE</button>' +
      '<button type="button" class="rc-play" aria-pressed="false"></button>' +
      '<button type="button" class="rc-next" aria-label="' + opts.labels.next + '">\u23ED</button>' +
      '<button type="button" class="rc-stop" disabled aria-label="' + opts.labels.stop + '">\u23F9</button>' +
      '<label class="rc-rate-label">' + opts.labels.speed +
      ' <select class="rc-rate" aria-label="' + opts.labels.speed + '">' + speedOpts + '</select></label>' +
      '<input type="range" class="rc-seek" min="0" max="0" step="1" value="0" aria-label="' + opts.labels.seek + '">' +
      '<div class="rc-progress" aria-hidden="true"><span class="rc-fill"></span></div>' +
      '<span class="rc-pos" role="status"></span>' +
      '</div>';
    var play = mount.querySelector('.rc-play');
    var prevBtn = mount.querySelector('.rc-prev');
    var nextBtn = mount.querySelector('.rc-next');
    var stopBtn = mount.querySelector('.rc-stop');
    var rateSel = mount.querySelector('.rc-rate');
    var seekEl = mount.querySelector('.rc-seek');
    var fill = mount.querySelector('.rc-fill');
    var posEl = mount.querySelector('.rc-pos');

    // ---- readable blocks ---------------------------------------------------
    var blocks = [];
    Array.prototype.forEach.call(root.querySelectorAll(opts.blockSelector), function (el) {
      if (el.closest(opts.excludeSelector)) return;
      if (el.textContent.replace(/\s+/g, '')) blocks.push(el);
    });

    // Orphan-text fallback (ported from the shipped embed, dogear v1.0.7):
    // some documents hold body text as bare text inside a container — no
    // block markup at all. The block selector then matches only headings
    // and the body is silently skipped. A container holding real direct
    // text and NO selected block inside it is itself a block; only the
    // outermost such container is taken, so its text is walked once, in
    // order. Markup-rich documents are unaffected.
    var orphans = [];
    Array.prototype.forEach.call(
      root.querySelectorAll('div,section,blockquote,td,dd,dt,figcaption'), function (el) {
        if (el.closest(opts.excludeSelector)) return;
        if (el.querySelector(opts.blockSelector)) return;
        var direct = false;
        Array.prototype.forEach.call(el.childNodes, function (n) {
          if (n.nodeType === 3 && n.nodeValue.replace(/\s+/g, '')) direct = true;
        });
        if (direct) orphans.push(el);
      });
    orphans = orphans.filter(function (el) {
      return !orphans.some(function (o) { return o !== el && o.contains(el); });
    });
    blocks = blocks.concat(orphans);
    blocks.sort(function (a, b) {
      var r = a.compareDocumentPosition(b);
      return (r & 2) ? 1 : ((r & 4) ? -1 : 0);
    });
    // Paragraph identity (0.3.0): the block's index IS its paragraph
    // number, in the document and in every API below.
    blocks.forEach(function (el, bi) {
      el.classList.add('rc-para');
      el.setAttribute('data-rc-para', String(bi));
    });

    // ---- sentence split + highlight spans ----------------------------------
    var sents = [];
    blocks.forEach(function (el, bi) {
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
      var nodes = [], n;
      while ((n = walker.nextNode())) {
        // Skip text inside excluded descendants of a kept block.
        if (n.parentElement && n.parentElement.closest &&
            n.parentElement.closest(opts.excludeSelector)) continue;
        if (n.nodeValue.replace(/\s+/g, '')) nodes.push(n);
      }
      nodes.forEach(function (tn) {
        var parts = tn.nodeValue.split(/(?<=[.!?])\s+/);
        var frag = document.createDocumentFragment();
        parts.forEach(function (p) {
          if (!p.replace(/\s+/g, '')) return;
          var sp = document.createElement('span');
          sp.className = 'rc-sent';
          sp.textContent = p;
          frag.appendChild(sp);
          frag.appendChild(document.createTextNode(' '));
          sents.push({ el: sp, text: p.replace(/\s+/g, ' ').trim(), para: bi });
        });
        tn.parentNode.replaceChild(frag, tn);
      });
    });
    if (!sents.length) { mount.style.display = 'none'; return null; }

    // ---- chunking ------------------------------------------------------------
    var chunks = [];
    var sentStart = []; // sentence index -> first chunk index
    sents.forEach(function (s, si) {
      sentStart[si] = chunks.length;
      var t = s.text, size = opts.chunkSize;
      while (t.length > size) {
        var c = t.lastIndexOf(',', size);
        if (c < 80) c = t.lastIndexOf(' ', size);
        if (c < 80) c = size;
        chunks.push({ el: s.el, text: t.slice(0, c + 1), para: s.para, sent: si });
        t = t.slice(c + 1).replace(/^\s+/, '');
      }
      if (t) chunks.push({ el: s.el, text: t, para: s.para, sent: si });
    });
    // Paragraph -> chunk span (0.3.0).
    var paraStart = [], paraEnd = []; // paraEnd is exclusive
    chunks.forEach(function (ch, i) {
      if (paraStart[ch.para] === undefined) paraStart[ch.para] = i;
      paraEnd[ch.para] = i + 1;
    });
    function paraOf(i) {
      if (!chunks.length) return 0;
      i = Math.min(Math.max(0, i), chunks.length - 1);
      return chunks[i].para;
    }

    // ---- voice ---------------------------------------------------------------
    // On-device voices ONLY (0.2.1). A network voice (localService ===
    // false) sends the text being read to the browser vendor's servers,
    // and an utterance with no voice set speaks in the browser default
    // voice — which is itself often a network voice. So the invariant
    // is hard, not a preference: resolveVoice() never selects a
    // non-local voice (unless the shell opted out), and doPlay()/speak()
    // refuse to start when no local voice is available, telling the
    // shell via opts.onNoLocalVoice.
    var selectedURI = opts.voiceURI || 'dogear:default';
    var voice = null;
    function allVoices() {
      try { return synth.getVoices() || []; } catch (e) { return []; }
    }
    function localVoices() {
      return allVoices().filter(function (v) {
        return v && (opts.localOnly === false || v.localService === true);
      });
    }
    function dogearPick() {
      var pool = localVoices();
      if (!pool.length) return null;
      // Preference ordering among on-device voices (unchanged from
      // 0.2.0): English first, then en-US, then Google-named.
      var en = pool.filter(function (v) { return /^en/i.test(v.lang || ''); });
      var p = (en.length ? en : pool).slice();
      p.sort(function (a, b) {
        var ua = /en[-_]us/i.test(a.lang || '') ? 0 : 1, ub = /en[-_]us/i.test(b.lang || '') ? 0 : 1;
        if (ua !== ub) return ua - ub;
        var ga = /google/i.test(a.name || '') ? 0 : 1, gb = /google/i.test(b.name || '') ? 0 : 1;
        return ga - gb;
      });
      return p[0] || null;
    }
    function resolveVoice() {
      if (selectedURI === 'system:default') {
        var def = localVoices().filter(function (v) { return v.default; })[0];
        voice = def || dogearPick();
      } else if (selectedURI && selectedURI !== 'dogear:default') {
        var m = allVoices().filter(function (v) { return v && v.voiceURI === selectedURI; })[0];
        if (m && (opts.localOnly === false || m.localService === true)) voice = m;
        else if (/^android:/.test(selectedURI)) {
          // Native-bridge passthrough: the transport resolves the URI
          // against the device's TTS engines; the object is a token.
          voice = { name: selectedURI, voiceURI: selectedURI, lang: '', localService: true };
        } else voice = dogearPick();
      } else {
        voice = dogearPick();
      }
      return voice;
    }
    function onVoicesChanged() {
      resolveVoice();
      if (typeof opts.onVoicesChanged === 'function') {
        try { opts.onVoicesChanged(getVoices()); } catch (e) {}
      }
    }
    try { if ('onvoiceschanged' in synth) synth.onvoiceschanged = onVoicesChanged; } catch (e) {}
    resolveVoice();

    function getVoices() {
      return localVoices().map(function (v) {
        return {
          name: v.name || '', lang: v.lang || '', voiceURI: v.voiceURI || '',
          localService: !!v.localService, default: !!v.default,
        };
      });
    }

    // ---- state + position persistence -----------------------------------------
    var state = 'idle', idx = 0, gen = 0, keepAlive = null;
    var range = null; // {start, end} chunk indexes, end exclusive (0.3.0)
    // Place records go through the shell's adapter when one is given
    // (0.2.1); the page's localStorage is only the default for shells
    // that run in their own origin (the web app), never a requirement.
    var store = opts.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    function savePos() {
      if (!opts.storageKey || !store) return;
      // n pins the record to this exact chunking: a place saved against a
      // different chunk count belongs to different content and must not be
      // offered as a resume point (ported from the shipped embed, dogear).
      try { store.setItem(opts.storageKey, JSON.stringify({ i: idx, n: chunks.length, t: Date.now() })); } catch (e) {}
    }
    function clearPos() {
      if (!opts.storageKey || !store) return;
      try { store.removeItem(opts.storageKey); } catch (e) {}
    }
    try {
      var sp = JSON.parse((store && store.getItem(opts.storageKey)) || 'null');
      // Records written before 0.2.0 carry no n; accept them on the range
      // check alone. Records with an n must match this chunking exactly.
      if (sp && sp.i > 0 && sp.i < chunks.length &&
          (typeof sp.n !== 'number' || sp.n === chunks.length)) idx = sp.i;
    } catch (e) {}

    function clearHi() {
      var h = root.querySelector('.rc-sent.rc-reading');
      if (h) h.classList.remove('rc-reading');
      var p = root.querySelector('.rc-para.rc-para-reading');
      if (p) p.classList.remove('rc-para-reading');
    }
    function markPara(p) {
      var old = root.querySelector('.rc-para.rc-para-reading');
      if (old && old !== blocks[p]) old.classList.remove('rc-para-reading');
      if (blocks[p]) blocks[p].classList.add('rc-para-reading');
    }
    function scrollToEl(el) {
      // Follow-along (0.3.0): the view never loses the voice. Guarded:
      // some DOMs (jsdom, older WebViews) lack scrollIntoView.
      try {
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'nearest' });
        }
      } catch (e) {}
    }
    function getPosition() {
      return {
        index: idx,
        count: chunks.length,
        paragraph: paraOf(idx),
        paragraphs: blocks.length,
        progress: chunks.length ? idx / chunks.length : 0,
        state: state,
        range: range ? { start: range.start, end: range.end } : null,
      };
    }
    function emitPos() {
      if (typeof opts.onPosition === 'function') {
        try { opts.onPosition(getPosition()); } catch (e) {}
      }
    }
    function progress(i) {
      if (fill) {
        var pct = i < 0 ? 0 : Math.round(((i + 1) / chunks.length) * 100);
        /* The fill is the app watchdog's progression signal: an
           UNWRITTEN fill means "nothing has completed yet" and
           any written width counts as progression (the shipped
           engines never write at speak time). A 0% write before
           the first completion would move that baseline and
           make a finished document read as a speech failure —
           so a zero write lands only once the fill exists. */
        if (pct > 0 || fill.style.width) fill.style.width = pct + '%';
      }
      if (seekEl) {
        seekEl.max = String(Math.max(0, chunks.length - 1));
        if (document.activeElement !== seekEl) seekEl.value = String(idx);
      }
      if (posEl) {
        posEl.textContent = chunks.length
          ? 'Paragraph ' + (paraOf(idx) + 1) + ' of ' + blocks.length +
            ' \u00B7 part ' + (idx + 1) + ' of ' + chunks.length
          : '';
      }
    }
    function setPlay() {
      if (state === 'playing') play.innerHTML = '\u23F8 ' + opts.labels.pause;
      else if (state === 'paused') play.innerHTML = '\u25B6 ' + opts.labels.resume;
      else play.innerHTML = (idx > 0 ? '\u25B6 ' + opts.labels.resume : '\uD83D\uDD0A ' + opts.labels.listen);
      play.setAttribute('aria-pressed', state === 'playing' ? 'true' : 'false');
      if (stopBtn) stopBtn.disabled = (state === 'idle');
      if (prevBtn) prevBtn.disabled = !chunks.length || (idx === 0 && !range);
      if (nextBtn) nextBtn.disabled = !chunks.length || idx >= chunks.length - 1;
    }
    function disarm() { if (keepAlive) { clearInterval(keepAlive); keepAlive = null; } }
    function arm() {
      disarm();
      keepAlive = setInterval(function () {
        try { if (state === 'playing' && !synth.paused) synth.resume(); } catch (e) {}
      }, opts.keepAliveMs);
    }
    // Screen wake lock (ported from the shipped embed, dogear v1.0.6):
    // the display must not time out mid-document on mobile.
    var wakeLock = null;
    function lock() {
      if (!('wakeLock' in navigator)) return;
      try { navigator.wakeLock.request('screen').then(function (s) { wakeLock = s; }, function () {}); } catch (e) {}
    }
    function unlock() {
      if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
    }
    function noVoiceBlock() {
      // Refuse rather than fall back: the shell explains why.
      gen++; disarm(); unlock();
      try { synth.cancel(); } catch (e) {}
      state = 'idle'; clearHi(); setPlay();
      if (typeof opts.onNoLocalVoice === 'function') opts.onNoLocalVoice();
    }
    function finishRange() {
      // A read-this-only range ends HERE: playback stops, the place
      // is kept AT the range end (never cleared, never rewound).
      var end = range ? range.end : idx;
      range = null;
      gen++; disarm(); unlock();
      try { synth.cancel(); } catch (e) {}
      state = 'idle';
      clearHi();
      if (end >= chunks.length) {
        idx = 0; clearPos(); progress(-1);
      } else {
        idx = end; savePos(); progress(idx - 1);
      }
      setPlay(); emitPos();
      if (typeof opts.onRangeEnd === 'function') {
        try { opts.onRangeEnd(); } catch (e) {}
      }
    }
    function advance(i, g) {
      var n = i + 1;
      if (range && n >= range.end) { finishRange(); return; }
      speak(n, g);
    }
    function speak(i, g) {
      if (g !== gen || state !== 'playing') return;
      // Backstop: never dispatch an utterance without a confirmed
      // on-device voice (an unset voice speaks in the browser default,
      // which may be a network voice).
      if (!voice) { noVoiceBlock(); return; }
      if (range && i >= range.end) { finishRange(); return; }
      if (i >= chunks.length) { stopAll(true); return; }
      idx = i; savePos();
      var ch = chunks[i];
      clearHi();
      ch.el.classList.add('rc-reading');
      markPara(ch.para);
      scrollToEl(ch.el);
      progress(i - 1);
      emitPos();
      var u = new SpeechSynthesisUtterance(ch.text);
      if (voice) u.voice = voice;
      try { u.rate = parseFloat(rateSel.value) || 1; } catch (e) { u.rate = 1; }
      u.onend = function () { if (g !== gen || state !== 'playing') return; progress(i); advance(i, g); };
      u.onerror = function () {
        if (g !== gen || state !== 'playing') return;
        // Ported from the shipped embed (dogear v1.0.6) — the place-losing
        // defect this engine still carried: on a hidden page an utterance
        // error means the OS suspended speech, not that the chunk failed.
        // Advancing on error cascades chunk-to-chunk until speak() runs
        // past the end and the completion path CLEARS the saved place —
        // the reader then restarts from the top. On a hidden page: keep
        // the place at the current chunk and stop here.
        if (document.hidden) {
          savePos(); gen++; disarm(); unlock();
          state = 'idle'; clearHi(); setPlay();
          return;
        }
        advance(i, g);
      };
      try { synth.speak(u); } catch (e) { if (g === gen && state === 'playing') advance(i, g); }
    }
    function doPlay() {
      if (state === 'playing') { try { synth.pause(); } catch (e) {} state = 'paused'; setPlay(); disarm(); unlock(); emitPos(); return; }
      if (state === 'paused') { try { synth.resume(); } catch (e) {} state = 'playing'; setPlay(); arm(); lock(); emitPos(); return; }
      // Starting playback requires a confirmed on-device voice; the
      // voice list may have arrived (or changed) since create().
      resolveVoice();
      if (!voice) {
        if (typeof opts.onNoLocalVoice === 'function') opts.onNoLocalVoice();
        return;
      }
      if (range && (idx < range.start || idx >= range.end)) idx = range.start;
      gen++;
      try { synth.cancel(); } catch (e) {}
      state = 'playing'; setPlay(); arm(); lock(); speak(idx, gen);
    }
    function stopAll(done) {
      gen++; disarm(); unlock();
      try { synth.cancel(); } catch (e) {}
      state = 'idle';
      if (done) { idx = 0; clearPos(); range = null; }
      clearHi(); progress(-1); setPlay(); emitPos();
    }
    function showAt(i) {
      clearHi();
      var ch = chunks[i];
      if (!ch) return;
      ch.el.classList.add('rc-reading');
      markPara(ch.para);
      scrollToEl(ch.el);
      progress(i - 1);
    }

    // ---- navigation (0.3.0) -------------------------------------------------
    function seekToUnit(i, o) {
      o = o || {};
      if (!chunks.length) return -1;
      i = Math.round(Number(i) || 0);
      i = Math.min(Math.max(0, i), chunks.length - 1);
      if (!o.keepRange) range = null;
      var was = state;
      idx = i; savePos();
      showAt(idx);
      if (o.resume || was === 'playing') {
        resolveVoice();
        if (!voice) {
          state = 'idle'; setPlay(); emitPos();
          if (typeof opts.onNoLocalVoice === 'function') opts.onNoLocalVoice();
          return idx;
        }
        gen++;
        try { synth.cancel(); } catch (e) {}
        state = 'playing'; setPlay(); arm(); lock();
        speak(idx, gen);
      } else if (was === 'paused') {
        // The paused utterance belongs to the old position: drop it.
        // The place is kept at the new unit; Resume speaks from here.
        gen++;
        try { synth.cancel(); } catch (e) {}
        state = 'idle'; setPlay();
      }
      emitPos();
      return idx;
    }
    function seekToParagraph(p, o) {
      p = Math.min(Math.max(0, Math.round(Number(p) || 0)), blocks.length - 1);
      if (paraStart[p] === undefined) return -1;
      return seekToUnit(paraStart[p], o);
    }
    function nextParagraph() {
      var p = paraOf(idx);
      if (p + 1 >= blocks.length || paraStart[p + 1] === undefined) return false;
      seekToUnit(paraStart[p + 1], { resume: state !== 'idle' });
      return true;
    }
    function previousParagraph() {
      var p = paraOf(idx);
      var target = idx > paraStart[p] ? paraStart[p] : (p > 0 ? paraStart[p - 1] : 0);
      seekToUnit(target, { resume: state !== 'idle' });
      return target !== idx || true;
    }
    function setChunkRange(a, b) {
      a = Math.min(Math.max(0, Math.round(Number(a) || 0)), chunks.length - 1);
      b = Math.min(Math.max(a + 1, Math.round(Number(b) || 0)), chunks.length);
      range = { start: a, end: b };
      return range;
    }
    function playRangeParagraphs(a, b) {
      a = Math.min(Math.max(0, Math.round(Number(a) || 0)), blocks.length - 1);
      b = Math.min(Math.max(a, Math.round(Number(b) || 0)), blocks.length - 1);
      if (paraStart[a] === undefined || paraEnd[b] === undefined) return false;
      setChunkRange(paraStart[a], paraEnd[b]);
      seekToUnit(range.start, { resume: true, keepRange: true });
      return true;
    }
    // The sentence containing a DOM node (a selection endpoint, an
    // event target, a shell's tracked click target), or -1 when the
    // node is not inside one of this reader's sentence spans. A
    // target element that WRAPS sentence spans (an inline element
    // on a real page — a link or emphasis around part of a
    // sentence) resolves too when every span it wraps belongs to
    // ONE sentence: the wrapper is that sentence's own furniture.
    // A wrapper spanning several sentences stays unresolved here;
    // the point geometry below is the finer instrument for it.
    function sentenceIndexForNode(node) {
      var el = node && node.nodeType === 1 ? node : (node && node.parentElement);
      if (!el || !el.closest) return -1;
      var sp = el.closest('.rc-sent');
      if (sp && root.contains(sp)) {
        for (var i = 0; i < sents.length; i++) if (sents[i].el === sp) return i;
        return -1;
      }
      if (!root.contains(el) || !el.querySelectorAll) return -1;
      var inner = el.querySelectorAll('.rc-sent');
      var found = -1;
      for (var j = 0; j < inner.length; j++) {
        var si = -1;
        for (var k = 0; k < sents.length; k++) {
          if (sents[k].el === inner[j]) { si = k; break; }
        }
        if (si < 0) continue;
        if (found >= 0 && found !== si) return -1;
        found = si;
      }
      return found;
    }
    // The sentence of paragraph p at a press point (client
    // coordinates), or -1 when the point is on no sentence's line.
    // A span whose painted box holds the point wins outright;
    // otherwise the point must share a line with a span (its y
    // inside the span's vertical band) and the nearest such span
    // on that line wins — that is the press that landed on the
    // space between two sentences, or just past a line's last
    // word. A point above the first line, below the last, or in
    // the paragraph's padding resolves NOTHING: the paragraph
    // fallback owns those, honestly.
    function sentenceAtPoint(p, x, y) {
      if (!isFinite(x) || !isFinite(y)) return -1;
      var best = -1, bestGap = Infinity;
      for (var i = 0; i < sents.length; i++) {
        if (sents[i].para !== p) continue;
        var rects;
        try { rects = sents[i].el.getClientRects(); } catch (e) { return -1; }
        if (!rects) continue;
        for (var r = 0; r < rects.length; r++) {
          var rc = rects[r];
          if (!rc || (!rc.width && !rc.height)) continue;
          if (x >= rc.left && x <= rc.right && y >= rc.top && y <= rc.bottom) {
            return i;
          }
          if (y >= rc.top && y <= rc.bottom) {
            var gap = x < rc.left ? rc.left - x : (x > rc.right ? x - rc.right : 0);
            if (gap < bestGap) { bestGap = gap; best = i; }
          }
        }
      }
      return best;
    }
    function selectionSpan(node) {
      return sentenceIndexForNode(node);
    }
    function seekToSentence(si, o) {
      si = Math.round(Number(si) || 0);
      if (si < 0 || si >= sents.length || sentStart[si] === undefined) return -1;
      return seekToUnit(sentStart[si], o);
    }
    function paraFromNode(node) {
      var t = node && node.nodeType === 3 ? node.parentNode : node;
      if (!t || !t.closest) return -1;
      var b = t.closest('[data-rc-para]');
      if (!b || !root.contains(b)) return -1;
      var p = parseInt(b.getAttribute('data-rc-para'), 10);
      return isNaN(p) ? -1 : p;
    }
    // One resolution rule for every POINTED start (the engine's own
    // gestures; the shells' read-from-here): the sentence under the
    // point wins, so aiming at a paragraph's third sentence starts
    // there — not back at the paragraph top (the owner's live
    // finding on the 1.7.0 RC, 2026-11-07). When the hit target
    // carries no sentence (the paragraph element itself — the press
    // landed on the gap between two sentence spans, or a line's
    // unpainted stretch) and the caller passes the press point
    // (o.point = {x, y}, client coordinates), the sentence on the
    // point's line, nearest the point, wins instead of the silent
    // paragraph default (the owner's live RETEST finding, same
    // day: the same paragraph, a few pixels apart, gave both
    // answers). The paragraph remains the fallback for a point
    // truly on the paragraph itself: its padding, its action row,
    // the block element with no sentence on the point's line.
    // Returns the chunk index playback moved to, or -1 when the
    // point is not in the reading matter at all.
    function seekFromNode(node, o) {
      var si = sentenceIndexForNode(node);
      var p = -1;
      if (si < 0) {
        p = paraFromNode(node);
        if (p >= 0 && o && o.point) {
          si = sentenceAtPoint(p, o.point.x, o.point.y);
        }
      }
      if (si >= 0) return seekToSentence(si, o);
      if (p < 0) p = paraFromNode(node);
      if (p < 0) return -1;
      return seekToParagraph(p, o);
    }
    // The last selection observed inside this reader (sentence
    // indexes at both ends), tracked on selectionchange. Touch
    // browsers collapse the live selection the moment the listener
    // reaches for the shell's Read-this-only button, so the button
    // can never see the selection it exists for; the tracked copy
    // is what the tap meant. Only a live, resolvable selection is
    // ever recorded — a collapse teaches nothing and erases
    // nothing.
    var lastSel = null;
    function trackSelection() {
      var sel = null;
      try { sel = window.getSelection ? window.getSelection() : null; } catch (e) {}
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      var a = selectionSpan(sel.anchorNode);
      var f = selectionSpan(sel.focusNode);
      if (a >= 0 && f >= 0) lastSel = { a: a, f: f };
    }
    document.addEventListener('selectionchange', trackSelection);
    function playSelection() {
      var a = -1, f = -1;
      var sel = null;
      try { sel = window.getSelection ? window.getSelection() : null; } catch (e) {}
      if (sel && !sel.isCollapsed && sel.rangeCount) {
        a = selectionSpan(sel.anchorNode);
        f = selectionSpan(sel.focusNode);
        if (a >= 0 && f >= 0) lastSel = { a: a, f: f };
      }
      if ((a < 0 || f < 0) && lastSel) { a = lastSel.a; f = lastSel.f; }
      if (a < 0 || f < 0) return false;
      var s0 = Math.min(a, f), s1 = Math.max(a, f);
      var end = (s1 + 1 < sents.length) ? sentStart[s1 + 1] : chunks.length;
      setChunkRange(sentStart[s0], end);
      seekToUnit(range.start, { resume: true, keepRange: true });
      return true;
    }
    function setVoice(uri) {
      selectedURI = uri || 'dogear:default';
      resolveVoice();
      if (!voice) {
        if (typeof opts.onNoLocalVoice === 'function') opts.onNoLocalVoice();
        return false;
      }
      if (state === 'playing') {
        // Same unit, new voice: restart the CURRENT chunk so the
        // switch is heard at once and the position never moves.
        gen++;
        try { synth.cancel(); } catch (e) {}
        speak(idx, gen);
      } else if (state === 'paused') {
        gen++;
        try { synth.cancel(); } catch (e) {}
        state = 'idle'; setPlay(); emitPos();
      }
      return true;
    }

    // ---- pointed-start gestures (0.3.0) ---------------------------------------
    // Right-click / long-press starts at the pointed SENTENCE when
    // the point lands inside one, else at its paragraph — the same
    // seekFromNode rule the shells' read-from-here uses.
    var lpTimer = null;
    var lpNode = null;
    var lpPoint = null;
    function eventPoint(e) {
      if (!e || !isFinite(e.clientX) || !isFinite(e.clientY)) return null;
      return { x: e.clientX, y: e.clientY };
    }
    function onContextMenu(e) {
      if (!e || seekFromNode(e.target,
        { resume: true, point: eventPoint(e) }) < 0) return;
      e.preventDefault();
    }
    function clearLp() {
      if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
      lpNode = null;
      lpPoint = null;
    }
    function onPointerDown(e) {
      if (e.pointerType === 'mouse') return;
      if (sentenceIndexForNode(e.target) < 0 && paraFromNode(e.target) < 0) return;
      clearLp();
      lpNode = e.target;
      lpPoint = eventPoint(e);
      lpTimer = setTimeout(function () {
        lpTimer = null;
        var node = lpNode;
        var point = lpPoint;
        lpNode = null;
        lpPoint = null;
        if (node) seekFromNode(node, { resume: true, point: point });
      }, 600);
    }
    if (opts.navGestures) {
      root.addEventListener('contextmenu', onContextMenu);
      root.addEventListener('pointerdown', onPointerDown);
      root.addEventListener('pointerup', clearLp);
      root.addEventListener('pointercancel', clearLp);
    }

    play.addEventListener('click', doPlay);
    if (prevBtn) prevBtn.addEventListener('click', function () { previousParagraph(); });
    if (nextBtn) nextBtn.addEventListener('click', function () { nextParagraph(); });
    if (stopBtn) stopBtn.addEventListener('click', function () { range = null; stopAll(false); });
    if (seekEl) seekEl.addEventListener('change', function () {
      seekToUnit(parseInt(seekEl.value, 10) || 0, { resume: state !== 'idle' });
    });
    if (rateSel) rateSel.addEventListener('change', function () {
      if (state !== 'playing') return;
      gen++;
      try { synth.cancel(); } catch (e) {}
      speak(idx, gen);
    });
    function onPageHide() { stopAll(false); }
    document.addEventListener('pagehide', onPageHide);
    // Ported from the shipped embed (dogear v1.0.6): when the page goes
    // hidden mid-play, keep the place and release the wake lock; when it
    // returns, reconcile if the OS stopped the audio underneath us.
    function onVisibility() {
      if (document.hidden) {
        unlock(); disarm();
        if (state === 'playing') savePos();
      } else if (state === 'playing') {
        lock(); arm();
        try { if (!synth.speaking && !synth.paused) { state = 'idle'; setPlay(); } } catch (e) {}
      }
    }
    document.addEventListener('visibilitychange', onVisibility);

    if (idx > 0) progress(idx - 1);
    setPlay();
    emitPos();

    return {
      version: VERSION,
      play: doPlay,
      stop: function () { range = null; stopAll(false); },
      getState: function () { return state; },
      getProgress: function () { return chunks.length ? idx / chunks.length : 0; },
      getPosition: getPosition,
      getIndex: function () { return idx; },
      getChunkCount: function () { return chunks.length; },
      getParagraphCount: function () { return blocks.length; },
      getParagraphs: function () {
        return blocks.map(function (el, p) {
          return {
            index: p,
            chunkStart: paraStart[p],
            chunkEnd: paraEnd[p],
            text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
            element: el,
          };
        });
      },
      paragraphAt: paraOf,
      sentenceAt: sentenceIndexForNode,
      seekToUnit: seekToUnit,
      seekToParagraph: seekToParagraph,
      seekToSentence: seekToSentence,
      seekFromNode: seekFromNode,
      seekFraction: function (f, o) { return seekToUnit(unitForFraction(f, chunks.length), o); },
      unitForFraction: function (f) { return unitForFraction(f, chunks.length); },
      nextParagraph: nextParagraph,
      previousParagraph: previousParagraph,
      setRangeParagraphs: function (a, b) {
        a = Math.min(Math.max(0, Math.round(Number(a) || 0)), blocks.length - 1);
        b = Math.min(Math.max(a, Math.round(Number(b) || 0)), blocks.length - 1);
        if (paraStart[a] === undefined || paraEnd[b] === undefined) return null;
        return setChunkRange(paraStart[a], paraEnd[b]);
      },
      playRangeParagraphs: playRangeParagraphs,
      playSelection: playSelection,
      clearRange: function () { range = null; },
      getRange: function () { return range ? { start: range.start, end: range.end } : null; },
      getVoices: getVoices,
      getVoiceURI: function () { return selectedURI; },
      getVoice: function () { return voice; },
      setVoice: setVoice,
      destroy: function () {
        stopAll(false);
        clearLp();
        if (opts.navGestures) {
          root.removeEventListener('contextmenu', onContextMenu);
          root.removeEventListener('pointerdown', onPointerDown);
          root.removeEventListener('pointerup', clearLp);
          root.removeEventListener('pointercancel', clearLp);
        }
        document.removeEventListener('pagehide', onPageHide);
        document.removeEventListener('visibilitychange', onVisibility);
        document.removeEventListener('selectionchange', trackSelection);
        mount.innerHTML = '';
      },
    };
  }

  // Boot contract (ported from the shipped embed, dogear v1.0.5): NEVER
  // initialize while the document is still parsing. An inline script runs
  // synchronously, so readable content placed after it in the HTML would
  // otherwise be invisible to the reader — the parse-order defect family
  // behind three fleet incidents. auto() makes initialization independent
  // of script placement: while parsing, it defers create() to
  // DOMContentLoaded; otherwise it creates immediately. Returns the
  // reader when created immediately, or null when deferred — in both
  // cases options.onReady(reader), if given, fires once the reader
  // exists. Shells that call create() directly own the same contract:
  // call it after the document has been parsed.
  function auto(options) {
    options = options || {};
    if (typeof document !== 'undefined' && document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        var r = create(options);
        if (typeof options.onReady === 'function') options.onReady(r);
      });
      return null;
    }
    var r = create(options);
    if (typeof options.onReady === 'function') options.onReady(r);
    return r;
  }

  return { VERSION: VERSION, create: create, auto: auto, DEFAULTS: DEFAULTS, unitForFraction: unitForFraction };
}));
