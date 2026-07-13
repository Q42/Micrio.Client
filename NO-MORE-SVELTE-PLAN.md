# No More Svelte — Migration Plan & Status

Replace all Svelte in Micrio.Client with a self-made dynamic components framework
based on real `HTMLElement` custom elements. No virtual DOM, no template compilers,
no HTML strings — just real DOM nodes, imperative rendering, and a tiny reactive
store layer.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                        <micr-io>                             │
│                   (HTMLMicrioElement)                        │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                   <micrio-main>                        │  │
│  │  (root UI component, replaces Main.svelte)             │  │
│  │                                                         │  │
│  │  ┌──────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │  │
│  │  │ logo │ │ controls │ │ details  │ │ markers  │  …   │  │
│  │  └──────┘ └──────────┘ └──────────┘ └──────────┘      │  │
│  │     │          │             │            │            │  │
│  │     ▼          ▼             ▼            ▼            │  │
│  │  micrio-  micrio-       micrio-      micrio-          │  │
│  │  logo     controls      details      markers          │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Key Layers

| Layer | Location | Purpose |
|-------|----------|---------|
| **Store framework** | `src/ts/store.ts` | API-compatible replacement for `svelte/store` |
| **Component base** | `src/ts/component.ts` | `MicrioElement<P>` extends `HTMLElement` |
| **Components** | `src/components/micrio-*.ts` | Each `.svelte` → one custom element |
| **Entry point** | `src/ts/main.ts` | Defines `<micr-io>`, imports all components |

---

## Phase 1 — Store Framework (`src/ts/store.ts`) ✅

**Status: Complete**

Drop-in replacement for `svelte/store`. All 15+ TS files updated to import from
`$ts/store` instead of `svelte/store`.

### Exports

| Export | Signature | Notes |
|--------|-----------|-------|
| `writable` | `writable<T>(value?: T)` | `Set`-based subscriber list |
| `readable` | `readable<T>(value?, start?)` | Auto start/stop on first/last subscriber |
| `get` | `get<T>(store)` | Synchronous read via sub/unsub |
| `tick` | `tick()` | Returns `Promise.resolve()` |
| `Readable` | interface | `subscribe(run, invalidate?): Unsubscriber` |
| `Writable` | interface | extends `Readable` + `set` + `update` |
| `Unsubscriber` | type | `() => void` |

### Files updated

All files that previously imported from `svelte/store` or `svelte` now import
from `$ts/store`. The only remaining Svelte import is `mount`/`unmount` in
`element.ts` — these were removed when the root component migration was completed.

---

## Phase 2 — Component Base Class (`src/ts/component.ts`) ✅

**Status: Complete**

### Class: `MicrioElement<P>`

```typescript
class MicrioElement<P = {}> extends HTMLElement
```

| Feature | API | Description |
|---------|-----|-------------|
| **Props** | `_props: Partial<P>` | Merged props object, read in render |
| **Props setter** | `setProps(props: Partial<P>)` | Merges and calls `onPropsChange()` |
| **Lifecycle** | `onMount()`, `onDestroy()` | Called from `connectedCallback`/`disconnectedCallback` |
| **Props change** | `onPropsChange()` | Override to react to prop changes |
| **Store watch** | `watch<T>(store, fn)` | Auto-unsubscribed on disconnect |
| **Store once** | `watchOnce<T>(store, fn)` | Subscribe, fire once, unsubscribe |
| **Context provide** | `provide(key, value)` | Stores in per-element Map (Symbol-keyed) |
| **Context inject** | `inject<T>(key)` | Walks up DOM tree to find providing ancestor |
| **CSS injection** | `static styles: string` | Injected into `<head>` once per tag |
| **Tag name** | `static tag: string` | Used with `customElements.define()` |

### Static fields (to override)

```typescript
static tag: string;     // e.g. 'micrio-button'
static styles: string;  // CSS text
```

---

## Phase 3 — Component Migration

### Migration Pattern

Each `.svelte` file maps to one `micrio-*` custom element. The conversion follows
a consistent pattern:

