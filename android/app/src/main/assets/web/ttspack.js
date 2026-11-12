// SPDX-FileCopyrightText: 2026 2351485 ALBERTA INC.
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/* DogEar TTS voice pack — the bundled studio voices.
 *
 * What it is: a speechSynthesis-SHAPED transport over the
 * Kokoro-82M text-to-speech pack on the voice shelf (a registry
 * entry of kind "tts", fetched and verified by voicepack.js —
 * free, never unlock-gated; spec item 7). It exists so the
 * reader core (0.4.0's opts.synth seam) and the answer speaker
 * drive the pack voices through the exact contract they already
 * use for platform voices:
 *
 *   - getVoices() presents the pack voices as synthetic
 *     localService voices (voiceURI "pack:kokoro:<voice>"), so
 *     the reader's on-device-only filter and setVoice() accept
 *     them unchanged, and af_heart — listed first, en-US — is
 *     what the reader's default-voice rule resolves when the
 *     pack is installed.
 *   - speak(utterance) synthesizes the utterance's text with the
 *     utterance's voice and rate (the reader's speed setting maps
 *     to Kokoro's native speed input) and plays it through
 *     WebAudio; the utterance's onend fires when playback ends,
 *     which is what advances the reader's chunk loop and its
 *     highlight — the same end-event contract platform voices
 *     honour. No boundary events are fired (none are required).
 *   - cancel() stops playback and discards any synthesis still
 *     in flight; pause()/resume() suspend/resume the audio
 *     context. speaking/paused track the live state.
 *
 * One deviation from the survey, forced by the reader's own
 * protocol: the survey imagined merging tiny stub chunks
 * ("Chapter 2.") into the following synthesis. The reader hands
 * the transport ONE chunk at a time and only advances on that
 * chunk's onend, so there is never a "following chunk" to merge
 * into — stub chunks are synthesized singly. They are short, so
 * the cost is a fraction of a second of synthesis each.
 *
 * The engine (G2P + Kokoro graph + ONNX Runtime) loads lazily
 * from the pack shelf on the first speak(), through the service
 * worker's verified pack cache — fully offline thereafter.
 *
 * Voice effects (quick-win lane, 2026-11-10): this transport
 * owns the app's only WebAudio graph, so it is where the
 * listener's volume BOOST and warmth honestly live. When the
 * app supplies an fxProvider (voicefx.js settings), playback
 * runs source → low-shelf (warmth: up to +6 dB below 220 Hz —
 * the "depth" neither engine exposes as a parameter) →
 * gain (the utterance's own volume scaled by the listener's
 * 0–2 volume setting; above 1 is the boost) → a soft limiter
 * (DynamicsCompressor, engaged only when the staged gain
 * exceeds unity) → destination. At neutral settings (gain 1,
 * warmth 0) the source connects straight to the destination,
 * exactly the shipped path. Kokoro has NO pitch parameter —
 * engine.speak takes speed only — so pitch is never applied
 * or promised here.
 */
