// SPDX-FileCopyrightText: 2026 2351485 ALBERTA INC.
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/* DogEar voice pack — optional, downloadable, fully on-device
 * two-way voice.
 *
 * What it is: a shelf of speech-recognition models the app
 * offers to download ONCE each, from inside the app, only when
 * the listener wants two-way voice. The listener CHOOSES a model
 * (Tiny / Base / Small / Medium / Large); every model rides on
 * one shared runtime that runs it in the browser
 * (Transformers.js + ONNX Runtime Web, WebAssembly), downloaded
 * once alongside the first model. No model ships inside the app:
 * each is a user-chosen download, under that model's own
 * licence, shown on the shelf before download. After the
 * download, speech is recognized ON THIS DEVICE. The phone is
 * the only ear: no audio is uploaded, no transcription service
 * exists in this design, and each model can be deleted from the
 * same place it was fetched.
 *
 * Two capabilities ride on the transcription:
 *   1. TALK TO THE READER — voice commands for playback (listen,
 *      pause, resume, stop, back, forward, start over), matched
 *      by parseIntent and carried out by the host (app.js) on the
 *      reader's own controls.
 *   2. ASK THE TEXT — a spoken question about the open document.
 *      The answer is retrieval + quotation ONLY (retrieval.js):
 *      the document's own words, read aloud — never a composed
 *      answer, so it cannot fabricate. When the retrieval gates
 *      refuse, the app says so. There is deliberately NO answer
 *      model in this build; generative synthesis is a documented
 *      next step, not this one.
 *
 * Entitlement: the pack is gated behind the app's one unlocked
 * state (opts.isUnlocked — a Play unlock purchase or the owner's
 * super-user licence), checked again here so no other path can
 * fetch 100+ MB on a locked device. A standalone pack SKU is
 * reserved in config (SKUS.voicePack), but the owner's ruling
 * (2026-10-21 22:54 MDT) is DECIDED: the pack is INCLUDED in
 * the US$24.99 unlock, not a separate charge — the SKU key
 * stays unpriced and unreferenced by billing.
 *
 * Pack mechanics: files are versioned static assets under
 * DogEarConfig.VOICE_PACK_BASE ('/pack/v2'), described by
 * pack-registry.json (served at <base>/pack-registry.json): one
 * shared runtime file set plus, per model, that model's own
 * file set, each file with a sha256. A model counts as
 * installed only when its own files AND all runtime files are
 * on the device. Downloads fetch the missing runtime files
 * first, then the model's missing files, and verify every
 * file's hash BEFORE it enters Cache Storage; a mismatch is an
 * error and nothing partial is kept for that file. The service
 * worker serves /pack/ cache-first from the same cache, which
 * is what makes the downloaded runtime importable and the
 * models readable offline. Engine loads configure the runtime
 * for local files only (allowRemoteModels = false) — after a
 * model download, the voice path makes no network request that
 * could carry anything anywhere. The model in use is the
 * listener's selection, kept in storage under
 * 'dogearapp:voice-model:v1'; changing it drops the loaded
 * engine so the next load builds the newly chosen model's
 * pipeline.
 *
 * Factory-shaped like billing.js / meter.js: tests inject fake
 * caches, fetch, importer and media devices and exercise the
 * exact code the app runs.
 */
