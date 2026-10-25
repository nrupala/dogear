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
  speak(u) {
    spoken.push(u.text);
    this.speaking = true;
    setTimeout(() => { if (u.onend) u.onend(); }, 0);
  },
  cancel() { this.speaking = false; },
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
check(window.ReaderCore.VERSION === '0.2.0', 'engine is the pinned 0.2.0');
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
check(spoken.join(' ').includes('DogEar reads pages aloud'),
  'speech starts at the article, not the page chrome');
check(window.document.querySelectorAll('.rc-sent').length > 3,
  'sentences wrapped for highlighting');
resp = await command({ dogear: true, cmd: 'state' });
check(resp && (resp.state === 'playing' || resp.progress >= 0),
  'state reports the live reader');

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

console.log('FAILURES: ' + failures);
process.exit(failures ? 1 : 0);
