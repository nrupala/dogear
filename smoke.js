// Smoke test for reader/dogear.js with a stub DOM.
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/reader/dogear.js', 'utf8');

let failures = 0;
function ok(cond, name) {
  if (cond) console.log('  ok:', name);
  else { failures++; console.log('  FAIL:', name); }
}

// ---- text nodes / elements ----
function textNode(v) { return { nodeType: 3, nodeValue: v, parentNode: null, parentElement: null }; }
function makeEl(tag, text, cls) {
  const el = {
    tag, className: cls || '', textContent: text,
    children: [], parentNode: null,
    classList: {
      add(c) { el.className += ' ' + c; },
      remove(c) { el.className = el.className.replace(new RegExp('\\b' + c + '\\b'), '').trim(); },
    },
    closest(sel) {
      // supports simple '.cls' and comma lists
      let p = el;
      const parts = sel.split(',').map(s => s.trim());
      while (p) {
        for (const s of parts) {
          if (s.startsWith('.') && p.className.split(' ').includes(s.slice(1))) return p;
        }
        p = p.parentNode;
      }
      return null;
    },
    querySelector(sel) {
      // only '.dg-sent.dg-on' used on scope
      if (sel === '.dg-sent.dg-on') {
        return scope.querySelectorAll('span').find(e => e.className.includes('dg-on')) || null;
      }
      return null;
    },
    querySelectorAll(sel) {
      if (sel === 'h1,h2,p,li') return [p1, p2];
      if (sel === 'span') return spans;
      return [];
    },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    replaceChild(nw, old) {
      const i = el.children.indexOf(old);
      if (nw._frag) nw._frag.forEach(c => { c.parentNode = el; });
      el.children.splice(i, 1, ...(nw._frag || [nw]));
      if (!nw._frag) nw.parentNode = el;
      return old;
    },
  };
  return el;
}

const spans = [];
const p1 = makeEl('p', 'First sentence here. Second sentence follows!');
const p2 = makeEl('p', 'A much longer paragraph with several sentences. It keeps going. And going. Done.');
// seed text nodes
function seedText(el, v) {
  const tn = textNode(v);
  tn.parentNode = el; tn.parentElement = el;
  return tn;
}
p1.children = [seedText(p1, p1.textContent)];
// p2 carries a nested excluded .hex span (hex must never be spoken)
const hexSpan = makeEl('span', '', 'hex');
const hexText = seedText(hexSpan, '#ABCDEF ');
hexSpan.children = [hexText];
hexSpan.parentNode = p2;
p2.children = [seedText(p2, 'A much longer paragraph with several sentences. '), hexSpan,
               seedText(p2, 'It keeps going. And going. Done.')];
p2.textContent = 'A much longer paragraph with several sentences. #ABCDEF It keeps going. And going. Done.';
const scope = makeEl('article', '');
scope.children = [p1, p2]; p1.parentNode = scope; p2.parentNode = scope;
scope.querySelectorAll = function (sel) {
  if (sel === 'h1,h2,p,li') return [p1, p2];
  return [];
};

const store = {};
const spoken = [];
let listeners = {};
const synthStub = {
  speaking: false, paused: false,
  getVoices() { return [{ name: 'Google US English', lang: 'en-US' }]; },
  speak(u) { spoken.push(u.text); synthStub.speaking = true; },
  cancel() { synthStub.speaking = false; },
  pause() { synthStub.paused = true; },
  resume() { synthStub.paused = false; },
  onvoiceschanged: null,
};

const mount = {
  _attrs: { 'data-dogear': '', 'data-dogear-exclude': '.dg,.hex' },
  className: '',
  style: {},
  innerHTML: '',
  classList: { add(c) { mount.className += ' ' + c; } },
  getAttribute(k) { return this._attrs[k] || null; },
  querySelector(sel) {
    const map = {
      '.dg-play': playBtn, '.dg-stop': stopBtn,
      '.dg-speed': rateSel, '.dg-fill': fillEl,
    };
    return map[sel] || null;
  },
};
const playBtn = { textContent: '', _handlers: {}, disabled: false,
  addEventListener(e, h) { this._handlers[e] = h; },
  setAttribute() {}, click() { this._handlers.click(); } };