(function () {
  'use strict';

  var REGISTRY_NAME = 'pack-registry.json';
  var SELECTION_KEY = 'dogearapp:voice-model:v1';
  var MIME = {
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.wasm': 'application/wasm',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.onnx': 'application/octet-stream',
  };
  function mimeFor(p) {
    var dot = p.lastIndexOf('.');
    return MIME[dot >= 0 ? p.slice(dot) : ''] || 'application/octet-stream';
  }
  function hexOf(buf) {
    var bytes = new Uint8Array(buf);
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      out += ('0' + bytes[i].toString(16)).slice(-2);
    }
    return out;
  }

  /* ---------------- intent parsing (pure) ----------------
     Commands are anchored full-utterance matches on the
     normalized transcript; questions are detected after, and
     anything longer that matches neither is treated as a
     question — the retrieval gates, not the parser, decide
     whether the document can answer it. A missed command can
     therefore cost a refused question, never a wrong action. */
  function normalizeUtterance(text) {
    var t = String(text || '').toLowerCase().trim();
    t = t.replace(/^(hey|ok|okay|please|dogear|dog ear)[,.\s]+/, '');
    t = t.replace(/[.!?\s]+$/, '').trim();
    return t;
  }
  var COMMANDS = [
    ['startover', /^(start over|start again|from the top|from the beginning|restart|back to the start|back to the beginning)$/],
    ['stop', /^(stop|stop reading|stop it|stop playback|enough|be quiet|quiet)$/],
    ['pause', /^(pause|pause it|pause reading|hold on|wait|wait a moment|wait a second)$/],
    ['resume', /^(resume|resume reading|continue|continue reading|keep reading|carry on|go on)$/],
    ['play', /^(listen|play|read|read it|read aloud|start|start reading|begin|begin reading)$/],
    ['back', /^(back|go back|back up|rewind|go back a bit|back a little|previous bit)$/],
    ['forward', /^(forward|go forward|skip|skip ahead|skip forward|jump ahead|go forward a bit|next bit)$/],
  ];
  function parseIntent(text) {
    var raw = String(text || '').trim();
    var t = normalizeUtterance(raw);
    if (!t) return { type: 'unknown' };
    var m = /^(ask|question)[:\s]+(.+)$/.exec(t);
    if (m) return { type: 'question', text: m[2] };
    for (var i = 0; i < COMMANDS.length; i++) {
      if (COMMANDS[i][1].test(t)) return { type: 'control', action: COMMANDS[i][0] };
    }
    if (/^(what|who|whom|whose|when|where|why|how|which|is|are|was|were|do|does|did|can|could|should|would|tell me|name|list|describe|explain)\b/.test(t) ||
        raw.indexOf('?') >= 0) {
      return { type: 'question', text: raw };
    }
    if (t.split(/\s+/).length >= 3) return { type: 'question', text: raw };
    return { type: 'unknown' };
  }

  /* create(opts) — opts:
   *   config:       DogEarConfig (default: window.DogEarConfig)
   *   isUnlocked:   () -> bool (REQUIRED for download; the app's
   *                 one unlocked state)
   *   freeModelIds: [modelId] whose downloads are NOT unlock-
   *                 gated (the bundled TTS voice pack is free and
   *                 the default voice; spec item 7). A free id
   *                 downloads only while its registry entry also
   *                 carries gate:"free" — config and shelf must
   *                 agree, so neither side alone can ungate a
   *                 model. Default: [config.TTS_PACK_MODEL_ID].
   *   cachesImpl:   Cache Storage (default: window.caches)
   *   fetchImpl:    (default: window.fetch)
   *   subtle:       crypto.subtle (default: window.crypto.subtle)
   *   importModule: (url) -> Promise<module> (default: dynamic
   *                 import; tests inject a fake runtime)
   *   storage:      selection store (default: window.localStorage)
   *   origin:       base origin for absolute cache keys
   *                 (default: window.location.origin)
   *   mediaDevices / MediaRecorderCtor / AudioContextCtor:
   *                 injectable capture stack (defaults: window's)
   *   retrieval:    DogEarRetrieval (default: window's)          */
  function create(opts) {
    opts = opts || {};
    var cfg = opts.config ||
      (typeof window !== 'undefined' && window.DogEarConfig) || {};
    var base = cfg.VOICE_PACK_BASE || '/pack/v2';
    var cacheName = cfg.VOICE_PACK_CACHE || 'dogear-voicepack-v2';
    var defaultModelId = cfg.VOICE_PACK_MODEL_ID || 'whisper-base.en';
    var storage = opts.storage ||
      (typeof window !== 'undefined' ? window.localStorage : null);
    var isUnlocked = opts.isUnlocked || function () { return false; };
    var freeModelIds = opts.freeModelIds ||
      (cfg.TTS_PACK_MODEL_ID ? [cfg.TTS_PACK_MODEL_ID] : []);
    function isFreeId(id) { return freeModelIds.indexOf(id) >= 0; }
    var cachesImpl = opts.cachesImpl ||
      (typeof window !== 'undefined' ? window.caches : null);
    var fetchImpl = opts.fetchImpl ||
      (typeof window !== 'undefined' && window.fetch ? window.fetch.bind(window) : null);
    var subtle = opts.subtle ||
      (typeof window !== 'undefined' && window.crypto ? window.crypto.subtle : null);
    var importModule = opts.importModule || function (url) { return import(url); };
    var origin = opts.origin ||
      (typeof window !== 'undefined' ? window.location.origin : 'https://app.getdogear.app');
    var retrieval = opts.retrieval ||
      (typeof window !== 'undefined' ? window.DogEarRetrieval : null);

    function fileUrl(relPath) { return origin + base + '/' + relPath; }
    function registryUrl() { return origin + base + '/' + REGISTRY_NAME; }

    /* ---------------- selection storage ---------------- */
    function storageGet() {
      try { return storage ? storage.getItem(SELECTION_KEY) : null; }
      catch (e) { return null; }
    }
    function storageSet(v) {
      try { if (storage) storage.setItem(SELECTION_KEY, v); } catch (e) {}
    }
    function storageClearSelection() {
      try { if (storage) storage.removeItem(SELECTION_KEY); } catch (e) {}
    }

    /* ---------------- registry ----------------
       The shelf: one shared runtime file set plus one file set
       per model, each file sha256-pinned. Fetched once and
       cached per instance.                              */
    var registryCache = null;
    function getRegistry() {
      if (registryCache) return Promise.resolve(registryCache);
      if (!fetchImpl) return Promise.reject(new Error('No network from here.'));
      return fetchImpl(registryUrl()).then(function (r) {
        if (!r.ok) throw new Error('The voice pack list could not be fetched, so the shelf cannot be shown. Check your connection and try again.');
        return r.json();
      }).then(function (reg) {
        if (!reg || !Array.isArray(reg.models) || !reg.models.length ||
            !reg.runtime || !Array.isArray(reg.runtime.files)) {
          throw new Error('The voice pack list came back unreadable, so the shelf cannot be shown. Try again in a moment.');
        }
        registryCache = reg;
        return reg;
      });
    }
    /* Back-compat alias: the registry IS the pack list now. */
    function getManifest() { return getRegistry(); }

    function modelById(reg, id) {
      for (var i = 0; i < reg.models.length; i++) {
        if (reg.models[i].id === id) return reg.models[i];
      }
      return null;
    }
    function recommendedOf(reg) {
      for (var i = 0; i < reg.models.length; i++) {
        if (reg.models[i].recommended) return reg.models[i];
      }
      return reg.models[0];
    }
    function runtimeFilesOf(reg) { return reg.runtime.files || []; }
    function sumBytes(files) {
      return files.reduce(function (a, f) { return a + f.bytes; }, 0);
    }
    function modelTotalBytes(model) {
      return typeof model.totalBytes === 'number'
        ? model.totalBytes : sumBytes(model.files || []);
    }

    /* Capability gate — evidence, 2026-10-22. The in-page WASM
       engine has a hard memory ceiling, measured three ways:
       Tiny (44 MB) and Base (80 MB) download, load and
       transcribe both on the bench and in the Android app;
       Small (253 MB) grew the WebView renderer to 2.5 GB RSS
       and the system killed the WHOLE APP (exit-info:
       LOW_MEMORY); Medium (780 MB) errored on every clip (a
       ~1.2 GB allocation refused); Large (1.5 GB) crashed the
       page outright. A model above the proven-safe size is
       therefore not downloadable or loadable in this runtime:
       its failure mode is the app's death, not an error the
       listener can act on. The ceiling lifts per model when a
       stronger (native) engine proves it on device. */
    var WASM_SAFE_MAX_BYTES = 100 * 1024 * 1024;
    function modelRunnableHere(model) {
      return !!model && modelTotalBytes(model) <= WASM_SAFE_MAX_BYTES;
    }
    var GATE_REASON = 'This model is not offered in the app yet: ' +
      'it needs more memory than the in-app voice engine can ' +
      'safely use, and the phone would shut DogEar down while ' +
      'loading it. Tiny and Base run safely here. The larger ' +
      'models return when the stronger engine lands.';

    function openCache() {
      if (!cachesImpl) return Promise.reject(new Error('This browser cannot keep the pack on the device.'));
      return cachesImpl.open(cacheName);
    }
    function cacheUrlSet(cache) {
      return cache.keys().then(function (keys) {
        return new Set(keys.map(function (k) { return k.url; }));
      });
    }

    /* Per-model standing against a known cache contents set.
       A model is installed only when ALL of its own files AND
       all of the shared runtime files are present; the byte and
       file counts are the model's own files only, with the
       runtime reported separately. */
    function statusFor(reg, model, have) {
      var files = model.files || [];
      var present = 0, bytes = 0;
      files.forEach(function (f) {
        if (have.has(fileUrl(f.path))) { present++; bytes += f.bytes; }
      });
      var rt = runtimeFilesOf(reg);
      var rtPresent = 0;
      rt.forEach(function (f) { if (have.has(fileUrl(f.path))) rtPresent++; });
      var runtimePresent = rtPresent === rt.length;
      /* State tracks the MODEL's own files — absent means none
         of it is here (even if the shared runtime is, left by
         another model), partial means some of it is — and
         installed additionally requires the whole runtime. */
      var state = (present === files.length && runtimePresent) ? 'installed'
        : (present === 0 ? 'absent' : 'partial');
      return {
        state: state,
        filesPresent: present, filesTotal: files.length,
        bytesPresent: bytes, totalBytes: modelTotalBytes(model),
        runtimePresent: runtimePresent,
        runtimeFilesPresent: rtPresent, runtimeFilesTotal: rt.length,
        model: model.id, modelId: model.id,
        packVersion: reg.packVersion, pack: reg.pack,
      };
    }

    /* Which of the model's files (and the shared runtime's) are
       already kept, byte-counted. With no argument, the
       SELECTED model's status. */
    function status(modelId) {
      return getRegistry().then(function (reg) {
        var idP = modelId ? Promise.resolve(modelId) : getSelectedModelId();
        return idP.then(function (id) {
          var model = modelById(reg, id) || recommendedOf(reg);
          return openCache().then(function (cache) {
            return cacheUrlSet(cache).then(function (have) {
              return statusFor(reg, model, have);
            });
          });
        });
      }).catch(function () {
        return { state: 'unknown', filesPresent: 0, filesTotal: 0, bytesPresent: 0, totalBytes: 0, runtimePresent: false };
      });
    }

    /* ---------------- selection ----------------
       The stored choice wins while it names a registry model;
       otherwise the recommended model if it is installed, else
       the first installed model, else the recommended model. */
    function getSelectedModelId() {
      return getRegistry().then(function (reg) {
        var stored = storageGet();
        if (stored && modelById(reg, stored)) return stored;
        return openCache().then(function (cache) {
          return cacheUrlSet(cache);
        }).then(function (have) {
          var rec = recommendedOf(reg);
          if (statusFor(reg, rec, have).state === 'installed') return rec.id;
          for (var i = 0; i < reg.models.length; i++) {
            if (statusFor(reg, reg.models[i], have).state === 'installed') {
              return reg.models[i].id;
            }
          }
          return rec.id;
        }).catch(function () { return recommendedOf(reg).id; });
      }).catch(function () {
        return storageGet() || defaultModelId;
      });
    }
    function setSelectedModelId(id) {
      storageSet(id);
      dropEngine();
      return id;
    }

    var downloadCtl = null;
    /* download(modelId, onProgress) — the model's missing files,
       preceded by any missing SHARED runtime files. Progress
       totals count exactly the bytes this run still needs
       (runtime-missing + model-missing, measured at the start);
       files already kept are skipped, so an interrupted download
       resumes. Every file's sha256 is verified BEFORE it enters
       the cache; a mismatch keeps nothing of that file. The
       legacy download(onProgress) shape downloads the selected
       model. */
    function download(modelId, onProgress) {
      if (typeof modelId === 'function') {
        onProgress = modelId; modelId = null;
      }
      // The unlock refusal happens BEFORE any fetch for gated
      // models (a locked app must not touch the network for the
      // shelf's gated payloads). A model named in freeModelIds
      // skips this refusal — and is re-checked against its own
      // registry entry's gate below, before any payload fetch.
      if (!isUnlocked() && !(modelId && isFreeId(modelId))) {
        return Promise.resolve({ ok: false, reason: 'The voice pack is part of the DogEar unlock — unlock DogEar first, then download it here.' });
      }
      if (!fetchImpl || !subtle) {
        return Promise.resolve({ ok: false, reason: 'This browser cannot download the pack safely.' });
      }
      var ctl = downloadCtl = { cancelled: false };
      return getRegistry().then(function (reg) {
        var idP = modelId ? Promise.resolve(modelId) : getSelectedModelId();
        return idP.then(function (id) {
          var model = modelById(reg, id);
          if (!model) throw new Error('That voice model is not on the shelf.');
          if (!isUnlocked() && !(isFreeId(model.id) && model.gate === 'free')) {
            return { ok: false, reason: 'The voice pack is part of the DogEar unlock — unlock DogEar first, then download it here.' };
          }
          if (!modelRunnableHere(model)) {
            return { ok: false, reason: GATE_REASON };
          }
          return openCache().then(function (cache) {
            var wanted = runtimeFilesOf(reg).concat(model.files || []);
            var missing = [];
            var check = Promise.resolve();
            wanted.forEach(function (f) {
              check = check.then(function () {
                return cache.match(fileUrl(f.path)).then(function (hit) {
                  if (!hit) missing.push(f);
                });
              });
            });
            return check.then(function () {
              var total = sumBytes(missing);
              var done = 0;
              function report(file) {
                if (onProgress) {
                  onProgress({ doneBytes: done, totalBytes: total, file: file || null, modelId: model.id });
                }
              }
              report(null);
              var chain = Promise.resolve();
              missing.forEach(function (f) {
                chain = chain.then(function () {
                  if (ctl.cancelled) throw new Error('__cancelled__');
                  var url = fileUrl(f.path);
                  return fetchImpl(url).then(function (r) {
                    if (!r.ok) throw new Error('A pack file could not be fetched (' + r.status + '): ' + f.path);
                    return readBody(r, f.bytes, function (n) {
                      if (onProgress) {
                        onProgress({ doneBytes: done + n, totalBytes: total, file: f.path, modelId: model.id });
                      }
                    });
                  }).then(function (buf) {
                    if (ctl.cancelled) throw new Error('__cancelled__');
                    return subtle.digest('SHA-256', buf).then(function (hash) {
                      if (hexOf(hash) !== f.sha256) {
                        throw new Error('A pack file did not match its checksum, so it was not kept: ' + f.path);
                      }
                      return cache.put(url, new Response(buf, {
                        headers: { 'Content-Type': mimeFor(f.path) },
                      }));
                    });
                  }).then(function () {
                    done += f.bytes;
                    report(f.path);
                  });
                });
              });
              return chain.then(function () {
                if (downloadCtl === ctl) downloadCtl = null;
                return { ok: true, modelId: model.id, totalBytes: total };
              });
            });
          });
        });
      }).catch(function (e) {
        if (downloadCtl === ctl) downloadCtl = null;
        if (e && e.message === '__cancelled__') {
          return { ok: false, cancelled: true, reason: 'Download stopped. The files fetched so far are kept — downloading again will pick up where this left off.' };
        }
        /* Beta.6 (R3): our specific pack messages pass (they
           name the file and the consequence); a raw network
           error becomes the elaborated form. */
        var dmsg = (e && e.message) || '';
        if (/^(A pack file|That voice model)/.test(dmsg)) {
          return { ok: false, reason: dmsg };
        }
        return { ok: false, reason: 'The download did not finish — check your connection and try again. What already arrived is kept, and trying again picks up from there.' };
      });
    }
    function readBody(r, expectBytes, onChunk) {
      if (r.body && typeof r.body.getReader === 'function') {
        var reader = r.body.getReader();
        var parts = [], n = 0;
        return (function next() {
          return reader.read().then(function (res) {
            if (res.done) {
              var merged = new Uint8Array(n);
              var off = 0;
              parts.forEach(function (p) { merged.set(p, off); off += p.byteLength; });
              return merged.buffer;
            }
            parts.push(res.value); n += res.value.byteLength;
            if (onChunk) onChunk(n);
            return next();
          });
        })();
      }
      return r.arrayBuffer().then(function (buf) {
        if (onChunk) onChunk(buf.byteLength);
        return buf;
      });
    }
    function cancelDownload() {
      if (downloadCtl) downloadCtl.cancelled = true;
    }

    /* Delete ONLY one model's cached files; the shared runtime
       and every other model stay. If the removed model was the
       selected one, the stored selection is cleared so the
       fallback rules pick the next model, and a loaded engine
       for it is dropped. */
    function removeModel(modelId) {
      return getRegistry().then(function (reg) {
        var model = modelById(reg, modelId);
        if (!model) return false;
        return openCache().then(function (cache) {
          var chain = Promise.resolve();
          (model.files || []).forEach(function (f) {
            chain = chain.then(function () {
              return cache.delete ? cache.delete(fileUrl(f.path))
                : Promise.resolve(false);
            });
          });
          return chain.then(function () {
            if (engineModelId === modelId) dropEngine();
            if (storageGet() === modelId) {
              storageClearSelection();
              dropEngine();
            }
            return true;
          });
        });
      }).catch(function () { return false; });
    }

    /* Legacy whole-pack removal: the entire pack cache (all
       models + the shared runtime) goes. */
    function remove() {
      cancelDownload();
      dropEngine();
      indexCache.clear();
      if (!cachesImpl) return Promise.resolve(false);
      return cachesImpl.delete(cacheName);
    }

    /* ---------------- speech engine ----------------
       The loaded engine is keyed by model id: it serves only
       the model it was built for. Changing the selection (or
       removing the in-use model) drops it, so the next load
       builds the newly selected model's pipeline. */
    var engine = null;       // the ASR function
    var enginePromise = null;
    var engineModelId = null;
    function dropEngine() {
      engine = null; enginePromise = null; engineModelId = null;
    }
    function loadEngine(onProgress) {
      return getSelectedModelId().then(function (id) {
        if (engine && engineModelId === id) return { ok: true };
        if (enginePromise && engineModelId === id) return enginePromise;
        return getRegistry().then(function (reg) {
          var model = modelById(reg, id);
          if (model && !modelRunnableHere(model)) {
            return { ok: false, reason: GATE_REASON };
          }
          return loadEngineFor(id, onProgress);
        });
      });
    }
    function loadEngineFor(id, onProgress) {
        /* A stale caller may pass a non-function (the picker-era
           signature took a model id here); a bad callback must not
           fail deep inside the runtime. */
        if (typeof onProgress !== 'function') onProgress = null;
        engineModelId = id;
        enginePromise = status(id).then(function (st) {
          if (st.state !== 'installed') {
            throw new Error('The voice pack is not on this device yet — choose a model on the voice shelf and download it, then Talk again.');
          }
          return importModule(base + '/runtime/transformers.js');
        }).then(function (TF) {
          if (!TF || typeof TF.pipeline !== 'function' || !TF.env) {
            throw new Error('The voice runtime did not load.');
          }
          var env = TF.env;
          env.allowRemoteModels = false;
          env.allowLocalModels = true;
          env.localModelPath = base + '/models/';
          env.useBrowserCache = false;
          if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
            env.backends.onnx.wasm.wasmPaths = base + '/runtime/';
            env.backends.onnx.wasm.numThreads =
              (typeof SharedArrayBuffer !== 'undefined')
                ? Math.min(4, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2)
                : 1;
          }
          return getRegistry().then(function (reg) {
            var model = modelById(reg, id);
            return TF.pipeline('automatic-speech-recognition', id, {
              dtype: (model && model.dtype) || 'q8',
              device: 'wasm',
              progress_callback: onProgress || undefined,
            });
          });
        }).then(function (asr) {
          engine = asr;
          enginePromise = null;
          return { ok: true };
        }).catch(function (e) {
          enginePromise = null;
          if (!engine) engineModelId = null;
          /* Beta.6 (R3): our own prose passes (it already names
             the remedy); a raw runtime message never reaches the
             listener — it becomes the elaborated engine-start
             failure instead. */
          var msg = (e && e.message) || '';
          if (/^(The voice pack is not|That voice model|This model is not offered)/.test(msg)) {
            return { ok: false, reason: msg };
          }
          if (/runtime did not load/i.test(msg)) {
            return { ok: false, reason: 'The voice runtime did not load — the pack on this device may be incomplete. Delete the model on the voice shelf and download it again, then Talk.' };
          }
          return { ok: false, reason: 'The voice engine could not start on this device. Try Talk once more; if it keeps failing, delete the model on the voice shelf and download it again.' };
        });
        return enginePromise;
    }
    function engineReady() { return !!engine; }

    /* Warm engine (1.7.0, spec item 8). The tap-to-listening
       path used to pay the full model load between the tap and
       the microphone opening — on a cold engine that latency
       ate the interaction (the owner's Wispr Flow comparison).
       warmEngine() runs the SAME deduped loadEngine() early —
       at boot / document open, off the first-paint path — so by
       the time Talk is tapped the engine is already up and the
       tap goes straight to listening. It never rejects and it
       is silent by design: a warm that cannot run (no model
       installed, model not offered here) leaves the tap path
       exactly as it was, spoken failure lines included. */
    function engineState() {
      return engine ? 'ready' : (enginePromise ? 'loading' : 'cold');
    }
    function warmEngine() {
      return loadEngine().then(function (r) {
        return { ok: !!(r && r.ok), state: engineState() };
      }, function () {
        return { ok: false, state: engineState() };
      });
    }

    /* Transcribe 16 kHz mono float samples. Returns the text
       and how long the device took. */
    function transcribe(samples) {
      if (!engine) {
        return Promise.resolve({ ok: false, reason: 'The voice engine is not running yet.' });
      }
      /* Near-silence guard (1.1.0 exercise finding): Whisper
         answers a silent recording with an invented word, not
         always a bracketed token — the host then replies "I
         don't know how to do it" to a user who said nothing,
         and the no-speech failure line never fires. A buffer
         whose peak is effectively zero (digital silence, a
         dead or muted microphone) is no speech BY MEASUREMENT:
         report empty text without troubling the engine, and
         the host's "couldn't make that out" line — cause and
         remedy, spoken — does its job. The floor is set far
         below any real speech a microphone can capture. */
      try {
        var peak = 0;
        for (var i = 0; i < samples.length; i++) {
          var a = Math.abs(samples[i]);
          if (a > peak) peak = a;
        }
        if (samples.length && peak < 0.005) {
          return Promise.resolve({ ok: true, text: '', ms: 0, silent: true });
        }
      } catch (e) { /* a non-array input falls through to the engine */ }
      var t0 = Date.now();
      return Promise.resolve(engine(samples)).then(function (out) {
        var text = (out && out.text ? String(out.text) : '').trim();
        /* Whisper answers silence with a bracketed non-speech
           token ([BLANK_AUDIO], [ Silence ], …). That is not
           something the user said: report it as no speech, so
           the host shows its "couldn't make that out" line
           instead of quoting a token back as words. Found in
           the beta.4 sandbox exercise, 2026-10-22. */
        if (/^\[[^\]]*\]$/.test(text)) text = '';
        return { ok: true, text: text, ms: Date.now() - t0 };
      }).catch(function (e) {
        /* Beta.6 (R3): the bare two-word failure line and the
           raw engine message are both gone. An engine throw is
           one of two kinds, and the words say which, plus the
           remedy — and that nothing left the device. */
        var msg = (e && e.message) || '';
        if (/memory|alloc|wasm|onnx|runtime|session|tensor/i.test(msg)) {
          return { ok: false, reason: 'The speech model stumbled over that recording — a memory or engine problem on this device, and nothing was sent anywhere. Try once more; if it keeps happening, delete the model on the voice shelf and download it again.' };
        }
        return { ok: false, reason: 'Listening did not work that time — the speech model could not read what was recorded, and nothing was sent anywhere. Try again, a little closer to the microphone.' };
      });
    }

    /* ---------------- microphone capture ----------------
       getUserMedia -> MediaRecorder -> decode -> resample to
       16 kHz mono floats. Recording stops on stop(), on the
       max, or when the stream ends. The audio exists only in
       memory, only until it has been transcribed.            */
    function startListening(opts2) {
      opts2 = opts2 || {};
      var maxMs = opts2.maxMs || 20000;
      var md = opts.mediaDevices ||
        (typeof navigator !== 'undefined' ? navigator.mediaDevices : null);
      var MRCtor = opts.MediaRecorderCtor ||
        (typeof window !== 'undefined' ? window.MediaRecorder : null);
      var ACCtor = opts.AudioContextCtor ||
        (typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null);
      var stream = null, rec = null, chunks = [], stopped = false, timer = null;
      var done = new Promise(function (resolve) {
        if (!md || !md.getUserMedia || !MRCtor || !ACCtor) {
          resolve({ ok: false, reason: 'This browser cannot record from the microphone here, so Talk cannot listen in this browser. Reading aloud still works as always.' });
          return;
        }
        md.getUserMedia({ audio: true }).then(function (s) {
          stream = s;
          rec = new MRCtor(stream);
          rec.addEventListener('dataavailable', function (e) {
            if (e.data && e.data.size) chunks.push(e.data);
          });
          rec.addEventListener('stop', function () {
            cleanup();
            var blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
            decodeTo16k(blob, ACCtor).then(resolve, function () {
              resolve({ ok: false, reason: 'What was recorded could not be read back — the recording came back in a shape this device cannot decode. Try again; if it repeats, restart DogEar and try once more.' });
            });
          });
          rec.start();
          timer = setTimeout(function () { stop(); }, maxMs);
        }).catch(function (e) {
          /* The failure CLASS decides the words. Only a true denial
             may speak of permission: on the owner's phone a busy /
             unopenable microphone (NotReadableError) was reported as
             "needs your permission" while the permission stood
             granted — a false claim about the user's own settings.
             Proven 2026-10-22; keep the classes separate. */
          var name = (e && e.name) || '';
          var reason;
          if (name === 'NotAllowedError' || name === 'SecurityError') {
            reason = 'The microphone is blocked. DogEar needs your permission to listen — nothing is recorded without it.';
          } else if (name === 'NotReadableError') {
            reason = 'The microphone could not be opened — it may be busy with another app. Close anything using the microphone and try again. Your permission is not the problem.';
          } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
            /* Beta.6 (R3): elaborated by the census suite, which
               caught these three branches still bare/thin —
               classes stay separate, the WORDS now carry cause
               + remedy in each. */
            reason = 'No microphone was found on this device, so Talk cannot listen here. Reading aloud still works as always.';
          } else if (name === 'AbortError') {
            reason = 'Listening was interrupted before it could start — the microphone never got going. Nothing was recorded. Tap Talk and try once more.';
          } else {
            reason = 'The microphone could not be opened on this device. Close anything that might be using it and try again — if it keeps failing, restarting DogEar usually clears it.';
          }
          resolve({ ok: false, reason: reason });
        });
        function cleanup() {
          if (timer) clearTimeout(timer);
          if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
        }
      });
      function stop() {
        if (stopped) return;
        stopped = true;
        if (rec && rec.state !== 'inactive') {
          try { rec.stop(); } catch (e) {}
        }
      }
      return { done: done, stop: stop };
    }
    function decodeTo16k(blob, ACCtor) {
      return blob.arrayBuffer().then(function (buf) {
        var ctx = new ACCtor();
        return ctx.decodeAudioData(buf).then(function (decoded) {
          var len = Math.max(1, Math.ceil(decoded.duration * 16000));
          var off = new OfflineAudioContext(1, len, 16000);
          var src = off.createBufferSource();
          src.buffer = decoded;
          src.connect(off.destination);
          src.start();
          return off.startRendering().then(function (rendered) {
            if (ctx.close) ctx.close();
            return { ok: true, samples: rendered.getChannelData(0), seconds: decoded.duration };
          });
        });
      });
    }

    /* ---------------- ask the text ---------------- */
    var indexCache = new Map();
    function indexFor(text) {
      var key = text.length + ':' + text.slice(0, 48) + ':' + text.slice(-48);
      if (!indexCache.has(key)) {
        if (!retrieval) return null;
        if (indexCache.size > 2) indexCache.clear();
        indexCache.set(key, retrieval.createIndex(text));
      }
      return indexCache.get(key);
    }
    function ask(docText, question) {
      var idx = indexFor(String(docText || ''));
      if (!idx) return { ok: false, reason: 'The question engine is not available in this build, so I cannot search the document. Reading and the voice commands still work.' };
      var a = idx.ask(question);
      return {
        ok: true,
        refused: a.refused,
        refusal: a.refusal,
        quote: a.quote,
        coverage: a.coverage,
        topScore: a.topScore,
        passageChunks: a.passages.reduce(function (acc, p) {
          return acc.concat(p.chunks);
        }, []),
      };
    }

    /* ---------------- duplex monitor (1.7.0, item 10) ------
       Engineered duplex: the microphone stays live while
       DogEar speaks or thinks, so the listener can barge in.
       Two hard rules:
       (1) Echo cancellation is a precondition, not a hope.
           The stream is requested WITH echoCancellation and
           the track's own settings must confirm it engaged —
           otherwise the monitor REFUSES and the app stays
           turn-based (the graceful floor: never ship a build
           that talks over itself).
       (2) Onset is detected on the live stream's level
           (AnalyserNode RMS), never on a transcript —
           silencing playback cannot wait for recognition.
           Windowed transcripts follow behind for the re-plan,
           each decoded and transcribed by the same proven
           path Talk uses. */
    function startDuplexMonitor(handlers, monOpts) {
      handlers = handlers || {};
      monOpts = monOpts || {};
      var md = opts.mediaDevices ||
        (typeof navigator !== 'undefined' ? navigator.mediaDevices : null);
      var ACCtor = opts.AudioContextCtor ||
        (typeof window !== 'undefined'
          ? (window.AudioContext || window.webkitAudioContext) : null);
      var MRCtor = opts.MediaRecorderCtor ||
        (typeof window !== 'undefined' ? window.MediaRecorder : null);
      var threshold = monOpts.threshold || 0.055;
      var windowMs = monOpts.windowMs || 1500;
      if (!md || !md.getUserMedia || !ACCtor) {
        return Promise.resolve({ ok: false, reason: 'no-duplex-here' });
      }
      var state = {
        stream: null, ctx: null, timer: null, rec: null,
        chunks: [], stopped: false, hotPolls: 0, armed: true,
        lastHotAt: 0, recTimer: null,
      };
      function stopMonitor() {
        state.stopped = true;
        if (state.timer) clearInterval(state.timer);
        if (state.recTimer) clearTimeout(state.recTimer);
        if (state.rec && state.rec.state !== 'inactive') {
          try { state.rec.stop(); } catch (e) {}
        }
        if (state.stream) {
          state.stream.getTracks().forEach(function (t) { t.stop(); });
        }
        if (state.ctx && state.ctx.close) {
          try { state.ctx.close(); } catch (e) {}
        }
      }
      return md.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      }).then(function (stream) {
        var track = stream.getAudioTracks
          ? stream.getAudioTracks()[0] : null;
        var settings = (track && track.getSettings)
          ? track.getSettings() : {};
        if (settings.echoCancellation !== true) {
          stream.getTracks().forEach(function (t) { t.stop(); });
          return { ok: false, reason: 'no-echo-cancellation' };
        }
        state.stream = stream;
        var ctx = new ACCtor();
        state.ctx = ctx;
        var srcNode = ctx.createMediaStreamSource(stream);
        var analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        srcNode.connect(analyser);
        var buf = new Uint8Array(analyser.fftSize);
        state.timer = setInterval(function () {
          if (state.stopped) return;
          analyser.getByteTimeDomainData(buf);
          var sum = 0;
          for (var i = 0; i < buf.length; i++) {
            var v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          var rms = Math.sqrt(sum / buf.length);
          var t = Date.now();
          if (rms >= threshold) {
            state.hotPolls++;
            state.lastHotAt = t;
            if (state.armed && state.hotPolls >= 2) {
              state.armed = false;
              if (handlers.onOnset) {
                try { handlers.onOnset({ at: t, rms: rms }); }
                catch (e) {}
              }
            }
          } else {
            state.hotPolls = 0;
            if (!state.armed && t - state.lastHotAt > 900) {
              state.armed = true;
            }
          }
        }, 25);
        function cycleRecorder() {
          if (state.stopped || !MRCtor) return;
          state.chunks = [];
          var rec = new MRCtor(stream);
          state.rec = rec;
          rec.addEventListener('dataavailable', function (e) {
            if (e.data && e.data.size) state.chunks.push(e.data);
          });
          rec.addEventListener('stop', function () {
            if (state.stopped) return;
            var blob = new Blob(state.chunks,
              { type: rec.mimeType || 'audio/webm' });
            decodeTo16k(blob, ACCtor).then(function (dec) {
              if (state.stopped || !dec || !dec.ok) {
                cycleRecorder();
                return;
              }
              return transcribe(dec.samples).then(function (tr) {
                if (!state.stopped && tr && tr.ok && tr.text &&
                    handlers.onPartial) {
                  try { handlers.onPartial(tr.text); } catch (e) {}
                }
                cycleRecorder();
              });
            }, function () { cycleRecorder(); });
          });
          rec.start();
          state.recTimer = setTimeout(function () {
            if (!state.stopped && rec.state !== 'inactive') {
              try { rec.stop(); } catch (e) {}
            }
          }, windowMs);
        }
        cycleRecorder();
        return { ok: true, stop: stopMonitor };
      }).catch(function () {
        return { ok: false, reason: 'mic-unavailable' };
      });
    }

    return {
      getRegistry: getRegistry,
      getManifest: getManifest,
      status: status,
      download: download,
      cancelDownload: cancelDownload,
      remove: remove,
      removeModel: removeModel,
      getSelectedModelId: getSelectedModelId,
      setSelectedModelId: setSelectedModelId,
      modelRunnableHere: modelRunnableHere,
      gateReason: GATE_REASON,
      get selectedModelId() { return storageGet() || defaultModelId; },
      loadEngine: loadEngine,
      engineReady: engineReady,
      warmEngine: warmEngine,
      engineState: engineState,
      transcribe: transcribe,
      startListening: startListening,
      startDuplexMonitor: startDuplexMonitor,
      ask: ask,
      parseIntent: parseIntent,
      base: base,
      cacheName: cacheName,
      modelId: defaultModelId,
    };
  }

  window.DogEarVoicePack = { create: create, parseIntent: parseIntent };
})();
