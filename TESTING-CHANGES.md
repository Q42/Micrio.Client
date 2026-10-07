# What the unit-test branch changed

A manual-test checklist for the `feature/vitest-unit-testing` branch: every behavioural
change in `src/` relative to `main`, subsystem by subsystem. `main` is the reference — if
something looks different from `main`, this document should say why.

Scope: **product code only**. The ~200 added test files, fixtures and helpers are not
listed; `TESTING.md` covers those. Build/tooling changes are in the last section because
they can still change what you see in the browser.

How to read it: a bullet is one change, tagged **bugfix**, **feature**,
**behaviour change**, **refactor** or **docs/types**. Where a change fixes a real defect,
the defect is stated as `old → new`. Line links point at the current file, so they stay
useful after the line counts settle.

> **Files that look changed but are not, behaviourally:** `src/render/shared.ts`,
> `src/core/globals.ts`, `src/core/frame.ts`, `src/core/camera.ts` and `src/core/events/pinch-shared.ts`
> are unchanged versus `main` (or comment-only), so they are deliberately absent below.

## Where to test first

Sorted by how much of the code path moved, and how visible a regression would be:

1. [Embeds](#embeds-and-media) — the largest change: sizing, lifecycle, grid state, video.
2. [Markers](#markers) — clustering, popup/tour plumbing, cluster counts.
3. [Grid](#gallery-and-grid) — action dispatch, marker-driven resize, aborted animations.
4. [Omni and galleries](#gallery-and-grid) — dial, `startIndex`, `noDial`, album `goto`.
5. [Interaction (pan/zoom/pinch/double-tap)](#input-and-interaction) — the DPR/retina anchor fix.
6. [Book 3D](#book) — page geometry, `_stop()`, last-page boundary.
7. [Audio](#audio) — volume rules and teardown.

---

## The element shell

### src/core/element.ts

- **bugfix** — `open()` no longer races the element's own initial setup. `#print()` now
  caches its in-flight promise (`#printing`) and `open()` awaits it, unless it is the
  gallery re-entering from inside that run (`element.ts:604`). Before: opening an image
  right after mounting an album-by-id raced the album build into a second canvas.
- **bugfix** — a _closed_ image can be opened again: the dedupe check is now
  `this.$current && this.$current._placed && …` instead of just `this.$current`
  (`element.ts:807`). Before: an image whose canvas had been closed returned early and the
  viewer stayed blank.
- **bugfix** — `close()` is a no-op for an image that is not placed
  (`element.ts:946`), instead of throwing `Canvas is not placed yet`.
- **bugfix** — an IIIF response that is neither a usable manifest nor an Image API
  `info.json` is now rejected with `UNSUPPORTED_IIIF` / "Not a valid IIIF manifest or Image
  API info.json" (`element.ts:570`). Before: it became an image with `NaN` bounds and a
  silently blank viewer.
- **behaviour change** — the derived id strips the whole `info.json` suffix
  (`replace(/\/info\.json$/, '')`), so a path like `…/foo-info.json` no longer loses part of
  its id.
- **bugfix** — album failures are now visible in the console instead of silent: a failed
  bundle fetch or `_fromAlbum` logs `[Micrio] Could not load the bundle for …` /
  `[Micrio] Could not open the album for …`. **Test focus:** these appear in a clean test run
  (see TESTING.md), and an album that degrades to one image now says why.
- **feature** — `open()` accepts `opts.transition`, forwarded to a grid focus
  (`element.ts:904`), which is how a marker's `gridTourTransition` reaches the grid.
- **bugfix** — the first-load flag is guarded by a local instead of unsubscribing from
  inside the callback, which also made a **reconnecting** already-loaded `<micr-io>` throw.
- **bugfix** — a rejected grid focus is swallowed (`.catch(() => {})`) instead of surfacing
  as an unhandled rejection.
- **refactor** — `_canvases`/IIIF types tightened (`width`/`height` optional on the raw
  response, checked with `isImageSize`).

### src/core/image.ts

- **bugfix** — the orphaned-embed lifecycle: a destroyed `<micrio-embed>` marks its WebGL
  sub-image orphaned (`_orphanEmbed`, faded out and hidden), a rebuilt/re-connected embed
  re-adopts it (`_adoptEmbed`), and `_releaseOrphans()` drops whatever is still unclaimed
  (`image.ts:565`+). Before: sub-images leaked their engine entries and tiles.
- **refactor** — the 7-character V5 id flag decoding moved verbatim to `decodeV5Id()` in
  `$utils/id`; no behaviour change.

### src/core/store.ts

- **bugfix** — `set()` snapshots its subscriber set before notifying. Before: a subscriber
  that unsubscribed itself (or another) during notification skipped the next subscriber.

---

## Input and interaction

The theme here is one coordinate bug: several handlers mixed device pixels (`el.left`,
`el.top`) with element-relative CSS pixels. On a retina display (`devicePixelRatio > 1`)
or a host page that offsets the element, every anchored zoom/gesture was shifted.

### src/render/engine-camera.ts

- **bugfix** — `_touchArea` divides `el.left`/`el.top` by the DPR ratio
  (`engine-camera.ts:45`). Before: pinch/gesture anchoring was off by the retina factor.

### src/render/camera-2d.ts

- **bugfix** — `_zoom` no longer subtracts `el.left`/`el.top` from its
  **element-relative** anchor. Before: a zoom anchored at the pointer was displaced by the
  element's device-pixel offset.

### src/core/events/doubletap.ts, gesture.ts, wheel.ts

- **bugfix** — double-tap zoom subtracts the canvas bounding box, so the zoom centres on the
  tap rather than a shifted point.
- **bugfix** — the macOS `gesturechange` zoom anchors in element-relative pixels.
- **bugfix** — wheel zoom uses the **canvas element** bounding box (the space the camera
  viewport speaks), not the host element's, and swallows the rejection of an interrupted
  zoom animation.
- **refactor** — wheel's `#wheelEndTo` is `ReturnType<typeof setTimeout>` rather than `-1`.

### src/core/events/drag.ts + facade.ts

- **behaviour change** — a second press while panning is left to the pinch layer (the
  handler no longer stops the pan itself). **Test focus:** touch pan → add a second finger →
  pinch → lift one finger → pan again.
- **refactor** — the removed unreachable "pinching" branches.
- **bugfix** — `_getImage()` no longer bails out when the visible-images list has not been
  populated yet (`#visible` starts as `[]`), so the first interaction is hit-tested
  correctly.
- **feature** — an omni object with `omni.noKeys` never hooks the keyboard
  (`facade.ts:211`), so a host page (the dashboard preview) keeps its arrow keys.

---

## Render layer

### src/render/engine.ts

- **bugfix** — a released embed's slot is `undefined`, and drawing a tile for it now returns
  early instead of reading a stale image (`engine.ts:262`).
- **bugfix** — `_removeCanvas()` clears `_placed` and the active-canvas entry
  (`engine.ts:611`). Before: a closed image stayed "placed" with no canvas, so it could never
  be shown again.
- **feature/bugfix** — `_removeEmbed()` + `#releaseTiles()`: a destroyed embed detaches its
  engine image, clears every lookup, aborts in-flight tile downloads and frees its tiles.

### src/render/tile-canvas.ts

- **bugfix** — a canvas that has children (a gallery, grid or omni parent) is never faded
  out (`tile-canvas.ts:394`). Before: hidden, its `_shouldDraw` stopped stepping its
  children, which stalled every awaited strip/layout animation.
- **feature** — `_removeImage()` detaches an embedded image and drops its queued draw
  entries.

### src/render/tile-image.ts

- **behaviour change** — `#getTilesViewport()` always takes the wrapping path and keeps the
  seam adjustment that main only applied to the non-360 branch. Only reached for 360
  embeds, so **test focus:** 360 embeds that straddle the longitude seam.
- **refactor** — `#startOffset` → `_startOffset` (read by the engine's tile release).

---

## Markers

### src/markers/markers.ts

- **bugfix** — clustering: `no-cluster` is symmetric (either member opts the pair out), and
  a pair that bridges two existing groups now merges **both** groups
  (`markers.ts:71`+). Before: a bridged member ended up in two clusters, so one copy could
  stay hidden.
- **bugfix** — clusters clear when `clusterMarkers` is turned off while the layer is up
  (`clearClusters()`); overlap flags are restored at the same time.
- **bugfix** — a changed marker object (or a changed clickable-area marker) rebuilds its
  element: `#markerObjects` / `#areaObjects` compare the object each element was built from
  (`markers.ts:270`+). Before: edited marker data kept stale props until reload.
- **feature** — the layer reacts to the settings store (`_watchLater(image._settings, rebuild)`).
- **feature** — markers hide while a tour runs: always for video tours unless the tour sets
  `keepMarkers`; for a marker tour only with `_markers.hideMarkersDuringTour`
  (`markers.ts:229`). **Test focus:** the tour layer hides/shows and a step popup still opens.
- **bugfix** — the old `micr-io[data-video-tour-active] micrio-markers { display: none }` rule
  is replaced by a `.hidden` class driven by the store, so the layer's visibility follows the
  actual tour state.

### src/markers/markers.css

- **bugfix** — `micrio-markers.hidden { display: none }` replaces the
  `micr-io[data-video-tour-active]` selector (CSS, no other change to the layer's own styles).

### src/markers/marker.css

- **behaviour change** — the cluster button is flex-centred, so the member count
  (`clusterCount`, above) sits in the middle of the dot rather than on the text baseline.

### src/markers/marker.ts

- **bugfix** — a cluster renders its member count as the button text via the new
  `clusterCount` prop (`marker.ts:499`, CSS in `marker.css` makes the button flex-centred).
  Before: the count was set as `title`, i.e. only a tooltip.
- **bugfix** — a `customIconIdx` that no longer resolves falls back to the marker's own icon
  and then the image-wide one. Before: the marker rendered with **no** icon.
- **bugfix** — activating a marker no longer cancels its own video tour
  (`$tour !== marker.videoTour`), and the tour subscription's unsubscriber is assigned before
  the (synchronous) subscribe can re-enter — before, that path could throw in its temporal
  dead zone.
- **bugfix** — the marker-close path resolves a marker **id string** from state as well as an
  object, so closing a marker whose state holds an id works.
- **bugfix** — `keepPopupsDuringTourTransitions` keeps the popup across a tour step change
  (`marker.ts:425`); every other close still clears it.
- **refactor** — `flyToView(...)` rejections are handled (cluster click, split jump).

### src/markers/marker-popup.ts + marker-popup.css

- **bugfix** — a tour step can no longer be advanced twice by one click (`#stepping` guard).
- **bugfix** — tour controls are (re-)placed when the tour state changes, and the popup
  keeps asking for `<micrio-tour>`'s aside until it exists (`#placeTourAside`, polled per
  frame). Before: a tour started after the popup left it without controls.
- **feature** — `_markers.tourStepCounterInPopup` renders `current/n` in the popup's own
  aside; the tour's aside already carries one.
- **behaviour change** — the tour controls/close-button logic prefers the marker tour's
  **source image** settings over the popup image's.
- **removed** — the legacy `_markers.markerColor`, `markerSize` and `viewportIsMarker`
  settings are not read at all (`bdf066a`). They were briefly implemented on this branch and
  reverted after testing showed an old image's values repainting markers orange and sizing
  them to their `view`. **Test focus:** markers keep the theme colour and the fixed CSS size,
  with no hover twitch and no inline `--micrio-marker-size`.

### src/markers/marker-content.ts

- **bugfix** — `_markers.preventAutoPlay` now gates marker audio autoplay too
  (`autoplay: autoplayMedia && …`). Before: marker audio autoplayed regardless of the
  setting. The unused `paused` / `noPlayOverlay` props were dropped.

---

## Embeds and media

### src/embed/embed.ts — the biggest single change

- **feature** — `#applyContentSize()` is now the one place that sizes the built content
  (video, iframe, image, button) and is re-run on an editor `change`, so an embed's size
  follows its data after mount. **Test focus:** change an embed's area/size live and check
  the video/iframe/image follows.
- **bugfix** — the `pauseWhenLargerThan` screen-size calculation guards a `0×0` canvas
  viewport (`embed.ts` `#checkPause`). Before: at startup the size was infinite and every
  such video paused immediately.
- **bugfix** — a video with native `controls` is not swallowed by the `no-events` overlay
  (`#noEvents` now excludes `embed.video?.controls`), so its controls stay clickable.
- **bugfix** — the overlay's grid `inactive` state is re-applied after `#buildDOM`
  (`#syncGridInactive`), because the grid stores emit synchronously — i.e. before the
  overlay exists. Before: an inactive marker-embed overlay was never marked inactive.
- **bugfix** — `_onMount` clears previous content (`replaceChildren()`), and click/keydown
  handlers are registered as stable references so `_onDestroy` can actually detach them.
  Before: a re-connect duplicated the overlay and leaked listeners.
- **bugfix** — a destroyed embed calls `image._orphanEmbed(this.#glImage)` instead of fading
  and forgetting it, so a rebuild re-adopts and an unclaimed one is released.
- **bugfix** — a destroyed embed pauses its HTML `<video>`; before, a detached element kept
  decoding and playing.
- **bugfix** — `embed.path` / `embed.isSingle` win over the parent image's tile path
  (`path: embed.path ?? this.#info.tileBasePath ?? this.#info.path`), so an embed pointing at
  another bucket/org or a single file resolves correctly.
- **bugfix/behaviour change** — `_markers.embedsInHtml` now applies **only** to embeds a
  marker carries (its clickable areas), not to the image's own embeds.
- **bugfix** — the video cap is computed before the book3d early-return and malformed
  (`0×0`) dimensions fall back to the area width instead of dividing by zero.
- **behaviour change** — GL camera placement (`setArea`/`setRotation`) is applied on a
  prop change too, not only at mount.

### src/embed/image-embeds.ts

- **bugfix** — after rebuilding the list, the container calls `image._releaseOrphans()`, so
  sub-images of embeds that disappeared are released.

### src/media/html5-adapter.ts

- **bugfix** — every listener the adapter attaches is remembered and detached in `destroy()`.
  Before: the `timeupdate` / `durationchange` / `error` listeners were wrappers that
  `removeEventListener` could never match, so they kept firing after teardown.

### src/media/media.ts

- **refactor** — the never-read `MediaProps.paused` and `MediaProps.noPlayOverlay` were
  removed (its internal `#paused` field is untouched).

### src/tour/serial-tour.ts

- **bugfix** — the chapter list is created with `className: 'chapters'`, so the existing
  `ol.chapters` styles apply. Before: unstyled list.

---

## Audio

New: `src/utils/media-settings.ts` centralises the rules — `mutedVolume` (default `0`) and
`startVolume` (default `1`), each clamped to `[0, 1]`, plus `volumeFor(image, muted)` and
`imageHasAudio(image)`.

### src/audio/audio-controller.ts

- **bugfix** — muting no longer hard-codes volume `0`: mute plays at the image's
  `mutedVolume`, unmute at its `startVolume`. **Test focus:** images whose `mutedVolume` is
  not 0.
- **bugfix** — the autoplay-probe `<audio>` is only created when the image actually has audio
  (`imageHasAudio`), and both the element **and** its `pointerup` gesture listener are now
  removed on destroy. Before: the probe element stayed in `document.body` forever.
- **bugfix** — `AudioPlaylist` detaches its `ended` listener on destroy.

### src/audio/audio-location.ts

- **bugfix** — the repeating positional source detaches its `ended` listener on `#end`, so a
  torn-down source cannot reschedule playback.
- **bugfix** — `#end()` tolerates a half-initialised instance (`#panner?.` / `#gain?.`), which
  happens when the marker has no source or the element has no current image yet.

---

## Gallery and grid

### src/gallery/controller.ts

- **bugfix** — a caller's `startId` only overrides the album's own when the album actually
  contains that id; otherwise the album's `startId` wins (`controller.ts` `_fromAlbum`).
  Before: an unknown element id silently forced page 0.
- **behaviour change** — a book3d album builds its pages with the book's own page layout
  (`computePageLayout`), so album and viewer agree on the page count. Before: the album had
  one extra page the viewer clamped away.
- **refactor/docs** — the IIIF canvas-body narrowing and its documented boundaries
  (`Gallery._fromIIIF`).

### src/gallery/gallery.ts

- **bugfix** — `album.goto(i)` for an index that is not part of the album resolves
  `undefined` **without moving**; before it jumped to page 0.
- **bugfix** — `#imageIdxToPage()` returns `-1` for a miss instead of `0`.
- **bugfix** — releasing a scrubber drag re-renders the scrubber, so the handle does not keep
  its `dragging` class and mid-drag position.
- **bugfix** — switching to another book3d album stops the previous viewer (`_stop()`), whose
  frames would otherwise stay queued forever.

### src/gallery/omni.ts

- **feature** — `omni.startIndex` is honoured (wrapped into the first layer) for the initial
  frame, the dial rotation and preloading. Before: always frame 0.
- **feature** — `omni.noDial` is honoured: no dial element is created, and the swipe, frame
  strip and layer menu still work. Before: the dial was always built.
- **bugfix** — `omni.showDegrees` initialises the dial's degree readout, and a live
  `showDegrees` toggle is followed through the settings store.
- **bugfix** — a layer change re-syncs the dial from the **active frame**, not the layer
  index. Before: the dial jumped to the wrong angle.
- **bugfix** — the swipe's "full width" flag is seeded from the current view, not only from
  changes. Before: the first single-pointer drag after entering omni was inert.
- **refactor** — reads `image.$info` instead of a second `DataLoader` lookup, so an
  object-opened (cache-miss) image works.

### src/grid/action-handlers.ts

- **bugfix** — `focus` now accepts the marker's `gridTourTransition` and forwards it to
  `gridFocus`, so a marker-driven grid focus uses the authored transition.
- **bugfix** — every action promise handles its rejection (`grid.set`, `reset`, `back`,
  `_flyToMarkers`, `gridFocus`). Before: an aborted layout animation surfaced as an unhandled
  rejection.
- **bugfix** — a marker-driven resize (`_meta.gridSize`) is applied with `enlarge(idx, …)` at
  marker open. Before it was stored in a `#nextSize` map that later re-applied it at an
  unrelated moment.
- **bugfix** — `gridSize` values that are not positive integers (e.g. `"abc"` → `NaN`) no
  longer write a `span NaN` grid area.
- **bugfix** — a `flyTo` list drops ids that are not in the current layout, so naming none of
  them warns instead of falling back to defaults, and a mixed list does not pad the box out.

### src/grid/grid.ts

- **refactor** — the `#nextSize` map is gone; `action()` gained an optional focus transition.
- **bugfix** — the gallery grid's initial `set()` and the strip animations handle their
  rejections, so an interrupted layout no longer surfaces as an unhandled one.

### src/grid/keyboard.ts

- **bugfix** — keyboard `back()`, `reset()` and the per-image `flyToView` handle their
  rejections (all three can be aborted mid-animation).

---

## Book (3D)

### src/book/main.ts

- **bugfix** — the next-page guard is `#currentPage < #pageCount - 1` for both the button
  and the drag release, so the last page's `pageCount` value can no longer be reached.
- **bugfix** — `_stop()` cancels the pending frame and marks the viewer stopped. A host that
  discards a viewer mid-animation must call it (the gallery does); before, the dead viewer's
  physics kept running on every later frame.
- **feature (test hook)** — `_step(dtMs)` advances one frame deterministically and reports
  whether another is wanted. No production path calls it.
- **refactor** — page pairing and per-page aspects moved to `src/book/core/layout.ts`
  (`computePageLayout`, `computeTexRegion`) and the dead `computedPageWidths` (always ~1) was
  replaced by the `PAGE_WIDTH = 1` constant. Behaviour unchanged; the maths is now unit-tested.

### src/book/core/orbit-camera.ts

- **bugfix** — a degenerate radius range (`maxRadius === minRadius`, possible for a box small
  against the canvas) no longer produces a `NaN` camera eye: the zoom factor falls back to 0.

### src/book/geometry/cover-mesh.ts, paper-mesh.ts

- **bugfix** — `PaperMesh` takes a `generate` flag and `CoverMesh` passes `false`, skipping the
  base grid/constraint build that a subclass overriding private-member methods cannot survive
  (`super()` installs the private brand only after it returns). Before: constructing a
  `CoverMesh` could throw.

### src/book/rendering/iiif-manager.ts

- **bugfix** — a requested texture level is clamped to the source width
  (`width = Math.min(width, originalWidth)`), so a small original is never asked for a level
  wider than the source. An unknown (`0`) width keeps the screen-size choice, and an
  already-higher `currentLevel` is still never downgraded.

### src/book/rendering/lighting.ts

- **bugfix** — a preset's light count is clamped to `MAX_POINT_LIGHTS` (8), so a larger count
  no longer reports lights the shader never wrote. **Test focus:** the fireplace preset with
  a high `candleCount`.

### src/book/input/input.ts

- **refactor** — the two-pointer helper destructures `m.values()`; previously two `next()`
  calls with a manual `done` check. (The unreachable throw is gone.)

---

## UI and layout

### src/layout/main.ts

- **bugfix/feature** — the provided `volume` store follows the current image's
  `startVolume`/`mutedVolume` (`syncVolume`, `main.ts:170`) and is re-synced whenever the
  current image changes. Before: mute was `0`, unmute was `1`, for every image.
- **bugfix** — the popover is re-fed its props through `#show`'s update callback, so a
  popover replaced while open (a page switching to a gallery, a page action) actually
  re-renders.

### src/layout/popover.ts + popover.css

- **feature** — the welcome screen renders a language switcher (`menu.languages`) with the
  active language marked `.active`, built from the image's published `revision` languages.
  Only shown for a welcome page with more than one language (`popover.ts:96`).
- **bugfix** — a gallery is part of the popover's render key, so swapping one gallery for
  another (a marker's images) re-renders. Before: the first gallery stayed on screen.

### src/layout/menu.ts

- **bugfix** — a click that opens a sub-tree stops propagation, but a click that commits an
  entry does not. Before: opening a branch reached the window listener that the open state
  installs, closing what it had just opened.

### src/ui/dial.ts + dial.css

- **bugfix** — a zero-size (unstyled or hidden) dial ignores the drag instead of dividing by
  zero and handing back a non-finite frame; a non-finite target frame is also rejected.
- **bugfix** — the drag updates `currentRotation` and the degree readout live, so the readout
  tracks the drag rather than only the frames the parent echoes back.
- **feature** — the degree readout is created/removed with `degrees` (so a live toggle
  works), rendered as a `<span>` with its own styles.

### src/layout/nav/minimap.ts, src/core/split.ts

- **refactor** — minimap wheel zoom and split-view `flyToView` handle their rejections
  instead of leaving unhandled promises.

### src/types/models/info.ts

- **docs/types** — omni `frontIndex` and `twoAxes` are marked `@deprecated`: nothing in the
  client reads them and no dashboard page exposes them (the server still sends them).
  `noKeys` is documented as "an omni with this set never hooks the keyboard".
- **docs/types** — `_markers` no longer declares `markerColor`, `markerSize` or
  `viewportIsMarker`.

---

## Utils

| File                          | Change                                                                                                                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/dom.ts`            | **bugfix** — `loadScript` settles exactly once: a script whose `error` fires after its callback ran (or vice versa) no longer reports both, and the callback name is cleaned off `globalThis`. Before, a failing script with a `cbFunc` left every awaiting caller hanging. |
| `src/utils/id.ts`             | **refactor** — new `decodeV5Id()`, extracted verbatim from `MicrioImage`'s constructor.                                                                                                                                                                                     |
| `src/utils/object.ts`         | **bugfix** — `deepCopy` mirrors circular plain-object references (a `WeakMap` of source → target) instead of recursing forever.                                                                                                                                             |
| `src/utils/idle.ts`           | **refactor** — `to` is typed `ReturnType<typeof setTimeout>`.                                                                                                                                                                                                               |
| `src/utils/media-settings.ts` | **new** — the audio volume rules; see [Audio](#audio).                                                                                                                                                                                                                      |

---

## Build, tooling and docs (not product behaviour, but can affect what you test)

- **Tooling** — `vitest`, `@vitest/browser-playwright`, `@vitest/coverage-v8`, `playwright`
  and `@types/node` added; `test`, `test:core`, `test:browser`, `test:browser:live`,
  `test:coverage`, `test:watch` scripts added; `vitest.config.ts` added (two projects, a
  config-load cleanup of `.vitest/`, coverage floors); `tsconfig.json` now includes `tests`;
  `vite.config.js` exports its alias map and GLSL plugin for reuse; `.oxlintrc.json` relaxes
  strict rules under `tests/**`; `.vitest` is gitignored.
- **Docs** — `TESTING.md` added (the test plan of record), `README.md` gained a unit-test
  section, `AGENTS.md` gained the agent notes (WebGL context budget, the `Frame` singleton,
  no headless experiments without asking).
- **Not rebuilt** — `public/dist/*` is a build artifact and still reflects a previous build;
  it is not part of this diff.

## Branch totals (source only)

`git diff main --stat -- src`: **57 files, +1553 / −607**.
`git diff main --stat -- src tests`: 197 files, +32653 / −607.
210 commits on the branch; the last is `bdf066a fix(markers): ignore the legacy size,
colour and viewport settings`.