const stopBtn = { disabled: true, _handlers: {},
  addEventListener(e, h) { this._handlers[e] = h; },
  setAttribute() {}, click() { this._handlers.click(); } };
const rateSel = { value: '1', _handlers: {}, addEventListener(e, h) { this._handlers[e] = h; } };
const fillEl = { style: {} };

global.document = {
  querySelector(sel) {
    if (sel === '[data-dogear]') return mount;
    if (sel === 'article') return scope;
    if (sel === 'style[data-dogear-css]') return null;
    if (scopeEl_override && sel === scopeEl_override) return scope;
    return null;
  },
  querySelectorAll(sel) { return sel === '[data-dogear]' ? [mount] : []; },
  createElement(tag) {
    if (tag === 'style') return { setAttribute() {}, textContent: '' };
    if (tag === 'span') { const s = makeEl('span', ''); spans.push(s); return s; }
    return makeEl(tag, '');
  },
  createTextNode(v) { return textNode(v); },
  createDocumentFragment() { return { _frag: [], appendChild(c) { this._frag.push(c); return c; } }; },
  createTreeWalker(root) {
    const nodes = [];
    (function walk(e) { (e.children || []).forEach(c => { if (c.nodeType === 3) nodes.push(c); else walk(c); }); })(root);
    let i = 0;
    return { nextNode() { return i < nodes.length ? nodes[i++] : null; } };
  },
  head: { appendChild() {} },
  hidden: false,
  addEventListener(e, h) { listeners[e] = h; },
};
let scopeEl_override = null;
global.window = { speechSynthesis: synthStub };
global.location = { pathname: '/p/test-article' };
global.localStorage = {
  getItem(k) { return store[k] || null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; },
};
global.navigator = {};
global.NodeFilter = { SHOW_TEXT: 4 };
// capture the keepalive tick instead of starting a real timer
let keepAliveTick = null;
global.setInterval = (fn) => { keepAliveTick = fn; return 1; };
global.clearInterval = () => { keepAliveTick = null; };
const utterances = [];
global.SpeechSynthesisUtterance = function (t) { this.text = t; this.rate = 1; this.voice = null; utterances.push(this); };

// run the reader
eval(src);

// ---- assertions ----
ok(mount.className.includes('dg'), 'mount gets dg class');
ok(playBtn.textContent === '\u25B6 dogear', 'idle label is "▶ dogear", got: ' + JSON.stringify(playBtn.textContent));

// sentence wrapping happened: spans created
ok(spans.length >= 6, 'sentences wrapped in spans (' + spans.length + ')');

// excluded descendants are never spoken: the .hex span's text must not even be wrapped
ok(spans.every(s => !s.textContent.includes('#ABCDEF')), 'nested excluded .hex text is never wrapped/spoken');
ok(spans.length === 6, 'sentence count unchanged by exclusion (' + spans.length + ')');

// click play -> speaks first chunk
playBtn.click();
ok(spoken.length === 1, 'first chunk spoken on play');
ok(spoken[0].startsWith('First sentence here.'), 'chunk text correct: ' + JSON.stringify(spoken[0]).slice(0, 60));
ok(playBtn.textContent === '\u23F8 Pause', 'label switches to Pause while playing');

// drive chunk 0 to completion -> onend saves place(i=1) and speaks chunk 1
utterances[utterances.length - 1].onend();
ok(spoken.length === 2, 'second chunk spoken after first ends');
ok(store['dogear:place:/p/test-article'] !== undefined &&
   JSON.parse(store['dogear:place:/p/test-article']).i === 1, 'place advanced to chunk 1');

