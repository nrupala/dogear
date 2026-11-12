// SPDX-FileCopyrightText: 2026 2351485 ALBERTA INC.
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/* DogEar ask-the-text retrieval — the re-spike's retrieval,
 * ported to the app.
 *
 * The retrieval core (tokenizer, stopwords, BM25, chunking,
 * re-ranking, passage assembly) is a faithful port of the spike
 * harness that cleared the owner's bar on 2026-10-21
 * (~/workspace/dogear/spike-ask-the-text/respike/harness2.py over
 * work/harness.py; results in RESULTS-RESPIKE-2026-10-21.md):
 *   - abbreviation-aware sentence splitting (the baseline split
 *     shattered "Mr."/"Mrs." into fragments), sentences packed
 *     into ~700-char chunks with a one-sentence overlap;
 *   - BM25 (k1=1.5, b=0.75) candidate pool of 16, re-ranked by
 *     normalised BM25 + 0.6 x question content-word coverage
 *     + 0.4 x ordered content-bigram phrase match; top 8;
 *   - passages: top-3 hits expanded +/-1 neighbour, merged in
 *     document order, duplicate sentences removed, context
 *     capped at 9,500 chars.
 * The battery test (tests/retrieval.test.mjs) proves the port
 * against the spike's own committed artifacts — same chunk texts,
 * same passages, 12/12 factual answer passages found.
 *
 * On top of retrieval sits the app-side answer layer, which is
 * extractive BY DESIGN: it never composes an answer. It picks
 * the best-matching passage units and returns them as a QUOTE —
 * the document's own words, which cannot fabricate. Before it
 * quotes, four honesty gates may refuse instead (the spike's
 * refusal spirit, recalibrated for ~700-char chunks — the
 * re-spike showed a raw word-count guard goes silent at this
 * chunk size, so these gates key on coverage ratios, absent
 * subjects, and figure-shape, not raw overlap):
 *   G1 a named subject of the question (a capitalised name)
 *      appears nowhere in the document -> refuse. This is the
 *      dangerous fabrication class: questions about people the
 *      document never mentions (the battery's Wickham/Collins
 *      probes).
 *   G2 a price/cost question whose passages hold no figure in a
 *      sentence about the asked thing -> refuse (quoting some
 *      other product's price would be a fabrication).
 *   G3 retrieval is weaker than every battery question ever
 *      scored (top re-rank < 1.05) -> refuse: nothing found.
 *   G4 two or more of the question's ordinary subject words are
 *      entirely absent from the document AND the quote covers
 *      under 40% of what was asked AND retrieval is on the weak
 *      side (< 1.28) -> refuse. Calibrated on the battery: it
 *      catches the absent-subject probe (A-N2) at top-score 1.20
 *      while the weakest genuine question it could touch sits
 *      at 1.32 — the margins are thin and are reported as such
 *      in VOICE-PACK-BUILD-NOTE.md. A false refusal is a safe
 *      failure (the user sees what was heard and can re-ask);
 *      a fabricated answer is not.
 * Matching inside the answer layer (quote pick + gates) folds
 * possessives and simple plurals ("certificates" ~ "certificate",
 * "Darcy's" ~ "darcy"); the retrieval core itself is untouched
 * by folding, exactly as spiked.
 *
 * Exposed as window.DogEarRetrieval, factory-shaped like the
 * other modules so headless tests exercise the same code.
 */
