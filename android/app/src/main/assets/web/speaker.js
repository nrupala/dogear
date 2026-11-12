// SPDX-FileCopyrightText: 2026 2351485 ALBERTA INC.
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/* DogEar speaker — the ONE speaker for all non-reader speech
 * (answers, refusals, failure lines, the self-model), built for
 * the beta.6 voice-quality program (VOICE-QUALITY-BETA6.md, R2).
 *
 * Why it exists: the old answer speaker split the text and
 * queued EVERY piece into speechSynthesis at once, with no
 * lifecycle handlers at all. That completes only where the
 * transport truly queues. In the Android shell the transport
 * is the native SpeechService, which speaks QUEUE_FLUSH with a
 * single current slot — each queued piece killed the one
 * before it, mid-sentence, and nothing anywhere compared the
 * text given with the text actually spoken. The owner's
 * verdict: "it doesn't complete whatever text it has been
 * given."
 *
 * The structural answer, all three parts load-bearing:
 *   1. ONE utterance outstanding, ever. Pieces are dispatched
 *      strictly one at a time, each awaited to its end or
 *      error before the next is sent. A flush transport has
 *      nothing to kill; a queueing transport is never flooded.
 *   2. A stall watchdog per piece. If neither end nor error
 *      arrives inside the piece's window (a length/rate
 *      estimate with a floor, a cap and margin — speech that
 *      is merely slow is never called stalled), the piece is
 *      cancelled and re-spoken ONCE. A second stall, or a
 *      second error, marks the piece lost and aborts the job:
 *      a gap-toothed answer is worse than an honest stop.
 *   3. Completion accounting. Every job records pieces given,
 *      confirmed spoken, recovered (completed after a retry)
 *      and lost. A job that ends with any piece unconfirmed is
 *      written to the defect log and reported to the job's
 *      caller, which tells the listener in words. A mismatch
 *      is a logged defect, never a silent truncation.
 *
 * Reader (book) speech is NOT routed through here: reader-core
 * speaks one chunk and awaits its end itself — the rhythm this
 * module imitates — and the bridge shim's serialization +
 * stall guard (native-bridge.js) covers that path at the
 * transport. This module covers everything the app says
 * OUTSIDE the book: the ask loop's whole voice.
 *
 * Factory-shaped like the other modules: tests inject a fake
 * synth, utterance constructor and timers and exercise the
 * exact code the app runs.
 */
