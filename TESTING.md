# Unit testing the Micrio Client

This document is the plan of record for the unit test suites: what exists, how to run
it, how to add to it, and what is deliberately still missing. It is meant to be read
and extended across sessions (see [Session backlog](#session-backlog)).

The repo went ten years without unit tests, so the target is **catching up**: start
with the logic that has real edges, and grow per subsystem rather than chasing a
coverage number.

Per-fixture and per-suite implementation notes deliberately live **next to the code
they describe** — in the fixture/helper file's header, or in the suite that pins the
behaviour — not here. This document answers "how do I run and extend the suite"; the
files answer "why is this fixture shaped that way".

## Running the tests

```sh
pnpm test           # core + browser (every fast suite)
pnpm test:core      # bare Node, no DOM, no browser, no network
pnpm test:browser   # headless Chromium (Playwright)
pnpm test:css       # the same Chromium, with the *real* stylesheets
pnpm test:browser:live   # opt-in: the only suite that touches the network
pnpm test:coverage  # core + browser under v8 coverage, one merged report
pnpm test:watch     # watch the core project while working on pure logic
```

`test:css` is its own run, not part of `test`, because the stylesheets it needs are a
process-wide switch: `MICRIO_TEST_CSS=1` (which the script sets) makes Vitest inject every
`.css` import for _all_ browser tests, and five of them assert on sizes the stubbed layout
gives them. They fail with the switch on — that is the measurement behind keeping this a
separate project rather than a mode of `browser`.

Requirements: Node `^20.19.0 || >=22.12.0`, and the Playwright Chromium build that the
installed `playwright` version expects. `playwright` is declared as `^1.59.0`, so a
`pnpm install` can resolve a newer minor whose browser revision is **not** in
`~/.cache/ms-playwright` — if `test:browser` fails with
`Executable doesn't exist at …/chrome-headless-shell`, run:

```sh
pnpm exec playwright install chromium
```

Failure screenshots and `context.annotate` attachments land in `.vitest/` (gitignored).
Vitest never removes them, so `vitest.config.ts` clears the directory at config load:
every test run starts clean, and whatever is in there afterwards belongs to the run you
just did — delete it by hand if you want it gone sooner.

### What a clean run still prints on stderr

A green `pnpm test` is not silent: the suites that pin a **failure** path drive the client
into it, and the browser forwards whatever it logs. Every remaining line is expected and
belongs to a test that asserts the state that failure leaves behind (the rendered error
message, the fallback image, the warning call — sometimes the same text, sometimes not):

- `Warning: unknown grid tour event …` — the dispatcher's unknown-action branch; the
  `grid-transitions` case asserts the text, the `grid-tour-events` one only the unchanged
  layout.
- `[Micrio] Could not open the album for …` — the album degradation cases (`brokenArchive`,
  `missingIndex`). The trailing value is the rejection from the **stubbed** archive request,
  never a download; see [Offline by default](#offline-by-default).
- `Error: Only IIIF Presentation API 3 …`, `No valid IIIF canvases …`, `Not a valid IIIF
manifest …` — the IIIF "unsupported input" cases, each asserting its exact message.
- `Error: Image with id "…" not found …`, the WebGL-unsupported message — `element-errors`,
  asserting the `micrio-error` text and that `open()` never rejects.
- `[Micrio] Media failed (E303): …` followed by `[Micrio] Serial tour stopped: step 1/2 …` —
  `serial-tour`'s failure case, which drives the media element's own `error` event and asserts
  the tour stops, stays on the failing step and reports through `media-error`. One pair per
  run: `#break()` is single-shot, so a step that reports twice still stops once.

Two categories used to appear and are now absent, so their return means a regression:

- **`PromiseRejectionEvent { isTrusted: true }`** — an unhandled rejection from an aborted
  camera or grid animation: `flyToView`/`zoom` reject when interrupted (`Ani.stop()`), and
  `Grid.set()` propagates that as its own rejection. Every fire-and-forget caller has to
  handle it with `.catch(() => {})`.
- **`ResizeObserver loop completed with undelivered notifications.`** — Chromium's loop
  protection. `Canvas.onresize` already returns early when nothing changed, so this can only
  happen in the browser project, where `.css` imports are stubbed and the production
  `canvas.micrio` box is therefore missing; `tests/browser/setup.ts` filters exactly that
  message.

Any _other_ stderr line is a real finding: no suite is expected to log an unhandled error or
an unexpected warning.

## The two projects

`vitest.config.ts` defines two independent projects. They are separate processes with
separate configs, so a core test can never accidentally depend on a browser.

| Project   | Environment       | Include glob                     | Purpose                                                                             |
| --------- | ----------------- | -------------------------------- | ----------------------------------------------------------------------------------- |
| `core`    | Node (no DOM)     | `tests/core/**/*.test.ts`        | Pure logic: math, parsing, state, data loading, matrix math                         |
| `browser` | Chromium headless | `tests/browser/**/*.test.ts`     | Anything needing a DOM, layout, WebGL or the `<micr-io>` element                    |
| `css`     | Chromium headless | `tests/browser/css/**/*.test.ts` | The same, with the real stylesheets: placement, visibility, layering, interactivity |

Both projects share the alias map and the GLSL plugin with the production build:
`vite.config.js` exports `aliases` and `glslMinifyPlugin()`, and `vitest.config.ts`
imports them. So `$core/...`, `$utils/...`, `$render/...` resolve in tests exactly like
they do in the app, `templates/grid/**` included.

The browser suite is registered through the production entry point (`src/main.ts`), so
`customElements.define('micr-io', ...)` and the version banner behave exactly like a
real page.

`css` is the same browser and the same entry point, with one switch: `vitest.config.ts`
stubs every `.css` import to `{}` unless `MICRIO_TEST_CSS=1`, and `test:css` is the only
script that sets it. The project is listed only when that flag is on, which is what keeps
`pnpm test` (and a bare `npx vitest run`) green — with the flag off, its files are also
excluded from the `browser` project, because they only pass with the stylesheets in.
See [What the CSS suite pins](#what-the-css-suite-pins).

### Test layout

Tests are grouped in the directory of the module they pin, mirroring `src/`. The shared
harness stays at `tests/`: `tests/fixtures/` (bundle, space, tour, grid, album, book,
omni and UI data builders), `tests/helpers/` (mount, wait, network, tour and grid
helpers) plus the ambient `tests/tests.d.ts`.

Some fixtures have to be **real resources**, not stubs: a serial tour's step clock is
driven by its own media, so `tests/fixtures/tours.ts` carries `STEP_TONE_URI` — an 8s tone
as a small `data:` WAV — because a fake `.mp3` URL is a genuine load error, and a real
error (correctly) breaks the tour.

```
tests/
├── core/                    # project "core" — bare Node
│   ├── core/                # src/core: error, state, store, i18n/
│   ├── render/              # src/render: easing, mat, shared (view/coords/viewport)
│   └── utils/               # src/utils: archive, dataLoader, fetch, id, math, ...
└── browser/                 # project "browser" — Chromium
    ├── setup.ts             # vitest setupFiles: installs the fakes, imports src/main
    ├── textures.ts          # tile-worker fake (installed by setup.ts)
    ├── audio-context.ts     # AudioContext fake (installed by setup.ts)
    ├── book-helpers.ts      # the shared BookViewer harness (frame stepping, one GL context)
    ├── smoke.test.ts        # suite plumbing (the only test at the project root)
    ├── audio/  book/  core/  embed/  gallery/  grid/  layout/  markers/  media/
    ├── core/events/         # the interaction layer: drag, wheel, pinch, gesture, keyboard
    ├── render/              # the engine: canvas, camera-2d, engine-360, tile-image, postprocess
    ├── space/               # the 360 suites: camera, minimap, spaces, transitions
    ├── tour/  ui/  utils/
    ├── css/                 # project "css" — the same browser, real stylesheets
    │   ├── setup.ts         # viewport constants and `useViewport` (page.viewport + a restore)
    │   ├── helpers.ts       # the assertion vocabulary: computed style, boxes, hit tests, transitions
    │   └── smoke.test.ts    # that the stylesheets are really in the page
    └── live/                # opt-in network suite
```

`browser/space/` is the one feature directory without a 1:1 `src/` counterpart: the 360
suites span `render/camera-360`, `layout/nav/minimap`, `utils/space`, `core/state` and
`markers/waypoint`, so one home beats splitting them across four directories.
`browser/css/` is a _project_ boundary rather than a feature one — it is the only directory
whose files run with the stylesheet stub switched off — so the shared `setup.ts` still runs
first and it keeps the browser-suite fixtures it needs.

**Import convention.** Tests import production code through the `$` aliases — `$core/store`,
`$utils/dom`, `$types/models`, `await import('$book/main')` — so a test reads like the
source file it covers. Test support (fixtures, helpers, a sibling fake such as
`browser/audio-context.ts`, another test's helpers) stays relative. The one exception is
`tests/browser/setup.ts`, which keeps `../../src/main`: the aliases map directories, and
`src/main.ts` sits at the source root.

Every project's include glob (`tests/core/**/*.test.ts`, `tests/browser/**/*.test.ts`,
`tests/browser/css/**/*.test.ts`) is recursive, and `.oxlintrc.json`'s `tests/**/*.ts`
override matches nested paths, so neither `vitest.config.ts` nor the lint and type-check
config needed a change for the layout. The `css` glob is listed before the `browser` one on
purpose: a file under `css/` must not also be collected, with the stub on, by `browser`.

## Writing tests that have an edge

Every test should pin down something an implementer could plausibly get wrong. The
current suites are a good guide:

- **Boundaries, not the middle.** `mod(-1, 3) === 2`, `epsEq` exactly at its epsilon,
  `parseTime(NaN)`, the hour/day rollover in `fmt`.
- **Inverted or surprising conventions, asserted explicitly.** `directionY` in
  `getSpaceVector` is the _inverted_ Y delta; `Mat4._multiply(o)` applies `o` **first**;
  `data-ui="false"` sets `noUI: true`. Write the comment that explains _why_.
- **The failure path.** A missing bundle renders `micrio-error` and never rejects
  `open()`; a null WebGL context surfaces the unsupported-browser message; a failed
  fetch is not cached and is retried.
- **Re-entrancy and ordering.** Subscribing while being notified, unsubscribing from
  inside a callback, coalescing, next-frame deferral in `Frame`.
- **Round-trips and invariants.** `getXY`/`getCoo`, `Mat4` invert, `normalize3` length,
  view aspect ratio.
- **Prototype pollution and cycles.** `deepCopy` rejects `__proto__` and mirrors
  circular references instead of overflowing the stack.

Avoid writing a test that only restates the implementation, and avoid asserting on
large snapshots of internally-generated structures — they make refactors expensive and
catch little.

A test that pins a _known gap_ (a setting that is read nowhere, a path that degrades on
purpose) is fine, but say so in the test: when the gap closes, that test is the one that
has to change. The suite is meant to fail loudly rather than let the gap go unnoticed.

## Offline by default

The default run is fully hermetic:

- `tests/helpers/network.ts` patches `globalThis.fetch`, so every main-thread request
  (`bundle.json`, IIIF manifests, styles, scripts) is served from a fixture or a 404.
  `requested` lists the URLs a test actually asked for, which is how "no network at all"
  is asserted. `tests/browser/setup.ts` installs the patch with no routes in every
  `beforeEach` (unless `__MICRIO_LIVE__`), so a suite that forgets to mock still cannot
  reach the real network; `browser/smoke` pins that default.
- A 404 is the default for anything unmatched, which keeps leaks loud instead of silent.
- Anything that does **not** go through `fetch` needs its own fake: binary archives and
  album indexes (`src/utils/archive.ts` uses `XMLHttpRequest` — `stubArchiveXhr()`), and
  texture tiles (decoded in a dedicated Web Worker — `tests/browser/textures.ts`). The
  header of `helpers/network.ts` is the index of those bypasses.
- `fetchJson` caches parsed responses by URI in a module-level map, and the texture/archive
  fakes key their own state by id. **Every fixture that goes through the network needs a
  fresh id or URL**: a reused one serves the earlier test's data.

### The live suite

`tests/browser/live/**` is the only place real network and real pixel decoding are
exercised. It is skipped unless `MICRIO_LIVE=1` is set, which `vitest.config.ts` turns
into an injected `__MICRIO_LIVE__` flag:

```sh
MICRIO_LIVE=1 pnpm run test:browser:live
```

It covers one modern image (`rqFkjZz`) and one legacy v3.2 image (`dzzLm`, arguably the
best real fixture available: 41472×30219 with 25 markers, 6 video tours and 9 marker
tours).

## Test data: fixtures and ids

The builders live in `tests/fixtures/` and `tests/helpers/`. Each file documents its own
mechanics; this is the map:

| File                        | What it builds                                                                                                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fixtures/bundles.ts`       | bundle builders: a modern v5+ image with markers/tours, a legacy pre-v5 image, a two-waypoint 360 space, a swipe album, a book3d album, plus `bundleWithFreshId` (a plain 2D image with a new id per call) |
| `fixtures/space-fixture.ts` | the 360 harness: `freshSpace` (rewrites ids **and** waypoint link endpoints), `openSpace`, `openVisibleSpace`, plus optional markers/settings                                                              |
| `fixtures/tours.ts`         | video tours, marker tours, cross-image serial tours, the `JXflr`-shaped story bundle, a small WebVTT document                                                                                              |
| `fixtures/markers.ts`       | the marker harness: a fresh single-image bundle with prefixed, tour-remapped marker ids and `openMarkers` (layer/element accessors)                                                                        |
| `fixtures/grid.ts`          | a real packed grid album, the shared archive XHR stub, `gridImageId`                                                                                                                                       |
| `fixtures/book.ts`          | a packed book3d album (thumbnails **and** index) and `openBook`                                                                                                                                            |
| `fixtures/albums.ts`        | the swipe/switch/grid-config album harness (`albumFixture`/`mountAlbum`/`awaitAlbum`)                                                                                                                      |
| `fixtures/omni.ts`          | the omni (3D object) fixture and `openOmni`                                                                                                                                                                |
| `fixtures/ui.ts`            | the toolbar/menu/popover bundle, localised in every language under test                                                                                                                                    |
| `fixtures/embeds.ts`        | embed/video-asset builders and `embedBundle` (a 2D image whose `data.embeds` drives the layout layer)                                                                                                      |
| `helpers/viewer.ts`         | `mountViewer` and `waitFor`                                                                                                                                                                                |
| `helpers/network.ts`        | the `fetch` patch, `mockJson`/`mockText`, `requested`                                                                                                                                                      |
| `helpers/tour.ts`           | `mountTour`, `startTour`, `recordEvents`, `settle`, the fake-clock helpers                                                                                                                                 |
| `helpers/grid.ts`           | reading a printed grid layout (`cellButtons`, `layoutIds`, `focusCell`, `settleFrames`)                                                                                                                    |
| `helpers/media.ts`          | mounting a `micrio-media` and waiting for its figure                                                                                                                                                       |
| `helpers/embed.ts`          | the `micrio-embed` harness: `mockHost` (an id-less `<micr-io>`, so **no GL context**), `fakeImage`, `mountEmbed`, `dispatchChange`                                                                         |
| `browser/book-helpers.ts`   | the shared `BookViewer` harness; packs a tiny archive for its page ids (opt out with `_noArchive`)                                                                                                         |

Three rules apply to all of them:

- **Fresh ids for anything module-cached.** `DataLoader`'s bundle/space/album caches and
  the shared `jsonCache` are module-level and live for the whole test file, so a fixture
  that goes through the network path must generate new ids per call (the per-file base-36
  counters in `grid.ts`, `albums.ts`, `omni.ts` and `ui.ts` do this). `MicrioElement._markerImages`
  is the same kind of cache: it maps a marker id to its `MicrioImage` for the lifetime of
  the test file, so `markers.ts` prefixes every marker id per call.
- **Never give a fixture image a 7-character id.** `MicrioImage` decodes any non-IIIF
  7-character id as a v5 id (`src/utils/id.ts`), which reads `is360` and the tile format
  out of the id itself — so a random 7-character fixture id makes 2D tests randomly take
  the 360 branch.
- **Helper matchers take a `RegExp`, not a URL string** (`mockJson`, `mockText`,
  `bundleUrl`).

## Three traps that make the browser suite flake

These are the only cross-suite hazards; each harness documents its own use of them.

1. **Keep the number of live WebGL contexts tiny.** Chromium keeps only a small number
   and silently evicts the oldest, after which `getContext` falls back to software
   rendering: later frames crawl, animations never finish, and it looks like a logic bug.
   The book suites share one context for every mounted viewer
   (`browser/book-helpers.ts`); a suite that mounts one context per fixture ends up with
   its later tests stalled.
2. **`Frame` is a module singleton with no reset API.** A callback left pending keeps
   `rafId` set, and every later `Frame.request` waits on a frame that never comes. Anything
   that drives frames by hand must point it at a capture host (`Frame._setDisplay`) and run
   one tick per step, as `browser/book-helpers.ts` does.
3. **Stop a frame-driven object when you discard it.** `Frame` removes a callback only by
   running it, so a `BookViewer` left mid-animation stays queued for the rest of the file
   and every later frame re-runs its physics (and re-queues it). `BookViewer._stop()`
   cancels the pending frame; the gallery calls it before replacing a book, and the test
   harness calls it in `destroy()`.

## What the CSS suite pins

Until the `css` project existed, `vitest.config.ts` stubbed every `.css` import to `{}`, so
**no assertion in the suite observed a stylesheet** and a purely visual regression — a layout
rule lost in a refactor, a `display: none` that out-specifies another, a selector that is one
element too wide — passed everything green. That was not hypothetical. Every one of these
shipped and passed every test:

- the serial tour's readout vanished because three `display: contents` rules were dropped
  when the component's inline styles moved into a file (see [The serial tour](#the-serial-tour));
- the media controls' readout collapsed on each step change, because the rule that hid the
  media's own span out-specified the rule that replaced it;
- a marker popup's clickable image showed the browser's `buttonface` background: a bare
  `<button>` is not a `<micrio-button>`, so the nested-context strip never reached it;
- the fullscreen media bar sat below the viewport, because the media is stretched to
  `height: 100%` and the controls follow it in normal flow;
- the zoom buttons were visible but dead under a marker tour: one rule set
  `pointer-events: none` while a companion rule re-showed them.

`tests/browser/css/` now covers that ground, run through the same production entry point
with the stub off. It stays a **separate project** rather than a mode of the `browser` one
because real CSS changes the measured layout of every component: `micr-io` becomes
`position: relative; overflow: hidden`, 15 wrappers become `display: contents`, empty layers
become `display: none`, the canvas is pinned to the host with `!important`, and the 98
existing browser files lean on the stubbed geometry: with the switch on,
`camera-2d`'s scale brackets, `ui-primitives`'s "dial with no measurable width",
`input-integration`'s wheel zoom, `event-contract` and `grid-transitions` all fail — measured,
not assumed. Enabling it suite-wide would be a 98-file refactor for no test value; opt-in
keeps the old suites bit-for-bit the same.

**Viewports are runtime values, not projects.** `setup.ts` exports `DESKTOP` (1024×768, the
project default and the size every test file starts at), `MOBILE` (400×800 — below every
`max-width` branch that reshapes the layout) and `TABLET` (820×1180 — the band between the
640px branches and the desktop, which 1024 alone never separates from a rule that failed to
apply). `useViewport` calls the provider's `page.viewport()`, which resizes the real test
iframe, and an `afterEach` restores the default, because the viewport lives for a whole test
file. Every suite starts at `DESKTOP`, so a test that forgets to restore it would be visible
in the next one. A future tablet rule needs no new project — and if one ever needs a _pinned_
environment, `browserProject('css-tablet', TABLET, ['tests/browser/css/**/*.test.ts'])` plus
one script is the whole change.

**The assertion vocabulary** is deliberately four questions, in `helpers.ts`:

- _visibility_ — `rendered()` (does the element generate a box at all) and
  `intersectsViewport()` (is any of it on screen, which is how the mobile sheet's
  off-canvas position is asserted);
- _placement_ — `box()`, compared as numbers, never as CSSOM strings (`translateY(0)`
  reserializes to a matrix);
- _layering and interactivity_ — `topAt()`/`hitsAt()` over `document.elementFromPoint`.
  This is the only honest test of `z-index` and `pointer-events` together, and it is what
  pins "faded out _and_ out of the click path" rather than "faded out";
- _transitions_ — `waitForStyle()`, polling on `setTimeout` rather than `rAF` (Chromium
  throttles frames hard in the headless iframe, which made a 0.25s fade take many seconds
  of frames).

Two traps are specific to this suite. **Mount at `100vw`/`100vh`**: `micr-io` is
`container-type: size`, so an 800px element inside a 400px viewport reports 800px to any
container query. And **`page.elementLocator(…).hover()` is the one interaction to use** —
real pointer movement is what `:hover` needs, and Playwright's actionability check on an
element with `pointer-events: none` (or a disabled button) hangs until the test times out;
drive those with a dispatched event instead.

Not covered, on purpose: **pixel/screenshot regression** (`toMatchScreenshot` exists and
needs no new dependency, but its baselines are font- and platform-rendered and the repo has
no CI yet — add one only for a regression no property assertion can express), and
**`prefers-color-scheme`** (the provider exposes no `emulateMedia`, so a `data-auto-scheme`
test would assert the host machine's setting; `data-light-mode`, the attribute path, is
covered).

The five incidents above are now the suites' outline: `element-ui.test.ts` pins the
`display: contents` list and the hide block, `toolbar-responsive.test.ts` the 500/501
layout and the sheet's backdrop, `marker-layering.test.ts` the layer's click-through and a
covered marker, `panel-theming.test.ts` the palette and the popover breakpoints,
`smoke.test.ts` the plumbing itself (that the stylesheets are really in the page, so a
regression in the switch cannot silently turn every other file into a test of Chromium's
default styles).

A file's own stylesheet still belongs with its own tests where possible: a claim about
_state_ (a class, a store, an event) goes in the feature suite, which is why
`toolbar-mobile.test.ts` keeps asserting what the toolbar offers while this project asserts
where it lands.

## The embed subsystem

`src/embed/embed.ts` (`<micrio-embed>`), `src/embed/image-embeds.ts` (the per-image layer)
and `src/media/embedvideo.ts` (`GLEmbedVideo`) render an embed as an HTML overlay, as a
tiled sub-image inside the WebGL scene, or **both** (a GL image plus an interactive
overlay), in 2D, 360 and book3d geometry. The suites are `browser/embed/{embed,
embed-360, embed-book3d, image-embeds}` and `browser/media/embedvideo`.

Harness notes that are easy to get wrong:

- **`helpers/embed.ts` mounts against an id-less `<micr-io>`.** `_getMicrio()` only needs a
  `micrio` context, and an id-less element never calls `#print()`, so `embed.test.ts` runs
  with **no WebGL context at all**. `fakeImage()` mocks the exact `MicrioImage` surface the
  module touches (`camera.getMatrix`/`_getXYDirect`, `engine`, the stores, `addEmbed`, the
  media registry). The real-camera/real-engine paths live in the `embed-360` and
  `image-embeds` suites, which do open viewers.
- **Placement seams instead of geometry.** `camera._getMatrixOverride` and
  `_getXYDirectOverride` are the same seams `src/book/main.ts` installs, so stubbing them
  drives the 360/book3d matrix branch deterministically; `book3d` itself is simulated by
  setting `image.album.info.type` (the layout mounts no album).
- **The book3d 500 ms print delay is a real timer.** It is armed at mount and is the only
  thing that clears it; the unit suite mounts the embed _while_ fake timers are active, so
  `vi.advanceTimersByTime(500)` is exact. A test that mounts first cannot adopt the timer.
- **Never dispatch a real `click` on an `href` embed** — the overlay is an `<a>` and a
  synthetic click would navigate the test page. Drive the shared handler with `keydown`.

**Sub-image lifetime.** A WebGL sub-image is **claimed** by the `<micrio-embed>` using it.
Destroying the element orphans it — it stays on `image._embeds` (and fades out) so a rebuild or
a re-connect that mounts the same embed object can re-adopt it — and the next claim sweep
releases whatever is still unclaimed: `MicrioImage._releaseOrphans()` drops it from `_embeds`,
and `Engine._removeEmbed()` detaches its engine image, deletes its tile textures (base tile
included) and drops every lookup. The sweeps run from `MicrioEmbed._onMount` and from the
`micrio-image-embeds` rebuild, which is what stops a rebuild with fresh embed data from growing
`_embeds`. The harness `fakeImage` mirrors that claim API (orphan/adopt/release plus
`engine._removeEmbed`).

Also note: `getMatrix` hands back a **reused** `Float32Array`, and the CSSOM reserializes
`matrix3d(...)` to ~6 significant digits with spaces — compare numbers, never strings.

## The render engine

`src/render/` is the ported WebGL tile engine: the `Engine` controller, one `TileCanvas` per
placed image, the `Image` tile pyramid, a 2D and a 360 camera, an animation/kinetic pair, the
`PostProcessor`, and the geometry substrate in `shared.ts`. The suites are:

| Suite                        | Project | Covers                                                                                                            |
| ---------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `core/render/shared`         | core    | `View`, `Coordinates`, `Viewport`, `DrawRect` — the pure geometry the whole engine rests on                       |
| `browser/render/canvas`      | browser | the `Canvas` controller (place/hook/resize/crop/ratio/margins) and the `Engine` lifecycle & settings pass-through |
| `browser/render/camera-2d`   | browser | `Camera2D` and the shared `EngineCamera`: `_pan`/`_zoom`/`_pinch`/`setCoo`/`_flyTo`, the scale-limit predicates   |
| `browser/render/engine-360`  | browser | `Camera360` (rotate/zoom/limits/coordinates/view sync), the 360 `TileCanvas` facades, and `Kinetic`               |
| `browser/render/tile-image`  | browser | the tile pyramid, layer selection, `_getTiles` culling, and the 360 sphere sampler                                |
| `browser/render/postprocess` | browser | `PostProcessor` and the watermark/uniform paths of `WebGL`, with **no** viewer                                    |

Harness notes:

- **One GL context per file is the rule; `canvas` and `camera-2d` are the two exceptions.**
  Both mount a viewer _per test_ because each assertion needs a clean camera (scale, limits and
  any armed animation all leak between calls), and resetting a live engine by hand is more
  fragile than one more context. Those two files together are still only a handful of contexts.
  `engine-360` and `tile-image` follow the rule with one viewer each per describe block.
- **`postprocess` needs no viewer at all.** `PostProcessor` takes a WebGL context as an
  argument, and the element it is handed is only used for its pure `_getShader` compiler — so
  the suite calls `micrio._webgl._init()` on an id-less `<micr-io>` and then keeps _that one_
  context for the whole file, asserting with `gl.isTexture`/`isFramebuffer`/`isProgram` rather
  than pixels.
- **Two different `_canvases` arrays exist.** `viewer.el._canvases` is the element's list of
  loaded `MicrioImage`s; `viewer.el._engine._canvases` is the engine's list of `TileCanvas`
  instances, and the canvas is what knows which image it was built for (`canvas._micrioImage`).
  Most render tests want the engine's list.
- **The placed image is not always `micrio.$current`.** A grid/gallery parent owns its own
  `MicrioImage` per id, so anything that walks the engine's per-image maps (fades, removal,
  embedding) has to use `canvas._micrioImage` — see `placedImage()` in `canvas.test.ts`.
- **`_getCoo` hands back one reused `Coordinates` and `View.arr` one reused `Float64Array`.**
  Capture the scalars you need before the next call, exactly as with `getMatrix`.
- **Some engine state is written by the frame loop, not by the call under test.** `TileCanvas`
  resets the current image's opacity/target during its first frame, so `tile-image.test.ts`
  waits one turn of the event loop after opening before poking an `Image` — otherwise the next
  frame overwrites the value.

Three state machines are pinned directly:

1. **The tile load state** (`TileEntry._loadState`, 0 → 1 → 2 → 3) and the cleanup that
   evicts a tile once it has been off-screen for `_deleteAfterSeconds`.
2. **The camera limit/scale state** — `coverLimit` vs `freeMove`, `_minScale`/`_maxScale`,
   `_minSize` and the over-zoom correction in `View._limit`.
3. **`Ani`'s `_flying`/`_limit`/`_correcting` flags**, which decide whether a view write is
   clamped while an animation is running.

**`tile-image.ts` (94.2%)**. Its 360-embed culling — `#getTilesViewport`, `#getEmbeddedScale`
and `_setDrawRect` — is pinned by a hand-built frustum in `tile-image.test.ts`
(`browser/render/tile-image.test.ts`, "360 embeds on a placed canvas"): one shared 360 viewer
carrying one embed placed through `image.addEmbed()`, with `_cameraForward*`/`_fieldOfView` set
directly to put it in or out of view. The `#getEmbeddedScale` non-360 half and
`#getTilesViewport`'s `!c.is360` half were deleted rather than tested: both are unreachable,
because `#is360Embed` is written once in the constructor and is the only gate on either call.
The archive/`fromScale` layer-count variants are covered through the engine's `_hasArchive`
flag and an explicit `fromScale`. What remains is defensive: `#get360Tiles`' `m < 2` and
zero-max-gap guards, which only a degenerate projection could reach.
**`ani.ts` (77.5%)**: the uncovered half is the jump-transition edge flags (`#fL/#fR/#fT/#fB`)
and the omni index wrap, both of which need a crafted from/to view pair rather than a real
navigation, and that one is noted in the backlog rather than faked.

## The grid transitions and input layer

`browser/grid/grid-transitions.test.ts` covers `src/grid/transitions.ts` and
`src/grid/keyboard.ts` — the layout transitions and the keyboard/tap input layer — together
with the marker/tour action dispatcher in `action-handlers.ts`.

- **`gridFocus` never reaches `setupBehindTransition`.** Only
  `grid.set(..., { transition: 'behind' | 'behind-delayed' })` does, and the stacking it applies
  is overwritten once the layout settles — so that helper is asserted directly, with a real grid.
  `behind-left` is a `MarkerFocusTransition`, not a `GridSetTransition`: only the plain `behind`
  name survives `set()`'s narrowing.
- **The blur runs under fake timers.** A focus with `blur: N` writes inline
  `filter`/`transition` styles and clears them through two nested `setTimeout`s. Mount and open
  with real timers first (`waitFor` polls on rAF, which a faked clock never advances), then
  switch. The blur branch is also only reachable for a **non-crossfade** transition: a
  crossfade returns from `transition()` before it, and so does a `view` handed in with
  `noViewAni` set.
- **`hookGridKeys` attaches the cell-tap listeners only for `panZoom === 'grid'` with a truthy
  `clickable`.** There is no public API for "arrow key" or "tap", so both are dispatched as real
  events; the tap path destructures `const [vx, vy] = gridImage.camera.getCoo(...)`, so a stub
  of that camera method has to be iterable.
- **This fixture lays every cell out in one row** (all areas share a `y`), which is why the
  vertical arrow keys are asserted through their wrap-around fallback rather than a row change.
- **`flyTo` validates its ids.** An id that is not part of the current layout is dropped before
  the bounding box is computed, so naming none of them warns (`console.warn('Given image IDs gave
no current displayed images')`) and leaves the view alone instead of flying to the full image.
  Both routes are pinned: a string list (including `''`) in `grid-transitions.test.ts`, and the
  payload-less `grid:flyTo` tour event in `grid-tour-events.test.ts` ("warns and stays put").

## The interaction layer (`src/core/events`)

`src/core/events` is the input layer for the 2D/360 viewer: `facade.ts` (the `Events`
controller) plus one module per input kind. The suites are
`browser/core/events/{drag, wheel, pinch, pointer-pinch, gesture, keyboard, doubletap, contextmenu-copy, facade}`
and the real-viewer `input-integration`.

- **The handlers are tested against a hand-built `EventContext`, not a `<micr-io>`.** Every
  handler only needs the `EventContext` interface (`shared.ts`), so `event-fixture.ts` builds
  a real wrapper `<div>` (the `_micrio` role) containing a real `<canvas>` (`_el`), with
  recording camera/engine/canvas fakes and the real `writable` stores. That keeps the suites
  GL-free and lets each settings variation get a fresh `Events` instance (`#settings` is
  captured once from the first truthy `current`).
- **Dispatch on `_el`, never on `_micrio`.** The drag, wheel, pinch, pointer-pinch and
  gesture handlers listen on `_micrio` but reject an event whose `target` is not `_el` (or a
  `[data-scroll-through]` descendant), so a test that dispatches on the wrapper silently
  tests the rejection path. The fixture nests the canvas for exactly this reason.
- **`Browser` is a plain object of data properties**, so `stubBrowser({ iOS, OSX, firefox,
hasTouch })` assigns and restores; no device is emulated. The iOS touch pinch and the macOS
  gesture handlers are only attached under those flags, but their public `start`/`stop` are
  also driven directly for the guard branches.
- **Coordinates handed to the camera are element-relative CSS pixels, independent of the
  device pixel ratio.** `wheel.test.ts` and the integration suite assert the same anchor at
  ratio 1 and 2, and that a screen point round-trips through image coordinates at both. The
  integration suite changes the ratio through the real `Canvas.onresize()` path, so the engine
  viewport and buffer size move with it.
- **The integration suite keeps one `<micr-io>` for the whole file** (WebGL budget).
  `setup.ts` empties `<body>` before every test, so each `beforeEach` re-appends the element,
  which also exercises disconnect/reconnect on every test.
- `wheel.ts`'s `wheelend` debounce is driven with fake timers; everything else uses real
  timers.

## Book input

`src/book/input/input.ts` (`InputHandler`) is the book's pointer state machine: orbit vs pan,
page drag vs page click, two-pointer pinch and the wheel hit point. The suite is
`browser/book/input.test.ts`.

- **No `BookViewer` and no WebGL.** The handler takes `(canvas, camera, onActivity)`
  directly; the camera is a recording fake with `_pan`/`_rotate`/`_zoom`/`_isZoomedIn` and
  `_freeCamMode`, and the canvas is a plain element with a stubbed
  `getBoundingClientRect()` at a non-zero origin (so a coordinate-space bug shows up).
- **The handler works in CSS pixels from the canvas element** (`clientX − rect.left`) while
  the renderer's backing buffer is DPR-scaled. The retina cases scale `canvas.width/height` to
  2× and assert the wheel point and drag deltas are unchanged.
- The viewer-level wiring (a touch tap turns a page, a two-finger pinch zooms, a DPR-2 buffer
  picks the same page) lives in `browser/book/viewer.test.ts`, using its shared frame-stepping
  harness. Setting `devicePixelRatio` and dispatching `resize` is what runs the real
  `PaperRenderer._resize()`.
- `InputHandler` has no teardown, so each test builds one with unique pointer ids; the stale
  global listeners see no matching pointer and no-op.

## The markers subsystem

`src/markers/` is a layer element plus three children, and the suites are named after them:
`browser/markers/{markers, marker-render, marker-actions, marker-popup, marker-content,
marker-cluster, marker-autotour, marker-split}` (plus `markers-grid` for the layer's grid
`inactive` path and `waypoints` for the 360 links).

- `markers.ts` (`<micrio-markers>`) is mounted by the layout once per **visible** image
  that has markers or a 360 space. It filters markers by the active language, injects each
  marker's `clickableArea` as a `<micrio-embed>` _before_ the marker elements, syncs the 360
  waypoints, and runs the clustering pass.
- `marker.ts` (`<micrio-marker>`) is the dot: icons, labels and tooltips from the marker's
  `i18n`, its own click/focus handling, and the whole open/close state machine (camera view,
  popup, popover, video tour, `micrioLink`, `micrioSplitLink`, auto-starting a marker tour).
- `marker-popup.ts` (`<micrio-marker-popup>`) is created by the layout from
  `micrio.state.popup`; a marker **popover** is a `state.popover` mode rendered by
  `layout/popover.ts` instead.
- `marker-content.ts` (`<micrio-marker-content>`) renders the culture data (title, bodies,
  media, embed, images); both the popup and the popover mount it.

Harness notes:

- **`MicrioElement._markerImages` is a module-level map keyed by marker id and never
  cleared.** `marker-content` and `marker-popup` resolve their image through it, so a
  reused marker id hands a later test the image of a viewer that was destroyed earlier.
  `fixtures/markers.ts` prefixes every marker id per call and remaps the marker tours'
  `steps` and `stepInfo` (including `micrioId`, so a single-image tour does not try to open
  the tours fixture's placeholder image).
- **Wait for the layer, not for marker elements.** A fixture whose markers are all filtered
  out by the active language still mounts `<micrio-markers>` and has no marker elements;
  `openMarkers` waits for the layer for exactly that reason.
- **A marker element is mounted against a real viewer** (the layer only exists inside
  `<micr-io>`), while the popup and content elements are mounted by the layout and by their
  parent — so the suites drive _state_ (`state.marker`, `state.popup`) rather than creating
  the elements by hand.
- **The popup animates out on its own.** Clearing `state.popup` does not remove the element:
  its own subscription adds `destroying` and a `transitionend` on itself is what removes it.

The layer's grid `inactive` path — a cell that is not focused drops its markers, waypoints and
clickable-area embeds — is pinned by `browser/markers/markers-grid.test.ts`. Reaching it offline
needs a _hand-built visible cell_: the layout only mounts a layer for an image in
`micrio._visible`, and a cell never gets there on its own because its canvas keeps a zero-size
visible rect (`helpers/grid.ts` documents why). The suite therefore calls
`cell.visible.set(true)` and then focuses the cell, which proves the `inactive` term is what
suppressed the markers rather than missing data. Note that `Grid._markersShown` is written
nowhere in `src` today, so the `indexOf` term of `inactive` is currently constant and `$focussed`
is the real discriminator.

### Markers, settings and clustering

The layer is the only part of the subsystem that reacts to the settings store
(`_watchLater(image._settings, rebuild)`); element-level settings (`preventAutoPlay`) are
read when a marker is built or repositioned, i.e. at load time. A marker's size and colour
come from CSS only — the dashboard-era `_markers.markerSize`, `markerColor` and
`viewportIsMarker` are ignored (the old image data still carries them).

- **Clustering** groups pairs closer than `_markers.clusterMarkerRadius` (top-level
  `clusterMarkerRadius`, default 24 px) in screen space. Either member of a pair can opt
  out with the `no-cluster` tag, and a pair that bridges two existing groups merges them.
  The synthetic `<micrio-marker class="cluster">` carries its member count as the button's
  text and its `data-marker-id` is the joined member _indices_ (`"0,1"`). Turning
  `clusterMarkers` off removes the clusters and restores the markers. An edited marker
  (same id, new object) and its clickable area are re-rendered, since `rebuild` compares
  the marker object each element was built from.
- **`embedsInHtml`** forces the HTML render path for the embeds that carry a `marker`
  (the clickable areas); the image's own embeds and `data-embeds-inside-gl` keep their
  behaviour.
- **Hiding during tours**: a running tour hides the layer unless the video tour sets
  `keepMarkers`. Video tours hide by default; a marker tour hides only with
  `hideMarkersDuringTour`, because its steps are usually the point of it. The layer stays
  mounted, so a step's popup still opens.
- **`keepPopupsDuringTourTransitions`** skips clearing `state.popup` when a marker tour
  moves from one step to the next; every other close (last step, tour stopped, unrelated
  marker) still clears it.
- **`tourStepCounterInPopup`** renders `currentStep+1/steps.length` in the popup's own
  aside (not in `tourControlsInPopup` mode, where the tour's aside already shows it). The
  counter is fresh per step because the layout replaces the popup; two consecutive steps
  that share a marker id would not update it.

## The serial tour

`<micrio-serial-tour>` is the multi-image marker tour (`isSerialTour`). Its step clock and
its control bar are the two places that are easy to get wrong, and the suite pins both
(`tests/browser/tour/serial-tour.test.ts`).

**Who owns what**

- The **clock** is the tour's (a 250ms `#tick`). Advancement is never a timeout:
  - a step **with media** is released by that media's own `ended` (`micrio-media`
    dispatches `ended`/`timeupdate`/`blocked`/`error` on _itself_, so the tour subscribes by
    event and never queries for a `video`/`audio` tag — a YouTube/Vimeo/HLS tour has none);
  - a step whose media **never started** (still loading, or autoplay blocked) holds the clock
    at 0 and waits. There is deliberately no grace period: a step is not skipped over
    unheard;
  - a step with **no media at all** is timed by its authored `stepInfo` duration.
- The **control bar** is the media element's (`figure` is the bar, fixed to the bottom).
  The tour injects one `[data-part="bar"]` per step into its `aside > div`.
- The **time readout** is that bar's own `<span>` — `micrio-media-controls aside > div > span`
  — fed by the tour's `getTimeDisplay`. It is not a span of the tour's own: the host is
  `display: contents` (so the media figure _is_ the bar), which leaves it with no box to
  position a child in. `media.ts` primes the controls the moment it creates them, so the
  readout is filled on the first frame rather than at the first `loadedmetadata`/`timeupdate`
  — an empty readout collapses, and the bar then takes its space.

**Failures are not papered over**

- A media **error** (404, timeout, decode failure, unplayable source) breaks the tour:
  `#break()` stops it, clears `state.tour`, leaves the viewer on the failing step, and
  reports through `media-error` naming the step (`step 1/2 (markerId) could not be played: …`).
- **Blocked autoplay** is not an error: the step latches paused and waits for the user to
  press play (`media-blocked`).
- `media.ts` reports what happened — `describeMediaError()` turns `MediaError` into a
  sentence, adapter `onError` is forwarded on the YouTube/Vimeo/HLS paths, and initialisation
  rejections and a rejected user-initiated `play()` are reported instead of swallowed.

The readout is also the example that matters most from [What the suite cannot
see](#what-the-suite-cannot-see-stylesheets): nothing here could have caught it, because no
assertion observes a stylesheet.

## Coverage

`pnpm test:coverage` runs the `core` and `browser` projects under `@vitest/coverage-v8`
and merges them into one report. The `css` project is left out: enabling its stylesheets
for a whole run breaks five existing `browser` assertions (see
[What the CSS suite pins](#what-the-css-suite-pins)), so a stylesheet suite that also
carried the coverage gate would make the gate unusable. Its files exercise the same
modules the `browser` suites already cover, so nothing measurable is lost. It measures all of `src/**/*.ts` — a file no test ever imports still
shows up as 0%, rather than dropping out of the report.

Coverage is a **whole-tree** number: the floors are checked against the merged report.
The core project only reaches ~7% on its own (bare Node never imports render, gallery,
book or the element), so `vitest run --project core --coverage` trips every threshold by
design — use it to inspect one project, not to gate.

Baseline (steady to a couple of tenths across runs — a few render branches only run on
some timing paths):

| Metric     | Baseline | Floor |
| ---------- | -------- | ----- |
| Statements | 90.5     | 89    |
| Branches   | 81.6     | 81    |
| Functions  | 89.1     | 89    |
| Lines      | 90.4     | 89    |

The floors live in `vitest.config.ts` (`89/81/89/89`) and sit a point or two under the
baseline, so a real coverage loss fails the run while ordinary refactoring does not. Branch
coverage sits closest to its floor (81.58 against 81), and functions are a tenth away
(89.14 against 89) after the code-hardening pass: a branch-heavy change — a new conditional
in a large file — can trip these **without any test failing**, so run `pnpm test:coverage`
before assuming a green `pnpm test` is the whole story. They are deliberately
coarse and global: per-file thresholds would fail outright on the large parts of the
tree that are intentionally at 0%.

Read the number as "this code ran", not "this code is pinned". v8 counts a module as
covered the moment it executes, and every browser suite loads the production entry
(`setup.ts` imports `src/main`), so a component that merely mounts with the element — the
toolbar, a swipe gallery, a media control — scores high with no assertion about it at all:
63 of the 124 files in the report score above zero without a test ever naming the module.
The suites above remain the source of truth for what is actually asserted.

Statement coverage per area. These are the rows `vitest` itself prints: a row covers the
files that sit **directly** in that directory, so `src/core` and `src/core/events` (and
`src/layout` / `src/layout/nav`) are separate rows. A _subtree_ figure has to be read off the
child rows — `src/core` is 81.9% for its own files, and 87.6% once `src/core/events` (100%)
and `src/core/i18n` are folded in.

| Area              | Stmts | Covered   |
| ----------------- | ----- | --------- |
| src/core/events   | 100.0 | 483/483   |
| src/book/input    | 100.0 | 143/143   |
| src/book/geometry | 99.2  | 254/256   |
| src/book/core     | 97.6  | 123/126   |
| src/book/physics  | 96.8  | 149/154   |
| src/utils         | 96.5  | 361/374   |
| src/core/i18n     | 95.5  | 21/22     |
| src/embed         | 93.5  | 346/370   |
| src/ui            | 93.4  | 142/152   |
| src/markers       | 93.3  | 738/791   |
| src/render        | 92.7  | 2898/3124 |
| src/grid          | 90.5  | 618/683   |
| src/gallery       | 90.2  | 899/997   |
| src/audio         | 88.2  | 217/246   |
| src/tour          | 86.2  | 241/279   |
| src/layout        | 86.3  | 588/681   |
| src/media         | 87.1  | 873/1003  |
| src/book          | 84.8  | 673/794   |
| src/layout/nav    | 82.9  | 261/315   |
| src/core          | 82.0  | 888/1083  |

The thin spots now start at **`src/core` (82.0%, mostly `camera.ts` and `image.ts`)**,
`src/layout/nav` (82.9%) and `src/book` (84.8%), with `src/media` (87.1%) just behind: its
adapters run under their own suites, and `media.ts` is at 79.9% because the YouTube/Vimeo/HLS
paths need stubbed third-party APIs. The serial tour's own file is at 82.8% after the
clock/readout/failure work. These are remaining thin spots rather than the floor, and they
are deliberately _not_ a backlog list — the backlog below holds only the CI item. To raise the
floor, run `pnpm test:coverage`, move the baseline to the new number, and keep the floors a
point or two under it.

`pnpm test`, `test:core` and `test:browser` collect no coverage, so the normal loop
pays nothing for it.

## Type checking and linting

- `pnpm typecheck` type-checks `src`, `build`, `templates` with `tsconfig.json`.
- `tsconfig.tests.json` covers `tests/**`, `vitest.config.ts` and the shared
  `vite.config.js` (hence `allowJs`), adding `types: ["node"]` and the DOM lib. Run it
  directly with `pnpm exec tsc -p tsconfig.tests.json --noEmit`.
- `pnpm lint` (oxlint, type-aware) lints the tests too. `.oxlintrc.json` disables the
  type-aware rules **for `tests/**` and `vitest.config.ts` only**: oxlint's TS program
  does not resolve types across `$`-aliased imports for out-of-program test files, so
  every access degrades to an `error` type and the `no-unsafe-*` family reports
  noise. All non-type-aware rules (correctness, suspicious, perf, the unicorn/style
  picks) still apply to tests. Type safety for tests comes from `tsc`, which does resolve
  the aliases.
- `pnpm format:check` must stay clean; run `pnpm format` after adding tests.
- `pnpm build` does not run the test suites: it stays a fast release gate.

## Status

Last full check: **1767 tests in 120 files pass** (`pnpm test`, the `core` + `browser`
projects), **plus 35 in 5 files in the separate `css` run** (`pnpm test:css`), coverage
`90.5 / 81.6 / 89.1 / 90.4` (statements / branches / functions / lines, floors
`89 / 81 / 89 / 89`), and `tsc` (both projects), `oxlint --type-aware` and
`oxfmt --check` are clean.

| Area                                                | Suite                                                                            | Status |
| --------------------------------------------------- | -------------------------------------------------------------------------------- | ------ |
| Math, ids, time, locale, easing                     | `tests/core/**/*.test.ts`                                                        | done   |
| Store API, state controllers                        | `tests/core/core/store`, `state`                                                 | done   |
| bundle.json loading and caching                     | `tests/core/utils/dataLoader`                                                    | done   |
| MDP archive parsing                                 | `tests/core/utils/archive`                                                       | done   |
| Matrix/vector math                                  | `tests/core/render/mat`                                                          | done   |
| View / Coordinates / Viewport geometry              | `tests/core/render/shared`                                                       | done   |
| `Canvas` controller and `Engine` lifecycle          | `tests/browser/render/canvas`                                                    | done   |
| 2D camera (`_pan`/`_zoom`/pinch/`setCoo`)           | `tests/browser/render/camera-2d`                                                 | done   |
| 360 camera, 360 canvas facades, kinetic drag        | `tests/browser/render/engine-360`                                                | done   |
| Tile pyramid, layer selection, tile culling         | `tests/browser/render/tile-image`                                                | done   |
| Postprocessor and WebGL watermark                   | `tests/browser/render/postprocess`                                               | done   |
| Legacy (pre-v5) vs v5+ bundles                      | `tests/browser/core/element-legacy`                                              | done   |
| `<micr-io>` open / events / attributes / reconnect  | `tests/browser/core/element-*`                                                   | done   |
| Marker layer, filter, settings, clickable areas     | `tests/browser/markers/markers`                                                  | done   |
| Grid cell markers (inactive, then focused)          | `tests/browser/markers/markers-grid`                                             | done   |
| Marker icons, labels, scaling, viewport sizing      | `tests/browser/markers/marker-render`                                            | done   |
| Marker clicks, events, links, tour interaction      | `tests/browser/markers/marker-actions`                                           | done   |
| Marker popup, minimize, tour controls               | `tests/browser/markers/marker-popup`                                             | done   |
| Marker content, media, embeds, image gallery        | `tests/browser/markers/marker-content`                                           | done   |
| Marker clustering                                   | `tests/browser/markers/marker-cluster`                                           | done   |
| Auto-starting a marker tour                         | `tests/browser/markers/marker-autotour`                                          | done   |
| Marker split-screen links                           | `tests/browser/markers/marker-split`                                             | done   |
| 360 space resolution and navigation                 | `tests/browser/space/tours-360`                                                  | done   |
| 360 camera (yaw/pitch, transforms, matrix)          | `tests/browser/space/camera-360`                                                 | done   |
| `trueNorth` and image orientation                   | `tests/browser/space/space-truenorth`                                            | done   |
| 360 waypoints (`<micrio-waypoint>`)                 | `tests/browser/markers/waypoints`                                                | done   |
| 360 space transitions                               | `tests/browser/space/space-transition`                                           | done   |
| 360 minimap                                         | `tests/browser/space/minimap-360`                                                | done   |
| Album resolution, config, sorting and degradation   | `tests/browser/gallery/gallery-album`                                            | done   |
| Swipe album and strip navigation                    | `tests/browser/gallery/gallery-swipe`                                            | done   |
| Gallery scrubber (pointer, touch, ticks, teardown)  | `tests/browser/gallery/gallery-scrubber`                                         | done   |
| Switch album layout and navigation                  | `tests/browser/gallery/gallery-switch`                                           | done   |
| IIIF (Presentation 2/3/4) and Image API info.json   | `tests/browser/gallery/gallery-iiif`                                             | done   |
| Live IIIF manifests and their Image API tiles       | `tests/browser/live/iiif`                                                        | opt-in |
| Asset galleries (`micrio-swipe-gallery`)            | `tests/browser/gallery/gallery-assets`                                           | done   |
| Album bundle without a gallery controller           | `tests/browser/gallery/gallery`                                                  | done   |
| Omni rotation, layers, dial and swipe               | `tests/browser/gallery/omni-viewer`                                              | done   |
| Omni markers and marker tours                       | `tests/browser/gallery/omni-markers`                                             | done   |
| Omni camera angle maths                             | `tests/core/core/camera-omni`                                                    | done   |
| Video tour timeline and playback                    | `tests/browser/media/video-tour`                                                 | done   |
| Marker tour UI and navigation                       | `tests/browser/tour/marker-tour`                                                 | done   |
| Serial (multi-image) tours                          | `tests/browser/tour/serial-tour`                                                 | done   |
| Media element, controls, subtitles                  | `tests/browser/media/media-*`, `subtitles`                                       | done   |
| Tour toolbar and autostart wiring                   | `tests/browser/tour/tour-integration`                                            | done   |
| Audio controller (Web Audio, positional)            | `tests/browser/audio/audio-controller`                                           | done   |
| Audio level settings (`startVolume`/`mutedVolume`)  | `tests/core/utils/media-settings`                                                | done   |
| Spatial audio routing                               | `tests/browser/audio/audio-location`                                             | done   |
| Media adapters (HTML5/YouTube/Vimeo/HLS)            | `tests/browser/media/*-adapter`, `hls-player`                                    | done   |
| Adapter selection and wiring in `<micrio-media>`    | `tests/browser/media/media-adapters`                                             | done   |
| Grid column maths and transition areas              | `tests/browser/grid/grid-format`                                                 | done   |
| Grid storytelling                                   | `tests/browser/grid/grid-{layout,focus,history,tour-events,actions,integration}` | done   |
| Grid transitions, keyboard and tap input            | `tests/browser/grid/grid-transitions`                                            | done   |
| Book maths (vec3, page layout, spine sync)          | `tests/core/book/{vec3,layout,spine-sync}`                                       | done   |
| XPBD physics solver                                 | `tests/core/book/native-solver`                                                  | done   |
| Book meshes, uv projection, raycasting              | `tests/browser/book/{meshes,uv-project,raycast}`                                 | done   |
| Book camera, page flip, lighting presets            | `tests/browser/book/{orbit-camera,page-flip,lighting}`                           | done   |
| Book renderer and IIIF texture manager              | `tests/browser/book/{renderer,iiif-manager}`                                     | done   |
| `BookViewer` (flips, drags, zoom, draw bounds)      | `tests/browser/book/viewer`                                                      | done   |
| book3d album path and the book fixture              | `tests/browser/gallery/book3d-album`                                             | done   |
| Wheel, drag, pinch, gesture, keyboard, context menu | `tests/browser/core/events/*`                                                    | done   |
| Real-viewer input end to end, and retina DPR        | `tests/browser/core/events/input-integration`                                    | done   |
| Book input (pan/orbit/pinch/click/wheel, retina)    | `tests/browser/book/input`                                                       | done   |
| UI translation tables                               | `tests/core/core/i18n/i18n-strings`                                              | done   |
| Buttons, icons, progress circle, dial               | `tests/browser/ui/ui-button`, `ui-primitives`                                    | done   |
| Menu tree and its actions                           | `tests/browser/ui/ui-menu`                                                       | done   |
| Toolbar (desktop + mobile sheet) and controls       | `tests/browser/layout/{toolbar-*,controls}`                                      | done   |
| Content-page popover and welcome screen             | `tests/browser/layout/popover`                                                   | done   |
| Image/video/iframe embeds, 2D HTML + WebGL          | `tests/browser/embed/embed`                                                      | done   |
| 360 embed placement (`matrix3d`, π/2 scale)         | `tests/browser/embed/embed-360`                                                  | done   |
| book3d embed placement and the print delay          | `tests/browser/embed/embed-book3d`                                               | done   |
| `<micrio-image-embeds>` container and layout wiring | `tests/browser/embed/image-embeds`                                               | done   |
| GL embed video (HLS, loop, visibility, teardown)    | `tests/browser/media/embedvideo`                                                 | done   |
| Stylesheet plumbing, the real-CSS switch            | `tests/browser/css/smoke`                                                        | done   |
| Toolbar layout and the mobile sheet (500/501)       | `tests/browser/css/toolbar-responsive`                                           | done   |
| `display:contents`, the idle hide block, canvas pin | `tests/browser/css/element-ui`                                                   | done   |
| Marker layering, click-through and hidden markers   | `tests/browser/css/marker-layering`                                              | done   |
| Light palette and the popover breakpoints (tablet)  | `tests/browser/css/panel-theming`                                                | done   |

## Session backlog

1. **CI** — a GitHub Actions workflow that installs the Playwright browser and runs
   `test:core` + `test:browser` + `test:css`.
