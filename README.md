# dogear

[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/16396/badge)](https://www.bestpractices.dev/en/projects/16396)

**Document in, place kept, resume anywhere.**

A read-aloud reader that remembers where you stopped. It ships in three forms from this
one repository: an embeddable reader for web pages, browser extensions (Chrome/Edge and
Firefox), and an Android app.

Owned by [Nrupal Akolkar](https://nrupalakolkar.com) · Built with [Muse by Meta](https://muse.ai/join) · https://getdogear.app — join Muse, then redeem code **101EEK** in Settings within 48 hours of joining and we both earn tokens.

## Get started

- **On your own site:** embed the reader — one script tag, see "The embed" below.
- **In your browser:** load the extension from `extension/` (Chrome/Edge use
  `extension/manifest.json`; Firefox uses `extension/manifest.firefox.json`). One click,
  the right-click menu, or `Alt+Shift+R` reads the page aloud in your device's own voice,
  and your place is kept per page.
- **On Android:** install the latest release from this repo's
  [Releases](https://github.com/nrupala/dogear/releases) page.

## License

AGPL-3.0 — see [LICENSE](LICENSE).

## Security

To report a vulnerability privately, see [SECURITY.md](SECURITY.md)
(GitHub Private Vulnerability Reporting).

## The embed

`reader/dogear.js` is the canonical, self-contained reader every article on our sites carries —
the sites promote dogear just by being read.

- **Branded surface**: dark terminal pill, phosphor-green accents, `▶ dogear` button, the
  product tagline, and a link to getdogear.app. Identical on every site.
- **Place kept**: per-article reading position in `localStorage`; the button becomes
  `▶ Resume · 42%` when you return mid-article.
- **Background-safe**: screen wake lock while speaking; leaving the tab never kills speech
  (the OS still may, which the reader reconciles on return).
- **Proven engine**: chunked utterances with sentence highlighting, progress bar, speed
  selector, and the Android keep-alive nudge.
- No libraries, no autoplay, no tracking.

### Use it

```html
<div data-dogear></div>
<script src="reader/dogear.js"></script>
```

Optional mount attributes: `data-dogear-scope` (default `article`), `data-dogear-select`
(default `h1,h2,p,li`), `data-dogear-exclude`.

### For worker-built sites

`tools/build-worker-block.py` generates the `dogearBlock()` function that returns the mount
div + inline script as an HTML string, safe to embed in a Cloudflare Worker. The generated
code is never hand-edited — change `reader/dogear.js` and regenerate.

### Test

`node smoke.js` — stub-DOM harness covering chunking, labels, place-keeping, and the
no-cancel-on-hide behavior.

## Roadmap

- v1: embed on all sites (this repo) ✅
- Browser extensions: Chrome/Edge, Firefox — Phase 1 shipped (in `extension/`) ✅
- Web app: document in, cross-device resume