(function () {
  'use strict';

  var FLOOR_MS = 4000;      // shortest watchdog window per piece
  var CAP_MS = 60000;       // longest window per piece
  var MARGIN_MS = 2500;     // added to every estimate
  var CHARS_PER_SEC = 9;    // slow-side speaking pace at rate 1

  /* The sentence/240 rule the old speakAloud used — kept, so
     piece boundaries (and therefore what "a piece" means in
     the ledger) are unchanged from the shipped behavior. */
  function splitPieces(text) {
    var parts = String(text).match(/[^.!?]+[.!?]+["\u201d]?\s*|[^.!?]+$/g) || [String(text)];
    var queue = [];
    parts.forEach(function (p) {
      p = p.trim();
      while (p.length > 240) {
        var cut = p.lastIndexOf(' ', 240);
        if (cut < 80) cut = 240;
        queue.push(p.slice(0, cut));
        p = p.slice(cut).trim();
      }
      if (p) queue.push(p);
    });
    return queue;
  }

  function windowFor(piece, rate) {
    var est = (String(piece).length / (CHARS_PER_SEC * (rate || 1))) * 1000;
    return Math.min(CAP_MS, Math.max(FLOOR_MS, est + MARGIN_MS));
  }

  function create(opts) {
    opts = opts || {};
    var synth = opts.synth ||
      (typeof window !== 'undefined' ? window.speechSynthesis : null);
    var Utt = opts.UtteranceCtor ||
      (typeof window !== 'undefined' ? window.SpeechSynthesisUtterance : null);
    var setT = opts.setTimeout || (typeof setTimeout !== 'undefined' ? setTimeout : null);
    var clearT = opts.clearTimeout || (typeof clearTimeout !== 'undefined' ? clearTimeout : null);
    var nowFn = opts.now || function () { return Date.now(); };

    var jobs = [];        // every job, in order (the ledger)
    var defects = [];     // jobs that ended incomplete
    var epoch = 0;        // bumped by cancel()/speak(): stale runners stand down
    var activeJob = null;
    var activeSettle = null; // the in-flight attempt's settler, so
                             // cancel() resolves it NOW, not at the
                             // watchdog window (up to a minute later)

    function arm(fn, ms) {
      if (!setT) return null;
      try { return setT(fn, ms); } catch (e) { return null; }
    }
    function disarm(t) {
      if (t === null || !clearT) return;
      try { clearT(t); } catch (e) {}
    }

    /* One attempt at one piece. Resolves 'end' | 'error' |
       'stall' | 'cancelled'. Never rejects. */
    function attempt(job, piece, rate, voice, pitch, volume) {
      return new Promise(function (resolve) {
        var myEpoch = job.epoch;
        var settled = false;
        var timer = null;
        var extended = false;
        function settle(how) {
          if (settled) return;
          settled = true;
          disarm(timer);
          if (activeSettle === settle) activeSettle = null;
          resolve(how);
        }
        activeSettle = settle;
        var u;
        try {
          u = new Utt(piece);
          u.rate = rate || 1;
          /* Voice effects (quick-win lane, 2026-11-10): the
             host passes the listener's pitch + volume from
             voicefx.js. Pitch lands on the utterance as-is
             (device voices honour it; the pack transport's
             engine has no pitch parameter and ignores the
             field — named honestly in the panel). Volume is
             a 0–2 setting: the utterance field itself takes
             the platform-clamped 0–1 value, and the full
             setting rides along as dogearVolume, which the
             pack transport's gain staging reads (its WebAudio
             graph is the one place a boost above 1 exists). */
          if (typeof pitch === 'number' && isFinite(pitch)) {
            try { u.pitch = Math.min(2, Math.max(0, pitch)); } catch (e) {}
          }
          if (typeof volume === 'number' && isFinite(volume)) {
            var v = Math.min(2, Math.max(0, volume));
            try { u.volume = Math.min(1, v); } catch (e) {}
            try { u.dogearVolume = v; } catch (e) {}
          }
          /* 1.7.0: answers speak in the listener's chosen
             reading voice when the host passes one. */
          if (voice) { try { u.voice = voice; } catch (e) {} }
        } catch (e) { settle('error'); return; }
        u.onend = function () { settle('end'); };
        u.onerror = function () { settle('error'); };
        function onWindow() {
          if (settled) return;
          if (epoch !== myEpoch) { settle('cancelled'); return; }
          /* The transport is paused (the user, or the shell's
             own pause before capture): speech is legitimately
             suspended, not stalled. Extend once per pause —
             a piece that resumes gets a fresh full window. */
          var paused = false;
          try { paused = !!synth.paused; } catch (e) {}
          if (paused) {
            timer = arm(onWindow, windowFor(piece, rate));
            return;
          }
          /* Stalled: no lifecycle event inside the window.
             Cancel before resolving, so the transport drops
             the corpse; events the cancel provokes arrive
             after settle() and are ignored by the guard. */
          try { synth.cancel(); } catch (e) {}
          settle('stall');
        }
        /* A cancel that landed while this attempt was being
           set up — classically in the stall -> recovery gap:
           the watchdog settled the previous attempt, and the
           owner's barge-in cancel arrived before this recovery
           attempt dispatched — must not produce sound. Until
           now the epoch was consulted only between pieces and
           inside the watchdog, never at dispatch, so a recovery
           attempt could speak for a job already cancelled
           (owner-found 2026-11-11: an interrupted answer
           resumed after the next answer finished). A cancelled
           job never speaks again. */
        if (epoch !== myEpoch) { settle('cancelled'); return; }
        try { synth.speak(u); } catch (e) { settle('error'); return; }
        timer = arm(onWindow, windowFor(piece, rate));
        // `extended` reserved for future per-piece extension
        // accounting; pause-extension above re-arms in place.
        void extended;
      });
    }

    /* speak(text) -> Promise<job>. The job:
       { id, text, pieces, confirmed, recovered, lost,
         lostPieces: [..], completed, aborted, startedAt,
         endedAt }
       completed === (lost === 0 && confirmed === pieces). */
    function speak(text, speakOpts) {
      speakOpts = speakOpts || {};
      var rate = speakOpts.rate || 1;
      var voice = speakOpts.voice || null;
      var pitch = (typeof speakOpts.pitch === 'number')
        ? speakOpts.pitch : null;
      var volume = (typeof speakOpts.volume === 'number')
        ? speakOpts.volume : null;
      epoch++;
      var job = {
        id: jobs.length + 1,
        epoch: epoch,
        text: String(text),
        pieces: 0, confirmed: 0, recovered: 0, lost: 0,
        lostPieces: [],
        completed: false, aborted: false,
        startedAt: nowFn(), endedAt: null,
      };
      jobs.push(job);
      activeJob = job;
      if (!synth || !Utt) {
        job.aborted = true;
        job.endedAt = nowFn();
        if (activeJob === job) activeJob = null;
        return Promise.resolve(job);
      }
      var pieces = splitPieces(job.text);
      job.pieces = pieces.length;
      if (!pieces.length) {
        job.completed = true;
        job.endedAt = nowFn();
        if (activeJob === job) activeJob = null;
        return Promise.resolve(job);
      }
      /* A new job supersedes whatever the transport still
         holds (the old speakAloud cancelled first, too). */
      try { synth.cancel(); } catch (e) {}
      var chain = Promise.resolve(true);
      pieces.forEach(function (piece) {
        chain = chain.then(function (goOn) {
          /* A stopped chain is not automatically an abort:
             a LOST piece stops it too, and that job must land
             in the defect log, not be excused as aborted.
             Only an epoch change (cancel / supersede) aborts. */
          if (!goOn) return false;
          if (epoch !== job.epoch) {
            job.aborted = true;
            return false;
          }
          return attempt(job, piece, rate, voice, pitch, volume).then(function (how) {
            if (how === 'end') { job.confirmed++; return true; }
            if (how === 'cancelled') { job.aborted = true; return false; }
            /* 'error' or 'stall': one recovery — re-speak the
               SAME piece. Text is never skipped silently. */
            return attempt(job, piece, rate, voice, pitch, volume).then(function (how2) {
              if (how2 === 'end') {
                job.confirmed++;
                job.recovered++;
                return true;
              }
              if (how2 === 'cancelled') { job.aborted = true; return false; }
              job.lost++;
              job.lostPieces.push(piece);
              return false; // abort the job at the lost piece
            });
          });
        });
      });
      return chain.then(function () {
        job.endedAt = nowFn();
        job.completed = (job.lost === 0 && !job.aborted &&
          job.confirmed === job.pieces);
        if (!job.completed && !job.aborted) {
          defects.push(job);
          try {
            console.warn('DogEar speaker: job ' + job.id +
              ' incomplete — given ' + job.pieces + ', confirmed ' +
              job.confirmed + ', lost ' + job.lost);
          } catch (e) {}
        }
        if (activeJob === job) activeJob = null;
        return job;
      });
    }

    function cancel() {
      epoch++;
      if (synth) { try { synth.cancel(); } catch (e) {} }
      if (activeSettle) {
        var s = activeSettle;
        activeSettle = null;
        s('cancelled');
      }
    }

    return {
      speak: speak,
      cancel: cancel,
      ledger: function () { return jobs.slice(); },
      defects: function () { return defects.slice(); },
      active: function () { return activeJob; },
    };
  }

  var shared = null;
  function defaultSpeaker() {
    if (!shared) shared = create({});
    return shared;
  }

  window.DogEarSpeaker = {
    create: create,
    splitPieces: splitPieces,
    windowFor: windowFor,
    default: defaultSpeaker,
  };
})();
