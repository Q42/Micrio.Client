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
  `tests/browser/element-open.test.ts`, `tours-360.test.ts` and `gallery.test.ts` show the
  pattern.
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
`tests/browser/video-tour.test.ts`). `VideoTourInstance` derives `currentTime` from
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

**`_meta.gridSize` does nothing yet.** The controller stores it in `#nextSize` and clears
that at the start of every `set`, and `#cellSizes` is written but never read, so a marker's
`gridSize` never reaches the layout. `tests/browser/grid-actions.test.ts` pins the current
behaviour on purpose, so wiring the feature up has to change a test rather than pass silently.

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

| Area                                               | Suite                                                                       | Status     |
| -------------------------------------------------- | --------------------------------------------------------------------------- | ---------- |
| Math, ids, time, locale, easing                    | `tests/core/*.test.ts`                                                      | done       |
| Store API, state controllers                       | `tests/core/store`, `state`                                                 | done       |
| bundle.json loading and caching                    | `tests/core/dataLoader`                                                     | done       |
| MDP archive parsing                                | `tests/core/archive`                                                        | done       |
| Matrix/vector math                                 | `tests/core/mat`                                                            | done       |
| Legacy (pre-v5) vs v5+ bundles                     | `tests/browser/element-legacy`                                              | done       |
| `<micr-io>` open / events / attributes             | `tests/browser/element-*`                                                   | done       |
| Markers                                            | `tests/browser/markers`                                                     | done       |
| 360 space resolution and navigation                | `tests/browser/tours-360`                                                   | done       |
| 360 camera (yaw/pitch, transforms, matrix)         | `tests/browser/camera-360`                                                  | done       |
| `trueNorth` and image orientation                  | `tests/browser/space-truenorth`                                             | done       |
| 360 waypoints (`<micrio-waypoint>`)                | `tests/browser/waypoints`                                                   | done       |
| 360 space transitions                              | `tests/browser/space-transition`                                            | done       |
| 360 minimap                                        | `tests/browser/minimap-360`                                                 | done       |
| Gallery / album switching                          | `tests/browser/gallery`                                                     | partial    |
| Video tour timeline and playback                   | `tests/browser/video-tour`                                                  | done       |
| Marker tour UI and navigation                      | `tests/browser/marker-tour`                                                 | done       |
| Serial (multi-image) tours                         | `tests/browser/serial-tour`                                                 | done       |
| Media element, controls, subtitles                 | `tests/browser/media-*`, `subtitles`                                        | done       |
| Tour toolbar and autostart wiring                  | `tests/browser/tour-integration`                                            | done       |
| Audio controller (Web Audio, positional)           | `tests/browser/audio-controller`                                            | done       |
| Audio level settings (`startVolume`/`mutedVolume`) | `tests/core/media-settings`                                                 | done       |
| Spatial audio routing                              | `tests/browser/audio-location`                                              | done       |
| Media adapters (HTML5/YouTube/Vimeo/HLS)           | `tests/browser/*-adapter`, `hls-player`                                     | done       |
| Adapter selection and wiring in `<micrio-media>`   | `tests/browser/media-adapters`                                              | done       |
| Grid column maths and transition areas             | `tests/browser/grid-format`                                                 | done       |
| Grid storytelling                                  | `tests/browser/grid-{layout,focus,history,tour-events,actions,integration}` | done       |
| 3D book viewer                                     | `tests/browser/book3d-smoke`                                                | smoke only |
| UI translation tables                              | `tests/core/i18n-strings`                                                   | done       |
| Buttons, icons, progress circle, dial              | `tests/browser/ui-button`, `ui-primitives`                                  | done       |
| Menu tree and its actions                          | `tests/browser/ui-menu`                                                     | done       |
| Toolbar (desktop + mobile sheet)                   | `tests/browser/toolbar-*`                                                   | done       |
| Content-page popover and welcome screen            | `tests/browser/popover`                                                     | done       |

## Session backlog

Roughly in order of value against risk:

1. **3D book viewer in depth** — page flip, physics, lighting, IIIF page manager. Only
   after the other subsystems, and only with golden-image or geometry assertions.
2. **Coverage ratchet** — add `@vitest/coverage-v8`, record a baseline, then raise a
   floor. Deliberately postponed: no thresholds while most of the tree is still untested.
3. **CI** — a GitHub Actions workflow that installs the Playwright browser and runs
   `test:core` + `test:browser`.
