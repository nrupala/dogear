// SPDX-FileCopyrightText: 2026 2351485 ALBERTA INC.
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/* DogEar licence — a signed key the user pastes once.
 *
 * Shape of a licence token:
 *     base64url(payloadJson) + "." + base64url(ed25519Signature)
 * The signature covers the exact payload bytes. Payload fields:
 *     { v: 1, holder: string, plan: string,
 *       formats: ["pdf","epub","docx","html"],
 *       issued: "YYYY-MM-DD", expires: null | "YYYY-MM-DD" }
 *
 * Verification is Ed25519 (RFC 8032) via the vendored TweetNaCl
 * (/vendor/nacl.min.js), checked against the licence signing public
 * key embedded below. The private key never ships — it lives with
 * the issuer only. Verification is fail-closed and says WHY it
 * failed in plain words; a licence is never "probably fine".
 *
 * Exposed as window.DogEarLicence so the app shell and the headless
 * tests exercise the same code.
 */
(function () {
  'use strict';

  // DogEar licence signing public key (raw Ed25519, hex). Public by
  // design — this is the half that is safe to print anywhere.
  var PUBLIC_KEY_HEX = 'adbc4f7a8821509c67415b0de3ea76f0b161d6ffdd877560e04b65108e514b47';

  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) {
      out[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return out;
  }
  function b64urlToBytes(s) {
    if (typeof s !== 'string' || !/^[A-Za-z0-9_-]+$/.test(s)) return null;
    var b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var bin;
    try { bin = atob(b64); } catch (e) { return null; }
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToText(bytes) {
    // Payloads are JSON with UTF-8 names in them — decode properly.
    if (typeof TextDecoder !== 'undefined') {
      try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch (e) { return null; }
    }
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    try { return decodeURIComponent(escape(s)); } catch (e) { return null; }
  }

  /* parse(token) → { payloadText, payload, signature } | null.
     Structural checks only — no signature judgement here. */
  function parse(token) {
    if (typeof token !== 'string') return null;
    var parts = token.trim().split('.');
    if (parts.length !== 2) return null;
    var payloadBytes = b64urlToBytes(parts[0]);
    var signature = b64urlToBytes(parts[1]);
    if (!payloadBytes || !signature || signature.length !== 64) return null;
    var payloadText = bytesToText(payloadBytes);
    if (payloadText === null) return null;
    var payload;
    try { payload = JSON.parse(payloadText); } catch (e) { return null; }
    if (!payload || payload.v !== 1 || typeof payload.holder !== 'string' ||
        !Array.isArray(payload.formats)) return null;
    return { payloadText: payloadText, payloadBytes: payloadBytes,
             payload: payload, signature: signature };
  }

  /* verify(token, opts) → { ok: true, payload }
   *                      | { ok: false, reason: 'plain words' }
     opts.now: a Date for the expiry check (tests inject one);
     opts.publicKeyHex: overrides the embedded key (tests only). */
  function verify(token, opts) {
    opts = opts || {};
    var nacl = (typeof window !== 'undefined' && window.nacl) ||
               (typeof self !== 'undefined' && self.nacl) || null;
    if (!nacl || !nacl.sign || !nacl.sign.detached) {
      return { ok: false, reason: 'The licence checker itself could not load, so this key cannot be accepted right now.' };
    }
    var parsed = parse(token);
    if (!parsed) {
      return { ok: false, reason: 'That does not look like a DogEar licence key. Check you copied the whole key.' };
    }
    var pub = hexToBytes(opts.publicKeyHex || PUBLIC_KEY_HEX);
    var good = false;
    try {
      good = nacl.sign.detached.verify(parsed.payloadBytes, parsed.signature, pub);
    } catch (e) { good = false; }
    if (!good) {
      return { ok: false, reason: 'That licence key is not genuine — its signature does not check out. Nothing was unlocked.' };
    }
    if (parsed.payload.expires) {
      var now = opts.now || new Date();
      var exp = new Date(parsed.payload.expires + 'T23:59:59');
      if (isNaN(exp.getTime())) {
        return { ok: false, reason: 'That licence key has a broken expiry date, so it cannot be accepted.' };
      }
      if (now > exp) {
        return { ok: false, reason: 'That licence expired on ' + parsed.payload.expires + '. Nothing was unlocked.' };
      }
    }
    return { ok: true, payload: parsed.payload };
  }

  /* Does this verified payload unlock the given format kind? */
  function allows(payload, kind) {
    return !!payload && Array.isArray(payload.formats) &&
      payload.formats.indexOf(kind) !== -1;
  }

  /* Is this the owner's super-user licence? That plan unlocks
     EVERYTHING the app can gate — the formats and the daily
     listening meter alike. It is a plan name the issuer mints,
     checked here like any other payload field: the signature over
     the payload is what makes it true, never the claim alone. */
  function unlocksAll(payload) {
    return !!payload && payload.plan === 'owner-super-user';
  }

  window.DogEarLicence = {
    PUBLIC_KEY_HEX: PUBLIC_KEY_HEX,
    parse: parse,
    verify: verify,
    allows: allows,
    unlocksAll: unlocksAll,
  };
})();
