# DogEar beta.5 — app-first scaffolding: design note

Date: 2026-10-22 (late evening). Lane: Wright beta.5 commission.
Diagnosis: DIAGNOSIS-BETA4-PHONE-TALK-2026-10-22.md (mechanisms
M1–M4). Directive (owner): "base DogEar as an app-first system" —
benchmarks Audible (playback behaviour) and Google Assistant
(voice interaction).

## What the scaffolding was, and why it failed

Beta.4's shape: a native `SpeechService` speaks (foreground
service, media session, audio focus — that layer was proven sound),
but **everything the user touches lives in the web page**, and
playback state exists in three places at once — reader-core in the
page, the bridge shim's `current`/`pausedFlag`, and the service's
own `state`. Talk capture also lives in the page (getUserMedia +
MediaRecorder), in front of a WASM engine that loads and infers on
the renderer's main thread. The owner's phone test found the
predictable result: while the app speaks — exactly when the
renderer is busiest — presses queue, state disagrees between
layers absorb presses silently, the microphone opens (or fails to)
against a voice that may still be talking, and the Talk button,
a conditional DOM node, neither persists nor reports itself
truthfully. The emulator could not show any of this (injected
taps, silent virtual mic, fast x86 renderer); the phone could.

## What app-first changes structurally

**One native state machine — `PlayerCore` — is the only source of
truth** for playback state, voice state, session (document),
position, and the in-playback marks. Everything else is a surface
that commands it or reflects it:

- **Native control bar** (new, in `MainActivity`): a standing
  Android view docked under the WebView, built from platform
  widgets — Pause/Resume · Stop · Talk · Continue on the transport
  row; Save · Bookmark · Favorite · Tag · Note on the marks row;
  a status line carrying title + chunk position. It is painted by
  the activity's UI thread and receives the platform's own touch
  dispatch: **no press can be starved by renderer load, and the bar
  exists whether or not the page has rendered** (the owner's
  "does not stay persistent", removed by construction).
- **`SpeechService` becomes the voice box only.** It keeps its
  proven mechanics (TTS, foreground notification, media session,
  audio-focus etiquette, wake lock) but reports utterance lifecycle
  into PlayerCore and takes its commands from PlayerCore. Its
  private `state` no longer decides anything user-visible alone.
- **Media session / notification / lock screen** route into
  PlayerCore like every other surface, so a headset pause and a
  bar pause are the same event in the same machine — no echo, no
  toggle drift (M3 removed by construction).
- **Capture is native** (`VoiceCapture`, AudioRecord 16 kHz mono).
  PlayerCore stops TTS and settles audio focus *before* the mic
  opens — silence first, by construction (M2 removed). Samples are
  handed to the page, whose **unchanged** voicepack engine
  transcribes them (the engine, the shelf and the capability gate
  are exactly beta.4's). Capture failure classes (permission /
  busy / no mic) keep beta.4's honest per-class words.
- **Position is native truth.** reader-core already writes its
  place record `{i, n}` before speaking each chunk; the bridge
  reads that record at speak time and reports `(chunk, total)`
  with every utterance. PlayerCore persists position on every
  chunk start. **Save** writes an explicit saved place; **Continue**
  resumes exactly there — after a stop, after leaving the reader,
  after an app restart — by commanding the page to open the
  document and seek, or by resuming the live reader.
- **The eight in-playback features hang off the machine**:
  Stop · Pause · Save · Continue · Favorites · Bookmarks · Tags ·
  Notes — each a PlayerCore command, each timestamped to the
  current chunk, each operable *during* speech because none of
  them waits on the page. Marks persist in a native store
  (`MarksStore`, one JSON file in app-private storage); the page
  can read them back through the bridge and render them (the
  reader gains a Marks list that seeks on tap).
- **The web layer is the page.** It renders the document, the
  library and the shelf; it reflects PlayerCore snapshots
  (`__dogearPlayerEvent`) into its labels; its own Listen/Talk
  buttons remain as mirrors that send the same idempotent
  commands. If the page is slow, the app still behaves.

## What deliberately does not change

reader-core (pinned), the Whisper engine + WASM capability gate +
shelf, pricing/licence/meter code (byte-identical discipline as
beta.4), the licensing boundary (no model weights in the
artifact), the wake word (designed, not built). One retained seam,
named: chunks are still fed by the page's engine one at a time
(reader-core's speak/onend contract), so a dead page still halts
*future* chunks — the native chunk queue stays the documented
next wall (STRENGTHENED-STRUCTURE.md item 3). Beta.5 removes the
owner's finding — controls, state, capture, position — not that
seam, and the exercise record will say so.

## Proof shape

PlayerCore is Android-free at its core (ports for speech, capture,
storage, clock and posting are injected), so its transitions are
covered by JVM unit tests in CI's toolchain (run on the build
host): command idempotence, silence-before-capture ordering,
position persistence, marks timestamping, continue-after-restart.
The candidate is then exercised end-to-end on the dogear35 AVD
with **physical-path input only** (adb taps on the native bar +
uiautomator state reads): every one of the eight controls operated
*during* active TTS speech, a 20-cycle pause/resume press series
counting state mismatches, Talk-during-speech, minimize and
screen-off legs, fresh install. Anything the guest cannot decide
is named phone-only in the record, plainly — starting with the
owner's exact Samsung failure, whose closing proof is his hand on
the candidate, as it was for beta.4's battery leg.