| Svelte feature | Replacement |
|----------------|-------------|
| `$state(val)` | Class field |
| `$derived(expr)` | Getter or computed in `#render()` |
| `$effect(() => ...)` | `watch(store, ...)` or manual subscription |
| `$props()` / `$bindable()` | `_props` + `setProps()` |
| `{#if cond}` | `if(cond) appendChild(...)` or `el.style.display` toggle |
| `{#each list as item}` | `for(const item of list) appendChild(...)` |
| `{@html raw}` | `element.innerHTML = raw` |
| `on:click={fn}` | `el.addEventListener('click', fn)` |
| `bind:this={ref}` | Store ref in class field during render |
| `getContext(key)` | `this.inject(key)` |
| `setContext(key, val)` | `this.provide(key, val)` |
| `onMount(fn)` | `onMount()` lifecycle hook |
| `onDestroy(fn)` | `onDestroy()` lifecycle hook |
| `transition:fade` | CSS `@keyframes` + class toggle |
| `<style>` scoped | `static styles` string with class-based selectors |
| `<script module>` | Module-level exports |
| Svelte snippets | Regular DOM children via `appendChild` |

### Component File Structure

```typescript
// src/components/micrio-button.ts
import { MicrioElement } from '$ts/component';

export interface ButtonProps {
  type?: string;
  title?: string | null;
  disabled?: boolean;
  onclick?: (e: Event) => void;
}

export class MicrioButton extends MicrioElement<ButtonProps> {
  static tag = 'micrio-button';
  static styles = `.micrio-button { /* CSS from <style> */ }`;

  onMount() { this.#render(); }

  onPropsChange() { this.#render(); }

  #render() {
    const p = this._props as ButtonProps;
    const btn = document.createElement('button');
    btn.className = 'micrio-button';
    btn.disabled = !!p.disabled;
    btn.textContent = p.title ?? '';
    btn.addEventListener('click', (e) => p.onclick?.(e));
    this.replaceChildren(btn);
  }
}

customElements.define(MicrioButton.tag, MicrioButton);
```

### Component Dependency Graph

```
Layer 1 (leaf):  Icon  Button  ButtonGroup  ProgressCircle  ProgressBar
                      │
Layer 2 (simple): Logo  Error  Article  Fullscreen  ZoomButtons  Dial
                      │
Layer 3 (medium): Controls  Details  Subtitles  MediaControls  AudioLocation
                      │
Layer 4 (logic):   Markers  Marker  Waypoint  Embed  AudioPlaylist
                   AudioController  Events  ImageEmbeds
                      │
Layer 5 (complex): Toolbar  Menu  Gallery  MarkerPopup  Tour  SerialTour
                   Minimap  Popover  MicrioGallery
                      │
Layer 6 (root):    Main
```

Migration order: Layer 1 → Layer 6. Each layer depends only on layers below it.

### Components Migrated (14 of ~39)

| # | Component | Svelte file | Custom element | Status |
|---|-----------|-------------|----------------|--------|
| 1 | Icon | `src/svelte/ui/Icon.svelte` | `micrio-icon` | ✅ |
| 2 | Button | `src/svelte/ui/Button.svelte` | `micrio-button` | ✅ |
| 3 | ButtonGroup | `src/svelte/ui/ButtonGroup.svelte` | `micrio-button-group` | ✅ |
| 4 | ProgressCircle | `src/svelte/ui/ProgressCircle.svelte` | `micrio-progress-circle` | ✅ |
| 5 | ProgressBar | `src/svelte/ui/ProgressBar.svelte` | `micrio-progress-bar` | ✅ |
| 6 | Logo | `src/svelte/ui/Logo.svelte` | `micrio-logo` | ✅ |
| 7 | Error | `src/svelte/common/Error.svelte` | `micrio-error` | ✅ |
| 8 | Fullscreen | `src/svelte/ui/Fullscreen.svelte` | `micrio-fullscreen` | ✅ |
| 9 | ZoomButtons | `src/svelte/ui/ZoomButtons.svelte` | `micrio-zoom-buttons` | ✅ |
| 10 | Article | `src/svelte/common/Article.svelte` | `micrio-article` | ✅ |
| 11 | Details | `src/svelte/common/Details.svelte` | `micrio-details` | ✅ |
| 12 | Subtitles | `src/svelte/common/Subtitles.svelte` | `micrio-subtitles` | ✅ |
| 13 | Controls | `src/svelte/components/Controls.svelte` | `micrio-controls` | ✅ |
| 14 | **Main (root)** | `src/svelte/Main.svelte` | `micrio-main` | ✅ |

