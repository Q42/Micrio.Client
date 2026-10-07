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

| Directory  | Purpose                                                              |
| ---------- | -------------------------------------------------------------------- |
| `core/`    | Element definition, image model, camera, state management, store API |
| `render/`  | WebGL engine, canvas management, tiling                              |
| `ui/`      | UI component definitions and icon set                                |
| `grid/`    | Grid layout and interaction                                          |
| `gallery/` | Gallery (swipe/switch) controller                                    |
| `media/`   | Video tour and embedded video controllers                            |
| `types/`   | TypeScript type definitions and models                               |

## Grid template

An interactive demo of the grid storytelling API lives in
[`templates/grid/`](templates/grid/):

- [`templates/grid/README.md`](templates/grid/README.md) — the technical Grid API reference.
- [`templates/grid/HUMANS.md`](templates/grid/HUMANS.md) — the non-developer guide (markers, tours, video-tour events).
- [`templates/grid/grid.html`](templates/grid/grid.html) + [`templates/grid/grid.ts`](templates/grid/grid.ts) — the runnable demo (`pnpm run dev`, then open `/templates/grid/grid.html`).

## Getting it running

Make sure you have Node `^20.19.0 || >=22.12.0` (see `.nvmrc`) and `pnpm` installed.

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

This runs `tsc` with the project's `tsconfig.json`. The repo runs on **TypeScript 7**
(the native compiler; `typescript` is pinned to `^7.0.2`). See
[TypeScript 7 in VS Code](#typescript-7-in-vs-code) for the editor side.

## Unit tests

```sh
$ pnpm test              # both projects
$ pnpm run test:core     # bare Node, no DOM, no network
$ pnpm run test:browser  # headless Chromium via Playwright
$ pnpm run test:coverage # both, with the v8 coverage floors
$ pnpm run test:watch    # watch the core project
```

Two independent Vitest projects: `core` covers pure logic (math, parsing, state, data
loading, matrix math) and `browser` covers everything that needs a real DOM, layout, WebGL
or the `<micr-io>` element — 1700+ tests across ~120 files, with coverage floors enforced
by `test:coverage`. [TESTING.md](TESTING.md) is the document of record: how to run them, the
offline-fixture strategy, per-subsystem suite notes, hints for adding suites, the coverage
baseline, and the one thing the suite deliberately cannot see (stylesheets — check layout
changes in a browser).

## Linting

```sh
$ pnpm run lint        # oxlint --type-aware
$ pnpm run lint:fix    # oxlint --type-aware --fix
```

This runs [oxlint](https://oxc.rs/docs/guide/usage/linter) in type-aware mode
(configured by `.oxlintrc.json`, with `oxlint-tsgolint` providing the type
information). The rule set is deliberately strict: `correctness`, `suspicious`
and `perf` are errors, plus a curated list of `pedantic`/`style`/type-aware
rules (195 in total). `lint:fix` applies the auto-fixable rules; the rest have to
be fixed by hand. The migration to this rule set is complete — 0 findings, and
`pnpm typecheck` and `pnpm build` both pass. It landed as one small commit per
rule per area, so `git log --grep '<rule-id>'` still shows how any single rule
was resolved.

Notes for changing the config:

- `typescript/no-confusing-void-expression`, the `no-unsafe-*` family and
  `strict-boolean-expressions` are off for `**/*.js` (the build scripts are not
  in the TS program, so type-aware rules say nothing useful there); every other
  rule still applies.
- `strict-boolean-expressions` uses
  `{ "allowNullableBoolean": true, "allowNullableString": true, "allowNullableNumber": true }`.
  In oxlint 1.86 `allowNullableObject` is a no-op (nullable objects are always
  reported) and wrapping a condition in `Boolean(x)` does not satisfy the rule —
  write explicit comparisons. When converting, preserve the old falsiness set
  exactly (`x !== undefined` is only equivalent for object values; `''`/`0` and
  WebGL `null`-means-failure cases need explicit checks).
- Off on purpose: `eslint/no-underscore-dangle` (3437 findings; `_`-prefixed
  internals are the convention), `unicorn/no-null` (`null` and `undefined` differ
  in the state model), `unicorn/no-array-sort` (its ES2023 remedy does not
  type-check at the ES2022 target). The whole `style`, `restriction` and
  `pedantic` categories stay disabled — individual rules from them are enabled
  explicitly.
- Generated output (`public/**`, `templates/grid/grid.js`, `*.min.js`) is
  ignored; `grid.js` is built from `grid.ts` by `pnpm build:grid`.
- Lint must exit 0 with zero findings (warnings are denied), and the repo must be
  oxfmt-clean. `build` runs `lint` and `format:check` first and aborts on either,
  so a broken build never ships. Never wire `lint:fix` or `format` (or any
  autofix) into `build`/`publish`: publishing must never rewrite sources.
- The few remaining `oxlint-disable-next-line` comments are each justified
  in-code; `reportUnusedDisableDirectives` is `error`, so a stale one fails lint.

The typing cleanup also made a few public types honest (runtime unchanged):
`HTMLMicrioElement.open()` now returns `Promise<MicrioImage | undefined>`,
`GalleryConfig.type` is optional, and `MicrioEventDetails['print']` is
`Partial<ImageInfo.ImageInfo>`. Worth mentioning in release notes.

## TypeScript 7 in VS Code

TypeScript 7 is the native (Go) compiler, and it ships **no `lib/tsserver.js`** — `lib/` holds
only `tsc.js`, `getExePath.js` and a version stub. VS Code's built-in TypeScript extension
loads its language server from that JS path, so it cannot drive a TypeScript 7 workspace. Until VS Code
picks the native server up itself, the editor needs the preview extension, and that
integration is **still experimental** (October 2026):

- install the **TypeScript Native Preview** extension — recommended via
  [`.vscode/extensions.json`](.vscode/extensions.json);
- it only takes over the language server with `js/ts.experimental.useTsgo: true`;
- it does **not** yet auto-detect a workspace `typescript` 7 package — it looks only for
  `@typescript/native-preview`, which was last published 2026-07-07 and is superseded by
  `typescript@7`. Without
  `"js/ts.tsdk.path": "node_modules/typescript/lib"` (`tsc`'s JS entry point), the editor
  silently runs the extension's own bundled compiler instead of the workspace's, so the
  editor and `pnpm run typecheck`/CI can disagree.

All three settings live in [`.vscode/settings.json`](.vscode/settings.json) and
[`.vscode/extensions.json`](.vscode/extensions.json), so a checkout gets them for free.
Tracked upstream as
[microsoft/TypeScript#64565](https://github.com/microsoft/TypeScript/issues/64565) — once the
extension detects the workspace package, the `tsdk.path` line can go, and once VS Code ships
it natively, the `useTsgo` flag and the extension recommendation can go too.

## Production build

```sh
$ pnpm run build
```

This will:

1. Bundle the source with Vite (IIFE, minified via Terser)
2. Generate TypeScript declaration files from the docs entry point
3. Assemble CSS from component static styles

Output lands in `./public/dist/`:

- `micrio.min.js`
- `micrio.min.d.ts`

To test the compiled version, edit `./index.html` to load the production JS rather than the dev module.

## Questions

- Technical documentation: https://doc.micr.io/
- Reproducible issues: https://support.micr.io/
- General inquiries: support@micr.io

Good luck!

[Marcel Duin](mailto:support@micr.io)
