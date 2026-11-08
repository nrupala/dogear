// SPDX-FileCopyrightText: 2026 2351485 ALBERTA INC.
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/* DogEar extension — jsdom smoke test.
 *
 * Loads the real payload (pinned reader-core + content.js) into a jsdom
 * page with the platform surfaces stubbed (chrome.*, speechSynthesis)
 * and drives the exact message protocol the background worker uses:
 *
 *   read-page      -> the DogEar bar mounts, the engine starts speaking
 *   toggle         -> pause, then resume
 *   state          -> reports the live state
 *   read-selection -> the selection panel fills and reading starts
 *   stop           -> speech stops, place kept
 *
 * jsdom proves the shell+engine integration end to end short of a real
 * browser binary; the store zips additionally pass tools/verify.py.
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

let failures = 0;
function check(cond, msg) {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
  if (!cond) failures++;
}

const html = `<!DOCTYPE html><html><head><title>Fixture</title></head><body>
<article>
  <h1>A Fixture Article</h1>
  <p>DogEar reads pages aloud in the voice that already lives on this
  computer. The first sentence proves the engine found the article.</p>
  <p>A second paragraph gives the reader somewhere to go. Place is kept
  per page, so a long document resumes where it stopped.</p>
  <p>The final paragraph closes the fixture. Nothing here is uploaded.</p>
</article>
</body></html>`;

const dom = new JSDOM(html, {
  url: 'https://example.test/fixture',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;

// ---- platform stubs ------------------------------------------------------
const spoken = [];
window.SpeechSynthesisUtterance = class {
  constructor(text) { this.text = text; }
};
window.speechSynthesis = {
  speaking: false,
  paused: false,
  getVoices() {
    return [{ name: 'Fixture Voice', lang: 'en-US', localService: true }];
  },
  // Deterministic: an utterance never ends on its own. The test ends it
  // explicitly via finishUtterance() — an auto-ending stub races the
  // message round-trips and makes toggle assertions timing-dependent
  // (the first CI failure: the whole short fixture "finished" before
  // the pause toggle landed).
  speak(u) {
    spoken.push(u.text);
    this.speaking = true;
    this._current = u;
  },
  finishUtterance() {
    const u = this._current;
    this._current = null;
    this.speaking = false;
    if (u && u.onend) u.onend();
  },
  cancel() { this.speaking = false; this._current = null; },
  pause() { this.paused = true; },
  resume() { this.paused = false; },
};

const storageData = {};
let messageListener = null;
window.chrome = {
  runtime: {
    onMessage: {
      addListener(fn) { messageListener = fn; },
    },
  },
  storage: {
    local: {
      get(keys, cb) {
        const out = {};
        (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
          if (k in storageData) out[k] = storageData[k];
        });
        cb(out);
      },
      set(obj, cb) {
        Object.assign(storageData, obj);
        if (cb) cb();
      },
    },
  },
};

// ---- load the payload ------------------------------------------------------
window.eval(read('vendor/reader-core/reader-core.js'));
check(typeof window.ReaderCore === 'object', 'pinned reader-core loads');
check(window.ReaderCore.VERSION === '0.3.0', 'engine is the pinned 0.3.0');
window.eval(read('content.js'));
check(typeof messageListener === 'function', 'content glue registered its listener');

function command(msg) {
  return new Promise((resolve) => {
    messageListener(msg, {}, (resp) => resolve(resp));
  });
}
const tick = () => new Promise((r) => setTimeout(r, 30));

// ---- read-page ---------------------------------------------------------------
let resp = await command({ dogear: true, cmd: 'read-page' });
await tick();
check(resp && resp.ok === true, 'read-page accepted');
const bar = window.document.getElementById('dogear-ext-bar');
check(!!bar, 'DogEar bar mounted on the page');
check(bar && bar.textContent.includes('2351485 ALBERTA INC.'),
  'bar carries the entity line');
check(spoken.length > 0, 'engine spoke the first chunk');
check(spoken[0].includes('Fixture Article'),
  'speech starts at the article heading');
window.speechSynthesis.finishUtterance();
check(spoken.join(' ').includes('DogEar reads pages aloud'),
  'speech continues into the article body, not the page chrome');
check(window.document.querySelectorAll('.rc-sent').length > 3,
  'sentences wrapped for highlighting');
resp = await command({ dogear: true, cmd: 'state' });
check(resp && resp.state === 'playing', 'state reports the live reader');

// ---- toggle: pause then resume ----------------------------------------------
resp = await command({ dogear: true, cmd: 'toggle' });
check(resp && resp.state === 'paused', 'toggle pauses');
resp = await command({ dogear: true, cmd: 'toggle' });
check(resp && resp.state === 'playing', 'toggle resumes');

// ---- stop ---------------------------------------------------------------------
resp = await command({ dogear: true, cmd: 'stop' });
check(resp && resp.state === 'idle', 'stop halts, place kept');

// ---- read-selection -------------------------------------------------------------
resp = await command({
  dogear: true,
  cmd: 'read-selection',
  text: 'A highlighted passage the user chose. It is read on its own.',
});
await tick();
check(resp && resp.ok === true, 'read-selection accepted');
const sel = window.document.querySelector('#dogear-ext-bar .dge-sel');
check(sel && sel.textContent.includes('highlighted passage'),
  'selection panel carries the chosen text');
check(spoken.join(' ').includes('highlighted passage'),
  'selection is what gets spoken');

// ---- read-selection with nothing selected ---------------------------------------
resp = await command({ dogear: true, cmd: 'read-selection', text: '   ' });
check(resp && resp.ok === false, 'empty selection is refused honestly');

// ---- navigation (1.1.0): skip, seek, read-this-only, read-from-here, voice ------
resp = await command({ dogear: true, cmd: 'read-page' });
await tick();
check(resp && resp.state === 'playing', 'nav: page reading again');
const startPara = resp.position ? resp.position.paragraph : 0;

resp = await command({ dogear: true, cmd: 'next-paragraph' });
check(resp && resp.position && resp.position.paragraph === startPara + 1,
  'nav: next-paragraph lands on the next paragraph');
check(spoken[spoken.length - 1].includes('A second paragraph'),
  'nav: the new paragraph is what gets spoken');

resp = await command({ dogear: true, cmd: 'prev-paragraph' });
check(resp && resp.position && resp.position.paragraph === startPara,
  'nav: prev-paragraph returns to the paragraph before');

resp = await command({ dogear: true, cmd: 'seek-fraction', fraction: 1 });
check(resp && resp.position && resp.position.paragraph === 3,
  'nav: seek to the end lands on the final paragraph');

const paras = window.document.querySelectorAll('article p');
const sentSpan = paras[1].querySelector('.rc-sent');
const sentText = sentSpan && sentSpan.firstChild;
// jsdom's Selection collapses programmatic ranges (anchor lands on
// the span, isCollapsed=true) — a harness limit, not the product's:
// a real browser selection anchors on the text node and stays open.
// Stub exactly that platform surface; the engine's span mapping,
// range setting and seeking all run for real.
const realGetSelection = window.getSelection.bind(window);
window.getSelection = () => ({
  isCollapsed: false,
  rangeCount: 1,
  anchorNode: sentText,
  focusNode: sentText,
  removeAllRanges() {},
  addRange() {},
});
const before = spoken.length;
resp = await command({ dogear: true, cmd: 'read-this-only', text: '' });
window.getSelection = realGetSelection;
check(resp && resp.ok === true, 'nav: read-this-only accepted in place');
check(spoken.length > before &&
  spoken[spoken.length - 1].includes('A second paragraph'),
  'nav: only the selected paragraph is spoken');

paras[2].dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }));
resp = await command({ dogear: true, cmd: 'read-from-here' });
check(resp && resp.ok === true && resp.position && resp.position.paragraph === 3,
  'nav: read-from-here starts at the right-clicked paragraph');
check(spoken[spoken.length - 1].includes('The final paragraph'),
  'nav: speech begins at that paragraph');

// Sentence-level aim (2026-11-07 fix): a right-click ON the second
// sentence of a paragraph starts at that sentence, not back at the
// paragraph top — the owner's live finding on the 1.7.0 RC. The
// place line still reports the paragraph. (The live spans are the
// innermost .rc-sent set: this page has hosted two readers by now,
// and a recreated engine wraps its spans inside the previous set —
// a real click lands on the inner text, never the stale wrapper.)
const liveSpans = [...paras[1].querySelectorAll('.rc-sent')]
  .filter((s) => !s.querySelector('.rc-sent'));
check(liveSpans.length === 2, 'nav: fixture paragraph carries two live sentences');
liveSpans[1].dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }));
resp = await command({ dogear: true, cmd: 'read-from-here' });
check(resp && resp.ok === true && resp.position && resp.position.paragraph === 2,
  'nav: read-from-here on a sentence keeps the paragraph place');
check(spoken[spoken.length - 1].includes('Place is kept per page'),
  'nav: speech begins at the pointed sentence, not the paragraph top');

// Pointed-start geometry (2026-11-07 retest fix): a right-click
// whose hit target is the paragraph ELEMENT — the press landed on
// the gap between two sentence spans, or on a line's unpainted
// stretch — used to default silently to the paragraph top (the
// owner's "read properly the first time, then defaulted to
// paragraph"). The content script now tracks the press point and
// the engine resolves the sentence on the point's line. jsdom has
// no layout, so the live spans carry stubbed rects painting the
// final paragraph's two sentences on two lines.
const geoSpans = [...paras[2].querySelectorAll('.rc-sent')]
  .filter((s) => !s.querySelector('.rc-sent'));
check(geoSpans.length === 2, 'nav: final paragraph carries two live sentences');
const rectOf = (l, t, r, b) =>
  [{ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t, x: l, y: t }];
geoSpans[0].getClientRects = () => rectOf(0, 0, 300, 20);
geoSpans[1].getClientRects = () => rectOf(0, 20, 260, 40);
paras[2].dispatchEvent(new window.MouseEvent('contextmenu',
  { bubbles: true, clientX: 50, clientY: 30 }));
resp = await command({ dogear: true, cmd: 'read-from-here' });
check(resp && resp.ok === true && resp.position && resp.position.paragraph === 3,
  'nav: read-from-here on the block keeps the paragraph place');
check(spoken[spoken.length - 1].includes('Nothing here is uploaded'),
  'nav: the press point on the second line starts at its sentence');

// Read-this-only after the selection is gone (2026-11-07 retest
// fix): the engine tracks the last selection observed inside the
// reader, so a command arriving after the live selection has
// collapsed — the touch lifecycle, where the tap that summons the
// command takes the selection with it — still reads what was
// selected. The platform surface is stubbed exactly as in the
// read-this-only section above: first the live selection (which
// fires the engine's tracking), then the collapsed one the
// command actually meets.
const trackSpan = [...paras[1].querySelectorAll('.rc-sent')]
  .filter((s) => !s.querySelector('.rc-sent'))[1];
const trackText = trackSpan && trackSpan.firstChild;
window.getSelection = () => ({
  isCollapsed: false, rangeCount: 1,
  anchorNode: trackText, focusNode: trackText,
  removeAllRanges() {}, addRange() {},
});
window.document.dispatchEvent(new window.Event('selectionchange', { bubbles: true }));
window.getSelection = () => ({
  isCollapsed: true, rangeCount: 0,
  anchorNode: null, focusNode: null,
  removeAllRanges() {}, addRange() {},
});
const beforeOnly = spoken.length;
resp = await command({ dogear: true, cmd: 'read-this-only', text: '' });
window.getSelection = realGetSelection;
check(resp && resp.ok === true,
  'nav: read-this-only survives the collapsed selection');
check(spoken.length > beforeOnly &&
  spoken[spoken.length - 1].includes('Place is kept per page'),
  'nav: the tracked selection is what gets spoken');

resp = await command({ dogear: true, cmd: 'voices' });
check(resp && Array.isArray(resp.voices), 'nav: voices command reports the list');
const idxBeforeVoice = resp && resp.position ? resp.position.index : null;
resp = await command({ dogear: true, cmd: 'set-voice', voiceURI: 'dogear:default' });
check(resp && resp.ok === true, 'nav: set-voice accepted');
check(storageData.dogearVoiceUri === 'dogear:default',
  'nav: the voice choice is remembered in extension storage');
check(resp.position && resp.position.index === idxBeforeVoice,
  'nav: switching voice keeps the reading position');

console.log('FAILURES: ' + failures);
process.exit(failures ? 1 : 0);
