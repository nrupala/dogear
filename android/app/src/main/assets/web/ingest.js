// SPDX-FileCopyrightText: 2026 2351485 ALBERTA INC.
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/* DogEar document ingestion — turns a file the user picked into
 * plain readable text, entirely on this device.
 *
 * Formats:
 *   free:    .txt .md (decoded as text — no parser needed)
 *   licence: .pdf (PDF.js), .epub (JSZip + the book's own XHTML),
 *            .docx (Mammoth), .html (parsed in an inert document)
 *
 * The parsers are VENDORED with the app (/vendor/, hash-pinned at
 * build time) and loaded lazily, only when a file of that kind is
 * opened. Nothing is fetched from a CDN, ever: if every outside
 * service vanished tonight, this file would still work. File
 * contents never leave the device — there is no upload anywhere
 * in this module.
 *
 * Failures throw plain-words Errors; the app shows them verbatim.
 * A document that cannot be read is a loud "no", never silence.
 */
(function () {
  'use strict';

  var GATED = ['pdf', 'epub', 'docx', 'html'];

  function kindForFile(name, mime) {
    var n = String(name || '').toLowerCase();
    if (/\.pdf$/.test(n) || mime === 'application/pdf') return 'pdf';
    if (/\.epub$/.test(n) || mime === 'application/epub+zip') return 'epub';
    if (/\.docx$/.test(n) ||
        mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
    if (/\.html?$/.test(n) || mime === 'text/html') return 'html';
    if (/\.md$/.test(n) || /\.markdown$/.test(n) || mime === 'text/markdown') return 'md';
    if (/\.txt$/.test(n) || mime === 'text/plain') return 'txt';
    return null;
  }

  function isGated(kind) { return GATED.indexOf(kind) !== -1; }

  function decodeText(buffer) {
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  }

  /* ---------- lazy vendored-library loading ---------- */
  var scriptLoads = {};
  function loadScript(src) {
    if (scriptLoads[src]) return scriptLoads[src];
    scriptLoads[src] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () {
        reject(new Error('A reading tool the app carries could not be loaded (' + src + '). Try reloading the page.'));
      };
      document.head.appendChild(s);
    });
    return scriptLoads[src];
  }

  /* The vendored PDF.js build uses the newest Uint8Array helpers
     (toHex / fromBase64, Chrome 129+). Fill any that are missing so
     a slightly older browser still reads PDFs — tiny, standard
     shims, only installed where the real thing is absent. */
  function shimUint8() {
    if (typeof Uint8Array === 'undefined') return;
    var proto = Uint8Array.prototype;
    if (!proto.toHex) {
      proto.toHex = function () {
        var s = '';
        for (var i = 0; i < this.length; i++) s += this[i].toString(16).padStart(2, '0');
        return s;
      };
    }
    if (!proto.toBase64) {
      proto.toBase64 = function () {
        var s = '';
        for (var i = 0; i < this.length; i++) s += String.fromCharCode(this[i]);
        return btoa(s);
      };
    }
    if (!Uint8Array.fromHex) {
      Uint8Array.fromHex = function (hex) {
        var out = new Uint8Array(hex.length / 2);
        for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
        return out;
      };
    }
    if (!Uint8Array.fromBase64) {
      Uint8Array.fromBase64 = function (b64) {
        var bin = atob(b64);
        var out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      };
    }
  }

  var pdfLibPromise = null;
  /* The vendored paths, exactly as served. The _setPdfLibUrls
     seam exists only so the headless batteries can point the
     loader at the same vendored files on disk (a Node test has
     no '/vendor' URL space); nothing in the app calls it, and
     the defaults are the shipped paths. */
  var pdfLibUrl = '/vendor/pdf.min.mjs';
  var pdfWorkerUrl = '/vendor/pdf.worker.min.mjs';
  function loadPdfLib() {
    shimUint8();
    if (!pdfLibPromise) {
      pdfLibPromise = import(pdfLibUrl).then(function (lib) {
        lib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        return lib;
      }).catch(function () {
        pdfLibPromise = null;
        throw new Error('The PDF reader the app carries could not be loaded. Try reloading the page.');
      });
    }
    return pdfLibPromise;
  }

  /* ---------- HTML → text (inert parse; nothing renders) ---------- */
  function htmlToBlocks(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var title = doc.title ? doc.title.trim() : '';
    var blocks = [];
    var seen = [];
    Array.prototype.forEach.call(
      doc.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote'), function (el) {
        if (seen.some(function (s) { return s.contains(el); })) return;
        var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) { blocks.push(t); seen.push(el); }
      });
    if (!blocks.length && doc.body) {
      var t = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) blocks.push(t);
    }
    return { title: title, text: blocks.join('\n\n') };
  }

  /* ---------- PDF ---------- */
  // Join one page's text items into paragraphs: an item that ends
  // a line contributes a line break; blank-ish gaps become paragraph
  // breaks. Exposed for the headless tests.
  function pdfPageText(items) {
    var raw = '';
    items.forEach(function (it) {
      raw += it.str;
      raw += it.hasEOL ? '\n' : ' ';
    });
    var paras = [];
    var cur = [];
    raw.split('\n').forEach(function (line) {
      var l = line.replace(/\s+/g, ' ').trim();
      if (!l) { if (cur.length) { paras.push(cur.join(' ')); cur = []; } return; }
      cur.push(l);
    });
    if (cur.length) paras.push(cur.join(' '));
    return paras.join('\n\n');
  }

  function extractPdf(buffer) {
    return loadPdfLib().then(function (pdfjs) {
      return pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
    }).then(function (pdf) {
      var pages = [];
      var chain = Promise.resolve();
      var n = pdf.numPages;
      var collect = function (pageNo) {
        return pdf.getPage(pageNo).then(function (page) {
          return page.getTextContent();
        }).then(function (tc) {
          var t = pdfPageText(tc.items);
          if (t) pages.push(t);
        });
      };
      for (var i = 1; i <= n; i++) {
        (function (p) { chain = chain.then(function () { return collect(p); }); })(i);
      }
      return chain.then(function () {
        return { title: '', text: pages.join('\n\n') };
      });
    }).catch(function (e) {
      if (e && /^The PDF reader/.test(e.message)) throw e;
      throw new Error('That PDF could not be read — it may be damaged or password-protected.');
    });
  }

  /* ---------- DOCX ---------- */
  function extractDocx(buffer) {
    var ready = window.mammoth
      ? Promise.resolve()
      : loadScript('/vendor/mammoth.browser.min.js');
    return ready.then(function () {
      if (!window.mammoth) throw new Error('The Word-document reader the app carries could not be loaded.');
      return window.mammoth.extractRawText({ arrayBuffer: buffer });
    }).then(function (res) {
      return { title: '', text: (res && res.value ? res.value : '').replace(/\n{3,}/g, '\n\n').trim() };
    }).catch(function (e) {
      if (e && /^The Word-document/.test(e.message)) throw e;
      throw new Error('That Word document could not be read — it may be damaged, or an older .doc file (only .docx works).');
    });
  }

  /* ---------- EPUB ---------- */
  function byLocalName(root, name) {
    var out = [];
    var all = root.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) {
      if (all[i].localName === name) out.push(all[i]);
    }
    return out;
  }
  function zipText(zip, path) {
    var f = zip.file(path);
    return f ? f.async('text') : Promise.resolve(null);
  }
  function resolvePath(baseDir, href) {
    var parts = (baseDir + href).split('/');
    var out = [];
    parts.forEach(function (p) {
      if (p === '.' || p === '') return;
      if (p === '..') { out.pop(); return; }
      out.push(p);
    });
    return out.join('/');
  }

  function extractEpub(buffer) {
    var ready = window.JSZip
      ? Promise.resolve()
      : loadScript('/vendor/jszip.min.js');
    return ready.then(function () {
      if (!window.JSZip) throw new Error('The e-book reader the app carries could not be loaded.');
      return window.JSZip.loadAsync(buffer);
    }).then(function (zip) {
      return zipText(zip, 'META-INF/container.xml').then(function (container) {
        if (!container) throw new Error('That e-book could not be read — its table of contents is missing.');
        var cdoc = new DOMParser().parseFromString(container, 'text/xml');
        var roots = byLocalName(cdoc, 'rootfile');
        if (!roots.length) throw new Error('That e-book could not be read — its table of contents is broken.');
        var opfPath = roots[0].getAttribute('full-path');
        var baseDir = opfPath.indexOf('/') !== -1 ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
        return zipText(zip, opfPath).then(function (opfText) {
          if (!opfText) throw new Error('That e-book could not be read — its contents list is missing.');
          var opf = new DOMParser().parseFromString(opfText, 'text/xml');
          var title = '';
          var titles = byLocalName(opf, 'title');
          if (titles.length) title = (titles[0].textContent || '').trim();
          var manifest = {};
          byLocalName(opf, 'item').forEach(function (it) {
            manifest[it.getAttribute('id')] = {
              href: it.getAttribute('href'),
              type: it.getAttribute('media-type') || '',
            };
          });
          var spine = byLocalName(opf, 'itemref').map(function (r) {
            return manifest[r.getAttribute('idref')];
          }).filter(function (it) {
            return it && /xhtml|html|xml/.test(it.type) && !/nav/.test(it.href || '');
          });
          var chapters = [];
          var chain = Promise.resolve();
          spine.forEach(function (it) {
            chain = chain.then(function () {
              var path = resolvePath(baseDir, decodeURIComponent(it.href));
              return zipText(zip, path).then(function (xhtml) {
                if (!xhtml) return;
                var ex = htmlToBlocks(xhtml);
                if (ex.text) chapters.push(ex.text);
              });
            });
          });
          return chain.then(function () {
            return { title: title, text: chapters.join('\n\n') };
          });
        });
      });
    }).catch(function (e) {
      if (e && /^That e-book/.test(e.message) || e && /^The e-book/.test(e.message)) throw e;
      throw new Error('That e-book could not be read — it may be damaged or copy-protected (DRM books cannot be opened).');
    });
  }

  /* ---------- streaming extraction (large documents) ----------
     The extractors above already work sequentially — a PDF page
     at a time, an EPUB chapter at a time — but extract() holds
     every page until the whole book is in memory as one string.
     extractStreaming runs the SAME sequential walk and hands
     each page/chapter's text to onSegment the moment it is
     read, so the caller can store it (in chunks, on device)
     and let reading start on the first part while the rest is
     still being read out of the file. Memory stays bounded by
     one page/chapter plus whatever the caller keeps.
     onSegment(text, info) may return a promise; it is awaited
     before the next page is read (backpressure: a stored chunk
     is durable before extraction moves on). info is
     { unit: 'page'|'chapter'|'part', index, total } with total
     -1 when the format does not know it up front.
     Resolves { title } when the walk completes. A failure
     throws the same plain-words Errors as extract(); segments
     already handed over stay handed over — the caller keeps
     the part that was read and can ask for the file again to
     finish (the app's resume path). */
  function extractPdfStreaming(buffer, onSegment) {
    return loadPdfLib().then(function (pdfjs) {
      return pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
    }).then(function (pdf) {
      var n = pdf.numPages;
      var chain = Promise.resolve();
      var emit = function (pageNo) {
        return pdf.getPage(pageNo).then(function (page) {
          return page.getTextContent();
        }).then(function (tc) {
          var t = pdfPageText(tc.items);
          if (t) return onSegment(t, { unit: 'page', index: pageNo - 1, total: n });
        });
      };
      for (var i = 1; i <= n; i++) {
        (function (p) { chain = chain.then(function () { return emit(p); }); })(i);
      }
      return chain.then(function () { return { title: '' }; });
    }).catch(function (e) {
      if (e && /^The PDF reader/.test(e.message)) throw e;
      throw new Error('That PDF could not be read — it may be damaged or password-protected.');
    });
  }

  function extractEpubStreaming(buffer, onSegment) {
    var ready = window.JSZip
      ? Promise.resolve()
      : loadScript('/vendor/jszip.min.js');
    return ready.then(function () {
      if (!window.JSZip) throw new Error('The e-book reader the app carries could not be loaded.');
      return window.JSZip.loadAsync(buffer);
    }).then(function (zip) {
      return zipText(zip, 'META-INF/container.xml').then(function (container) {
        if (!container) throw new Error('That e-book could not be read — its table of contents is missing.');
        var cdoc = new DOMParser().parseFromString(container, 'text/xml');
        var roots = byLocalName(cdoc, 'rootfile');
        if (!roots.length) throw new Error('That e-book could not be read — its table of contents is broken.');
        var opfPath = roots[0].getAttribute('full-path');
        var baseDir = opfPath.indexOf('/') !== -1 ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
        return zipText(zip, opfPath).then(function (opfText) {
          if (!opfText) throw new Error('That e-book could not be read — its contents list is missing.');
          var opf = new DOMParser().parseFromString(opfText, 'text/xml');
          var title = '';
          var titles = byLocalName(opf, 'title');
          if (titles.length) title = (titles[0].textContent || '').trim();
          var manifest = {};
          byLocalName(opf, 'item').forEach(function (it) {
            manifest[it.getAttribute('id')] = {
              href: it.getAttribute('href'),
              type: it.getAttribute('media-type') || '',
            };
          });
          var spine = byLocalName(opf, 'itemref').map(function (r) {
            return manifest[r.getAttribute('idref')];
          }).filter(function (it) {
            return it && /xhtml|html|xml/.test(it.type) && !/nav/.test(it.href || '');
          });
          var chain = Promise.resolve();
          spine.forEach(function (it, ci) {
            chain = chain.then(function () {
              var path = resolvePath(baseDir, decodeURIComponent(it.href));
              return zipText(zip, path).then(function (xhtml) {
                if (!xhtml) return;
                var ex = htmlToBlocks(xhtml);
                if (ex.text) {
                  return onSegment(ex.text,
                    { unit: 'chapter', index: ci, total: spine.length });
                }
              });
            });
          });
          return chain.then(function () { return { title: title }; });
        });
      });
    }).catch(function (e) {
      if (e && /^That e-book/.test(e.message) || e && /^The e-book/.test(e.message)) throw e;
      throw new Error('That e-book could not be read — it may be damaged or copy-protected (DRM books cannot be opened).');
    });
  }

  function extractStreaming(kind, buffer, onSegment) {
    switch (kind) {
      case 'pdf': return extractPdfStreaming(buffer, onSegment);
      case 'epub': return extractEpubStreaming(buffer, onSegment);
      case 'txt':
      case 'md':
      case 'html':
      case 'docx':
        /* These formats have no sequential walk to stream (the
           whole file is parsed at once), but their text still
           reaches the caller in pieces: the extracted text is
           handed over paragraph-block by paragraph-block, so
           chunked storage — and reading the first chunk — never
           waits on anything but the parse itself. */
        return extract(kind, buffer).then(function (ex) {
          var blocks = String(ex.text || '').split(/\n{2,}/);
          var chain = Promise.resolve();
          blocks.forEach(function (b, bi) {
            if (!b) return;
            chain = chain.then(function () {
              return onSegment(b, { unit: 'part', index: bi, total: blocks.length });
            });
          });
          return chain.then(function () { return { title: ex.title || '' }; });
        });
      default:
        return Promise.reject(new Error('DogEar cannot read that kind of file yet.'));
    }
  }

  /* ---------- entry point ---------- */
  function extract(kind, buffer) {
    switch (kind) {
      case 'txt':
      case 'md':
        return Promise.resolve({ title: '', text: decodeText(buffer) });
      case 'html':
        return Promise.resolve(htmlToBlocks(decodeText(buffer)));
      case 'pdf': return extractPdf(buffer);
      case 'docx': return extractDocx(buffer);
      case 'epub': return extractEpub(buffer);
      default:
        return Promise.reject(new Error('DogEar cannot read that kind of file yet.'));
    }
  }

  window.DogEarIngest = {
    GATED: GATED.slice(),
    kindForFile: kindForFile,
    isGated: isGated,
    extract: extract,
    extractStreaming: extractStreaming,
    _htmlToBlocks: htmlToBlocks,
    _pdfPageText: pdfPageText,
    _setPdfLibUrls: function (libUrl, workerUrl) {
      pdfLibUrl = libUrl; pdfWorkerUrl = workerUrl; pdfLibPromise = null;
    },
  };
})();
