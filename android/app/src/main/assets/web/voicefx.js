// SPDX-FileCopyrightText: 2026 2351485 ALBERTA INC.
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/* DogEar voice effects — the listener's sound settings
 * (quick-win lane, 2026-11-10): speaking speed, voice pitch,
 * listening volume with boost, and warmth ("depth").
 *
 * One settings record, device-local, stored beside the voice
 * choice (dogearapp:voice-uri:v1) under its own key. Every
 * speech surface derives its parameters from here, so the
 * panel, the answer speaker and the pack transport can never
 * disagree about what the listener asked for.
 *
 * What each setting honestly reaches (the transports enforce
 * this; the report names it per path):
 *   speed   — utterance rate everywhere rate exists: the
 *             reader (reader-core sets u.rate per chunk from
 *             its Speed select, which the app seeds from here
 *             and keeps in step), the answer speaker, and
 *             Kokoro's native synthesis speed (ttspack clamps
 *             it to the engine's own 0.5–2 range).
 *   pitch   — utterance pitch on the DEVICE voices' answer
 *             path (speaker.js sets u.pitch). Kokoro exposes
 *             no pitch parameter, and reader-core never sets
 *             pitch on reading utterances, so pitch does not
 *             reach reading or the pack voices. The panel
 *             says so in words.
 *   volume  — a 0–2 slider (0–200%). At or under 100% it is a
 *             plain volume. Above 100% it is a BOOST, and a
 *             boost is only physically possible where the app
 *             owns the audio graph: the Kokoro pack path,
 *             whose PCM plays through a WebAudio GainNode
 *             (ttspack) with a soft limiter behind it. Device
 *             voices are spoken by the platform, which clamps
 *             utterance volume to 0–1 — for them the slider
 *             works up to 100% and no higher. The panel says so.
 *   warmth  — "depth": a gentle low-shelf EQ in the pack
 *             path's WebAudio chain (ttspack). Neither engine
 *             exposes a depth parameter; this filter is the
 *             honest available approximation, and it exists
 *             only where the audio graph is ours (the pack).
 *
 * Factory-shaped like the other modules: storage is injected
 * so tests exercise the exact code the app runs.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'dogearapp:voice-fx:v1';

  /* The reader's Speed select offers these steps (the app
     passes them to reader-core as its `speeds` opt, widening
     the vendored default by the two ends). The panel speed
     control offers the same steps, so the two controls can
     never name a speed the other cannot hold. */
  var SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  var RANGES = {
    speed: { min: 0.5, max: 2, def: 1 },
    pitch: { min: 0.5, max: 1.5, def: 1 },
    volume: { min: 0, max: 2, def: 1 },
    warmth: { min: 0, max: 1, def: 0 },
  };

  function clampField(name, v) {
    var r = RANGES[name];
    /* null/undefined are "absent", not zero — a corrupt stored
       record must degrade to the default, never to silence. */
    if (v === null || v === undefined) return r.def;
    v = Number(v);
    if (!isFinite(v)) return r.def;
    return Math.min(r.max, Math.max(r.min, v));
  }

  function defaults() {
    return { speed: 1, pitch: 1, volume: 1, warmth: 0 };
  }

  /* Normalize any stored/foreign object into a full settings
     record with every field inside its range. */
  function normalize(raw) {
    var out = defaults();
    if (!raw || typeof raw !== 'object') return out;
    for (var k in RANGES) out[k] = clampField(k, raw[k]);
    return out;
  }

  function nearestSpeed(v) {
    v = clampField('speed', v);
    var best = SPEEDS[0];
    for (var i = 0; i < SPEEDS.length; i++) {
      if (Math.abs(SPEEDS[i] - v) < Math.abs(best - v)) best = SPEEDS[i];
    }
    return best;
  }

  function create(opts) {
    opts = opts || {};
    var storage = opts.storage || null;
    if (!storage && typeof window !== 'undefined') {
      try { storage = window.localStorage; } catch (e) { storage = null; }
    }
    var current = defaults();
    try {
      var raw = storage ? storage.getItem(STORAGE_KEY) : null;
      if (raw) current = normalize(JSON.parse(raw));
    } catch (e) { current = defaults(); }

    function persist() {
      try {
        if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(current));
      } catch (e) {}
    }

    return {
      /* A copy — callers never hold the live record. */
      get: function () {
        return {
          speed: current.speed, pitch: current.pitch,
          volume: current.volume, warmth: current.warmth,
        };
      },
      /* Merge a partial change; out-of-range values clamp.
         Returns the full normalized record. */
      set: function (patch) {
        if (patch && typeof patch === 'object') {
          for (var k in RANGES) {
            if (patch[k] !== undefined) {
              current[k] = clampField(k, patch[k]);
            }
          }
        }
        persist();
        return this.get();
      },
      reset: function () {
        current = defaults();
        persist();
        return this.get();
      },
    };
  }

  var shared = null;
  function defaultSettings() {
    if (!shared) shared = create({});
    return shared;
  }

  window.DogEarVoiceFx = {
    create: create,
    default: defaultSettings,
    normalize: normalize,
    clampField: clampField,
    nearestSpeed: nearestSpeed,
    SPEEDS: SPEEDS.slice(),
    RANGES: RANGES,
    STORAGE_KEY: STORAGE_KEY,
  };
})();
