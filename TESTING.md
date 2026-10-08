# Unit testing the Micrio Client

The plan of record for the unit test suites: what exists, how to run and extend it, and
what is deliberately still missing. Per-fixture and per-suite implementation notes live
**next to the code they describe** (a fixture header, the suite that pins the behaviour),
not here.

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

Requirements: Node `^20.19.0 || >=22.12.0`, and the Chromium build the installed `playwright`
expects. `^1.59.0` can resolve a newer minor whose revision is **not** in
`~/.cache/ms-playwright`; if a browser run fails with `Executable doesn't exist at
…/chrome-headless-shell`, run `pnpm exec playwright install chromium`.

Failure screenshots and `context.annotate` attachments land in `.vitest/` (gitignored);
`vitest.config.ts` clears that directory per run, so what is there belongs to the run you
just did. The stylesheet suite's `render-proof/` images are deliberately kept between runs.

### What a clean run still prints on stderr

A green `pnpm test` is not silent: the suites that pin a **failure** path drive the client
into it and the browser forwards its log. Each remaining line belongs to a test that asserts
the state that failure leaves behind:

- `Warning: unknown grid tour event …` — the dispatcher's unknown-action branch
  (`grid-transitions` asserts the text, `grid-tour-events` only the unchanged layout).
- `[Micrio] Could not open the album for …` — album degradation (`brokenArchive`,
  `missingIndex`); the trailing value is the **stubbed** archive request's rejection, never a
  download (see [Offline by default](#offline-by-default)).
- `Error: Only IIIF Presentation API 3 …`, `No valid IIIF canvases …`, `Not a valid IIIF
manifest …` — the IIIF "unsupported input" cases, each asserting its exact message.
- `Error: Image with id "…" not found …`, the WebGL-unsupported message — `element-errors`,
  asserting the `micrio-error` text and that `open()` never rejects.
- `[Micrio] Media failed (E303): …` then `[Micrio] Serial tour stopped: step 1/2 …` —
  `serial-tour`'s failure case (it drives the media's own `error` event). One pair per run:
  `#break()` is single-shot.

Anything else is a real finding. An unhandled **`PromiseRejectionEvent { isTrusted: true }`**
(a fire-and-forget camera/grid animation) has been a regression before, and Chromium's
**`ResizeObserver loop completed with undelivered notifications`** is stubbed-geometry only
and filtered by `tests/browser/setup.ts`.

## The projects

`vitest.config.ts` defines the test projects below. The `core` and `browser` ones are
separate processes with separate configs, so a core test can never accidentally depend on a
browser; `css` is a separate _run_ of the browser project (see its row).

| Project   | Environment       | Include glob                     | Purpose                                                                             |
| --------- | ----------------- | -------------------------------- | ----------------------------------------------------------------------------------- |
| `core`    | Node (no DOM)     | `tests/core/**/*.test.ts`        | Pure logic: math, parsing, state, data loading, matrix math                         |
| `browser` | Chromium headless | `tests/browser/**/*.test.ts`     | Anything needing a DOM, layout, WebGL or the `<micr-io>` element                    |
| `css`     | Chromium headless | `tests/browser/css/**/*.test.ts` | The same, with the real stylesheets: placement, visibility, layering, interactivity |

Every project shares the alias map and the GLSL plugin with the production build:
`vite.config.js` exports `aliases` and `glslMinifyPlugin()`, and `vitest.config.ts`
imports them. So `$core/...`, `$utils/...`, `$render/...` resolve in tests exactly like
they do in the app, `templates/grid/**` included.

The browser suite is registered through the production entry point (`src/main.ts`), so
`customElements.define('micr-io', ...)` and the version banner behave exactly like a
real page.

`css` is the same browser and entry point with `vitest.config.ts`'s stub off
(`MICRIO_TEST_CSS=1`, set only by `test:css`); it is listed as a project only when that flag
is on, and `browser` excludes its directory. See
[What the CSS suite pins](#what-the-css-suite-pins).

### Test layout

Tests are grouped in the directory of the module they pin, mirroring `src/`. The shared
harness stays at `tests/`: `fixtures/` (bundle, space, tour, grid, album, book, omni and UI
data builders), `helpers/` (mount, wait, network, tour, grid) and the ambient
`tests/tests.d.ts`. One fixture is deliberately a **real resource**: `tours.ts`'s
`STEP_TONE_URI` is an 8s `data:` WAV, because a fake `.mp3` URL is a genuine load error and a
real error (correctly) breaks the tour.

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

`browser/space/` is the one feature directory without a 1:1 `src/` counterpart (the 360
suites span `render/camera-360`, `layout/nav/minimap`, `utils/space`, `core/state`,
`markers/waypoint`); `browser/css/` is a _project_ boundary, not a feature one — it runs
`setup.ts` first and keeps the browser fixtures.

**Import convention.** Production code is imported through the `$` aliases (`$core/store`,
`$utils/dom`, `$types/models`, `await import('$book/main')`), so a test reads like the file it
covers; test support stays relative. The one exception is `tests/browser/setup.ts`, which
keeps `../../src/main` — the aliases map directories and `src/main.ts` sits at the root.

## Writing tests that have an edge

Every test should pin something an implementer could plausibly get wrong: **boundaries**
(`mod(-1, 3) === 2`, `epsEq` at exactly its epsilon, `parseTime(NaN)`, `fmt`'s rollover),
**surprising conventions** (`directionY` is the _inverted_ Y delta; `Mat4._multiply(o)`
applies `o` **first**; `data-ui="false"` sets `noUI: true` — write the _why_), **the failure
path** (a missing bundle renders `micrio-error` and never rejects `open()`; a failed fetch is
not cached and is retried), **re-entrancy and ordering** (subscribe while being notified,
unsubscribe from inside a callback, `Frame`'s next-frame deferral), **round-trips and
invariants** (`getXY`/`getCoo`, `Mat4` invert, `normalize3` length), and **prototype pollution
and cycles** (`deepCopy` rejects `__proto__`, mirrors circular references).

Avoid a test that only restates the implementation, and large snapshots of internally
generated structures — they make refactors expensive and catch little. A test that pins a
_known gap_ is fine, but say so in the test: when the gap closes, that test is the one that has
to change.

## Offline by default

The default run is hermetic:

- `helpers/network.ts` patches `globalThis.fetch`, so every main-thread request
  (`bundle.json`, IIIF manifests, styles, scripts) comes from a fixture or a 404; `requested`
  lists what a test actually asked for. `setup.ts` re-installs the patch (no routes) in every
  `beforeEach` unless `__MICRIO_LIVE__`, so a suite that forgets to mock still cannot reach
  the network — `browser/smoke` pins that.
- Anything that does **not** go through `fetch` needs its own fake: archives and album indexes
  (`XMLHttpRequest` — `stubArchiveXhr()`) and texture tiles (a Web Worker —
  `browser/textures.ts`). `helpers/network.ts`'s header indexes those bypasses.
- `fetchJson` caches by URI and the fakes key their state by id, so **every fixture that goes
  through the network needs a fresh id or URL**: a reused one serves the earlier test's data.

### The live suite

`tests/browser/live/**` is the only place with real network and real pixel decoding, skipped
unless `MICRIO_LIVE=1` (`pnpm test:browser:live`, which `vitest.config.ts` turns into the
injected `__MICRIO_LIVE__` flag). It covers one modern image (`rqFkjZz`) and one legacy v3.2
image (`dzzLm`: 41472×30219, 25 markers, 6 video tours, 9 marker tours).

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

The only cross-suite hazards; each harness documents its own use of them.

1. **Keep the number of live WebGL contexts tiny.** Chromium evicts the oldest and then falls
   back to software rendering: frames crawl, animations never finish, and it looks like a
   logic bug. The book suites share one context (`browser/book-helpers.ts`).
2. **`Frame` is a module singleton with no reset API.** A pending callback keeps `rafId` set,
   and every later `Frame.request` waits for a frame that never comes. Point it at a capture
   host (`Frame._setDisplay`) and run one tick per step, as `book-helpers.ts` does.
3. **Stop a frame-driven object when you discard it.** `Frame` only removes a callback by
   running it, so a `BookViewer` left mid-animation re-runs its physics on every later frame.
   `BookViewer._stop()` cancels the pending frame; the harness calls it in `destroy()`.

### Waiting on the real clock

`rAF` is the first thing Chromium throttles when several suites run at once, so a **bounded**
wait that polls on `requestAnimationFrame` can miss its deadline while the work is still
landing. A handful of suites failed only under load that way (each passed in isolation, and an
idle machine ran the whole project green three times in a row): a `zoom` event published a
frame after the `move` it was asserted behind, a camera limit recomputed between the write and
the predicate, a cell's `focussed` mark read in the same tick as the key that triggers it.

- **`pollUntil` (`tests/helpers/async.ts`) is the bounded wait**: it wakes on a timer, so a
  frame-starved browser cannot stretch it, and it throws on deadline.
- **`waitFor` (`tests/helpers/viewer.ts`) stays the frame-loop wait**, and is still the only
  correct choice under `vi.useFakeTimers()` — a faked clock deliberately never advances an
  `rAF` poll, while `pollUntil` would advance it.
- Asserting that **nothing** happened needs the same care: let deferred work run first (a
  bounded poll for the change, which is expected to time out) and then assert the absence,
  rather than reading a value in the tick after the dispatch.
- Anything that reads a **reused** structure (`Viewport`, `Coordinates`, `View.arr`) must read
  it at the assertion, not capture it at mount: the engine mutates those objects when it
  re-measures, and a captured copy silently goes stale under load.

## What the CSS suite pins

`tests/browser/css/` runs the same production entry point with the stylesheet stub switched
off, so a purely visual regression — a rule lost in a refactor, a `display: none` that
out-specifies another, a selector one element too wide — fails a test. Several such bugs had
shipped unseen (they are why these assertions exist); each is now guarded.

It is a **separate run**, not a mode of `browser`, because real CSS changes every component's
measured layout (`micr-io` becomes `position: relative; overflow: hidden`, wrappers become
`display: contents`, empty layers `display: none`, the canvas is pinned with `!important`).
With the stylesheets on, five `browser` tests fail on the sizes the stubbed layout gives them
(`camera-2d`, `ui-primitives`, `input-integration`, `event-contract`, `grid-transitions`), so
the two never share a run and `browser` excludes this directory. See the config for the
switch and the `exclude`.

**Viewports are runtime values.** `setup.ts` exports `DESKTOP` (1024×768, the default),
`MOBILE` (400×800) and `TABLET` (820×1180, between the 640px branches and the desktop). `useViewport` drives `page.viewport()` on the real iframe and an
`afterEach` restores the default. A pinned tablet project, if ever needed, is one
`browserProject(...)` call plus a script.

**The assertion vocabulary**, in `helpers.ts`: `rendered()` / `intersectsViewport()` for
visibility, `box()` for placement (numbers, never CSSOM strings), `topAt()` / `hitsAt()` over
`elementFromPoint` for layering and interactivity — the only way to pin "faded out _and_ out
of the click path" rather than just "faded out" — and `waitForStyle()` for transitions.

Two traps. **Mount at `100vw`/`100vh` where the rules are responsive**: `micr-io` is
`container-type: size`, so an 800px element in a 400px viewport reports 800px to a container
query. **`page.elementLocator(…).hover()` is the one interaction to use**: Playwright's
actionability check on a `pointer-events: none` (or disabled) element hangs until the timeout,
so those get a dispatched event instead.

**Visual proof.** `render-proof.test.ts` writes PNGs to `.vitest/render-proof/` (`pnpm
test:css`, then open it; `pnpm proof` on Linux): the app at each viewport, plus the 3D book
mid-page-turn at each viewport, chrome included. Nothing compares them — they exist so a human
can see the stylesheets and the WebGL scene really rendered. Every other command leaves them
alone; only `test:css` rebuilds them.

Capturing the book needs two things a plain screenshot call does not give: the book renderer
draws into a context without `preserveDrawingBuffer`, which the compositor clears before an
out-of-task capture, and it takes its drawing buffer size from the canvas box **when it is
constructed**, so the host must be at the target size before the album opens
(`book-helpers.ts`'s `_preserveDrawingBuffer`, `fixtures/book.ts`'s `style`). The turn itself
is sampled until the spread's shadow is big enough, because the page is only in the air for
part of the animation.

**Live gap:** the `figure:is(:fullscreen, …)` rules in `media.css` cannot be _executed_ in a
headless iframe (a real fullscreen transition needs a user gesture), so `media-fullscreen`
pins their declarations and the DOM shape they need. A change that keeps the text but breaks
the rule would still get through; closing it needs a headed pass.

**Not covered, on purpose:** pixel/screenshot regression (`toMatchScreenshot` needs no new
dependency, but baselines are font- and platform-rendered and the repo has no CI), and
`prefers-color-scheme` (the provider exposes no `emulateMedia`, so it would assert the host's
setting; the `data-light-mode` attribute path is covered).

A style claim about _state_ still belongs in the feature suite: `toolbar-mobile.test.ts`
asserts what the toolbar offers, this project asserts where it lands.

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

**Sub-image lifetime.** A WebGL sub-image is **claimed** by the `<micrio-embed>` using it;
destroying the element orphans it (it stays on `image._embeds` and fades) so a rebuild can
re-adopt it, and the next sweep releases what is still unclaimed
(`MicrioImage._releaseOrphans` + `Engine._removeEmbed`). The sweeps run from
`MicrioEmbed._onMount` and the `micrio-image-embeds` rebuild; `fakeImage` mirrors the API.

`getMatrix` hands back a **reused** `Float32Array` and the CSSOM reserializes `matrix3d(...)`
to ~6 significant digits — compare numbers, never strings.

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

- **One GL context per file; `canvas` and `camera-2d` mount a viewer per test** because a
  clean camera matters (scale, limits and armed animations leak between calls). `engine-360`
  and `tile-image` use one viewer per describe block.
- **`postprocess` needs no viewer**: it takes a WebGL context and only uses the element for
  `_getShader`, so it keeps one context from an id-less `<micr-io>` and asserts with
  `gl.isTexture`/`isFramebuffer`/`isProgram`, not pixels.
- **Two `_canvases` arrays exist**: `el._canvases` is the loaded `MicrioImage`s,
  `el._engine._canvases` the `TileCanvas` instances. Most render tests want the engine's.
- **The placed image is not always `micrio.$current`** — a grid/gallery parent owns one
  `MicrioImage` per id, so per-image maps (fades, removal, embedding) go through
  `canvas._micrioImage` (`placedImage()` in `canvas.test.ts`).
- **`_getCoo` reuses one `Coordinates` and `View.arr` one `Float64Array`** — copy the scalars
  out before the next call.
- **The frame loop writes some state**: `TileCanvas` resets the current image's opacity/target
  on its first frame, so `tile-image.test.ts` waits one turn of the event loop after opening.

**Thin spots, and why.** `tile-image.ts`'s 360-embed culling is pinned by a hand-built frustum
("360 embeds on a placed canvas"); what is left uncovered is defensive (`#get360Tiles`' `m < 2`
and zero-gap guards, reachable only by a degenerate projection). `ani.ts` (77.5%) leaves the
jump-transition edge flags and the omni index wrap, which need a crafted from/to view pair
rather than a real navigation.

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
- **`Browser` is a plain object of data properties**, so
  `stubBrowser({ iOS, OSX, firefox, hasTouch })` assigns and restores; no device is emulated. The iOS touch pinch and the macOS
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

- `markers.ts` (the layer) is mounted by the layout per **visible** image that has markers or
  a 360 space; it filters by language, injects each `clickableArea` as a `<micrio-embed>`
  before the marker elements, syncs waypoints and runs the clustering pass.
- `marker.ts` is the dot (icons, labels, tooltips, click/focus) plus the open/close state
  machine; `marker-popup.ts` is created from `state.popup`, while a marker **popover** is a
  `state.popover` mode rendered by `layout/popover.ts`; `marker-content.ts` renders the culture
  data and is mounted by both.

Harness notes:

- **`MicrioElement._markerImages` is keyed by marker id and never cleared** — `marker-content`
  and `marker-popup` resolve their image through it, so a reused id hands a later test an
  earlier viewer's image. `fixtures/markers.ts` prefixes every id per call and remaps the
  tours' `steps`/`stepInfo` (including `micrioId`).
- **Wait for the layer, not for marker elements**: a fixture whose markers are all filtered out
  by language still mounts the layer and has none.
- **Drive _state_, not elements**: a marker only exists inside a real `<micr-io>`, and the popup
  and content are mounted by the layout/parent.
- **The popup animates out on its own**: clearing `state.popup` does not remove it; its own
  subscription adds `destroying` and its `transitionend` removes it.

The grid `inactive` path — an unfocused cell drops its markers, waypoints and clickable-area
embeds — is `browser/markers/markers-grid.test.ts`. Reaching it offline needs a _hand-built
visible cell_ (the layout only mounts a layer for an image in `micrio._visible`, and a cell
never gets there because its canvas keeps a zero-size visible rect), so the suite calls
`cell.visible.set(true)` and focuses it. `Grid._markersShown` is written nowhere today, so the
`indexOf` term of `inactive` is constant and `$focussed` is the real discriminator.

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

`<micrio-serial-tour>` is the multi-image marker tour (`isSerialTour`); its step clock and
its control bar are pinned by `tests/browser/tour/serial-tour.test.ts`.

**Who owns what**

- The **clock** is the tour's (250ms `#tick`); advancement is never a timeout. A step with
  media is released by that media's own `ended` (the media dispatches its events on _itself_,
  so the tour never queries for a `video`/`audio` tag — a YouTube/Vimeo/HLS tour has none); a
  step whose media never started holds the clock at 0 and waits (deliberately no grace
  period); a step with no media is timed by its authored `stepInfo` duration.
- The **control bar** is the media element's (`figure`, fixed to the bottom), with one
  `[data-part="bar"]` per step injected into its `aside > div`.
- The **time readout** is that bar's own `<span>`, fed by `getTimeDisplay`. Not a span of the
  tour's own: the host is `display: contents`, leaving it no box to position a child in.
  `media.ts` primes the controls on creation so the readout is filled on the first frame; an
  empty readout collapses and the bar takes its space.

**Failures are not papered over.** A media error breaks the tour: `#break()` stops it, clears
`state.tour`, leaves the viewer on the failing step and reports `media-error` naming the step.
Blocked autoplay is not an error (the step latches paused, `media-blocked`). `media.ts` reports
what happened: `describeMediaError()` turns a `MediaError` into a sentence, adapter `onError`
is forwarded on the YouTube/Vimeo/HLS paths, and init/play rejections are reported, not
swallowed. The bar's fullscreen overlay and its fixed-width `tabular-nums` readout are guarded
in `browser/css/media-fullscreen.test.ts`.

## Coverage

`pnpm test:coverage` merges `core` + `browser` under `@vitest/coverage-v8`, over all of
`src/**/*.ts` — a file no test imports still shows as 0%. The `css` project is left out
(its stylesheets break five `browser` assertions, see
[What the CSS suite pins](#what-the-css-suite-pins)); it exercises the same modules, so
nothing measurable is lost. The floors are checked against the merged report, so
`--project core --coverage` alone (~7%) trips every threshold by design — use it to inspect,
not to gate. Baseline, steady to a couple of tenths (some render branches only run on certain
timing paths):

| Metric     | Baseline | Floor |
| ---------- | -------- | ----- |
| Statements | 90.5     | 89    |
| Branches   | 81.6     | 81    |
| Functions  | 89.1     | 89    |
| Lines      | 90.4     | 89    |

The floors sit a point or two under the baseline, so a real loss fails the run and ordinary
refactoring does not — but branches sit closest to theirs, and a new conditional in a large
file can trip the threshold **without any test failing**. Read the number as "this code ran",
not "this code is pinned": every browser suite loads `src/main`, so a component that merely
mounts scores high with no assertion about it (63 of 124 files do). Per-area statements,
`vitest`'s own rows:

| Area              | Stmts | Covered   |
| ----------------- | ----- | --------- |
| src/core/events   | 100.0 | 483/483   |
| src/book/input    | 100.0 | 143/143   |
| src/book/geometry | 99.2  | 254/256   |
| src/book/core     | 97.6  | 123/126   |
| src/book/physics  | 96.8  | 149/154   |
| src/utils         | 95.6  | 360/374   |
| src/core/i18n     | 95.5  | 21/22     |
| src/ui            | 93.8  | 142/152   |
| src/embed         | 93.5  | 346/370   |
| src/markers       | 91.5  | 619/677   |
| src/grid          | 90.5  | 618/683   |
| src/gallery       | 90.0  | 899/998   |
| src/render        | 92.1  | 2884/3131 |
| src/audio         | 87.2  | 214/246   |
| src/tour          | 86.4  | 241/279   |
| src/layout        | 86.2  | 588/682   |
| src/media         | 85.2  | 862/1009  |
| src/core          | 83.5  | 804/963   |
| src/book          | 83.3  | 637/765   |
| src/layout/nav    | 82.8  | 265/320   |

**The live thin spots.** `src/layout/nav` (82.8%) and `src/core` (83.5%) are the lowest
areas, and they are thin for a reason worth naming: `src/core/camera.ts` is at 63.9% and
`src/core/image.ts` at 77.4% — the two largest files of the element itself, whose uncovered
halves are the WebGL/state paths the browser suites reach only through a full viewer.
`src/media` (85.2%) is next, with `media.ts` at 75.3% because the YouTube/Vimeo/HLS paths need
stubbed third-party APIs, and the serial tour's own file sits at 82.9%. The `src/markers` row
reads lower than it did because the marker suites moved to fresh per-call fixtures, not
because anything regressed.

These are thin spots, not a backlog list (that holds only the CI item). To raise the floor, run
`pnpm test:coverage`, move the baseline to the new number and keep the floors a point or two
under it.

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
projects), **plus 57 in 9 files in the separate `css` run** (`pnpm test:css`), coverage
`90.5 / 81.6 / 89.1 / 90.4` (statements / branches / functions / lines, floors
`89 / 81 / 89 / 89`), and `tsc` (source and tests), `oxlint --type-aware` and
`oxfmt --check` are clean.

| Area                                                                 | Suite                                                                            | Status |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------ |
| Math, ids, time, locale, easing                                      | `tests/core/**/*.test.ts`                                                        | done   |
| Store API, state controllers                                         | `tests/core/core/store`, `state`                                                 | done   |
| bundle.json loading and caching                                      | `tests/core/utils/dataLoader`                                                    | done   |
| MDP archive parsing                                                  | `tests/core/utils/archive`                                                       | done   |
| Matrix/vector math                                                   | `tests/core/render/mat`                                                          | done   |
| View / Coordinates / Viewport geometry                               | `tests/core/render/shared`                                                       | done   |
| `Canvas` controller and `Engine` lifecycle                           | `tests/browser/render/canvas`                                                    | done   |
| 2D camera (`_pan`/`_zoom`/pinch/`setCoo`)                            | `tests/browser/render/camera-2d`                                                 | done   |
| 360 camera, 360 canvas facades, kinetic drag                         | `tests/browser/render/engine-360`                                                | done   |
| Tile pyramid, layer selection, tile culling                          | `tests/browser/render/tile-image`                                                | done   |
| Postprocessor and WebGL watermark                                    | `tests/browser/render/postprocess`                                               | done   |
| Legacy (pre-v5) vs v5+ bundles                                       | `tests/browser/core/element-legacy`                                              | done   |
| `<micr-io>` open / events / attributes / reconnect                   | `tests/browser/core/element-*`                                                   | done   |
| Marker layer, filter, settings, clickable areas                      | `tests/browser/markers/markers`                                                  | done   |
| Grid cell markers (inactive, then focused)                           | `tests/browser/markers/markers-grid`                                             | done   |
| Marker icons, labels, scaling, viewport sizing                       | `tests/browser/markers/marker-render`                                            | done   |
| Marker clicks, events, links, tour interaction                       | `tests/browser/markers/marker-actions`                                           | done   |
| Marker popup, minimize, tour controls                                | `tests/browser/markers/marker-popup`                                             | done   |
| Marker content, media, embeds, image gallery                         | `tests/browser/markers/marker-content`                                           | done   |
| Marker clustering                                                    | `tests/browser/markers/marker-cluster`                                           | done   |
| Auto-starting a marker tour                                          | `tests/browser/markers/marker-autotour`                                          | done   |
| Marker split-screen links                                            | `tests/browser/markers/marker-split`                                             | done   |
| 360 space resolution and navigation                                  | `tests/browser/space/tours-360`                                                  | done   |
| 360 camera (yaw/pitch, transforms, matrix)                           | `tests/browser/space/camera-360`                                                 | done   |
| `trueNorth` and image orientation                                    | `tests/browser/space/space-truenorth`                                            | done   |
| 360 waypoints (`<micrio-waypoint>`)                                  | `tests/browser/markers/waypoints`                                                | done   |
| 360 space transitions                                                | `tests/browser/space/space-transition`                                           | done   |
| 360 minimap                                                          | `tests/browser/space/minimap-360`                                                | done   |
| Album resolution, config, sorting and degradation                    | `tests/browser/gallery/gallery-album`                                            | done   |
| Swipe album and strip navigation                                     | `tests/browser/gallery/gallery-swipe`                                            | done   |
| Gallery scrubber (pointer, touch, ticks, teardown)                   | `tests/browser/gallery/gallery-scrubber`                                         | done   |
| Switch album layout and navigation                                   | `tests/browser/gallery/gallery-switch`                                           | done   |
| IIIF (Presentation 2/3/4) and Image API info.json                    | `tests/browser/gallery/gallery-iiif`                                             | done   |
| Live IIIF manifests and their Image API tiles                        | `tests/browser/live/iiif`                                                        | opt-in |
| Asset galleries (`micrio-swipe-gallery`)                             | `tests/browser/gallery/gallery-assets`                                           | done   |
| Album bundle without a gallery controller                            | `tests/browser/gallery/gallery`                                                  | done   |
| Omni rotation, layers, dial and swipe                                | `tests/browser/gallery/omni-viewer`                                              | done   |
| Omni markers and marker tours                                        | `tests/browser/gallery/omni-markers`                                             | done   |
| Omni camera angle maths                                              | `tests/core/core/camera-omni`                                                    | done   |
| Video tour timeline and playback                                     | `tests/browser/media/video-tour`                                                 | done   |
| Marker tour UI and navigation                                        | `tests/browser/tour/marker-tour`                                                 | done   |
| Serial (multi-image) tours                                           | `tests/browser/tour/serial-tour`                                                 | done   |
| Media element, controls, subtitles                                   | `tests/browser/media/media-*`, `subtitles`                                       | done   |
| Tour toolbar and autostart wiring                                    | `tests/browser/tour/tour-integration`                                            | done   |
| Audio controller (Web Audio, positional)                             | `tests/browser/audio/audio-controller`                                           | done   |
| Audio level settings (`startVolume`/`mutedVolume`)                   | `tests/core/utils/media-settings`                                                | done   |
| Spatial audio routing                                                | `tests/browser/audio/audio-location`                                             | done   |
| Media adapters (HTML5/YouTube/Vimeo/HLS)                             | `tests/browser/media/*-adapter`, `hls-player`                                    | done   |
| Adapter selection and wiring in `<micrio-media>`                     | `tests/browser/media/media-adapters`                                             | done   |
| Grid column maths and transition areas                               | `tests/browser/grid/grid-format`                                                 | done   |
| Grid storytelling                                                    | `tests/browser/grid/grid-{layout,focus,history,tour-events,actions,integration}` | done   |
| Grid transitions, keyboard and tap input                             | `tests/browser/grid/grid-transitions`                                            | done   |
| Book maths (vec3, page layout, spine sync)                           | `tests/core/book/{vec3,layout,spine-sync}`                                       | done   |
| XPBD physics solver                                                  | `tests/core/book/native-solver`                                                  | done   |
| Book meshes, uv projection, raycasting                               | `tests/browser/book/{meshes,uv-project,raycast}`                                 | done   |
| Book camera, page flip, lighting presets                             | `tests/browser/book/{orbit-camera,page-flip,lighting}`                           | done   |
| Book renderer and IIIF texture manager                               | `tests/browser/book/{renderer,iiif-manager}`                                     | done   |
| `BookViewer` (flips, drags, zoom, draw bounds)                       | `tests/browser/book/viewer`                                                      | done   |
| book3d album path and the book fixture                               | `tests/browser/gallery/book3d-album`                                             | done   |
| Wheel, drag, pinch, gesture, keyboard, context menu                  | `tests/browser/core/events/*`                                                    | done   |
| Real-viewer input end to end, and retina DPR                         | `tests/browser/core/events/input-integration`                                    | done   |
| Book input (pan/orbit/pinch/click/wheel, retina)                     | `tests/browser/book/input`                                                       | done   |
| UI translation tables                                                | `tests/core/core/i18n/i18n-strings`                                              | done   |
| Buttons, icons, progress circle, dial                                | `tests/browser/ui/ui-button`, `ui-primitives`                                    | done   |
| Menu tree and its actions                                            | `tests/browser/ui/ui-menu`                                                       | done   |
| Toolbar (desktop + mobile sheet) and controls                        | `tests/browser/layout/{toolbar-*,controls}`                                      | done   |
| Content-page popover and welcome screen                              | `tests/browser/layout/popover`                                                   | done   |
| Image/video/iframe embeds, 2D HTML + WebGL                           | `tests/browser/embed/embed`                                                      | done   |
| 360 embed placement (`matrix3d`, π/2 scale)                          | `tests/browser/embed/embed-360`                                                  | done   |
| book3d embed placement and the print delay                           | `tests/browser/embed/embed-book3d`                                               | done   |
| `<micrio-image-embeds>` container and layout wiring                  | `tests/browser/embed/image-embeds`                                               | done   |
| GL embed video (HLS, loop, visibility, teardown)                     | `tests/browser/media/embedvideo`                                                 | done   |
| Stylesheets: placement, visibility, layering (desktop/mobile/tablet) | `tests/browser/css/*` — see [What the CSS suite pins](#what-the-css-suite-pins)  | done   |

## Session backlog

1. **CI** — a GitHub Actions workflow that installs the Playwright browser and runs
   `test:core` + `test:browser` + `test:css`.
