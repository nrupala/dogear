// SPDX-FileCopyrightText: 2026 2351485 ALBERTA INC.
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/* DogEar billing — Play purchases through the Digital Goods API.
 *
 * Where this runs: only inside the Play-installed app (the TWA),
 * where Chrome offers window.getDigitalGoodsService for Play
 * Billing. On the open web there is no such service and this
 * module reports itself unavailable — the app then shows NO buy
 * buttons at all, never dead ones (the web unlock note explains
 * where the unlock is sold).
 *
 * The flow, per the Digital Goods API:
 *   getDigitalGoodsService('https://play.google.com/billing')
 *   service.getDetails([sku])            — prices from Play itself
 *   new PaymentRequest(...).show()       — Play's own buy sheet
 *   service.acknowledge(token, 'onetime')— for the unlock
 *   service.consume(token)               — for tips
 *   service.listPurchases()              — restores the unlock
 *
 * Verification seam: after a purchase the client POSTs the
 * purchase token to the worker's /api/verify-purchase endpoint.
 * That endpoint is STATELESS today (validates shape, stores
 * nothing) because real verification needs the Play Developer API
 * credential, which belongs to the owner's future Play Console
 * account and cannot exist yet. RESIDUAL RISK, named plainly:
 * until that credential lands, entitlement here is client-side —
 * a determined user with a faked billing service could unlock
 * without paying. Accepted for a US$24.99 unlock; recorded in
 * LICENSING-BUILD-NOTE.md, and the seam is where the fix plugs in
 * without touching this flow.
 *
 * Factory-shaped like licence.js / meter.js: tests inject a mock
 * service, a mock PaymentRequest and a mock fetch, and exercise
 * the exact code the app runs.
 */
