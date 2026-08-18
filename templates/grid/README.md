# Micrio Grid

A **Grid** in Micrio is a gallery view that lays out a set of images as a
CSS grid instead of the usual single-image "swipe" or "switch" gallery.
One image acts as the *viewport* (the `micrio.image`), and every other image
in the album becomes a *cell* inside that viewport.

The Grid is a full storytelling tool. Beyond simply showing thumbnails, the
Grid controller can:

- re-arrange the grid into any layout (one column, one row, a mosaic, a
  filtered subset, …),
- resize individual cells so they span multiple columns and/or rows,
- animate **transitions between two configurations** (crossfade, slide,
  swipe, "behind", staggered appear, …),
- **focus** on a single image (zoom into it, with an exit animation), and
  navigate back to the overview,
- be driven **declaratively from data**: Micrio Markers and Tours can trigger
  any of these behaviors.

Everything below is derived from the source in `src/grid/` — read that if you
want the exact behavior behind an API.

---

## Contents

1. [How a grid is created](#how-a-grid-is-created)
2. [Getting a reference to the Grid controller](#getting-a-reference-to-the-grid-controller)
3. [The data model](#the-data-model)
4. [The Grid API](#the-grid-api)
5. [Grid actions](#grid-actions)
6. [Driving grids from Markers](#driving-grids-from-markers)
7. [Driving grids from Tours](#driving-grids-from-tours)
8. [Grid settings](#grid-settings)
9. [Grid events](#grid-events)
10. [A complete storytelling example](#a-complete-storytelling-example)

---

## How a grid is created

A grid is a *gallery* whose `type` is `'grid'`. In the Micrio data model that
is `GalleryConfig.type` (`'swipe' | 'switch' | 'grid' | 'book3d'`).

```js
const galleryConfig = {
  type: 'grid',
  // optional: click/pan behavior
  grid: {
    clickable: 'focus',   // 'focus' | 'zoom' | false
    panZoom:   'grid',    // 'cells' | 'grid'
  },
};
```

In practice you almost never build a grid by hand: you publish an **album** in
the [Micrio editor](https://dash.micr.io/) with the "grid" presentation, and
open it like any other Micrio image:

```html
<micr-io id="yourAlbumOrImageId"></micr-io>
```

When the album loads, Micrio instantiates a `<micrio-grid>` custom element and
attaches it to the parent image (`parent.grid`), which is why the controller is
reachable as `micrio.$current.grid`.

The grid's *cells* are the images of that album. Every image keeps its own
Micrio ID, and that ID is what you pass around in the API below.

---

## Getting a reference to the Grid controller

The controller is the `Grid` class defined in `src/grid/grid.ts`. You get a
reference to it through events, or directly off the parent image.

### Via the `grid-init` event

`grid-init` fires once, with the `Grid` instance as `event.detail`:

```js
const micrio = document.querySelector('micr-io');

micrio.addEventListener('grid-init', e => {
  const grid = e.detail; // the Grid controller
  console.log('Grid ready, images:', grid._images.length);
});
```

Use `grid-load` if you also need to wait for the *initial layout* to be
finished and the marker/tour hooks to be wired:

```js
micrio.addEventListener('grid-load', () => {
  // initial grid.set(...) has resolved, hooks are active
});
```

### Via the parent image

Once the grid album is open, the controller is attached to the main (parent)
image:

```js
const grid = micrio.$current?.grid;
```

Key public properties on the controller:

| Property | Type | Description |
|----------|------|-------------|
| `grid.micrio` | `HTMLMicrioElement` | The `<micr-io>` element. |
| `grid.image` | `MicrioImage` | The main viewport image the grid renders into. |
| `grid.$focussed` | `MicrioImage \| undefined` | The currently focused (single-view) image, if any. |

> **Note on durations.** Grid methods that accept a `duration` argument
> (`set`, `reset`, `back`, `gridFocus`, `action`, `enlarge`) take it in
> **seconds**. Internally the code multiplies by `1000` when handing the value
> to the camera. This matches the `grid.transitionDuration` setting, which is
> also in seconds.

---

## The data model

The grid works with a small set of types from `src/types/models/grid.ts`.

### `Grid.GridImage`

The unit of a layout — one image placed as one or more cells.

```ts
interface GridImage {
  /** Micrio image ID (must exist in the album). */
  id: string;
  /** Cell span as [columns, rows?]. `[1]` = 1×1, `[2]` = 2 columns wide, `[2,2]` = 2×2. */
  size: [number, number?];
  /** Normalized area `[x, y, w, h]` of the *viewport* this cell occupies.
   *  Auto-computed from the CSS grid when omitted. */
  area?: Camera.View;
  /** Normalized view `[x, y, w, h]` to fly this image's own camera to. */
  view?: Camera.View;
}
```

- `id` must refer to an image that is part of the grid album (`grid._imageMap`).
  The IDs come from the album's image list; `grid._images` and `grid._imageMap`
  are marked `@internal` in the source but are the practical way to enumerate
  the images and resolve IDs at runtime (used in the examples below).
- `size` controls the CSS `grid-area` span. `[1]` is a normal cell, `[2,1]` or
  `[2]` spans two columns, `[2,2]` spans two columns and two rows.
- `area` lets you position an image *within the viewport* directly (used
  internally for transitions). When omitted, the cell's bounding box is
  measured and used.
- `view` is the target viewport *inside* the image's own coordinate space
  (what you'd normally pass to `camera.flyToView`).

### `Grid.FocusOptions`

Options for `grid.gridFocus()`:

```ts
interface FocusOptions {
  /** Optional target view inside the image. */
  view?: Camera.View;
  /** Transition duration (seconds). */
  duration?: number;
  /** Focus transition animation (default: crossfade). */
  transition?: Grid.MarkerFocusTransition;
  /** Set the target viewport immediately (skip animating it). */
  noViewAni?: boolean;
  /** Animate the previously focused image to this view during exit. */
  exitView?: Camera.View;
  /** Limit the focused image to cover view (implies `cover`). */
  coverLimit?: boolean;
  /** Open as cover view, but do not hard-limit it. */
  cover?: boolean;
  /** Blur the image during the transition, in pixels. */
  blur?: number;
}
```

### Transitions

Focus transitions (`Grid.MarkerFocusTransition`):

```
'crossfade' | 'slide' | 'slide-horiz' | 'slide-vert' |
'slide-up' | 'slide-down' | 'slide-right' | 'slide-left' |
'swipe' | 'swipe-horiz' | 'swipe-vert' |
'swipe-up' | 'swipe-down' | 'swipe-right' | 'swipe-left' |
'behind' | 'behind-left' | 'behind-right'
```

Layout-set transitions (`Grid.GridSetTransition`), passed as
`set(images, { transition })`:

```
'crossfade' | 'behind' | 'behind-delayed' | 'appear-delayed'
```

---

## The Grid API

### `grid.set(images, opts?)` → `Promise<MicrioImage[]>`

Re-lays-out the grid to show the given images. This is the core primitive for
changing layout **and** transitioning between two configurations.

```js
// Reset to a 1×1 grid of every image in the album
await grid.set(
  grid._images.map(i => ({ id: i.id, size: [1] })),
  { duration: 1 }
);
```

```js
// Show only three images in a single horizontal row
await grid.set(
  [
    { id: 'imgA', size: [1] },
    { id: 'imgB', size: [1] },
    { id: 'imgC', size: [1] },
  ],
  { horizontal: true, duration: 1 }
);
```

```js
// A mosaic: one hero image spanning 2×2, plus a row of small cells
await grid.set(
  [
    { id: 'imgA', size: [2, 2] },
    { id: 'imgB', size: [1] },
    { id: 'imgC', size: [1] },
    { id: 'imgD', size: [1] },
  ],
  { duration: 1, transition: 'behind' }
);
```

Notable `set` options:

| Option | Type | Description |
|--------|------|-------------|
| `horizontal` | `boolean` | Force a single row (one column per image). |
| `columns` | `number` | Force an explicit column count. |
| `duration` | `number` | Transition duration in seconds. |
| `view` | `Camera.View` | Target view for the *viewport* image. |
| `transition` | `GridSetTransition` | `'crossfade'`, `'behind'`, `'behind-delayed'`, `'appear-delayed'`. |
| `noHistory` | `boolean` | Do not push the current layout onto the history stack. |
| `keepGrid` | `boolean` | Keep existing layout while re-arranging. |
| `cover` | `boolean` | Place images as cover view. |
| `coverLimit` | `boolean` | Limit zoom to cover scale. |
| `scale` | `number` | Shrink cells (0…1), effectively adds spacing. |
| `noBlur` / `noFade` | `boolean` | Skip the automatic un-focus / fade handling. |
| `noCamAni` | `boolean` | Skip camera animation on the placed images. |

`set()` returns a promise that resolves with the placed `MicrioImage[]` once
the transition is done.

### `grid.gridFocus(img, opts?)` → `Promise<void>`

Focus the grid on a **single** image. This is how you "zoom into" one image
from the overview.

```js
const target = grid._images.find(i => i.id === 'imgB');
await grid.gridFocus(target, {
  transition: 'slide-up',
  duration: 1,
  view: [0.25, 0.25, 0.5, 0.5], // optional: target view inside the image
});
```

- Pass `undefined` as the image to go **back** to the overview (same as
  `grid.back()`).
- The transition list is `Grid.MarkerFocusTransition` (see above).
- After focusing, the image's close button calls `grid.back()`, and `Escape`
  does the same when keyboard hooks are enabled.

### `grid.blur()`

Remove focus from the currently focused image and return to the grid overview,
**without** animating back through history:

```js
grid.blur();
```

### `grid.back(duration?)` → `Promise<void>`

Navigate to the *previous* layout state on the history stack. `set()` pushes
history automatically unless you pass `noHistory: true`; `gridFocus()` pushes
history too, so `back()` undoes the last layout change or focus.

```js
await grid.back(0.8);
```

### `grid.reset(duration?, noCamAni?, forceAni?)` → `Promise<MicrioImage[]>`

Reset to the initial layout (every album image) and clear all history.

```js
await grid.reset(1);
```

### `grid.enlarge(idx, width, height = width)` → `Promise<MicrioImage[]>`

Enlarge a specific cell to span `width`×`height` cells, re-laying out without
recording history. `idx` is the index in the **current** layout.

```js
// Make the first cell 2 columns × 2 rows
await grid.enlarge(0, 2, 2);
```

### `grid.action(action, data?, duration?)`

Execute a named grid action. This is the same dispatcher that Markers and
Tours use internally, so you can call the exact same actions from your own
code:

```js
grid.action('focus', 'imgA,imgB', 1);   // focus two images
grid.action('reset');                    // reset the grid
grid.action('flyTo', 'imgA,imgB');       // fit the viewport around two images
```

The full action list is in the next section.

---

## Grid actions

`GridActionType` (in `src/grid/actions.ts`) defines the built-in actions. They
are triggered through `grid.action(name, data, duration)` and, from data,
through marker `_meta.gridAction` and tour events (see below).

| Action | Data | Behavior |
|--------|------|----------|
| `focus` | comma-separated image IDs, optional `\|h` | Show only those images. One ID → `gridFocus`; multiple IDs → `set(...)` (add `\|h` for a horizontal row). |
| `flyTo` | comma-separated image IDs | Animate the *viewport* camera to fit the bounding box of those images. |
| `focusTagged` | tag name, optional `\|h` | Show images that contain markers with this tag, and fly each image to the matching marker's `view`. |
| `focusWithTagged` | tag name, optional `\|h` | Show images that contain markers with this tag, keeping each image at full view (no zoom to the marker). |
| `reset` | — | Reset the grid to the initial layout and view. |
| `back` | — | Go back one step in layout history. |
| `switchToGrid` | — | Instantly return a focused image to its position inside the grid layout. |
| `filterTourImages` | optional `'h'` | Show only images that are steps of the currently running marker tour. |
| `nextFadeDuration` | duration in seconds | Set a one-time crossfade duration for the **next** transition only. |

Example — a marker that focuses two images side by side:

```json
{
  "gridAction": "focus|imgA,imgB|h"
}
```

`gridAction` is split on `|`: first part is the action name, the rest is the
action data.

---

## Driving grids from Markers

Markers can trigger grid behavior through their `data` object. In the editor
this is the marker's **"Custom JSON"** field, exposed in the model as
`Marker.data._meta` (see `src/types/models/data.ts`).

### `_meta.gridAction`

When a marker opens, the grid reads `marker.data._meta.gridAction`, splits it
on `|`, and runs `grid.action(...)`:

```json
{
  "_meta": {
    "gridAction": "focus|imgA"
  }
}
```

```json
{
  "_meta": {
    "gridAction": "flyTo|imgA,imgB,imgC"
  }
}
```

```json
{
  "_meta": {
    "gridAction": "reset"
  }
}
```

This is the primary, data-driven way to script a grid narrative from markers.

### `_meta.gridSize`

When a marker opens *inside* a grid, the tile of the image containing that
marker is resized. It accepts a single number (square) or a
`"columns,rows"` string:

```json
{
  "_meta": {
    "gridSize": 2
  }
}
```

```json
{
  "_meta": {
    "gridSize": "2,2"
  }
}
```

### `_meta.gridView`

Marks a multi-image tour step as staying *in the grid view* instead of
focusing a single image. It is carried through into the generated tour step
info (`MarkerTourStepInfo.gridView`), and `micrio.open(id, { gridView: true })`
keeps the grid active while the tour moves between images.

### Marker `micrioLink`

A marker with `data.micrioLink` (a partial image info containing an `id`)
opens that image. Inside a grid, opening an image that exists in the grid
calls `grid.gridFocus()` on it (see `open()` in `src/core/element.ts`):

```json
{
  "micrioLink": { "id": "imgC" }
}
```

### `data.gridTourTransition`

Per-marker field that selects the focus transition used when a grid tour
jumps to this marker's image (`Grid.MarkerFocusTransition`):

```json
{
  "gridTourTransition": "slide-up"
}
```

---

## Driving grids from Tours

The grid listens for Micrio **tour events** whose `action` starts with
`grid:`. Any tour event of the form `action: "grid:<name>"` is dispatched to
the same action handler, with the event's `data` and its duration
(`event.end - event.start`):

```json
{
  "start": 0,
  "end": 2,
  "action": "grid:focus",
  "data": "imgA,imgB|h"
}
```

```json
{
  "start": 2,
  "end": 5,
  "action": "grid:reset"
}
```

Because these reuse `GridActionType`, every action in the
[table above](#grid-actions) is available in a tour timeline: `grid:focus`,
`grid:flyTo`, `grid:focusTagged`, `grid:focusWithTagged`, `grid:reset`,
`grid:back`, `grid:switchToGrid`, `grid:filterTourImages`,
`grid:nextFadeDuration`.

This is how you sequence an entire grid narrative along a video tour timeline.

---

## Grid settings

Grid behavior is configured on the image settings (`ImageInfo.Settings.grid`,
see `src/types/models/info.ts`):

```js
micrio.defaultSettings = {
  grid: {
    clickable: 'focus',      // 'focus' | 'zoom' — false disables cell clicks
    panZoom:   'grid',       // 'cells' | 'grid'
    transitionDuration:    1,   // seconds (in)
    transitionDurationOut: 0.5, // seconds (back / out)
  },
};
```

- `clickable: 'focus'` expands a clicked cell to full view
  (`grid.gridFocus`).
- `clickable: 'zoom'` instead flies the *viewport* camera to the cell's area
  (no single-image focus).
- `panZoom: 'cells'` lets you pan/zoom the individual cell under the cursor;
  `'grid'` pans/zooms the whole grid container.

The same two fields exist on the gallery config
(`GalleryConfig.grid.clickable`, `GalleryConfig.grid.panZoom`). When a grid
album is loaded from an archive, Micrio also sets sensible defaults
(`zoomLimit: 15`, `minimap: false`, and `hookKeys: true` when clickable).

When `clickable` is enabled, keyboard navigation is available: **arrow keys**
move between adjacent cells and **Escape** goes back (from a focused image) or
resets the view.

---

## Grid events

Dispatched on the `<micr-io>` element (see `src/types/models/events.ts`):

| Event | Detail | Fires when |
|-------|--------|------------|
| `grid-init` | `Grid` | The controller is constructed and ready. |
| `grid-load` | `void` | All images in the grid have loaded (initial layout done). |
| `grid-layout-set` | `Grid` | The layout changed. |
| `grid-focus` | `MicrioImage` | The grid focused a single image. |
| `grid-blur` | `void` | Focus was removed / navigated away. |

```js
micrio.addEventListener('grid-focus', e => {
  console.log('Focused image:', e.detail.id);
});
```

---

## A complete storytelling example

This scripts a small narrative against a grid album: start with a hero cell,
then focus an image, then reveal a filtered layout, and reset.

```js
const micrio = document.querySelector('micr-io');

micrio.addEventListener('grid-load', async () => {
  const grid = micrio.$current.grid;
  const byId = id => grid._images.find(i => i.id === id);

  // 1. Opening layout: a 2×2 hero plus a row of small cells.
  await grid.set(
    [
      { id: 'hero',   size: [2, 2] },
      { id: 'intro',  size: [1] },
      { id: 'scene1', size: [1] },
      { id: 'scene2', size: [1] },
    ],
    { duration: 1 }
  );

  // 2. Focus the hero with a slide-up transition.
  await grid.gridFocus(byId('hero'), {
    transition: 'slide-up',
    duration: 1,
  });

  // 3. Back to the overview, then reveal only the "story" images.
  await grid.back(0.8);
  await grid.set(
    grid._images
      .filter(i => i.id.startsWith('scene'))
      .map(i => ({ id: i.id, size: [1] })),
    { horizontal: true, duration: 1, transition: 'appear-delayed' }
  );

  // 4. The same via a named action, and finally reset.
  grid.action('filterTourImages', 'h', 1);
  grid.action('reset');
});
```

The marker/tour sections above show how to express steps 2–4 as **data**
(`_meta.gridAction`, `micrioLink`, and `grid:` tour events) so the same
narrative can be authored in the editor rather than in code.

---

## Reference: source files

| File | Purpose |
|------|---------|
| `src/grid/grid.ts` | The `Grid` controller (layout, focus, history, actions). |
| `src/grid/actions.ts` | `GridActionType` enum. |
| `src/grid/action-handlers.ts` | Action implementations + tour-event dispatch. |
| `src/grid/transitions.ts` | Focus/set transition implementations. |
| `src/grid/format.ts` | Column calculation and slide/swipe areas. |
| `src/grid/keyboard.ts` | Arrow-key / Escape navigation. |
| `src/types/models/grid.ts` | `GridImage`, `FocusOptions`, transition types. |
| `src/types/models/info.ts` | `Settings.grid` and `GalleryConfig.grid`. |
| `src/types/models/data.ts` | `Marker.data._meta`, `gridTourTransition`. |
| `src/gallery/controller.ts` | Creates the grid when gallery `type === 'grid'`. |