// pause, then stop -> idle label shows Resume · %
playBtn.click(); // pause
ok(playBtn.textContent === '\u25B6 Resume', 'label shows Resume after pause');
stopBtn.disabled = false;
stopBtn.click();
ok(playBtn.textContent === '\u25B6 Resume \u00B7 17%', 'idle+place label shows Resume · 17%: ' + JSON.stringify(playBtn.textContent));

// finish clears place: emulate by playing to end is internal; check clearPlace path via many onends is skipped —
// instead verify the place object shape
const place = JSON.parse(store['dogear:place:/p/test-article']);
ok(typeof place.i === 'number' && place.n > 0 && place.t > 0, 'place object has {i,n,t}');

// visibilitychange hidden must NOT cancel speech (the PR #30 lesson)
synthStub.speaking = true;
let cancelled = false;
const origCancel = synthStub.cancel;
synthStub.cancel = () => { cancelled = true; origCancel(); };
// force state to playing: click play again (idle -> play resumes from place)
playBtn.click();
cancelled = false; // doPlay's own pre-cancel is expected; clear before the hide event
document.hidden = true;
listeners['visibilitychange']();
ok(cancelled === false, 'hidden does not cancel speech');

// return to the tab: the keepalive re-arms (and only resets if audio truly died)
document.hidden = false;
listeners['visibilitychange']();
ok(typeof keepAliveTick === 'function', 'keepalive re-arms on return to tab');

// keepalive must nudge a stuck-paused synth back awake while playing (v1.0.4:
// the tick used to skip resume() exactly when paused, its only useful case)
synthStub.speaking = false;
synthStub.paused = true; // Android-style stall: OS suspended the utterance mid-play
let resumed = false;
const origResume = synthStub.resume;
synthStub.resume = () => { resumed = true; origResume(); };
keepAliveTick();
ok(resumed === true && synthStub.paused === false, 'keepalive resumes a stuck-paused synth while playing');

/* v1.0.5 parser-order regression: the boot contract.
   The reader must NEVER initialize while document.readyState==='loading'.
   Scenario: the embed <script> runs synchronously mid-parse — the mount div
   exists (dogearBlock emits it just before the script) but the article body
   has not been parsed yet. The reader must defer to DOMContentLoaded and then
   see the late content. This is the same family as the onsmartgrid </script>
   incident and the worker pages that only ever wrapped the headline. */