(function () {
  'use strict';

  var VOICES = [
    { id: 'af_heart', label: 'Heart', lang: 'en-US' },
    { id: 'af_bella', label: 'Bella', lang: 'en-US' },
    { id: 'bf_emma', label: 'Emma', lang: 'en-GB' },
    { id: 'am_michael', label: 'Michael', lang: 'en-US' },
  ];
  var DEFAULT_MODEL_ID = 'kokoro-82m-q8';
  var VOICE_URI_PREFIX = 'pack:kokoro:';

  /* The utterance shape both consumers construct:
   * reader-core builds them through its UtteranceCtor seam, the
   * speaker through DogEarSpeaker.create({UtteranceCtor}). The
   * platform's SpeechSynthesisUtterance is NOT constructed here,
   * so a pack utterance can never leak into the platform synth. */
  function Utterance(text) {
    this.text = text == null ? '' : String(text);
    this.voice = null;
    this.lang = '';
    this.rate = 1;
    this.pitch = 1;
    this.volume = 1;
    this.onstart = null;
    this.onend = null;
    this.onerror = null;
    this.onpause = null;
    this.onresume = null;
    this.onboundary = null;
    this.onmark = null;
  }

  function voiceUri(id) { return VOICE_URI_PREFIX + id; }
  function voiceIdFromUri(uri) {
    if (typeof uri !== 'string') return null;
    if (uri.indexOf(VOICE_URI_PREFIX) !== 0) return null;
    var id = uri.slice(VOICE_URI_PREFIX.length);
    for (var i = 0; i < VOICES.length; i++) {
      if (VOICES[i].id === id) return id;
    }
    return null;
  }

  /* create(opts) — opts:
   *   config:          DogEarConfig (default: window's)
   *   voicePack:       a DogEarVoicePack instance (the shelf
   *                    client; default: window.DogEarVoicePack
   *                    is NOT auto-created — the app passes its
   *                    one instance so the shelf is fetched once)
   *   importModule:    (url) -> Promise<module> (tests inject)
   *   AudioContextCtor: (tests inject)
   *   fxProvider:      () -> { volume: 0..2, warmth: 0..1 } | null
   *                    (the listener's voice effects; the app
   *                    passes voicefx.js's live settings)
   *   origin:          base origin (default: location.origin)   */
  function create(opts) {
    opts = opts || {};
    var cfg = opts.config ||
      (typeof window !== 'undefined' && window.DogEarConfig) || {};
    var modelId = cfg.TTS_PACK_MODEL_ID || DEFAULT_MODEL_ID;
    var base = cfg.VOICE_PACK_BASE || '/pack/v2';
    var origin = opts.origin ||
      (typeof window !== 'undefined' ? window.location.origin : '');
    var importModule = opts.importModule ||
      function (url) { return import(url); };
    var ACCtor = opts.AudioContextCtor ||
      (typeof window !== 'undefined'
        ? (window.AudioContext || window.webkitAudioContext) : null);
    var voicePack = opts.voicePack || null;
    var fxProvider = (typeof opts.fxProvider === 'function')
      ? opts.fxProvider : null;

    /* The listener's voice effects, read fresh at every
       utterance (a settings change applies to the NEXT
       utterance, never mid-sentence). Null = no effects:
       the shipped neutral behaviour. */
    function fxSettings() {
      if (!fxProvider) return null;
      var s = null;
      try { s = fxProvider(); } catch (e) { return null; }
      if (!s || typeof s !== 'object') return null;
      var vol = Number(s.volume);
      var warm = Number(s.warmth);
      return {
        volume: isFinite(vol) ? Math.min(2, Math.max(0, vol)) : 1,
        warmth: isFinite(warm) ? Math.min(1, Math.max(0, warm)) : 0,
      };
    }

    /* The gain staged for one utterance. An utterance that
       carries dogearVolume (the answer speaker stamps the
       listener's full 0–2 volume there, because the platform
       utterance it mirrors clamps volume to 0–1) already
       holds the setting in its own value — used as-is, never
       applied twice. Otherwise the utterance's own volume
       (platform semantics, clamped 0–1) is scaled by the
       listener's volume setting. */
    function stageGain(u, fx) {
      if (u && typeof u.dogearVolume === 'number' &&
          isFinite(u.dogearVolume)) {
        return Math.min(2, Math.max(0, u.dogearVolume));
      }
      var base = 1;
      if (u && typeof u.volume === 'number' && isFinite(u.volume)) {
        base = Math.min(1, Math.max(0, u.volume));
      }
      return base * (fx ? fx.volume : 1);
    }

    var enginePromise = null;
    var audioCtx = null;
    var epoch = 0;
    var current = null; // {src, utterance}
    var isSpeaking = false;
    var isPaused = false;

    function modelDir() { return origin + base + '/models/' + modelId + '/'; }
    function runtimeDir() { return origin + base + '/runtime/'; }

    function loadEngine() {
      if (!enginePromise) {
        enginePromise = importModule(modelDir() + 'tts-engine.js')
          .then(function (mod) {
            return mod.createEngine({
              modelDir: modelDir(),
              runtimeDir: runtimeDir(),
            });
          });
      }
      return enginePromise;
    }

    function ctx() {
      if (!audioCtx) {
        if (!ACCtor) throw new Error('WebAudio is not available here.');
        audioCtx = new ACCtor();
      }
      if (audioCtx.state === 'suspended' && !isPaused) {
        audioCtx.resume();
      }
      return audioCtx;
    }

    function stopCurrent() {
      if (current) {
        try { current.src.onended = null; current.src.stop(); } catch (e) {}
        current = null;
      }
      isSpeaking = false;
      isPaused = false;
    }

    var transport = {
      onvoiceschanged: null,

      getVoices: function () {
        return VOICES.map(function (v) {
          return {
            voiceURI: voiceUri(v.id),
            name: 'DogEar ' + v.label,
            lang: v.lang,
            localService: true,
            default: v.id === 'af_heart',
          };
        });
      },

      speak: function (u) {
        if (!u) return;
        var my = ++epoch;
        stopCurrent();
        isSpeaking = true;
        var voiceId = (u.voice && voiceIdFromUri(u.voice.voiceURI)) || 'af_heart';
        var speed = Math.min(2, Math.max(0.5, u.rate || 1));
        if (u.onstart) {
          Promise.resolve().then(function () {
            if (my === epoch && u.onstart) u.onstart({});
          });
        }
        loadEngine()
          .then(function (engine) { return engine.speak(u.text, voiceId, speed); })
          .then(function (audio) {
            if (my !== epoch) return; // cancelled while synthesizing
            var ac = ctx();
            var buffer = ac.createBuffer(1, audio.samples.length, audio.sampleRate);
            buffer.getChannelData(0).set(audio.samples);
            var src = ac.createBufferSource();
            src.buffer = buffer;
            /* Voice-effects chain (see the header): neutral
               settings take the shipped direct path; otherwise
               source → warmth shelf → gain → soft limiter
               (only when the staged gain exceeds unity) →
               destination. Each node is used only when the
               context can build it. */
            var fx = fxSettings();
            var gainVal = stageGain(u, fx);
            var shelfDb = fx ? fx.warmth * 6 : 0;
            if (gainVal === 1 && shelfDb === 0) {
              src.connect(ac.destination);
            } else {
              var last = src;
              if (shelfDb !== 0 && ac.createBiquadFilter) {
                var shelf = ac.createBiquadFilter();
                shelf.type = 'lowshelf';
                shelf.frequency.value = 220;
                shelf.gain.value = shelfDb;
                last.connect(shelf);
                last = shelf;
              }
              if (ac.createGain) {
                var gain = ac.createGain();
                gain.gain.value = gainVal;
                last.connect(gain);
                last = gain;
              }
              if (gainVal > 1 && ac.createDynamicsCompressor) {
                var comp = ac.createDynamicsCompressor();
                comp.threshold.value = -6;
                comp.knee.value = 6;
                comp.ratio.value = 12;
                comp.attack.value = 0.002;
                comp.release.value = 0.2;
                last.connect(comp);
                last = comp;
              }
              last.connect(ac.destination);
            }
            current = { src: src, utterance: u };
            src.onended = function () {
              if (my !== epoch) return;
              current = null;
              isSpeaking = false;
              isPaused = false;
              if (u.onend) u.onend({});
            };
            src.start();
          })
          .catch(function (err) {
            if (my !== epoch) return;
            isSpeaking = false;
            current = null;
            if (u.onerror) {
              var ev = { error: String((err && err.message) || err) };
              // Ladder exhaustion (the Kokoro driver walked its
              // whole recovery ladder — fresh session, then
              // halved splits to the floor — and the chunk still
              // failed) is marked on the error event, so the
              // reader can surface its skipped-part notice for
              // exactly this failure and no other.
              if (err && err.ladderExhausted) ev.ladderExhausted = true;
              u.onerror(ev);
            }
          });
      },

      cancel: function () {
        epoch += 1;
        stopCurrent();
      },

      pause: function () {
        if (audioCtx && isSpeaking && !isPaused) {
          isPaused = true;
          audioCtx.suspend();
          if (current && current.utterance.onpause) current.utterance.onpause({});
        }
      },

      resume: function () {
        if (audioCtx && isPaused) {
          isPaused = false;
          audioCtx.resume();
          if (current && current.utterance.onresume) current.utterance.onresume({});
        }
      },
    };
    Object.defineProperties(transport, {
      speaking: { get: function () { return isSpeaking; }, enumerable: true },
      paused: { get: function () { return isPaused; }, enumerable: true },
      pending: { get: function () { return false; }, enumerable: true },
    });

    return {
      transport: transport,
      Utterance: Utterance,
      modelId: modelId,
      voices: VOICES.map(function (v) {
        return { id: v.id, label: v.label, lang: v.lang, voiceURI: voiceUri(v.id) };
      }),
      isPackVoiceUri: function (uri) { return voiceIdFromUri(uri) !== null; },
      /* Shelf passthroughs (the app drives install/delete from
       * the voice panel and the picker through these). */
      status: function () {
        if (!voicePack) return Promise.resolve({ state: 'unknown' });
        return voicePack.status(modelId).then(function (s) {
          // voicepack.status falls back to the recommended
          // model for an unknown id; the pack is installed only
          // when the status measured THIS model.
          if (!s || s.modelId !== modelId) return { state: 'unknown' };
          return s;
        });
      },
      download: function (onProgress) {
        if (!voicePack) {
          return Promise.resolve({ ok: false, reason: 'The voice shelf is not available.' });
        }
        return voicePack.download(modelId, onProgress);
      },
      remove: function () {
        if (!voicePack) return Promise.resolve({ ok: false });
        return voicePack.removeModel(modelId);
      },
      /* Warm the engine ahead of the first speak (optional). */
      prepare: function () { return loadEngine().then(function () { return { ok: true }; }); },
    };
  }

  window.DogEarTtsPack = {
    create: create,
    Utterance: Utterance,
    VOICES: VOICES,
    MODEL_ID: DEFAULT_MODEL_ID,
    voiceUri: voiceUri,
    voiceIdFromUri: voiceIdFromUri,
  };
})();
