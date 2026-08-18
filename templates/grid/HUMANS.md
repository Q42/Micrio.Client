# Grid storytelling — the human guide

> This is the non-developer companion to `README.md`. You don't need to write a
> single line of JavaScript — everything here is data you set on **markers**,
> **marker tours** and **video tours** in the Micrio editor
> ([dash.micr.io](https://dash.micr.io/)). When a visitor opens a marker or a
> tour plays, the grid reads those values and reacts.

A **Grid** in Micrio shows an album's images as a mosaic of cells. From
published data you can make it:

- re-arrange itself into a different layout,
- make one image bigger (span more cells),
- zoom into a single image,
- show only the paintings that share a **motif** (a marker tag),
- and play all of the above back on a **timeline**.

---

## The three building blocks

| Block | When it fires | What it can do |
|-------|---------------|----------------|
| **Marker** (its "Custom JSON") | The moment the marker is opened | Run one grid action, resize a tile, stay in grid view. |
| **Marker tour** | As the visitor walks through the steps | Open markers one-by-one, possibly across different images. |
| **Video tour** (or a marker's own video tour) | While it plays | Move the camera, then fire grid actions at chosen times. |

All three use the **same grid action language** — learn it once, use it
everywhere.

---

## Marker "Custom JSON" — the special keys

Every marker has a **Custom JSON** field. The grid reads three keys from it:

| Key | Value | What it does |
|-----|-------|--------------|
| `gridAction` | a grid action, see below | Runs that action the moment the marker opens. |
| `gridSize` | a number or `"columns,rows"` | Makes the image's tile bigger while the marker is open. |
| `gridView` | `true` | For multi-image tour steps: keep the grid view instead of zooming into one image. |

Example Custom JSON that resets the grid when the marker opens:

```json
{ "gridAction": "reset" }
```

Example that makes the tile 2 columns × 2 rows:

```json
{ "gridSize": "2,2" }
```

(`gridSize` as a single number means "square", so `2` is the same as `"2,2"`.)

---

## The grid action language

A **grid action** is one of these, written as `action` or `action|data`. The
part after the `|` is the action's *data*.

| Action | Data (after `\|`) | What it does |
|--------|-------------------|--------------|
| `reset` | — | Show the full overview again (every image). |
| `focus` | image IDs, comma-separated | Show only those images. One ID opens it full-screen; several make a small grid of just those. |
| `flyTo` | image IDs, comma-separated | Pan/zoom the whole view so all the named images are on screen. |
| `focusTagged` | a tag name | Show only paintings that have a marker with this tag, **zoomed in on each marker**. |
| `focusWithTagged` | a tag name | Show only paintings that have a marker with this tag, each at **full view**. |
| `back` | — | Undo the last layout change (go back one step). |
| `switchToGrid` | — | Drop the currently opened image back into the grid. |
| `filterTourImages` | `h` (optional) | Show only the images that are steps of the currently running marker tour. |
| `nextFadeDuration` | seconds (a number) | Set the crossfade length for the *next* change only. |

### The `h` flag

Append `|h` to `focus`, `focusTagged` or `focusWithTagged` to lay the result
out as a single horizontal row:

```json
{ "gridAction": "focus|imgA,imgB,imgC|h" }
```

### Examples

```json
{ "gridAction": "focus|imgA" }
{ "gridAction": "focus|imgA,imgB" }
{ "gridAction": "flyTo|imgA,imgB,imgC" }
{ "gridAction": "focusTagged|boats" }
{ "gridAction": "focusWithTagged|architecture" }
{ "gridAction": "filterTourImages|h" }
{ "gridAction": "nextFadeDuration|3" }
```

---

## Marker tags — grouping paintings by motif

A marker can carry one or more `tags`. Tags are the glue behind
`focusTagged` / `focusWithTagged`: give several markers across *different*
paintings the same tag, and one action can pull up all those paintings at once.

For example, tag a marker on *The Dogana* and one on *Boston Harbor* with
`boats`. Then:

- `focusTagged|boats` → shows just those paintings, zoomed onto the boats.
- `focusWithTagged|boats` → shows just those paintings, full view.

Tags are matched **exactly**, so pick short, lowercase, consistent names
(`boats`, `figures`, `architecture`, …). Don't use `|` or `,` in a tag name —
those characters are the delimiters.

---

## Linking images & transitions

### `micrioLink` — jump to another image

A marker can link to another image. In a grid, opening that link focuses the
target image:

```json
{ "micrioLink": { "id": "imgC" } }
```

### `gridTourTransition` — how a tour jump animates

When a tour jumps to a marker's image, this chooses the transition animation:

```json
{ "gridTourTransition": "slide-up" }
```

Available values: `crossfade`, `slide`, `slide-horiz`, `slide-vert`,
`slide-up`, `slide-down`, `slide-right`, `slide-left`, `swipe`,
`swipe-horiz`, `swipe-vert`, `swipe-up`, `swipe-down`, `swipe-right`,
`swipe-left`, `behind`, `behind-left`, `behind-right`.

---

## Marker tours — a guided walk through markers

A **marker tour** is an ordered list of markers the visitor walks through with
Next/Previous. Each step is one marker, and every step can live on a
**different image** — that's what makes it a multi-image tour across the grid.

Each step carries:

| Field | Meaning |
|-------|---------|
| `markerId` | which marker to open |
| `micrioId` | which image that marker lives on |
| `duration` | how long the step lasts (seconds) |
| `gridView` | stay in the grid view for this step (optional) |

### Serial tours

Turn the tour into a **serial tour** by setting `isSerialTour: true`. Instead
of Next/Previous buttons you get one continuous timeline with a progress bar
per step (and chapters). In practice each serial step usually carries a small
video tour (see below), and when that step's media ends the tour advances to
the next step automatically.

---

## Video tours — a camera path plus timed events

A **video tour** plays a camera path (`timeline`) and can fire timed
**events** while it plays. It has:

- `duration` — total length, in seconds.
- `timeline` — a list of camera positions. Each entry is
  `start` (when the camera arrives), `end` (when it leaves), and `rect`
  (the view `[x, y, w, h]`).
- `events` — timed actions, the subject of the next section.

A **marker can carry its own video tour** in its `videoTour` setting: opening
that marker (with no popup) starts the tour. That's the trick behind
"tap a marker and a guided camera sequence begins".

> No audio needed: a video tour with no media still runs — the camera moves and
> the events fire on a timer.

---

## Video-tour events = grid triggers on a timeline

This is the most powerful bit. A video tour's `events` let you fire grid
actions at exact moments.

Each event has:

| Field | Meaning |
|-------|---------|
| `start` | when it becomes active (seconds) |
| `end` | when it stops being active (seconds) |
| `action` | what to do — for the grid, write `grid:` + an action name |
| `data` | the action's data (tag name, image IDs, …) |

The action fires **once**, when the event becomes active at `start`, and its
duration is `end − start`.

The action name is one of the [grid actions](#the-grid-action-language) above,
prefixed with `grid:`. The `data` is the same as the part after the `|` in a
marker's `gridAction` — but here it's a **separate field**.

So a marker `gridAction` of `focusTagged|boats` becomes an event of:

```json
{ "start": 4, "end": 6, "action": "grid:focusTagged", "data": "boats" }
```

### A complete example

A 14-second video tour that moves the camera and re-arranges the grid as it
goes:

```json
{
  "id": "guided-tour",
  "i18n": {
    "en": {
      "title": "Guided grid tour",
      "duration": 14,
      "timeline": [
        { "start": 0,  "end": 2,  "rect": [0, 0, 1, 1] },
        { "start": 4,  "end": 8,  "rect": [0.3, 0.2, 0.45, 0.55] },
        { "start": 10, "end": 14, "rect": [0, 0, 1, 1] }
      ],
      "events": [
        { "start": 0.5, "end": 1.5, "action": "grid:reset" },
        { "start": 5,   "end": 7,   "action": "grid:focusWithTagged", "data": "architecture" },
        { "start": 8.5, "end": 9.5, "action": "grid:focusTagged",     "data": "boats" },
        { "start": 11,  "end": 14,  "action": "grid:reset" }
      ]
    }
  }
}
```

Reading that timeline in plain English: start with the overview, zoom into a
detail, zoom back out — and along the way, show the *architecture* paintings,
then zoom in on every *boats* motif, then return to the full overview.

---

## Recipes

### "Open a marker → show the related paintings"

1. Add a tag (e.g. `figures`) to one marker on each painting you want to group.
2. On the marker that starts the story, set Custom JSON:

```json
{ "gridAction": "focusWithTagged|figures" }
```

### "Open a marker → zoom in on a motif"

Same, but zoom to the markers:

```json
{ "gridAction": "focusTagged|figures" }
```

### "Make one painting the hero"

On a marker inside that painting, set its tile size:

```json
{ "gridSize": "2,2" }
```

### "A guided, timed walk through the grid"

Give a marker its own `videoTour` whose `events` sequence `grid:` actions —
like the complete example above. Opening the marker plays the whole thing.

### "A chaptered story across many paintings"

Build a **marker tour** whose steps live on different images, with
`isSerialTour: true`, and give each step a short video tour (its `duration`
drives the progress bar). The story advances image by image, firing any
`grid:` events you placed in each step.

### "End back where you started"

Put `grid:reset` (or a marker `gridAction` of `reset`) at the end of the
timeline / last step.

---

## Cheat sheet

### Marker Custom JSON keys

| Key | Example value |
|-----|---------------|
| `gridAction` | `"focus|imgA,imgB|h"` |
| `gridSize` | `2` or `"2,2"` or `"3,2"` |
| `gridView` | `true` |

### Marker data fields

| Field | Example value |
|-------|---------------|
| `micrioLink` | `{ "id": "imgC" }` |
| `gridTourTransition` | `"slide-up"` |

### Marker fields (on the marker itself)

| Field | Example value |
|-------|---------------|
| `tags` | `["boats", "figures"]` |
| `videoTour` | a video-tour object (see above) |

### Video-tour event

| Field | Example value |
|-------|---------------|
| `start` / `end` | `4` / `6` (seconds) |
| `action` | `"grid:focusTagged"` |
| `data` | `"boats"` |

### Grid actions at a glance

`reset` · `focus` · `flyTo` · `focusTagged` · `focusWithTagged` · `back` ·
`switchToGrid` · `filterTourImages` · `nextFadeDuration`

---

## Notes & gotchas

- **Durations are seconds** everywhere (video-tour `duration`, event `start`/
  `end`, `nextFadeDuration`, step `duration`).
- **`focusTagged` zooms in** on the markers; **`focusWithTagged` shows full
  view**. Easy to mix up — the "With" variant stays wide.
- **Marker `gridAction` joins action and data with `|`**
  (`"focusTagged|boats"`). **Video-tour events keep them separate** and prefix
  the action with `grid:` (`"action": "grid:focusTagged"`, `"data": "boats"`).
- **Tag names and image IDs must match exactly** (they're case-sensitive).
  Avoid `|` and `,` inside them — those are the delimiters.
- **An event fires once**, when it becomes active at its `start` time — it
  doesn't repeat while it's active.
- **`filterTourImages` only does something while a marker tour is running** —
  it reads the running tour's steps.
- **`back`/`switchToGrid` need history or a focused image** — they're for
  "undo the last move" and "put the opened image back", not standalone effects.
