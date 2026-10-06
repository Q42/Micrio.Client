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
pnpm test           # both projects
pnpm test:core      # bare Node, no DOM, no browser, no network
pnpm test:browser   # headless Chromium (Playwright)
pnpm test:browser:live   # opt-in: the only suite that touches the network
pnpm test:coverage  # both projects under v8 coverage, one merged report
pnpm test:watch     # watch the core project while working on pure logic
```

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

## The two projects

`vitest.config.ts` defines two independent projects. They are separate processes with
separate configs, so a core test can never accidentally depend on a browser.

| Project   | Environment       | Include glob                 | Purpose                                                          |
| --------- | ----------------- | ---------------------------- | ---------------------------------------------------------------- |
| `core`    | Node (no DOM)     | `tests/core/**/*.test.ts`    | Pure logic: math, parsing, state, data loading, matrix math      |
| `browser` | Chromium headless | `tests/browser/**/*.test.ts` | Anything needing a DOM, layout, WebGL or the `<micr-io>` element |

Both projects share the alias map and the GLSL plugin with the production build:
`vite.config.js` exports `aliases` and `glslMinifyPlugin()`, and `vitest.config.ts`
imports them. So `$core/...`, `$utils/...`, `$render/...` resolve in tests exactly like
they do in the app, `templates/grid/**` included.

The browser suite is registered through the production entry point (`src/main.ts`), so
`customElements.define('micr-io', ...)` and the version banner behave exactly like a
real page.

### Test layout

Tests are grouped in the directory of the module they pin, mirroring `src/`. The shared
harness stays at `tests/`: `tests/fixtures/` (bundle, space, tour, grid, album, book,
omni and UI data builders), `tests/helpers/` (mount, wait, network, tour and grid
helpers) and the ambient `tests/tests.d.ts`.

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
    ├── render/              # the engine: canvas, camera-2d, engine-360, tile-image, postprocess
    ├── space/               # the 360 suites: camera, minimap, spaces, transitions
    ├── tour/  ui/  utils/
    └── live/                # opt-in network suite
```

`browser/space/` is the one feature directory without a 1:1 `src/` counterpart: the 360
suites span `render/camera-360`, `layout/nav/minimap`, `utils/space`, `core/state` and
`markers/waypoint`, so one home beats splitting them across four directories.

**Import convention.** Tests import production code through the `$` aliases — `$core/store`,
`$utils/dom`, `$types/models`, `await import('$book/main')` — so a test reads like the
source file it covers. Test support (fixtures, helpers, a sibling fake such as
`browser/audio-context.ts`, another test's helpers) stays relative. The one exception is
`tests/browser/setup.ts`, which keeps `../../src/main`: the aliases map directories, and
`src/main.ts` sits at the source root.

Both projects' include globs (`tests/core/**/*.test.ts`, `tests/browser/**/*.test.ts`) are
recursive, and `.oxlintrc.json`'s `tests/**/*.ts` override matches nested paths, so neither
`vitest.config.ts` nor the lint and type-check config needed a change for the layout.

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

One gap is deliberately pinned (its test starts with `KNOWN GAP`; when the gap closes,
that test is the one to change):

1. **WebGL sub-images leak** — `image._embeds` is append-only; rebuilding an embed with a
   fresh data object mints a new uuid, misses the reuse lookup and adds a second image.
   Releasing it needs image/engine teardown that does not exist yet.

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

Two render files sit below their neighbours. **`tile-image.ts` (65.7%)**: its 360-embed
overlap branches (`#getTilesViewport`, `#getEmbeddedScale`, `_setDrawRect`) need a hand-built
frustum fixture, and the archive/`fromScale` layer-count variants need a packed archive.
**`ani.ts` (77.5%)**: the uncovered half is the jump-transition edge flags (`#fL/#fR/#fT/#fB`)
and the omni index wrap, both of which need a crafted from/to view pair rather than a real
navigation. Both are noted in the backlog rather than faked.

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
- One gap is pinned: the `console.warn('Given image IDs gave no current displayed images')`
  branch in the `flyTo` handler is unreachable from the dispatcher, because
  `data?.split(',').map(...)` has at least one element for _any_ string, including `''`
  (`grid-transitions.test.ts`, "a flyTo action with unknown ids is silently ignored").

## The markers subsystem

`src/markers/` is a layer element plus three children, and the suites are named after them:
`browser/markers/{markers, marker-render, marker-actions, marker-popup, marker-content,
marker-cluster, marker-autotour, marker-split}` (with `waypoints` covering the 360 links).

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

One branch is deliberately left out: the layer's grid `inactive` path (a cell that is not
focused drops its markers, waypoints and clickable areas). Grid cells never enter
`micrio._visible` offline — `helpers/grid.ts` documents why — so no `<micrio-markers>` is
ever mounted for them, and reaching it needs a hand-built fake.

### Markers, settings and clustering

The layer is the only part of the subsystem that reacts to the settings store
(`_watchLater(image._settings, rebuild)`); element-level settings (`viewportIsMarker`,
`preventAutoPlay`) are read when a marker is built or repositioned, i.e. at load time.

- **Clustering** groups pairs closer than `_markers.clusterMarkerRadius` (top-level
  `clusterMarkerRadius`, default 24 px) in screen space. Either member of a pair can opt
  out with the `no-cluster` tag, and a pair that bridges two existing groups merges them.
  The synthetic `<micrio-marker class="cluster">` carries its member count as the button's
  text and its `data-marker-id` is the joined member _indices_ (`"0,1"`). Turning
  `clusterMarkers` off removes the clusters and restores the markers. An edited marker
  (same id, new object) and its clickable area are re-rendered, since `rebuild` compares
  the marker object each element was built from.