(function () {
  'use strict';

  var UNLOCK_KEY = 'dogearapp:unlock:v1';

  function defaultGetService(cfg) {
    if (typeof window === 'undefined' ||
        typeof window.getDigitalGoodsService !== 'function') {
      return Promise.resolve(null);
    }
    return window.getDigitalGoodsService(cfg.PLAY_BILLING_METHOD)
      .catch(function () { return null; });
  }

  /* create(opts) — opts:
   *   config:        DogEarConfig (default: window.DogEarConfig)
   *   getService:    () -> Promise<service|null> (default: the
   *                  real window.getDigitalGoodsService)
   *   PaymentRequestCtor: (default: window.PaymentRequest)
   *   fetchImpl:     (default: window.fetch) — for the verify seam
   *   storage:       localStorage-like (default: window's)
   *   onUnlock:      called when the unlock state turns on        */
  function create(opts) {
    opts = opts || {};
    var cfg = opts.config ||
      (typeof window !== 'undefined' && window.DogEarConfig) || {};
    var getService = opts.getService || function () { return defaultGetService(cfg); };
    var PR = opts.PaymentRequestCtor ||
      (typeof window !== 'undefined' ? window.PaymentRequest : null);
    var fetchImpl = opts.fetchImpl ||
      (typeof window !== 'undefined' && window.fetch ? window.fetch.bind(window) : null);
    var storage = opts.storage || null;
    if (!storage) {
      try { storage = window.localStorage; } catch (e) { storage = null; }
    }
    var onUnlock = opts.onUnlock || function () {};

    var service = null;
    var available = false;
    var unlockedNow = readFlag();

    function readFlag() {
      if (!storage) return false;
      try {
        var v = JSON.parse(storage.getItem(UNLOCK_KEY) || 'null');
        return !!(v && v.unlocked);
      } catch (e) { return false; }
    }
    function writeFlag() {
      if (!storage) return;
      try {
        storage.setItem(UNLOCK_KEY, JSON.stringify({
          unlocked: true, source: 'play', at: new Date().toISOString(),
        }));
      } catch (e) {}
    }
    function setUnlocked() {
      var was = unlockedNow;
      unlockedNow = true;
      writeFlag();
      if (!was) onUnlock();
    }

    /* Ask Play what it holds for this user. If the unlock product
       is among the purchases, the device is unlocked — this is the
       restore path, and it needs no account: Play remembers. */
    function init() {
      return Promise.resolve()
        .then(function () { return getService(); })
        .then(function (svc) {
          service = svc || null;
          available = !!service;
          if (!service || typeof service.listPurchases !== 'function') {
            return { available: available, unlocked: unlockedNow };
          }
          return service.listPurchases().then(function (purchases) {
            var skus = cfg.SKUS || {};
            var mine = (purchases || []).some(function (p) {
              return p && p.itemId === skus.unlock;
            });
            if (mine) setUnlocked();
            return { available: true, unlocked: unlockedNow };
          }).catch(function () {
            return { available: true, unlocked: unlockedNow };
          });
        })
        .catch(function () {
          return { available: false, unlocked: unlockedNow };
        });
    }

    function getDetails(ids) {
      if (!service || typeof service.getDetails !== 'function') {
        return Promise.resolve([]);
      }
      return service.getDetails(ids).catch(function () { return []; });
    }

    /* The verify seam — best-effort by design today: a seam
       failure never unmakes a purchase Play itself completed. */
    function verifyWithServer(productId, purchaseToken) {
      if (!fetchImpl) return Promise.resolve({ sent: false });
      return fetchImpl('/api/verify-purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: productId, purchaseToken: purchaseToken }),
      }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (d) {
          return { sent: true, status: r.status, body: d };
        });
      }).catch(function () { return { sent: false }; });
    }

    /* buy(productId, kind) — kind: 'unlock' | 'tip'.
       Resolves { ok, ... } — never rejects for a user cancel. */
    function buy(productId, kind) {
      if (!available || !service) {
        return Promise.resolve({ ok: false, reason: 'Purchases are not available here.' });
      }
      if (!PR) {
        return Promise.resolve({ ok: false, reason: 'This browser cannot open the Play buy sheet.' });
      }
      return getDetails([productId]).then(function (items) {
        var item = (items || [])[0];
        if (!item || !item.price) {
          return { ok: false, reason: 'That item is not on sale yet. It will appear once the store listing is live.' };
        }
        var request;
        try {
          request = new PR(
            [{ supportedMethods: cfg.PLAY_BILLING_METHOD, data: { sku: productId } }],
            { total: { label: item.title || productId,
                       amount: { currency: item.price.currency, value: item.price.value } } });
        } catch (e) {
          return { ok: false, reason: 'The Play buy sheet could not be opened.' };
        }
        return request.show().then(function (response) {
          var token = response && response.details &&
            response.details.purchaseToken;
          var done = response && typeof response.complete === 'function'
            ? response.complete('success').catch(function () {})
            : Promise.resolve();
          return done.then(function () {
            if (!token) {
              return { ok: false, reason: 'Play finished the purchase without a receipt token. Nothing was unlocked — contact us and we will sort it out.' };
            }
            return verifyWithServer(productId, token).then(function (v) {
              var settle = kind === 'tip'
                ? (typeof service.consume === 'function'
                    ? service.consume(token).catch(function () {})
                    : Promise.resolve())
                : (typeof service.acknowledge === 'function'
                    ? service.acknowledge(token, 'onetime').catch(function () {})
                    : Promise.resolve());
              return settle.then(function () {
                if (kind === 'unlock') setUnlocked();
                return { ok: true, productId: productId,
                         verification: v.sent ? 'sent' : 'unconfirmed' };
              });
            });
          });
        }, function (err) {
          // Play's sheet rejects when the user backs out — that is
          // a cancel, not an error, and it is reported as one.
          if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) {
            return { ok: false, cancelled: true, reason: 'Purchase cancelled.' };
          }
          return { ok: false, reason: 'The purchase did not go through. Nothing was charged or unlocked.' };
        });
      });
    }

    return {
      init: init,
      buy: buy,
      buyUnlock: function () { return buy((cfg.SKUS || {}).unlock, 'unlock'); },
      buyTip: function (sku) { return buy(sku, 'tip'); },
      getDetails: getDetails,
      isAvailable: function () { return available; },
      isUnlocked: function () { return unlockedNow; },
      UNLOCK_KEY: UNLOCK_KEY,
    };
  }

  window.DogEarBilling = { create: create, UNLOCK_KEY: UNLOCK_KEY };
})();
