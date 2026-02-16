# Micrio Client Development Guide

Practical guide for working with the Micrio codebase.

## Architecture Overview

Micrio is a layered architecture:

1. **TypeScript Core** (`src/ts/`) - Main logic, state management, WebGL
2. **Svelte UI** (`src/svelte/`) - Reactive components for controls and overlays
3. **WebAssembly** (`src/wasm/`) - Performance-critical math (camera, tiles)

**Data flow:** User input → Events → Wasm calculates → WebGL renders → Svelte UI updates

## Key Concepts

### Images and Canvases

A `<micr-io>` element manages one or more `MicrioImage` instances:

```typescript
// Single image
<micr-io id="abc123"></micr-io>

// Multiple images (split screen, grid)
// Access via micrio.canvases array
```

### State Management

Uses Svelte stores for reactivity:

```typescript
// Global state
micrio.state.tour      // Current active tour
micrio.state.marker    // Opened marker
micrio.state.ui.hidden // UI visibility

// Per-image state
image.state.view       // Current viewport [x, y, w, h]
image.state.marker     // Marker opened in this image
```

### WebAssembly Bridge

TypeScript talks to Wasm via the `Wasm` class:

```typescript
// Wasm handles: camera math, tile visibility, animations
// JS handles: rendering, events, UI, data loading

// Example: Request tile draw from Wasm
wasm.drawTile(canvasPtr, tileId, x, y, width, height);
```

## Common Tasks

### Adding a New Feature

1. **Core logic** → Add to `src/ts/`
2. **UI component** → Add Svelte component in `src/svelte/components/`
3. **Mount in UI** → Import in `src/svelte/Main.svelte`
4. **Update types** → Add to `src/types/models.ts` if needed

### Handling Errors

Use the error utilities:

```typescript
import { MicrioError, ErrorCodes } from './utils/error';
import { withRetry } from './utils/retry';

// For network requests - automatic retry
try {
  const data = await withRetry(() => fetchJson(url));
} catch (e) {
  // After retries exhausted
  throw new MicrioError('Failed to load', {
    code: ErrorCodes.NETWORK_SERVER_ERROR,
    displayMessage: 'Server error. Please try again.'
  });
}
```

### Working with Tours

Tours are in `src/svelte/virtual/Tour.svelte`:

- Marker tours: Navigate between markers
- Video tours: Synchronized video with events
- Serial tours: Multi-image sequential tours

State is persisted via `micrio.state.get()` / `micrio.state.set()`.

### Debugging Tips

**Console debugging:**
```javascript
// Check current image
document.querySelector('micr-io').$current

// Check stores
micrio.state.tour.subscribe(t => console.log('Tour:', t))

// Wasm status
micrio.wasm.i // > 0 means initialized
```

**Enable verbose logging:**
```javascript
localStorage.setItem('micrio_debug', 'true');
location.reload();
```

## File Organization

**When to put code where:**

| Task | Location |
|------|----------|
| Core viewer logic | `src/ts/element.ts`, `src/ts/image.ts` |
| Rendering | `src/ts/webgl.ts`, `src/wasm/` |
| UI components | `src/svelte/components/` |
| Complex UI logic | `src/svelte/virtual/` |
| Data fetching | `src/ts/utils/fetch.ts` |
| Error handling | `src/ts/utils/error.ts`, `src/ts/utils/retry.ts` |

## Performance Considerations

- **Minimize Wasm/JS boundary crossings** - Batch operations
- **Use Svelte stores** - Don't manually update DOM
- **Lazy load** - Gallery thumbnails, tour data
- **WebGL** - Clean up textures when images switch

## Testing Checklist

Before submitting a PR:

- [ ] `pnpm run typecheck` passes
- [ ] Works in Chrome, Firefox, Safari
- [ ] Works on mobile (touch gestures)
- [ ] Test with 360° images if touching camera/Wasm
- [ ] Test error scenarios (offline, slow network)

## Useful Commands

```bash
# Build Wasm (optimized)
pnpm run asbuild:optimized

# Build Wasm (debug - better stack traces)
pnpm run asbuild:untouched

# Type check
pnpm run typecheck

# Build production
pnpm run build

# Update docs
pnpm run docs
```