- **`markerColor` / `markerSize`** are written as `--micrio-marker-color` /
  `--micrio-marker-size` on the layer, so every marker (and cluster) inherits them;
  `viewportIsMarker` overrides the size per marker.
- **`viewportIsMarker`** places a marker that has a `view` at the view's centre and sizes
  it to the smaller on-screen side of that view (min 8 px). Clustering still measures
  member `x`/`y`, so a viewport-sized member's cluster centroid is its dot position, not
  its view centre.
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

## Coverage

`pnpm test:coverage` runs both projects under `@vitest/coverage-v8` and merges them
into one report. It measures all of `src/**/*.ts` — a file no test ever imports still
shows up as 0%, rather than dropping out of the report.

Coverage is a **whole-tree** number: the floors are checked against the merged report.
The core project only reaches ~7% on its own (bare Node never imports render, gallery,
book or the element), so `vitest run --project core --coverage` trips every threshold by
design — use it to inspect one project, not to gate.

Baseline (stable to ±0.05 across runs):

| Metric     | Baseline | Floor |
| ---------- | -------- | ----- |
| Statements | 87.3     | 86    |
| Branches   | 77.9     | 76    |
| Functions  | 87.7     | 86    |
| Lines      | 87.2     | 86    |

The floors live in `vitest.config.ts` and sit ~1 point under the baseline, so a real
coverage loss fails the run while ordinary refactoring does not. They are deliberately
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
child rows — `src/core` is 80.6% for its own files, and 71.2% once `src/core/events` (49.5%)
is folded in.

| Area            | Stmts | Covered   |
| --------------- | ----- | --------- |
| src/utils       | 96.5  | 361/374   |
| src/core/i18n   | 95.5  | 21/22     |
| src/embed       | 93.4  | 342/366   |
| src/markers     | 93.4  | 739/791   |
| src/ui          | 93.4  | 142/152   |
| src/grid        | 90.3  | 616/682   |
| src/gallery     | 90.2  | 899/997   |
| src/audio       | 88.2  | 217/246   |
| src/render      | 88.1  | 2753/3124 |
| src/media       | 86.4  | 867/1003  |
| src/layout      | 86.3  | 588/681   |
| src/book        | 84.3  | 669/794   |
| src/layout/nav  | 82.5  | 260/315   |
| src/core        | 80.6  | 860/1067  |
| src/tour        | 80.5  | 211/262   |
| src/book/input  | 52.4  | 77/147    |
| src/core/events | 49.5  | 241/487   |

The thin spots, in order: **`src/core/events` (49.5%)** — the wheel, gesture, pinch,
double-tap and context-menu layer — then `src/book/input` (52.4%) and `src/tour` (80.5%).
They are the backlog, not the floor. To raise the floor, run `pnpm test:coverage`, move the
baseline to the new number, and keep the floors ~1 point under it.

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
| `<micr-io>` open / events / attributes              | `tests/browser/core/element-*`                                                   | done   |
| Marker layer, filter, settings, clickable areas     | `tests/browser/markers/markers`                                                  | done   |
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
| Gallery scrubber (pointer and touch)                | `tests/browser/gallery/gallery-scrubber`                                         | done   |
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
| UI translation tables                               | `tests/core/core/i18n/i18n-strings`                                              | done   |
| Buttons, icons, progress circle, dial               | `tests/browser/ui/ui-button`, `ui-primitives`                                    | done   |
| Menu tree and its actions                           | `tests/browser/ui/ui-menu`                                                       | done   |
| Toolbar (desktop + mobile sheet)                    | `tests/browser/layout/toolbar-*`                                                 | done   |
| Content-page popover and welcome screen             | `tests/browser/layout/popover`                                                   | done   |
| Image/video/iframe embeds, 2D HTML + WebGL          | `tests/browser/embed/embed`                                                      | done   |
| 360 embed placement (`matrix3d`, π/2 scale)         | `tests/browser/embed/embed-360`                                                  | done   |
| book3d embed placement and the print delay          | `tests/browser/embed/embed-book3d`                                               | done   |
| `<micrio-image-embeds>` container and layout wiring | `tests/browser/embed/image-embeds`                                               | done   |
| GL embed video (HLS, loop, visibility, teardown)    | `tests/browser/media/embedvideo`                                                 | done   |

## Session backlog

Roughly in order of value against risk:

1. **CI** — a GitHub Actions workflow that installs the Playwright browser and runs
   `test:core` + `test:browser`.
2. **The leaky WebGL sub-image** — releasing an embedded `MicrioImage` needs image/engine
   teardown that does not exist yet, so the `KNOWN GAP` test in `browser/embed/embed`
   pins it (see [The embed subsystem](#the-embed-subsystem)).
3. **The layer's grid `inactive` path** — the one marker branch with no suite; reaching it
   offline needs a hand-built visible cell (see [The markers subsystem](#the-markers-subsystem)).
4. **`src/core/events`** — the interaction layer (wheel, gesture, pinch, double-tap, context
   menu) sits around 49%, now the lowest area in the tree. It needs a synthetic pointer-event
   harness; the grid tap tests in `browser/grid/grid-transitions` are the closest thing to one.
5. **`src/render/tile-image.ts`'s 360-embed branches** — `#getTilesViewport`,
   `#getEmbeddedScale` and `_setDrawRect` need a hand-built frustum fixture, and the
   archive/`fromScale` layer-count variants need a packed archive (see
   [The render engine](#the-render-engine)).
