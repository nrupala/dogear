/* DogEar extension — background (service worker / event page).
 *
 * Phase 1 (owner's design, EXTENSION-SCOPE.md): the extension invokes the
 * operating system's built-in voices via Web Speech, and the pinned
 * reader-core engine does the reading. This worker owns NO page access of
 * its own: it injects the reader into the active tab only when the user
 * invokes DogEar (toolbar popup, context menu, or keyboard command),
 * riding the activeTab grant from that gesture. No background scraping,
 * no host permissions, no network calls.
 */
'use strict';

var MENU_PAGE = 'dogear-read-page';
var MENU_SELECTION = 'dogear-read-selection';
var MENU_FROM_HERE = 'dogear-read-from-here';
var MENU_THIS_ONLY = 'dogear-read-this-only';

function createMenus() {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(function () {
    chrome.contextMenus.create({
      id: MENU_PAGE,
      title: 'Read this page with DogEar',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: MENU_SELECTION,
      title: 'Read selection with DogEar',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: MENU_FROM_HERE,
      title: 'Read from here with DogEar',
      contexts: ['page', 'selection'],
    });
    chrome.contextMenus.create({
      id: MENU_THIS_ONLY,
      title: 'Read this only with DogEar',
      contexts: ['selection'],
    });
  });
}

if (chrome.runtime && chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener(createMenus);
}
if (chrome.runtime && chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(createMenus);
}

function inject(tabId) {
  return chrome.scripting
    .executeScript({
      target: { tabId: tabId },
      files: ['vendor/reader-core/reader-core.js', 'content.js'],
    })
    .then(function () {
      return chrome.scripting.insertCSS({
        target: { tabId: tabId },
        files: ['vendor/reader-core/reader-core.css', 'bar.css'],
      });
    });
}

function runCommand(tab, cmd, extra) {
  if (!tab || typeof tab.id !== 'number') {
    return Promise.resolve({ ok: false, error: 'No active tab.' });
  }
  var payload = { dogear: true, cmd: cmd };
  if (extra) {
    if (extra.fraction !== undefined) payload.fraction = extra.fraction;
    if (extra.voiceURI !== undefined) payload.voiceURI = extra.voiceURI;
  }
  var chain = inject(tab.id);
  if (cmd === 'read-selection' || cmd === 'read-this-only') {
    chain = chain
      .then(function () {
        return chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: function () {
            return String(
              window.getSelection ? window.getSelection().toString() : ''
            );
          },
        });
      })
      .then(function (res) {
        payload.text = (res && res[0] && res[0].result) || '';
      });
  }
  return chain
    .then(function () {
      return chrome.tabs.sendMessage(tab.id, payload);
    })
    .catch(function (e) {
      return { ok: false, error: String((e && e.message) || e) };
    });
}

function activeTab() {
  return chrome.tabs
    .query({ active: true, currentWindow: true })
    .then(function (tabs) {
      return tabs && tabs[0];
    });
}

if (chrome.contextMenus && chrome.contextMenus.onClicked) {
  chrome.contextMenus.onClicked.addListener(function (info, tab) {
    if (info.menuItemId === MENU_PAGE) runCommand(tab, 'read-page');
    if (info.menuItemId === MENU_FROM_HERE) {
      runCommand(tab, 'read-from-here');
    }
    if (info.menuItemId === MENU_THIS_ONLY) {
      runCommand(tab, 'read-this-only').then(function (r) {
        if (r && !r.ok && info.selectionText) {
          chrome.tabs.sendMessage(tab.id, {
            dogear: true,
            cmd: 'read-this-only',
            text: info.selectionText,
          });
        }
      });
    }
    if (info.menuItemId === MENU_SELECTION) {
      var t = tab;
      // The selection text comes from the page itself (see runCommand);
      // info.selectionText is a fallback when scripting is refused.
      runCommand(t, 'read-selection').then(function (r) {
        if (r && !r.ok && info.selectionText) {
          chrome.tabs.sendMessage(t.id, {
            dogear: true,
            cmd: 'read-selection',
            text: info.selectionText,
          });
        }
      });
    }
  });
}

if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener(function (command) {
    if (command === 'read-page') {
      activeTab().then(function (tab) {
        runCommand(tab, 'read-page');
      });
    }
  });
}

// Popup channel: the popup asks for a command against the active tab, or
// for the reader's current state. The sender must be this extension
// itself, the message must carry the popup flag, and the command must
// be on the allowlist — anything else is ignored, not answered.
var POPUP_COMMANDS = {
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

if (chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.fromPopup !== true) return;
    if (!sender || sender.id !== chrome.runtime.id) return;
    if (!POPUP_COMMANDS[msg.cmd]) return;
    activeTab()
      .then(function (tab) {
        return runCommand(tab, msg.cmd, {
          fraction: msg.fraction,
          voiceURI: msg.voiceURI,
        });
      })
      .then(function (r) {
        sendResponse(r || { ok: false, error: 'No response from the page.' });
      })
      .catch(function (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      });
    return true; // async response
  });
}
