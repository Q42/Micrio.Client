# Contributing to Micrio Client

Thank you for considering contributing to Micrio! This document will help you get started.

## Quick Start

```bash
# Clone and setup
git clone https://github.com/Q42/Micrio.Client.git
cd Micrio.Client
pnpm i
pnpm run asbuild:optimized
pnpm run dev
```

The dev server starts at http://localhost:2000/

## Project Structure

```
src/
├── ts/           # TypeScript core - element, image loading, state, WebGL, Wasm bridge
├── svelte/       # UI components - markers, tours, controls, popups
├── wasm/         # AssemblyScript - camera math, tile calculations (compile with pnpm run asbuild)
├── types/        # TypeScript definitions
└── css/          # Styles
```

**Key files to know:**
- `src/ts/element.ts` - Main `<micr-io>` custom element (~700 lines)
- `src/ts/image.ts` - MicrioImage class, handles loading and state
- `src/ts/state.ts` - State management with Svelte stores
- `src/ts/webgl.ts` - WebGL rendering
- `src/ts/wasm.ts` - WebAssembly communication bridge

## Making Changes

1. **TypeScript changes** - Hot reload automatically
2. **WebAssembly changes** - Run `pnpm run asbuild:optimized` after editing `src/wasm/`
3. **Run type checker** - `pnpm run typecheck` before committing

## Error Handling

When adding error handling, use the `MicrioError` class:

```typescript
import { MicrioError, ErrorCodes } from './utils/error';

// Categorized error with user-friendly message
throw new MicrioError('Failed to load image', {
  code: ErrorCodes.NETWORK_TIMEOUT,
  retryable: true
});
```

For network operations, use `withRetry()`:

```typescript
import { withRetry } from './utils/retry';

const data = await withRetry(
  () => fetchJson(url),
  { maxAttempts: 3 }
);
```

## Testing Your Changes

Test with different image types:
- Standard image: `OEjDREG` (default in index.html)
- 360° panorama: `ZnaHJK`
- Gallery: Uncomment gallery example in index.html

## Commit Guidelines

- Use present tense: "Add feature" not "Added feature"
- First line under 72 characters
- Reference issues: "Fix marker tour step persistence (#38)"

## Need Help?

- Check ARCHITECTURE.md for system overview
- Open an issue for questions
- Email: support@micr.io
