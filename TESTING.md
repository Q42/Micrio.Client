# Unit testing the Micrio Client

This document is the plan of record for the unit test suites: what exists, how to run
it, how to add to it, and what is deliberately still missing. It is meant to be read
and extended across sessions (see [Session backlog](#session-backlog)).

The repo went ten years without unit tests, so the target is **catching up**: start
with the logic that has real edges, and grow per subsystem rather than chasing a
coverage number.

## Running the tests

```sh
pnpm test           # both projects
pnpm test:core      # bare Node, no DOM, no browser, no network
pnpm test:browser   # headless Chromium (Playwright)
pnpm test:browser:live   # opt-in: the only suite that touches the network
pnpm test:watch     # watch the core project while working on pure logic
```

Requirements: Node `^20.19.0 || >=22.12.0`, and a Playwright Chromium build. If the
browser is missing:

```sh
pnpm exec playwright install chromium
```

`playwright` is pinned to `^1.59.0` because that is the release bundled with the
Chromium revision already present on the machines this was set up on. Bumping it may
require downloading a new browser build.

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
harness stays at `tests/`: `tests/fixtures/` (bundle, space, tour, grid and UI data
builders), `tests/helpers/` (mount, wait, network and grid helpers) and the ambient
`tests/tests.d.ts`.

```
tests/
├── core/                    # project "core" — bare Node
│   ├── core/                # src/core: error, state, store, i18n/
│   ├── render/              # src/render: easing, mat
│   └── utils/               # src/utils: archive, dataLoader, fetch, id, math, ...
└── browser/                 # project "browser" — Chromium
    ├── setup.ts             # vitest setupFiles: installs the fakes, imports src/main
    ├── textures.ts          # tile-worker fake (installed by setup.ts)
    ├── audio-context.ts     # AudioContext fake (installed by setup.ts)
    ├── smoke.test.ts        # suite plumbing (the only test at the project root)
    ├── audio/  book/  core/  gallery/  grid/  layout/  markers/  media/
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

## Offline by default

The default run is fully hermetic:

- `tests/helpers/network.ts` patches `globalThis.fetch`, so every main-thread request
  (`bundle.json`, IIIF manifests, styles, scripts) is served from a fixture or a 404.
  `requested` lists the URLs a test actually asked for, which is how "no network at all"
  is asserted.
- A 404 is the default for anything unmatched, which keeps leaks loud instead of silent.
- Texture tiles are decoded inside a dedicated Web Worker (`src/render/textures.ts`),
  which the main-thread patch cannot reach. `tests/browser/textures.ts` replaces that
  worker with one that answers every tile URL with a tiny real image (a 4x4 WebP built
  once with `OffscreenCanvas`), installed from `tests/browser/setup.ts` _before_
  `src/main` is imported because the worker bootstrap URL is created at module load.
  Tiles load instantly and frames draw with real texture data, so a suite can assert
  that rendering happened (`engine._numTiles`, `engine._progress`, the `draw` event)
  without network and without a texture error per tile.

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

- `tests/fixtures/bundles.ts` holds the bundle builders: a modern v5+ image with
  markers, a marker tour and a video tour; a legacy pre-v5 image with top-level culture
  data; a two-waypoint 360 space (linked both ways, so `<micrio-waypoint>` has something
  to render); a swipe album; a book3d album.
- `fixtures/space-fixture.ts` is the 360 harness: `freshSpace` rewrites a space bundle to
  fresh ids (images, space, waypoint ids **and** link endpoints), `openSpace` mounts and
  opens one, and `openVisibleSpace` also waits for `_visible`, which the waypoints layer
  and the 360 geometry depend on.
- **Bundle, space and album caches in `src/utils/dataLoader.ts` are module-level and
  keyed by id.** They live for the whole test file, so a test that goes through the
  network path needs **fresh ids**: a reused id serves the earlier test's bundle.
  `tests/browser/core/element-open.test.ts`, `tests/browser/space/tours-360.test.ts` and
  `tests/browser/gallery/gallery.test.ts` show the pattern.
- `helpers/viewer.ts` mounts a sized `<micr-io>`, opens a bundle object or an id, and
  exposes `waitFor` for polling on animation frames.
- `helpers/network.ts` also has `mockText(pattern, body)` for non-JSON resources
  (WebVTT). Both helpers take a **RegExp**, not a URL string.
- `helpers/tour.ts` adds `mountTour` (mount + open + wait for load), `startTour` (set the
  tour store the way the toolbar does), `recordEvents` (custom events with details) and a
  pair of clock helpers, `tickClock(ms)` and `advance(ms)`.
- `fixtures/tours.ts` builds video tours, marker tours, cross-image serial tours,
  `serialStoryBundle` (a `JXflr`-shaped story: one bundle of sibling images, a serial tour
  whose steps each carry a marker with its own video tour) and a small VTT document.
  `markersWithVideo` exists because a serial tour only produces media — and therefore
  progress bars — for steps whose marker carries a video tour.
  **Tours that read `DataLoader._getStepMarker` (`tour.ts` and `serial-tour.ts` both do)
  must be mounted through `bundle.json`, not as a bundle object**: that cache is filled by
  the fetch, so the object path resolves every step marker to `undefined`.
- `tests/fixtures/grid.ts` mounts a real grid album: it packs a tightly-packed MDP archive,
  stubs the XHR the archive is read over, and opens the album through the element's **id
  attribute** — the only path that turns an album into a gallery (`#print()`), since
  `open(id)` alone never does. Its `waitForGrid` gate must not wait on the viewer's
  `_visible` list (these fixtures serve no tiles, so it stays empty). Two of its moving parts
  are worth knowing before writing a grid test:
  - **The archive XHR stub outlives `openGrid`.** `#print` is fire-and-forget, so an album can
    still be resolving when the test moves on; a stub removed at the end of `openGrid` would
    send that album to the real network, which 404s and silently degrades the grid to a single
    image. Call `restoreArchiveXhr()` from the suite's `afterEach` instead.
  - **Image ids must be unique per fixture, and `gridImageId` guarantees it.** A v5 id is
    7 characters, so each fixture gets a base-36 tag from a monotonically increasing counter
    (never `Math.random()` — a 3-character random tag collides, and `DataLoader`'s bundle cache
    plus the shared `jsonCache` then serve an _earlier_ fixture's album). Markers that name an
    image id in `_meta.gridAction` should be built through `withIds`, which hands the generated
    ids to the caller inside the same fixture.
  - `expectNoAlbum` is for the fixtures whose album is meant to fail (a broken archive, a
    missing index): it skips the gates and resolves with `grid: undefined` so the test can
    assert the degradation _and_ still destroy the viewer.
- `tests/helpers/grid.ts` is the grid spec helper set: `cellButtons`/`cellButton`/`layoutIds`
  read the printed cell `<button>`s, `focusCell` focuses one and waits for `$focussed`,
  `settleFrames` waits out the controller's one-frame deferrals.
- `tests/fixtures/book.ts` is the book3d harness. It packs a real, tightly-packed MDP
  archive that holds **both** a decodable thumbnail per image id and the album index JSON,
  because a book3d album has two readers: `Gallery._fromAlbum` takes the album's images from
  the index (over XHR that `fetch` interception does not reach), and `BookViewer` reads each
  page's texture back out of the same archive with `archive._getImageById` (which indexes
  images by the first path segment of an entry). `openBook` mounts the element **by id** and
  gates on the gallery, on its `_images` and on the parent image's `_placed`, because
  `#print`/`_openOn` are fire-and-forget; the archive stub is the grid fixture's, restored in
  `afterEach` for the same reason.
  - The gallery parent `$current` keeps its **empty id** and stays `$current` for the whole
    book (that is how the book's draw hand-off reaches the marker layer), so a book test
    asserts through `bookAlbum(el)` (`numPages`, `currentIndex`, `next`/`prev`),
    `scrubberTicks(el)` and `bookMarkers(el)` rather than through `$current`.
- `tests/fixtures/albums.ts` is the swipe/switch/grid-config album harness. It packs an MDP
  body with **only the archive index** (tiles come from the texture-worker fake, because
  `engine._getTexture` consults `archive` only when the exact tile URL is a db key), and its
  `albumFixture`/`mountAlbum` pair keeps every id, album id and archive id unique per call —
  `DataLoader`'s bundle/album caches and `jsonCache` are module-level.
  - **`awaitAlbum` never calls `open(id)`.** `mountAlbum` gives the element an id and `#print`
    builds the album and opens its parent on its own; an explicit `open(id)` races that and
    builds a second top-level canvas. That stray canvas eventually calls `TileCanvas._fadeIn`,
    which fades out every _other_ canvas — including the gallery parent, which then counts as
    hidden, stops stepping its children and leaves every awaited `SwipeGallery.animateTo`
    pending forever. The gate is therefore the parent (`$current.album`, or `$current.grid` for
    a `grid` album, which never renders `<micrio-gallery>` and never gets an album API).
  - `destroyAlbums()` in `afterEach` destroys the viewers, next to `restoreArchiveXhr()`.
- `tests/fixtures/omni.ts` is the omni (3D object) harness. `openOmni` mounts the element **by
  id**, because `OmniUI.setup` reads the bundle back out of `DataLoader._getBundleImageSync` —
  a cache only the `bundle.json` fetch fills, so `open(bundleObject)` never sets up the omni UI.
  It also installs the shared archive XHR stub with an empty MDP, because a v5+ omni awaits
  `archive.load(<id>/base)` over XHR. Its gate is `image.omni`, which `setup` assigns last
  (`setup` itself is fire-and-forget). `destroyOmni()` in `afterEach`.
- `tests/browser/book-helpers.ts` is the shared BookViewer harness: `mountBook` mounts a sized
  canvas and a `BookViewer`, and steps frames manually through the internal `_step` hook with
  a fixed delta, so flips and the physics are deterministic. Four things are load-bearing:
  - **One shared WebGL2 context per file.** Chromium keeps only a small number of live WebGL
    contexts and silently evicts the oldest, after which `getContext` falls back and the
    frame loop crawls; a suite that mounts a context per test ends up with its later tests
    stalled. `mountBook` points every book's renderer at a wrapper whose `canvas` is the
    caller's element, so all of them share one context.
  - **The `Frame` scheduler is driven one tick per step.** `goto()`'s cascade re-schedules
    each flip through `Frame`, a module singleton with no reset API: a callback left pending
    by an earlier test keeps its scheduled-rAF id set, and every later cascade then waits on
    a frame that never comes. The harness hands `Frame` a host whose `requestAnimationFrame`
    captures `tick`, runs the book's own frame and then that tick, and re-homes the display
    in `afterEach`.
  - **`destroy()` calls `viewer._stop()`.** `Frame` only ever removes a callback by running
    it, so a viewer the test walks away from keeps a callback queued and every later frame
    of the file re-runs that dead viewer's physics — the difference between a 6s and a 30s
    browser run, and between one book suite and a flaky whole browser run.
  - **An awaited `goto()` needs `settle()`, not a synchronous stepping loop.** Frames only run
    inside `step()`, so `await`ing a pending `goto()` while the harness is idle leaves the page
    flip to its own 3s fallback: the book looks like it never settles when nothing is driving
    it. `settle(predicate)` steps a frame and then yields, so promise callbacks run between
    steps, and it reports how many frames the cascade took. That is how the `goto` tests pin
    the cascade rather than the fallback (a cascade settles in well under 200 frames in both
    directions).
- `tests/fixtures/ui.ts` is the UI harness: `uiBundle`/`openUi` mount a bundle with menu
  pages, tours and markers, and `uiPage`/`pageButton`/`uiMarker`/`imageAsset` build the
  shaped data the toolbar and popover tests need.
- **A marker only reaches the popover with `popupType: 'popover'`.** A plain marker opens
  the lighter `micrio-marker-popup` (`state.popup`) instead.
- `src/core/state.ts` and friends are exercised with small plain-object stubs, which need
  the self-referencing shape noted under [Sharp edges](#sharp-edges-worth-knowing).

### Fakes for the audio and player layers

- `tests/browser/audio-context.ts` installs a hand-written `AudioContext` (gain, panner,
  buffer source, listener, `decodeAudioData`), recording what each node was told and what
  it was connected to. It is installed from the browser setup, not per test, because
  `audio-controller` keeps its context in module state and initialises it at most once per
  file: the `interacted` store, `_ctx` and `mainGain` are all file-scoped, so the suite is
  ordered deliberately and `mainGain.gain.value` is the only sane way to observe muting.
- The three external player APIs are stubbed at the global they are read from (`YT`,
  `Vimeo`, `Hls`). That also short-circuits `loadExternalAPI`, which is the point: it only
  fetches a script when the global is missing, and a `<script>` tag does **not** go through
  the suite's `fetch` interception, so the real path would reach the CDN and never settle.
- `HTMLMediaElement.prototype.play` is stubbed to resolve in the browser setup. Headless
  Chromium cannot play any fixture source, and the playlist's rejection otherwise surfaces
  as an unhandled error; no test asserts on playback succeeding.

### Sharp edges worth knowing

**The layout removes `micrio-popover` when the state clears.** "The popover closed" is
asserted as the element being gone (or the state being `undefined`), not as
`dialog.open === false` — by the time you look, the element is usually detached.

**A popover renders from its state, and its render key includes the gallery.** The state
reaches an open popover through `#show`'s update callback (the element is reused), and the
key carries the page, marker, gallery and language — which is what lets one gallery replace
another.

**A click that opens a menu branch stops propagating.** The module's `opened` store installs
a window click listener while something is open, so opening a branch and letting the click
bubble would close it again in the same event.

**`micrio-button` passes its `className` down to the inner `<button>`/`<a>`.** Class
assertions (the toolbar's `indent`, the popover's `no-click`) have to query the child, not
the host.

**Self-referencing literals.** Object literals with a self-reference can lose the
reference under the Vite transform when they are built inside a nested function and passed
through an `as unknown as SomeClass` cast. Constructing the referenced object first and
dereferencing it through a local (`const engine = { micrio }`) is the reliable shape.

**Private fields are invisible to assertions.** `#props` and friends are not own
properties, so `(el as unknown as { _props?: X })._props` reads `undefined` even when
the component was configured correctly. Reading them tells you nothing — assert through
the DOM, or through a public accessor, instead.

**The audio controller only exists for an image with `music` or a marker carrying
`positionalAudio`.** A plain marker builds nothing, so a controller test needs one of those.
Its autoplay probe `<audio>` is appended _before_ the `AudioContext` availability check, so
its presence is not evidence that the audio graph exists.

**`dataLoader` caches image data by id for the whole file.** Reusing an id across tests
serves the first test's image — including one with no `data`. `_loading` also clears before
`$current.$data` is set, so an audio test waits on the data, not on loading.

**Fake timers freeze `waitFor`.** `waitFor` polls on `requestAnimationFrame`, which a faked
clock never advances: mount and open with real timers, then switch (`mountWithFakeTime` in
`tests/browser/media/video-tour.test.ts`). `VideoTourInstance` derives `currentTime` from
`Date.now()`, so `tickClock()` passes time without its scheduled steps firing and
`advance()` fires them.

**The toolbar's mobile layout is tested by pinning `window.innerWidth` and dispatching
`resize`**, because the component measures the width itself and a narrow real viewport would
drag CSS media queries into assertions about component state.

**A grid fixture renders no `micrio-marker` elements, and its cells stay invisible.** The
fixture serves no tiles, so no image ever enters the viewer's `_visible` list — and both the
marker layer and the controller's `#placeGrid` are built from that list. A grid marker test
therefore opens a marker by setting the marker _object_ on `image.state.marker` (the grid
watches `micrio.state.marker`, which the state controller mirrors) rather than by id, which
is an unrendered element's job to resolve.

**A grid cell's `camera.getView()` is not usable offline.** A cell's view only becomes
meaningful after a real render, so grid tests assert the hand-off instead: the layout, the
`opts.area` a cell was measured into, and the calls the controller makes on the camera.
`opts.area` is also written **once** — `#printGrid` skips an image that already has one, so a
later `set(..., { scale })` does not move it.

**A `BookViewer` requests frames through `Frame` and nothing removes them.** `Frame` only
drops a callback when it runs it, so a viewer that is thrown away mid-animation stays in the
queue for the rest of the page's life and every later frame re-runs its simulation (and
re-queues it). Hosts must call `viewer._stop()` — the gallery does before building the next
book, and the test harness does in `destroy()`.

**A `BookViewer`'s state is private, so a test drives it and reads its callbacks.** `_step`
runs one frame with an explicit delta and returns whether the loop wants another;
`_onDraw`/`_onPageChange` are the observable output, and `_getCurrentPage`/`_getPageCount`/
`_allowRotation` are the only readers. `isZoomedIn()` is derived from the last drawn bounds,
so it is only meaningful after a stepped frame.

**A book's zoom delta is inverted: a negative value zooms in.** `OrbitCamera._zoom` adds
`delta * _zoomSpeed` to the target radius, so `zoom(-2000)` pulls the camera in and
`zoom(+2000)` pushes it out — the opposite of a wheel's `deltaY` sign. The book, the camera
and the rotation buttons all agree on this convention; the tests pin it.

**`_meta.gridSize` does nothing yet.** The controller stores it in `#nextSize` and clears
that at the start of every `set`, and `#cellSizes` is written but never read, so a marker's
`gridSize` never reaches the layout. `tests/browser/grid/grid-actions.test.ts` pins the current
behaviour on purpose, so wiring the feature up has to change a test rather than pass silently.

**Every album type takes its images from the archive index.** `Gallery._fromAlbum` builds its
list from `index.images` (with `index?.images ?? []`), so a `swipe` or `switch` album needs an
archive exactly like a grid or book3d one. An album without an archive resolves to a `Gallery`
with zero images, and `#renderGallery` returns before it sets `$current.album` — so the viewer
shows no scrubber, no arrows and no album API at all (`gallery-album.test.ts` pins it).

**The album branch of `#print` needs the element's id attribute.** It runs only for a v5 id
whose bundle carries `info.albumId`, and only while the element has no `width`/`height`
attribute. It also always passes the element's own id as `_fromAlbum`'s `startId`, and that
argument wins over the album's `startId` — an album-level `startId` is unreachable through this
path.

**`album.goto(n)` takes an _image_ index, and a miss lands on page 0.** `#imageIdxToPage`
returns 0 for an unknown index, so `album.goto(99)` moves to the first page and resolves
`undefined` (the requested image index does not exist). The gallery's own `#goto` is the one
that clamps a page.

**An awaited `SwipeGallery.animateTo` needs the gallery parent to keep drawing.** The slide
resolves through `Frame` once no child `_areaAnimating()`; if the parent canvas is faded out
(another top-level canvas called `TileCanvas._fadeIn`, which fades out every other canvas) its
`_shouldDraw` returns early, the children never step and the promise stays pending forever. That
is why the album fixture lets `#print` own the open — a stray second canvas is enough to trigger
it.

**`fetchJson` caches by URI in a module-level `jsonCache`.** Two manifest tests that reuse the
same URL get the first test's response; every IIIF fixture needs its own URL (the same reason
`DataLoader` fixtures need fresh ids).

**The scrubber handle keeps its `dragging` class after release.** `#scrubStop` clears
`#dragging` and the `data-dragging` attribute but does not re-render the bar, and releasing on
the page the drag already reached never runs `#frameChanged` either — so the class only clears
on the next scrubber update (`gallery-scrubber.test.ts` pins it).

**The stylesheet imports are stubbed in tests, so a component has no box.** `vitest.config.ts`
replaces every `.css` import with an empty module, so the scrubber's `getBoundingClientRect`
and `clientWidth` are zero until a test gives the gallery (or the dial) an inline `display` and
`width`. Drag tests that measure pixels have to do that first.

**An omni image needs the bundle cache.** `OmniUI.setup` starts from
`DataLoader._getBundleImageSync(image.id)`, which only the `bundle.json` fetch fills — so
`open(bundleObject)` shows the first frame with no dial, no layer menu and no `image.omni`.
Omni tests mount by the element's id.

**The omni swiper is gated on `#isFullWidth`, which only a _change_ of `state.view` sets.** The
subscription in `#initSwiper` does not read the current value, so the first single-pointer drag
can be inert until the camera view updates; holding shift forces the gesture. The move that
crosses the drag threshold also re-arms `#startX` to its own `clientX`, so that move produces a
zero delta — the rotation starts on the _next_ move. `omni-viewer.test.ts` pins both.

**The omni layer menu subscription rotates the dial from the layer index, not the frame.** It
feeds `state.layer` into the frame-based `(idx / pagesPerLayer) * 360`, so layer 1 of a
36-frame/2-layer object reads as 1/18 of a turn (20°) instead of the half turn the layer names.
Pinned as-is.

**Six omni settings are read nowhere:** `noDial`, `noKeys`, `showDegrees`, `frontIndex`,
`twoAxes` and the omni-level `startIndex`. The dial is always built (`degrees: true`) and frame
0 is always the start, whatever they say. `omni-viewer.test.ts` pins the current behaviour, so
wiring any of them up has to change a test rather than pass silently.

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

| Area                                               | Suite                                                                            | Status |
| -------------------------------------------------- | -------------------------------------------------------------------------------- | ------ |
| Math, ids, time, locale, easing                    | `tests/core/**/*.test.ts`                                                        | done   |
| Store API, state controllers                       | `tests/core/core/store`, `state`                                                 | done   |
| bundle.json loading and caching                    | `tests/core/utils/dataLoader`                                                    | done   |
| MDP archive parsing                                | `tests/core/utils/archive`                                                       | done   |
| Matrix/vector math                                 | `tests/core/render/mat`                                                          | done   |
| Legacy (pre-v5) vs v5+ bundles                     | `tests/browser/core/element-legacy`                                              | done   |
| `<micr-io>` open / events / attributes             | `tests/browser/core/element-*`                                                   | done   |
| Markers                                            | `tests/browser/markers/markers`                                                  | done   |
| 360 space resolution and navigation                | `tests/browser/space/tours-360`                                                  | done   |
| 360 camera (yaw/pitch, transforms, matrix)         | `tests/browser/space/camera-360`                                                 | done   |
| `trueNorth` and image orientation                  | `tests/browser/space/space-truenorth`                                            | done   |
| 360 waypoints (`<micrio-waypoint>`)                | `tests/browser/markers/waypoints`                                                | done   |
| 360 space transitions                              | `tests/browser/space/space-transition`                                           | done   |
| 360 minimap                                        | `tests/browser/space/minimap-360`                                                | done   |
| Album resolution, config, sorting and degradation  | `tests/browser/gallery/gallery-album`                                            | done   |
| Swipe album and strip navigation                   | `tests/browser/gallery/gallery-swipe`                                            | done   |
| Gallery scrubber (pointer and touch)               | `tests/browser/gallery/gallery-scrubber`                                         | done   |
| Switch album layout and navigation                 | `tests/browser/gallery/gallery-switch`                                           | done   |
| IIIF manifest albums                               | `tests/browser/gallery/gallery-iiif`                                             | done   |
| Asset galleries (`micrio-swipe-gallery`)           | `tests/browser/gallery/gallery-assets`                                           | done   |
| Album bundle without a gallery controller          | `tests/browser/gallery/gallery`                                                  | done   |
| Omni rotation, layers, dial and swipe              | `tests/browser/gallery/omni-viewer`                                              | done   |
| Omni markers and marker tours                      | `tests/browser/gallery/omni-markers`                                             | done   |
| Omni camera angle maths                            | `tests/core/core/camera-omni`                                                    | done   |
| Video tour timeline and playback                   | `tests/browser/media/video-tour`                                                 | done   |
| Marker tour UI and navigation                      | `tests/browser/tour/marker-tour`                                                 | done   |
| Serial (multi-image) tours                         | `tests/browser/tour/serial-tour`                                                 | done   |
| Media element, controls, subtitles                 | `tests/browser/media/media-*`, `subtitles`                                       | done   |
| Tour toolbar and autostart wiring                  | `tests/browser/tour/tour-integration`                                            | done   |
| Audio controller (Web Audio, positional)           | `tests/browser/audio/audio-controller`                                           | done   |
| Audio level settings (`startVolume`/`mutedVolume`) | `tests/core/utils/media-settings`                                                | done   |
| Spatial audio routing                              | `tests/browser/audio/audio-location`                                             | done   |
| Media adapters (HTML5/YouTube/Vimeo/HLS)           | `tests/browser/media/*-adapter`, `hls-player`                                    | done   |
| Adapter selection and wiring in `<micrio-media>`   | `tests/browser/media/media-adapters`                                             | done   |
| Grid column maths and transition areas             | `tests/browser/grid/grid-format`                                                 | done   |
| Grid storytelling                                  | `tests/browser/grid/grid-{layout,focus,history,tour-events,actions,integration}` | done   |
| Book maths (vec3, page layout, spine sync)         | `tests/core/book/{vec3,layout,spine-sync}`                                       | done   |
| XPBD physics solver                                | `tests/core/book/native-solver`                                                  | done   |
| Book meshes, uv projection, raycasting             | `tests/browser/book/{meshes,uv-project,raycast}`                                 | done   |
| Book camera, page flip, lighting presets           | `tests/browser/book/{orbit-camera,page-flip,lighting}`                           | done   |
| Book renderer and IIIF texture manager             | `tests/browser/book/{renderer,iiif-manager}`                                     | done   |
| `BookViewer` (flips, drags, zoom, draw bounds)     | `tests/browser/book/viewer`                                                      | done   |
| book3d album path and the book fixture             | `tests/browser/gallery/book3d-album`                                             | done   |
| UI translation tables                              | `tests/core/core/i18n/i18n-strings`                                              | done   |
| Buttons, icons, progress circle, dial              | `tests/browser/ui/ui-button`, `ui-primitives`                                    | done   |
| Menu tree and its actions                          | `tests/browser/ui/ui-menu`                                                       | done   |
| Toolbar (desktop + mobile sheet)                   | `tests/browser/layout/toolbar-*`                                                 | done   |
| Content-page popover and welcome screen            | `tests/browser/layout/popover`                                                   | done   |

## Session backlog

Roughly in order of value against risk:

1. **Coverage ratchet** — add `@vitest/coverage-v8`, record a baseline, then raise a
   floor. Deliberately postponed: no thresholds while most of the tree is still untested.
2. **CI** — a GitHub Actions workflow that installs the Playwright browser and runs
   `test:core` + `test:browser`.