(function deferredBootRegression(){
  const spansB = [];
  const spokenB = [];
  const listenersB = {};
  const storeB = {};
  function seedB(el, v) {
    const tn = textNode(v); tn.parentNode = el; tn.parentElement = el; return tn;
  }
  const h1B = makeEl('h1', 'Late headline here.');
  h1B.children = [seedB(h1B, h1B.textContent)];
  const artB = makeEl('article', '');
  artB.children = [h1B]; h1B.parentNode = artB;
  artB.querySelectorAll = function (sel) {
    if (sel === 'h1,h2,p,li') return artB.children.filter(c => ['h1', 'h2', 'p', 'li'].indexOf(c.tag) >= 0);
    return [];
  };
  const playB = { textContent: '', _handlers: {}, addEventListener(e, h) { this._handlers[e] = h; },
    setAttribute() {}, click() { this._handlers.click(); } };
  const stopB = { disabled: true, _handlers: {}, addEventListener(e, h) { this._handlers[e] = h; }, setAttribute() {} };
  const rateB = { value: '1', _handlers: {}, addEventListener(e, h) { this._handlers[e] = h; } };
  const fillB = { style: {} };
  const mountB = {
    _attrs: { 'data-dogear': '', 'data-dogear-exclude': '.dg,.hex' },
    className: '', style: {}, innerHTML: '',
    classList: { add(c) { mountB.className += ' ' + c; } },
    getAttribute(k) { return this._attrs[k] || null; },
    querySelector(sel) {
      return { '.dg-play': playB, '.dg-stop': stopB, '.dg-speed': rateB, '.dg-fill': fillB }[sel] || null;
    },
  };
  const synthB = {
    speaking: false, paused: false,
    getVoices() { return [{ name: 'Google US English', lang: 'en-US' }]; },
    speak(u) { spokenB.push(u.text); synthB.speaking = true; },
    cancel() { synthB.speaking = false; },
    pause() { synthB.paused = true; },
    resume() { synthB.paused = false; },
    onvoiceschanged: null,
  };
  const docB = {
    readyState: 'loading', // the parser is still running when the script executes
    querySelector(sel) {
      if (sel === '[data-dogear]') return mountB;
      if (sel === 'article') return artB;
      if (sel === 'style[data-dogear-css]') return null;
      return null;
    },
    querySelectorAll(sel) { return sel === '[data-dogear]' ? [mountB] : []; },
    createElement(tag) {
      if (tag === 'style') return { setAttribute() {}, textContent: '' };
      if (tag === 'span') { const s = makeEl('span', ''); spansB.push(s); return s; }
      return makeEl(tag, '');
    },
    createTextNode(v) { return textNode(v); },
    createDocumentFragment() { return { _frag: [], appendChild(c) { this._frag.push(c); return c; } }; },
    createTreeWalker(root) {
      const nodes = [];
      (function walk(e) { (e.children || []).forEach(c => { if (c.nodeType === 3) nodes.push(c); else walk(c); }); })(root);
      let i = 0;
      return { nextNode() { return i < nodes.length ? nodes[i++] : null; } };
    },
    head: { appendChild() {} },
    hidden: false,
    addEventListener(e, h) { listenersB[e] = h; },
  };
  const saveDoc = global.document, saveWin = global.window,
        saveLoc = global.location, saveLS = global.localStorage;
  global.document = docB;
  global.window = { speechSynthesis: synthB };
  global.location = { pathname: '/p/deferred-test' };
  global.localStorage = {
    getItem(k) { return storeB[k] || null; },
    setItem(k, v) { storeB[k] = String(v); },
    removeItem(k) { delete storeB[k]; },
  };
  eval(src);
  ok(typeof listenersB['DOMContentLoaded'] === 'function', 'deferred: DOMContentLoaded listener registered while loading');
  ok(!mountB.className.includes('dg'), 'deferred: no init while document is still parsing');
  ok(spansB.length === 0, 'deferred: no sentences wrapped before DOMContentLoaded');
  // the parser continues past the <script>: body paragraphs (and excluded hex) appear
  const pB = makeEl('p', '');
  const hexB = makeEl('span', '', 'hex');
  const hexTB = seedB(hexB, '#FEDCBA ');
  hexB.children = [hexTB]; hexB.parentNode = pB; hexB.parentElement = pB;
  pB.children = [seedB(pB, 'Body paragraph one. '), hexB, seedB(pB, 'It has two sentences.')];
  pB.textContent = 'Body paragraph one. #FEDCBA It has two sentences.';
  pB.parentNode = artB; artB.children.push(pB);
  if (typeof listenersB['DOMContentLoaded'] === 'function') listenersB['DOMContentLoaded'](); // parsing finished -> boot runs
  ok(mountB.className.includes('dg'), 'deferred: init runs on DOMContentLoaded');
  ok(spansB.length === 3, 'deferred: late-parsed content is wrapped (' + spansB.length + ' spans)');
  ok(spansB.every(s => s.textContent.indexOf('#FEDCBA') < 0), 'deferred: excluded hex never wrapped');
  playB.click();
  ok(spokenB.length === 1 && spokenB[0].indexOf('Late headline here.') === 0,
     'deferred: play speaks first chunk: ' + JSON.stringify(spokenB[0] || '').slice(0, 40));
  ok(playB.textContent === '\u23F8 Pause', 'deferred: label switches to Pause while playing');
  global.document = saveDoc; global.window = saveWin;
  global.location = saveLoc; global.localStorage = saveLS;
})();

console.log(failures === 0 ? '\nALL SMOKE TESTS PASSED' : '\n' + failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
