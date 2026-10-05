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
they do in the app. `templates/grid/**` resolution works for tests too, via the same alias
map and the shared tsconfig (see [Type checking](#type-checking)).

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
  where the main-thread patch does not reach. `tests/browser/textures.ts` replaces
  that worker with one that resolves every requested tile URL to a tiny real image
  (a 4x4 WebP built once with `OffscreenCanvas`). Tiles therefore load instantly and
  frames draw with real texture data — the suite can assert that rendering happened
  (`engine._numTiles`, `engine._progress`, the `draw` event) without any network and
  without `[Micrio Texture] Error loading …` noise for every tile.

  It is installed from `tests/browser/setup.ts` _before_ `src/main` is imported,
  because the worker bootstrap URL is created at module load. To assert on the tile
  URLs the engine requested, read `requested` from `tests/helpers/network.ts` — the
  fake worker answers exactly the URLs the engine asks for.

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
  opens one, and `openVisibleSpace` additionally waits for `_visible` — which is what the
  waypoints layer and the 360 geometry actually depend on. Use `openVisibleSpace` for
  anything that inspects waypoints, the minimap or a settled camera.
- **Bundle, space and album caches in `src/utils/dataLoader.ts` are module-level and
  keyed by id.** They live for the whole test file. A test that goes through the
  network path must therefore use **fresh ids**, or it will hit a bundle cached by an
  earlier test and never populate the new space/album. `tests/browser/element-open.test.ts`,
  `tours-360.test.ts` and `gallery.test.ts` show the pattern.
- `helpers/viewer.ts` mounts a sized `<micr-io>`, opens a bundle object or an id, and
  exposes `waitFor` for polling on animation frames. Prefer `waitFor` over fixed
  `setTimeout` delays.
- `helpers/network.ts` also has `mockText(pattern, body)` for non-JSON resources
  (WebVTT). Both helpers take a **RegExp**, not a URL string — passing a URL silently
  produces a matcher that never matches.
- `helpers/tour.ts` adds `mountTour` (mount + open + wait for load), `startTour` (set the
  tour store the way the toolbar does), `recordEvents` (custom events with details) and a
  pair of clock helpers, `tickClock(ms)` and `advance(ms)`.
- `fixtures/tours.ts` builds video tours, marker tours, cross-image serial tours, and a
  small VTT document. `markersWithVideo` exists because a serial tour only produces media
  — and therefore progress bars — for steps whose marker carries a video tour.
- `src/core/state.ts` and friends are exercised with small plain-object stubs. When a
  stub needs a back-reference to itself (the `image.engine.micrio` pattern), build it as
  `const engine = { micrio }; const image = { engine }` — see the note below.

### Sharp edges worth knowing

**Self-referencing literals.** Object literals with a self-reference can lose the
reference under the Vite transform when they are built inside a nested function and
passed through an `as unknown as SomeClass` cast. Constructing the referenced object
first and dereferencing it through a local (`const engine = { micrio }`) is the reliable
shape, and is what `tests/core/state.test.ts` uses.

**Private fields are invisible to assertions.** `#props` and friends are not own
properties, so `(el as unknown as { _props?: X })._props` reads `undefined` even when
the component was configured correctly. Reading them tells you nothing — assert through
the DOM, or through a public accessor, instead. Several hours went into a phantom bug
caused by this.

**Fake timers freeze `waitFor`.** `waitFor` polls on `requestAnimationFrame`, which a
faked clock never advances. Mount and open with real timers, then switch:
`mountWithFakeTime` in `tests/browser/video-tour.test.ts` shows the pattern. Also
remember that `VideoTourInstance` derives `currentTime` from `Date.now()`, so use
`tickClock()` when you want to observe time passing without its scheduled steps firing,
and `advance()` when the steps firing _is_ the thing under test.

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
- `pnpm build` is unchanged: it stays a fast release gate and does not run the test
  suites.

## Status

| Area                                       | Suite                                | Status      |
| ------------------------------------------ | ------------------------------------ | ----------- |
| Math, ids, time, locale, easing            | `tests/core/*.test.ts`               | done        |
| Store API, state controllers               | `tests/core/store`, `state`          | done        |
| bundle.json loading and caching            | `tests/core/dataLoader`              | done        |
| MDP archive parsing                        | `tests/core/archive`                 | done        |
| Matrix/vector math                         | `tests/core/mat`                     | done        |
| Legacy (pre-v5) vs v5+ bundles             | `tests/browser/element-legacy`       | done        |
| `<micr-io>` open / events / attributes     | `tests/browser/element-*`            | done        |
| Markers                                    | `tests/browser/markers`              | done        |
| 360 space resolution and navigation        | `tests/browser/tours-360`            | done        |
| 360 camera (yaw/pitch, transforms, matrix) | `tests/browser/camera-360`           | done        |
| `trueNorth` and image orientation          | `tests/browser/space-truenorth`      | done        |
| 360 waypoints (`<micrio-waypoint>`)        | `tests/browser/waypoints`            | done        |
| 360 space transitions                      | `tests/browser/space-transition`     | done        |
| 360 minimap                                | `tests/browser/minimap-360`          | done        |
| Gallery / album switching                  | `tests/browser/gallery`              | partial     |
| Video tour timeline and playback           | `tests/browser/video-tour`           | done        |
| Marker tour UI and navigation              | `tests/browser/marker-tour`          | done        |
| Serial (multi-image) tours                 | `tests/browser/serial-tour`          | partial     |
| Media element, controls, subtitles         | `tests/browser/media-*`, `subtitles` | done        |
| Tour toolbar and autostart wiring          | `tests/browser/tour-integration`     | done        |
| Audio controller (Web Audio, positional)   | —                                    | not started |
| Grid storytelling                          | —                                    | not started |
| 3D book viewer                             | `tests/browser/book3d-smoke`         | smoke only  |
| UI components (toolbar, menu, popover)     | —                                    | not started |
| Media adapters (YouTube/Vimeo/HLS)         | —                                    | not started |

## Session backlog

Roughly in order of value against risk:

1. **Two tour bugs found while writing the above.** Both need a separate, focused look
   before the areas they touch can be called covered:
   - **`src/tour/serial-tour.ts` renders no controls.** With a serial tour mounted, the
     `<micrio-serial-tour>` element is created and `serialtour-*`, `markerTourActive` and
     the cross-image step advance all work, but the element's own `_onMount` produces no
     children: no progress bars, no chapter list, no time display. Confirmed with a
     mounted tour, step markers carrying video tours, `printChapters`, and both with and
     without a video tour on the marker.
   - **`_markers.tourControlsInPopup: true` renders no controls either.** With that
     setting the `<micrio-tour>` element mounts but is empty, where without it the aside
     (prev/counter/next/fullscreen/close) renders normally.
2. **Grid storytelling** (`src/grid/**`) — its own session: layout math, transitions,
   keyboard, action handlers, marker-driven grid tours.
3. **Audio controller** (`src/audio/**`) — the sequential playlist, `AudioContext`
   gain/volume and positional audio. Needs a stubbed `AudioContext`.
4. **Media adapters** — HLS/YouTube/Vimeo adapter contracts against stubbed players.
5. **UI components** — toolbar/menu/popover rendering and locale switching beyond the
   tour entries.
6. **3D book viewer in depth** — page flip, physics, lighting, IIIF page manager. Only
   after the other subsystems, and only with golden-image or geometry assertions.
7. **Coverage ratchet** — add `@vitest/coverage-v8`, record a baseline, then raise a
   floor. Deliberately postponed: no thresholds while most of the tree is still untested.
8. **CI** — a GitHub Actions workflow that installs the Playwright browser and runs
   `test:core` + `test:browser`.