### Components Remaining (21)

| # | Component | Svelte file | Priority |
|---|-----------|-------------|----------|
| 1 | Media | `src/svelte/components/Media.svelte` | Medium |
| 2 | MediaControls | `src/svelte/components/MediaControls.svelte` | Medium |
| 3 | Marker | `src/svelte/components/Marker.svelte` | Medium |
| 4 | MarkerPopup | `src/svelte/components/MarkerPopup.svelte` | Medium |
| 5 | MarkerContent | `src/svelte/common/MarkerContent.svelte` | Medium |
| 6 | Menu | `src/svelte/components/Menu.svelte` | Medium |
| 7 | Toolbar | `src/svelte/components/Toolbar.svelte` | Medium |
| 8 | Gallery | `src/svelte/components/Gallery.svelte` | Medium |
| 9 | Minimap | `src/svelte/components/Minimap.svelte` | Medium |
| 10 | Waypoint | `src/svelte/components/Waypoint.svelte` | Low |
| 11 | Tour | `src/svelte/virtual/Tour.svelte` | Low |
| 12 | SerialTour | `src/svelte/virtual/SerialTour.svelte` | Low |
| 13 | Popover | `src/svelte/components/Popover.svelte` | Low |
| 14 | MicrioGallery | `src/svelte/components/MicrioGallery.svelte` | Low |
| 15 | Embed | `src/svelte/virtual/Embed.svelte` | Low |
| 16 | ImageEmbeds | `src/svelte/virtual/ImageEmbeds.svelte` | Low |
| 17 | AudioController | `src/svelte/virtual/AudioController.svelte` | Low |
| 18 | AudioPlaylist | `src/svelte/virtual/AudioPlaylist.svelte` | Low |
| 19 | AudioLocation | `src/svelte/virtual/AudioLocation.svelte` | Low |
| 20 | Events | `src/svelte/virtual/Events.svelte` | Low |
| 21 | LogoOrg | `src/svelte/ui/LogoOrg.svelte` | Low |

---

## Phase 4 — Root Mounting ✅

**Status: Complete**

### Before (Svelte)
```typescript
// element.ts:_ui
_ui:{setProps?:(p:Partial<MicrioUIProps>) => void}|undefined;

// element.ts:printUI()
this._ui = mount(HTMLMicrioElement.Svelte, {target:this, props:{micrio:this, noHTML, noLogo}});

// element.ts:destroy()
if(this._ui) unmount(this._ui);
```

### After (Custom Element)
```typescript
// element.ts:_ui
_ui:any;  // MicrioMain instance

// element.ts:printUI()
const el = document.createElement('micrio-main');
this._ui = el;
this.appendChild(el);
this._ui?.setProps?.({micrio: this, noHTML, noLogo});

// element.ts:destroy()
if(this._ui) this._ui.remove();
```

### Entry point (`main.ts`)

```typescript
import '../components/micrio-main';  // imports all components, each self-registers
import { HTMLMicrioElement } from './element';
import { VERSION } from './version';

HTMLMicrioElement.VERSION = VERSION;
customElements.define('micr-io', HTMLMicrioElement);
```

---

## Phase 5 — Build System Cleanup ✅

**Status: Complete**

### Removed from `package.json`
- `svelte` (runtime dependency)
- `@sveltejs/vite-plugin-svelte`
- `svelte-preprocess`
- `@tsconfig/svelte`

