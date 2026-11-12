// SPDX-FileCopyrightText: 2026 2351485 ALBERTA INC.
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/* DogEar listening meter — the daily free allowance.
 *
 * The model (owner's ruling, 2026-10-21; allowance retimed by
 * the owner's ruling of 2026-11-07; full text in
 * ~/workspace/dogear/PRODUCT-DOCUMENT.md §2):
 *   - 60 free listening minutes per day ("1 hour free a day"),
 *     resetting at local midnight. (Until 2026-11-07 the
 *     allowance was 600 minutes per month; the owner ruled the
 *     daily hour because the chat layer makes DogEar a daily
 *     companion, and a daily habit needs a daily allowance.)
 *   - Minutes are CONTENT minutes at 1x: a document's length in
 *     words, divided by a words-per-minute rate. Playback speed
 *     never enters the count — listening at 2x consumes the same
 *     content minutes as listening at 1x.
 *   - Re-listening is FREE: within a day, only content heard
 *     for the first time counts. Going back over a span, or
 *     resuming a document begun on an earlier day, counts only
 *     the ground not covered before (each record carries the
 *     `base` — the fraction already heard when the day first
 *     met the document — and consumption is progress past it).
 *   - The cap is a START gate, never a stop: reaching 60 blocks
 *     starting a document the listener has not begun. A document
 *     already begun — today or earlier — is a continuation
 *     and can always be finished. Playback is never interrupted,
 *     mid-document or mid-sentence.
 *   - Documents, library and places are never locked or deleted.
 *     Only the Listen control for a not-yet-begun document is
 *     withheld at the cap; the text stays fully readable.
 *   - The day is the device's local calendar day; at rollover
 *     the allowance resets and per-document records start fresh.
 *   - An unlocked device (Play purchase or an owner licence) has
 *     no limit at all.
 *
 * State lives in localStorage beside the reading places:
 *   dogearapp:meter:v2 = { day: 'YYYY-MM-DD',
 *                          docs: { <docId>: { b: baseFraction,
 *                                             f: consumedFraction,
 *                                             m: totalMinutes } } }
 * Used minutes are DERIVED (sum of f x m), never stored, so the
 * record can never disagree with itself.
 *
 * Migration from the monthly meter (dogearapp:meter:v1): NOT
 * converted — the daily meter starts fresh under the v2 key and
 * the v1 record is simply never read again. Conversion would be
 * unsound in both directions: a month of consumption cannot be
 * attributed to today (carrying it over could spend today's
 * whole hour on listening done weeks ago), and carrying the
 * per-document fractions over as bases would double-charge
 * nothing yet silently forgive nothing either — the bases are
 * the day's own bookkeeping, meaningful only within the period
 * that made them. A clean reset can neither over-charge nor
 * under-charge; it also grants every existing listener a full
 * fresh hour on upgrade day, which is the generous direction.
 *
 * Exposed as window.DogEarMeter, factory-shaped like licence.js
 * so headless tests exercise the same code with a fake store, a
 * fake clock and a fake unlock state.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'dogearapp:meter:v2';
  var LEGACY_STORAGE_KEY = 'dogearapp:meter:v1';

  /* Content length of a text, in 1x listening minutes. Pure. */
  function minutesForText(text, wordsPerMinute) {
    var wpm = wordsPerMinute || 160;
    var words = String(text || '').split(/\s+/).filter(Boolean).length;
    return words / wpm;
  }

  function dayKeyOf(date) {
    var m = date.getMonth() + 1;
    var d = date.getDate();
    return date.getFullYear() + '-' + (m < 10 ? '0' : '') + m +
      '-' + (d < 10 ? '0' : '') + d;
  }

  function clamp01(x) {
    x = Number(x);
    if (!isFinite(x)) return 0;
    return Math.max(0, Math.min(1, x));
  }

  /* create(opts) — opts:
   *   storage:      localStorage-like {getItem,setItem} (default:
   *                 the window's localStorage)
   *   now:          () -> Date (default: the real clock)
   *   freeMinutes:  daily cap (default: config, else 60)
   *   wordsPerMinute: content rate (default: config, else 160)
   *   unlocked:     () -> bool (default: never unlocked)       */
  function create(opts) {
    opts = opts || {};
    var cfg = (typeof window !== 'undefined' && window.DogEarConfig) || {};
    var storage = opts.storage || null;
    if (!storage) {
      try { storage = window.localStorage; } catch (e) { storage = null; }
    }
    var now = opts.now || function () { return new Date(); };
    var freeMinutes = typeof opts.freeMinutes === 'number'
      ? opts.freeMinutes
      : (typeof cfg.FREE_MINUTES_PER_DAY === 'number'
        ? cfg.FREE_MINUTES_PER_DAY : 60);
    var wpm = typeof opts.wordsPerMinute === 'number'
      ? opts.wordsPerMinute
      : (typeof cfg.WORDS_PER_MINUTE === 'number' ? cfg.WORDS_PER_MINUTE : 160);
    var unlocked = opts.unlocked || function () { return false; };

    function fresh(day) { return { day: day, docs: {} }; }

    function load() {
      var day = dayKeyOf(now());
      var st = null;
      if (storage) {
        try { st = JSON.parse(storage.getItem(STORAGE_KEY) || 'null'); }
        catch (e) { st = null; }
      }
      if (!st || typeof st !== 'object' || !st.docs ||
          typeof st.docs !== 'object') {
        st = fresh(day);
      }
      if (st.day !== day) {
        // Rollover: a new day is a new allowance. Yesterday's
        // per-document records are done — the allowance resets.
        st = fresh(day);
        save(st);
      }
      return st;
    }
    function save(st) {
      if (!storage) return;
      try { storage.setItem(STORAGE_KEY, JSON.stringify(st)); } catch (e) {}
    }

    /* Meet a document for the first time today. baseFraction
       is how far into it the listener already was (their saved
       place) when the day met it — that ground was consumed on
       an earlier day and is not charged again. Idempotent: the
       first begin of the day wins. */
    function begin(docId, totalMinutes, baseFraction) {
      if (!docId) return;
      var st = load();
      if (!st.docs[docId]) {
        st.docs[docId] = { b: clamp01(baseFraction), f: 0, m: 0 };
      }
      var rec = st.docs[docId];
      if (typeof totalMinutes === 'number' && isFinite(totalMinutes) &&
          totalMinutes > 0 && rec.m === 0) {
        rec.m = totalMinutes;
      }
      save(st);
    }

    /* Record that docId has been heard up to `fraction` (0..1) of
       its content. Today's consumption is progress PAST the
       base, and only the furthest such point counts — a lower
       fraction (re-listening) changes nothing. */
    function observe(docId, fraction, totalMinutes) {
      if (!docId) return;
      if (!load().docs[docId]) begin(docId, totalMinutes, 0);
      var st = load();
      var rec = st.docs[docId];
      if (typeof totalMinutes === 'number' && isFinite(totalMinutes) &&
          totalMinutes > 0 && rec.m === 0) {
        rec.m = totalMinutes;
      }
      var consumed = Math.max(0, clamp01(fraction) - rec.b);
      if (consumed > rec.f) rec.f = consumed;
      save(st);
    }

    function complete(docId, totalMinutes) {
      observe(docId, 1, totalMinutes);
    }

    function usedMinutes() {
      var st = load();
      var used = 0;
      for (var id in st.docs) {
        var r = st.docs[id];
        if (r && typeof r.f === 'number' && typeof r.m === 'number') {
          used += r.f * r.m;
        }
      }
      return Math.round(used * 1000) / 1000;
    }

    function remainingMinutes() {
      return Math.max(0, freeMinutes - usedMinutes());
    }

    /* Listening to this document was begun TODAY. */
    function hasStarted(docId) {
      var st = load();
      var r = st.docs[docId];
      return !!(r && r.f > 0);
    }

    function atCap() {
      return usedMinutes() >= freeMinutes;
    }

    /* The start gate. True when listening to docId may BEGIN:
       - the device is unlocked, or
       - the document is a continuation — begun today, or
         begun earlier and resumed from a saved place (the caller
         passes continuing:true when a place exists), or
       - today's allowance is not yet used up.
       Playback already running is never this function's business:
       nothing in the meter can stop a document. */
    function canStart(docId, continuing) {
      if (unlocked()) return true;
      if (continuing) return true;
      if (hasStarted(docId)) return true;
      return !atCap();
    }

    function snapshot() {
      var st = load();
      return {
        day: st.day,
        freeMinutes: freeMinutes,
        usedMinutes: usedMinutes(),
        remainingMinutes: remainingMinutes(),
        unlocked: !!unlocked(),
        docs: st.docs,
      };
    }

    return {
      STORAGE_KEY: STORAGE_KEY,
      LEGACY_STORAGE_KEY: LEGACY_STORAGE_KEY,
      begin: begin,
      observe: observe,
      complete: complete,
      usedMinutes: usedMinutes,
      remainingMinutes: remainingMinutes,
      hasStarted: hasStarted,
      atCap: atCap,
      canStart: canStart,
      snapshot: snapshot,
      minutesForText: function (text) { return minutesForText(text, wpm); },
    };
  }

  window.DogEarMeter = {
    STORAGE_KEY: STORAGE_KEY,
    LEGACY_STORAGE_KEY: LEGACY_STORAGE_KEY,
    minutesForText: minutesForText,
    dayKeyOf: dayKeyOf,
    create: create,
  };
})();
