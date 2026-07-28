[![Micrio](https://b.micr.io/_statics/img/micrio-logo.png)](https://micr.io/)

# Micrio Client

If you are looking for HOWTOs, tutorials, or general Micrio help, please check out our
searchable Knowledge Base at:

[https://doc.micr.io/](https://doc.micr.io/)

This application is open source and is available on GitHub:

https://github.com/Q42/Micrio.Client

## Upgrading to the latest version (v7)

If you are using Micrio inside your project, and have custom CSS and/or using the JS API, check out this document which has all changes from earlier versions:

https://doc.micr.io/client/v7/changes.html

## NPM package

For the npm package `@micrio/client`, see https://www.npmjs.com/package/@micrio/client

## Architecture

This repository contains the source code for the Micrio Client — a pure Web Component (`<micr-io>`) built with TypeScript. It renders high-resolution zoomable images using WebGL, manages state via a custom store API, and handles user input (mouse, touch, keyboard, gesture) through its own event system.

Key source directories under `./src/`:

| Directory | Purpose |
|-----------|---------|
| `core/`   | Element definition, image model, camera, state management, store API |
| `render/` | WebGL engine, canvas management, tiling |
| `ui/`     | UI component definitions and icon set |
| `grid/`   | Grid layout and interaction |
| `gallery/`| Gallery (swipe/switch) controller |
| `media/`  | Video tour and embedded video controllers |
| `types/`  | TypeScript type definitions and models |

## Getting it running

Make sure you have Node >= 18.17 and `pnpm` installed.

From this directory, run:

```sh
$ pnpm i
```

To start the dev server:

```sh
$ pnpm run dev
```

This starts Vite on `http://localhost:2000/`. Changes to `./src/` are picked up via hot reload.

## Type-checking

```sh
$ pnpm run typecheck
```

This runs `tsc` with the project's `tsconfig.json`.

## Production build

```sh
$ pnpm run build
```

This will:
1. Bundle the source with Vite (IIFE, minified via Terser)
2. Generate TypeScript declaration files from the docs entry point
3. Assemble CSS from component static styles

Output lands in `./public/dist/`:

* `micrio.min.js`
* `micrio.min.d.ts`

To test the compiled version, edit `./index.html` to load the production JS rather than the dev module.


## Questions

- Technical documentation: https://doc.micr.io/
- Reproducible issues: https://support.micr.io/
- General inquiries: support@micr.io

Good luck!

[Marcel Duin](mailto:support@micr.io)