(function () {
  'use strict';

  /* ---------------- spike-faithful primitives ---------------- */

  var STOP = new Set(('a an the and or of to in on for with by at from as is are was were be been being ' +
    'do does did what which who whom whose when where why how much many ' +
    'it its this that these those he she they we you i his her their our your him them us me ' +
    'have has had not no if but so than then there here into about over under more most other others ' +
    'can could shall should will would may might must one two first').split(' '));

  function toks(s) {
    var m = String(s).toLowerCase().match(/[a-z0-9_']+/g) || [];
    var out = [];
    for (var i = 0; i < m.length; i++) {
      var t = m[i].replace(/^'+|'+$/g, '');
      if (t) out.push(t);
    }
    return out;
  }

  function blocksOf(text) {
    var out = [];
    var parts = String(text).split(/\n\s*\n/);
    for (var i = 0; i < parts.length; i++) {
      var b = parts[i].replace(/\s+/g, ' ').trim();
      if (b) out.push(b);
    }
    return out;
  }

  function sentencesOf(block) {
    return String(block).split(/(?<=[.!?])\s+/)
      .filter(function (p) { return p.replace(/ /g, ''); });
  }

  var ABBREV = ['Mr', 'Mrs', 'Ms', 'Dr', 'St', 'Jr', 'Sr', 'Prof', 'Capt',
    'Lt', 'Col', 'Gen', 'Hon', 'Rev', 'vs', 'etc', 'approx'];
  var PH = '\u0001';

  function sentencesOf2(block) {
    var t = String(block);
    for (var i = 0; i < ABBREV.length; i++) {
      t = t.split(ABBREV[i] + '.').join(ABBREV[i] + PH);
    }
    t = t.split('U.S.').join('U' + PH + 'S' + PH);
    t = t.split('U.K.').join('U' + PH + 'K' + PH);
    t = t.split('e.g.').join('e' + PH + 'g' + PH);
    t = t.split('i.e.').join('i' + PH + 'e' + PH);
    t = t.replace(/(?<![A-Za-z])([A-Z])\./g, '$1' + PH);
    return t.split(/(?<=[.!?])\s+/)
      .filter(function (p) { return p.replace(/ /g, ''); })
      .map(function (p) { return p.split(PH).join('.'); });
  }

  /* Verbatim reader-core chunk loop (used only to split a single
     over-long sentence before packing, as the spike did). */
  function chunkSentence(t, size) {
    var chunks = [];
    t = String(t);
    while (t.length > size) {
      var c = t.lastIndexOf(',', size);
      if (c < 80) c = t.lastIndexOf(' ', size);
      if (c < 80) c = size;
      chunks.push(t.slice(0, c + 1));
      t = t.slice(c + 1).replace(/^\s+/, '');
    }
    if (t) chunks.push(t);
    return chunks;
  }

  var TARGET = 700, MAXSENT = 1000, OVERLAP_MAX = 220;
  var POOL = 16, TOPK = 8, PASSAGE_CAP = 9500;
  var W_COV = 0.6, W_PHRASE = 0.4;

  function buildChunks2(text) {
    var sents = [];
    var blocks = blocksOf(text);
    for (var i = 0; i < blocks.length; i++) {
      var ss = sentencesOf2(blocks[i]);
      for (var j = 0; j < ss.length; j++) {
        if (ss[j].length > MAXSENT) {
          var pieces = chunkSentence(ss[j], MAXSENT);
          for (var k = 0; k < pieces.length; k++) sents.push(pieces[k]);
        } else {
          sents.push(ss[j]);
        }
      }
    }
    var chunks = [], cur = [];
    function curLen() {
      var n = 0;
      for (var i = 0; i < cur.length; i++) n += cur[i].length;
      return n;
    }
    for (var s = 0; s < sents.length; s++) {
      var sent = sents[s];
      if (cur.length && curLen() + 1 + sent.length > TARGET) {
        chunks.push(cur.join(' '));
        var last = cur[cur.length - 1];
        cur = (cur.length >= 2 && last.length <= OVERLAP_MAX) ? [last] : [];
      }
      cur.push(sent);
    }
    if (cur.length) chunks.push(cur.join(' '));
    return chunks.map(function (t, i) { return { n: i + 1, text: t }; });
  }

  function BM25(docs) {
    this.docs = docs.map(toks);
    this.N = docs.length;
    var total = 0;
    for (var i = 0; i < this.docs.length; i++) total += this.docs[i].length;
    this.avgdl = total / Math.max(1, this.N);
    this.df = {};
    this.tf = [];
    for (var d = 0; d < this.docs.length; d++) {
      var seen = {};
      var m = {};
      var arr = this.docs[d];
      for (var w = 0; w < arr.length; w++) {
        m[arr[w]] = (m[arr[w]] || 0) + 1;
        if (!seen[arr[w]]) { seen[arr[w]] = 1; this.df[arr[w]] = (this.df[arr[w]] || 0) + 1; }
      }
      this.tf.push(m);
    }
  }
  BM25.prototype.idf = function (t) {
    var n = this.df[t] || 0;
    return Math.log(1 + (this.N - n + 0.5) / (n + 0.5));
  };
  BM25.prototype.score = function (q, i, k1, b) {
    k1 = k1 === undefined ? 1.5 : k1;
    b = b === undefined ? 0.75 : b;
    var dl = this.docs[i].length;
    var s = 0;
    var qset = new Set(toks(q));
    var self = this;
    qset.forEach(function (t) {
      var f = self.tf[i][t] || 0;
      if (f) s += self.idf(t) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * dl / self.avgdl));
    });
    return s;
  };
  BM25.prototype.rank = function (q) {
    var self = this;
    var idx = this.docs.map(function (_, i) { return i; });
    var scores = idx.map(function (i) { return self.score(q, i); });
    idx.sort(function (a, b2) { return (scores[b2] - scores[a]) || (a - b2); });
    return idx;
  };

  function contentWords(q) {
    return toks(q).filter(function (t) { return !STOP.has(t) && t.length > 1; });
  }

  function rerank(q, chunks, bm) {
    var pool = bm.rank(q).slice(0, POOL);
    var topScore = pool.length ? bm.score(q, pool[0]) : 0;
    var cw = contentWords(q);
    var cset = new Set(cw);
    var bigrams = [];
    for (var i = 0; i + 1 < cw.length; i++) bigrams.push(cw[i] + '\u0000' + cw[i + 1]);
    var scored = pool.map(function (idx, pos) {
      var ctoks = toks(chunks[idx].text);
      var csetI = new Set(ctoks);
      var inter = 0;
      cset.forEach(function (t) { if (csetI.has(t)) inter++; });
      var cov = cset.size ? inter / cset.size : 0;
      var phr = 0;
      if (bigrams.length) {
        var pairs = new Set();
        for (var j = 0; j + 1 < ctoks.length; j++) pairs.add(ctoks[j] + '\u0000' + ctoks[j + 1]);
        var hit = 0;
        for (var b = 0; b < bigrams.length; b++) if (pairs.has(bigrams[b])) hit++;
        phr = hit / bigrams.length;
      }
      var raw = bm.score(q, idx);
      var bm25n = topScore ? raw / topScore : 0;
      return { i: idx, final: bm25n + W_COV * cov + W_PHRASE * phr, bm25: raw, cov: cov, phrase: phr, pos: pos };
    });
    scored.sort(function (a, b) {
      return (b.final - a.final) || (b.bm25 - a.bm25) || (a.pos - b.pos);
    });
    return scored;
  }

  function passagesFor2(chunks, selected) {
    var core = selected.slice();
    for (;;) {
      var chosen = new Set(core);
      var head = core.slice(0, 3);
      for (var h = 0; h < head.length; h++) {
        for (var dj = -1; dj <= 1; dj += 2) {
          var j = head[h] + dj;
          if (j >= 0 && j < chunks.length) chosen.add(j);
        }
      }
      var ordered = Array.from(chosen).sort(function (a, b) { return a - b; });
      var groups = [], cur = [ordered[0]];
      for (var o = 1; o < ordered.length; o++) {
        if (ordered[o] === cur[cur.length - 1] + 1) cur.push(ordered[o]);
        else { groups.push(cur); cur = [ordered[o]]; }
      }
      groups.push(cur);
      var out = groups.map(function (grp) {
        var seen = new Set(), sents = [];
        for (var g = 0; g < grp.length; g++) {
          var ss = sentencesOf(chunks[grp[g]].text);
          for (var s2 = 0; s2 < ss.length; s2++) {
            if (!seen.has(ss[s2])) { seen.add(ss[s2]); sents.push(ss[s2]); }
          }
        }
        return { chunks: grp.map(function (j2) { return chunks[j2].n; }), text: sents.join(' ') };
      });
      var totalChars = 0;
      for (var t = 0; t < out.length; t++) totalChars += out[t].text.length;
      if (totalChars <= PASSAGE_CAP || core.length <= 4) return out;
      core.pop();
    }
  }

  /* ---------------- answer layer (app-side) ---------------- */

  function fold(t) {
    t = String(t).replace(/\u2019/g, "'");
    if (t.slice(-2) === "'s") t = t.slice(0, -2);
    else if (t.slice(-1) === "'") t = t.slice(0, -1);
    if (t.length > 3 && t.slice(-1) === 's' &&
        !(t.slice(-2) === 'ss' || t.slice(-2) === 'us' || t.slice(-2) === 'is')) {
      t = t.slice(0, -1);
    }
    return t;
  }
  function ntoks(s) { return toks(s).map(fold); }

  var NUMWORDS = new Set(['one', 'two', 'three', 'four', 'five', 'six', 'seven',
    'eight', 'nine', 'ten', 'eleven', 'twelve', 'twenty', 'thirty', 'forty',
    'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand',
    'million', 'first', 'second', 'third', 'dozen', 'half', 'quarter']);

  /* Capitalised name pieces of the question, as a Map from the
     folded piece (what presence is checked with) to the surface
     form as written (what an honest refusal can name back). */
  function namePieces(q) {
    var out = new Map();
    var words = String(q).replace(/[?,]/g, ' ').split(/\s+/);
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w && /[A-Z]/.test(w.charAt(0))) {
        var stem = w.replace(/^['\u2019.,;:!"]+|['\u2019.,;:!"]+$/g, '');
        var pieces = toks(stem);
        for (var j = 0; j < pieces.length; j++) {
          if (pieces[j].length > 1 && !STOP.has(pieces[j]) && !out.has(fold(pieces[j]))) {
            out.set(fold(pieces[j]), stem);
          }
        }
      }
    }
    return out;
  }

  function quoteUnits(text) {
    var units = [];
    var sents = sentencesOf(text);
    for (var i = 0; i < sents.length; i++) {
      if (sents[i].length <= 260) units.push(sents[i]);
      else {
        var parts = sents[i].split(';');
        for (var j = 0; j < parts.length; j++) {
          var p = parts[j].trim();
          if (p) units.push(p);
        }
      }
    }
    return units;
  }

  var GATE_FLOOR = 1.05;       // G3: below every battery score ever recorded
  var GATE_G4_TOP = 1.28;      // G4: between the probe (1.20) and the weakest genuine (1.32)
  var GATE_G4_COV = 0.40;

  function createIndex(text) {
    var chunks = buildChunks2(text);
    var bm = new BM25(chunks.map(function (c) { return c.text; }));
    var ndf = {};
    chunks.forEach(function (c) {
      var seen = new Set(ntoks(c.text));
      seen.forEach(function (t) { ndf[t] = (ndf[t] || 0) + 1; });
    });
    function present(w) { return (ndf[fold(w)] || 0) > 0; }
    function idfF(t) {
      var n = ndf[t] || 0;
      return Math.log(1 + (chunks.length - n + 0.5) / (n + 0.5));
    }

    function retrieve(question) {
      var scored = rerank(question, chunks, bm);
      var selected = scored.slice(0, TOPK).map(function (s) { return s.i; });
      var passages = passagesFor2(chunks, selected);
      return { scored: scored, selected: selected, passages: passages };
    }

    function ask(question) {
      var r = retrieve(question);
      var scored = r.scored, passages = r.passages;
      var topFinal = scored.length ? scored[0].final : 0;
      var cset = new Set(contentWords(question).map(fold));
      var top3nums = new Set(r.selected.slice(0, 3).map(function (i) { return chunks[i].n; }));

      // Quote candidates: units of every passage group, groups
      // holding a top-3 hit bonused, as calibrated.
      var gunits = [], gtop = [];
      passages.forEach(function (p) {
        var us = [], seen = new Set();
        quoteUnits(p.text).forEach(function (u) {
          if (!seen.has(u)) { seen.add(u); us.push(u); }
        });
        gunits.push(us);
        gtop.push(p.chunks.some(function (n) { return top3nums.has(n); }));
      });
      var units = [];
      gunits.forEach(function (us, gi) {
        us.forEach(function (u, ui) { units.push({ gi: gi, ui: ui, u: u }); });
      });
      var moneyQ = /how much .*cost|cost\b|price|in dollars/i.test(question);
      var digitQ = /how (much|many)|when|what (year|date|time)|how old/i.test(question);
      function hasNum(u) {
        if (/\d/.test(u)) return true;
        var ts = toks(u);
        for (var i = 0; i < ts.length; i++) if (NUMWORDS.has(ts[i])) return true;
        return false;
      }
      function unitScore(item) {
        var matched = new Set();
        ntoks(item.u).forEach(function (t) { if (cset.has(t)) matched.add(t); });
        var bonus = (digitQ && hasNum(item.u)) ? 2 : 0;
        var idfSum = 0;
        matched.forEach(function (t) { idfSum += idfF(t); });
        return {
          primary: matched.size + bonus + (gtop[item.gi] ? 0.5 : 0),
          idfSum: idfSum, gi: item.gi, ui: item.ui, matched: matched.size,
        };
      }
      var ranked = units.map(function (item) {
        return { item: item, s: unitScore(item) };
      }).sort(function (a, b) {
        return (b.s.primary - a.s.primary) || (b.s.idfSum - a.s.idfSum) ||
          (a.s.gi - b.s.gi) || (a.s.ui - b.s.ui);
      });
      var best = ranked.length ? ranked[0].item : { gi: 0, ui: 0, u: '' };
      var parts = [best.u], total = best.u.length;
      var sibs = gunits[best.gi] || [];
      for (var e = best.ui + 1; e < Math.min(sibs.length, best.ui + 4); e++) {
        if (total + 1 + sibs[e].length > 560) break;
        parts.push(sibs[e]); total += 1 + sibs[e].length;
      }
      var quote = parts.join(' ');
      var qset = new Set(ntoks(quote));
      var qov = 0;
      cset.forEach(function (t) { if (qset.has(t)) qov++; });
      var cov = cset.size ? qov / cset.size : 0;

      var nps = namePieces(question);
      var absentNames = [];    // folded pieces (the check record)
      var absentDisplay = [];  // surface forms, for the spoken refusal
      nps.forEach(function (surface, piece) {
        if (!present(piece)) { absentNames.push(piece); absentDisplay.push(surface); }
      });
      var absentPlain = [];
      cset.forEach(function (w) {
        if (!present(w) && !nps.has(w)) absentPlain.push(w);
      });

      /* Refusal reasons are user prose, written to be read aloud
         after the app's "I couldn't find that in this document."
         The gate codes stay in `gate` for the record. */
      var refusal = null;
      if (absentNames.length) {
        var names = absentDisplay.length === 1 ? absentDisplay[0]
          : absentDisplay.slice(0, -1).join(', ') + ' or ' + absentDisplay[absentDisplay.length - 1];
        refusal = {
          gate: 'G1', absent: absentNames,
          reason: 'It doesn\u2019t mention ' + names + '.',
        };
      } else if (topFinal < GATE_FLOOR) {
        refusal = {
          gate: 'G3',
          reason: 'Nothing in it covers that closely enough to quote.',
        };
      } else if (moneyQ) {
        var fig = /(\$\s?\d|£\s?\d|\d+\s?(dollars|pounds|usd)|\bUSD\s?\d)/i;
        var okFig = units.some(function (item) {
          if (!fig.test(item.u)) return false;
          var m = 0;
          var us = new Set(ntoks(item.u));
          cset.forEach(function (t) { if (us.has(t)) m++; });
          return m >= 2;
        });
        if (!okFig) {
          refusal = {
            gate: 'G2',
            reason: 'It doesn\u2019t give a price or a cost for that.',
          };
        }
      }
      if (!refusal && absentPlain.length >= 2 && cov < GATE_G4_COV && topFinal < GATE_G4_TOP) {
        refusal = {
          gate: 'G4', absent: absentPlain,
          reason: 'The words for that aren\u2019t in it.',
        };
      }

      return {
        refused: !!refusal,
        refusal: refusal,
        quote: refusal ? '' : quote,
        coverage: cov,
        topScore: topFinal,
        passages: passages,
        topChunks: r.selected.map(function (i) { return chunks[i].n; }),
      };
    }

    return {
      chunks: chunks,
      chunkCount: chunks.length,
      retrieve: retrieve,
      ask: ask,
    };
  }

  window.DogEarRetrieval = {
    createIndex: createIndex,
    toks: toks,
    buildChunks: buildChunks2,
    STOP: STOP,
    _internal: {
      blocksOf: blocksOf,
      sentencesOf: sentencesOf,
      sentencesOf2: sentencesOf2,
      chunkSentence: chunkSentence,
      BM25: BM25,
      rerank: rerank,
      passagesFor2: passagesFor2,
      fold: fold,
      quoteUnits: quoteUnits,
    },
  };
})();