### Removed from `vite.config.js`
- Entire `svelte()` plugin block (previously the only plugin)
- `cssHash` Svelte config

### Removed from `tsconfig.json`
- `"extends": "@tsconfig/svelte/tsconfig.json"`
- `"src/svelte/Main.svelte"` from include
- Added `"src/components/**/*"` to include

### Removed from `src/types/models.ts`
- `/// <reference types="svelte" />`

### Current build stats
- **Modules:** 65
- **Output:** 205.44 kB (62.70 kB gzipped)
- **Build time:** ~530ms

---

## Key Design Decisions

### Why not Shadow DOM?
Light DOM preserves existing CSS custom property theming (`--micrio-*` on
`<micr-io>`), avoids breaking `:global()` patterns, and keeps `getComputedStyle`
working from the host element.

### Why not lit/html template literals?
The user explicitly requested "real, dynamic HTMLElements — no HTML strings."
Components use `document.createElement()`, `appendChild()`, and standard DOM APIs.

### Why not virtual DOM?
Each component fully controls its own subtree. Parent components re-render by
rebuilding `this` children on store changes. Leaf components update targeted
attributes/classes without full rebuilds when possible.

### CSS strategy
Each component's `static styles` string is injected into `<head>` once on first
mount of that tag (`<style data-micrio="micrio-button">`). CSS custom properties
handle theming without scoping issues. Class-based selectors (`.micrio-button`)
are used instead of Svelte's scoped hash approach.

### Context vs. Svelte's getContext
`provide(key, value)` stores in a `Map` keyed by `Symbol` on the element.
`inject(key)` walks `parentElement` up the DOM tree. This replaces
`setContext`/`getContext` without needing a separate registry.

### Transitions
Svelte `fade`/`fly` transitions are replaced by CSS `@keyframes` + class
toggling. Entry animations use `animation` on the element when appended.
Exit animations use `animation` before `remove()`.

### "Virtual" (renderless) components
Components like `AudioController`, `Events`, `ImageEmbeds`, and `Markers` manage
subsystems without rendering visible DOM. In the new system, these are either
plain classes instantiated by `micrio-main` or custom elements that render
nothing but run logic in `onMount`/subscriptions.

---

## CSS Extraction Strategy

The current state injects CSS at runtime via `static styles`. For a production
build, two options exist:

### Option A: Runtime injection (current, simpler)
Each component injects its CSS into `<head>` on first mount. No build step needed.
Works immediately. CSS is deduplicated by tag name.

### Option B: Build-time bundling (future optimization)
Write a Vite plugin that:
1. Scans `src/components/micrio-*.ts` for `static styles = \`...\``
2. Extracts CSS text
3. Concatenates into a single `micrio.prod.css` output
4. Removes runtime injection

This is not urgent — runtime injection adds negligible overhead (~14 small
`<style>` elements for the finished migration).

---

## How to Migrate a Component

1. **Create file** `src/components/micrio-{name}.ts`
2. **Import** `{ MicrioElement }` from `$ts/component`
3. **Define** class extending `MicrioElement<PropsType>`
4. **Set** `static tag = 'micrio-{name}'`
5. **Extract** CSS from `<style>` into `static styles` (minify if desired)
6. **Implement** `onMount()` to build initial DOM
7. **Implement** `onPropsChange()` to update DOM when props change
8. **Subscribe** to stores via `this.watch(store, callback)`
9. **Access context** via `this.inject<T>('key')`
10. **Register** with `customElements.define(MicrioX.tag, MicrioX)`
11. **Import** in `micrio-main.ts` to ensure registration
12. **Replace** `<X>` usage in parent components with `document.createElement('micrio-x')`
13. **Verify** with `npx tsc --noEmit` and `npx vite build`

### Example: Migrating Button.svelte
See `src/components/micrio-button.ts` for a complete reference.

---

## File Inventory

