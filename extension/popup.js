// SPDX-FileCopyrightText: 2026 2351485 ALBERTA INC.
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/* DogEar extension — popup logic.
 * Buttons ask the background worker to run a command on the active tab;
 * the meter is read from the extension's own storage; the voice list is
 * the operating system's own list (Web Speech), shown for what it is:
 * DogEar reads with an on-device voice — nothing is uploaded.
 */
'use strict';

var FREE_MINUTES = 600;

function send(cmd, extra) {
  return new Promise(function (resolve) {
    try {
      var msg = { fromPopup: true, cmd: cmd };
      if (extra) {
        if (extra.fraction !== undefined) msg.fraction = extra.fraction;
        if (extra.voiceURI !== undefined) msg.voiceURI = extra.voiceURI;
      }
      chrome.runtime.sendMessage(msg, function (r) {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(r || { ok: false, error: 'No response.' });
        }
      });
    } catch (e) {
      resolve({ ok: false, error: String(e) });
    }
  });
}

function setStatus(text) {
  document.getElementById('status').textContent = text;
}

function stateText(r) {
  if (!r) return 'No response from the page.';
  if (r.ok === false && r.error) {
    return 'DogEar can\u2019t run on this page (' + r.error + ')';
  }
  var base;
  switch (r.state) {
    case 'playing':
      base = 'Reading aloud\u2026';
      break;
    case 'paused':
      base = 'Paused \u2014 your place is kept.';
      break;
    case 'idle':
      base = 'Stopped \u2014 your place is kept.';
      break;
    default:
      base = 'Ready. Pick \u201CRead this page\u201D to start.';
  }
  if (r.position && r.position.paragraphs) {
    base +=
      ' Paragraph ' +
      (r.position.paragraph + 1) +
      ' of ' +
      r.position.paragraphs +
      '.';
  }
  return base;
}

function reflect(r) {
  setStatus(stateText(r));
  var pos = document.getElementById('position');
  if (pos) {
    pos.textContent =
      r && r.position && r.position.paragraphs
        ? 'Paragraph ' +
          (r.position.paragraph + 1) +
          ' of ' +
          r.position.paragraphs
        : '';
  }
  var seek = document.getElementById('seek');
  if (seek && r && typeof r.progress === 'number' &&
      document.activeElement !== seek) {
    seek.value = String(Math.round(r.progress * 1000));
  }
}

function wire(id, cmd) {
  document.getElementById(id).addEventListener('click', function () {
    send(cmd).then(reflect);
  });
}

function monthKey() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function renderMeter() {
  chrome.storage.local.get(['dogearMeter', 'dogearUnlocked'], function (o) {
    o = o || {};
    var used = ((o.dogearMeter || {})[monthKey()] || 0) / 60;
    var fill = document.getElementById('meter-fill');
    var text = document.getElementById('meter-text');
    if (o.dogearUnlocked) {
      fill.style.width = '100%';
      text.textContent = 'Unlocked — listening is unlimited.';
    } else {
      fill.style.width = Math.min(100, (used / FREE_MINUTES) * 100) + '%';
      text.textContent =
        Math.floor(used) + ' of ' + FREE_MINUTES + ' free minutes used';
    }
  });
}

/* The voice picker (1.1.0): DogEar's own voice leads, then the
   system default, then every on-device voice this browser
   reports — the same list the page's reader resolves against.
   The choice persists in the extension's storage (the content
   script reads it when a reader starts, and applies it live to
   a running reader); switching never moves the place. */
function renderVoicePicker() {
  var sel = document.getElementById('voice-pick');
  if (!sel) return;
  function fill() {
    var voices = [];
    try {
      voices = window.speechSynthesis.getVoices() || [];
    } catch (e) {}
    chrome.storage.local.get(['dogearVoiceUri'], function (o) {
      var pref = (o && o.dogearVoiceUri) || 'dogear:default';
      sel.innerHTML = '';
      function group(label) {
        var g = document.createElement('optgroup');
        g.label = label;
        sel.appendChild(g);
        return g;
      }
      function opt(parent, value, label) {
        var el = document.createElement('option');
        el.value = value;
        el.textContent = label;
        parent.appendChild(el);
      }
      opt(group('DogEar'), 'dogear:default', 'DogEar voice');
      var dev = group('This device');
      opt(dev, 'system:default', 'System default voice');
      var seen = {};
      voices.forEach(function (v) {
        if (!v || !v.localService || !v.voiceURI || seen[v.voiceURI]) {
          return;
        }
        seen[v.voiceURI] = true;
        opt(dev, v.voiceURI, v.name + ' (' + v.lang + ')');
      });
      sel.value = pref;
      if (sel.value !== pref) sel.value = 'dogear:default';
    });
  }
  fill();
  try {
    window.speechSynthesis.onvoiceschanged = fill;
  } catch (e) {}
  sel.addEventListener('change', function () {
    chrome.storage.local.set({ dogearVoiceUri: sel.value });
    send('set-voice', { voiceURI: sel.value }).then(reflect);
  });
}

document.addEventListener('DOMContentLoaded', function () {
  wire('btn-read-page', 'read-page');
  wire('btn-read-selection', 'read-selection');
  wire('btn-toggle', 'toggle');
  wire('btn-stop', 'stop');
  wire('btn-prev-para', 'prev-paragraph');
  wire('btn-next-para', 'next-paragraph');
  var seek = document.getElementById('seek');
  if (seek) {
    seek.addEventListener('change', function () {
      send('seek-fraction', {
        fraction: (parseInt(seek.value, 10) || 0) / 1000,
      }).then(reflect);
    });
  }
  renderMeter();
  renderVoicePicker();
  send('state').then(reflect);
});
