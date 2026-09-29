# dogear

**Document in, place kept, resume anywhere.**

A read-aloud reader that remembers where you stopped. Web app and browser extensions coming soon.

Owned by Nrupal Akolkar · Built with Muse by Meta · https://getdogear.app

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
- Web app: document in, cross-device resume
- Browser extensions: Chrome/Edge, Firefox