### New files created
```
src/ts/store.ts          — Store framework (~65 lines)
src/ts/component.ts      — Component base class (~110 lines)
src/components/
├── micrio-icon.ts
├── micrio-button.ts
├── micrio-button-group.ts
├── micrio-progress-circle.ts
├── micrio-progress-bar.ts
├── micrio-logo.ts
├── micrio-error.ts
├── micrio-fullscreen.ts
├── micrio-zoom-buttons.ts
├── micrio-article.ts
├── micrio-details.ts
├── micrio-subtitles.ts
├── micrio-controls.ts
└── micrio-main.ts
```

### Files modified
```
src/ts/main.ts           — Removed Svelte import, added micrio-main import
src/ts/element.ts        — mount→createElement, unmount→remove, removed Svelte refs
src/ts/image.ts          — Import from $ts/store
src/ts/state.ts          — Import from $ts/store
src/ts/gallery.ts        — Import from $ts/store
src/ts/camera.ts         — Import tick from $ts/store
src/ts/render/engine.ts  — Import from $ts/store
src/ts/render/canvas.ts  — Import from $ts/store
src/ts/events/facade.ts  — Import from $ts/store
src/ts/nav/grid.ts       — Import from $ts/store
src/ts/i18n/strings.ts   — Import from $ts/store
src/ts/utils/store.ts    — Import from $ts/store
src/ts/media/embedvideo.ts  — Import from $ts/store
src/ts/media/videotour.ts   — Import from $ts/store
src/types/models.ts      — Removed svelte type reference
vite.config.js           — Removed Svelte plugin
tsconfig.json            — No longer extends @tsconfig/svelte
package.json             — Removed Svelte deps
```

### Dead code (retained for reference)
```
src/svelte/              — All 39 original Svelte components
```

---

## Build & Verify Commands

```bash
# Typecheck
pnpm tsc --noEmit

# Build
pnpm vite build

# Dev server
pnpm vite --port 2000
```

---

## Complete Component Migration Checklist

- [x] **Phase 1**: Store framework (`src/ts/store.ts`)
- [x] **Phase 2**: Component base class (`src/ts/component.ts`)
- [x] **Phase 3**: 14 of 39 components migrated
- [x] **Phase 4**: Root mounting changed (element.ts + main.ts)
- [x] **Phase 5**: Build system cleaned (vite, tsconfig, package.json)
- [ ] Migrate `Media.svelte` → `micrio-media`
- [ ] Migrate `MediaControls.svelte` → `micrio-media-controls`
- [ ] Migrate `Marker.svelte` → `micrio-marker`
- [ ] Migrate `MarkerPopup.svelte` → `micrio-marker-popup`
- [ ] Migrate `MarkerContent.svelte` → `micrio-marker-content`
- [ ] Migrate `Menu.svelte` → `micrio-menu`
- [ ] Migrate `Toolbar.svelte` → `micrio-toolbar`
- [ ] Migrate `Gallery.svelte` → `micrio-gallery`
- [ ] Migrate `Minimap.svelte` → `micrio-minimap`
- [ ] Migrate `Waypoint.svelte` → `micrio-waypoint`
- [ ] Migrate `Tour.svelte` → `micrio-tour`
- [ ] Migrate `SerialTour.svelte` → `micrio-serial-tour`
- [ ] Migrate `Popover.svelte` → `micrio-popover`
- [ ] Migrate `MicrioGallery.svelte` → `micrio-gallery-item`
- [ ] Migrate `Embed.svelte` → `micrio-embed`
- [ ] Migrate `ImageEmbeds.svelte` → `micrio-image-embeds`
- [ ] Migrate `AudioController.svelte` → `micrio-audio-controller`
- [ ] Migrate `AudioPlaylist.svelte` → `micrio-audio-playlist`
- [ ] Migrate `AudioLocation.svelte` → `micrio-audio-location`
- [ ] Migrate `Events.svelte` → `micrio-events`
- [ ] Migrate `LogoOrg.svelte` → `micrio-logo-org`
- [ ] Delete `src/svelte/` directory (after all components migrated)
- [ ] Extract all CSS into production bundle
