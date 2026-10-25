/* DogEar extension — popup logic.
 * Buttons ask the background worker to run a command on the active tab;
 * the meter is read from the extension's own storage; the voice list is
 * the operating system's own list (Web Speech), shown for what it is:
 * DogEar reads with an on-device voice — nothing is uploaded.
 */
'use strict';

var FREE_MINUTES = 600;

function send(cmd) {
  return new Promise(function (resolve) {
    try {
      chrome.runtime.sendMessage({ fromPopup: true, cmd: cmd }, function (r) {
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
  switch (r.state) {
    case 'playing':
      return 'Reading aloud\u2026';
    case 'paused':
      return 'Paused — your place is kept.';
    case 'idle':
      return 'Stopped — your place is kept.';
    default:
      return 'Ready. Pick \u201CRead this page\u201D to start.';
  }
}

function wire(id, cmd) {
  document.getElementById(id).addEventListener('click', function () {
    send(cmd).then(function (r) {
      setStatus(stateText(r));
    });
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

function renderVoices() {
  var list = document.getElementById('voice-list');
  function fill() {
    var voices = [];
    try {
      voices = window.speechSynthesis.getVoices() || [];
    } catch (e) {}
    list.innerHTML = '';
    if (!voices.length) {
      var li = document.createElement('li');
      li.textContent = 'No voices reported by this browser yet.';
      list.appendChild(li);
      return;
    }
    voices.slice(0, 40).forEach(function (v) {
      var li = document.createElement('li');
      li.textContent =
        v.name + ' (' + v.lang + ')' + (v.localService ? ' — on device' : '');
      if (v.localService) li.className = 'on-device';
      list.appendChild(li);
    });
  }
  fill();
  try {
    window.speechSynthesis.onvoiceschanged = fill;
  } catch (e) {}
}

document.addEventListener('DOMContentLoaded', function () {
  wire('btn-read-page', 'read-page');
  wire('btn-read-selection', 'read-selection');
  wire('btn-toggle', 'toggle');
  wire('btn-stop', 'stop');
  renderMeter();
  renderVoices();
  send('state').then(function (r) {
    setStatus(stateText(r));
  });
});
