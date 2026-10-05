# Linting

This repo is linted with [oxlint](https://oxc.rs/docs/guide/usage/linter) in
type-aware mode. The rule set is deliberately strict: `correctness`,
`suspicious` and `perf` are errors, plus a curated list of `pedantic`/`style`/
type-aware rules — including the "heavy" type-aware family
(`no-unsafe-*`, `strict-boolean-expressions`).

```sh
pnpm lint        # oxlint --type-aware
pnpm lint:fix    # oxlint --type-aware --fix
```

`oxlint-tsgolint` is required for `--type-aware` and is a devDependency, so a
plain `pnpm i` is enough. On Node, oxlint needs `^20.19.0 || >=22.12.0` (the
same floor as vite 8); see `.nvmrc` (24.4.0).

## Status: complete

| Phase | Baseline | Now |
| --- | --- | --- |
| Strict rule migration (65 rules) | 3568 findings | 0 |
| Heavy type-aware rules (6 rules) | 1209 findings | 0 |

| Gate | Result |
| --- | --- |
| `pnpm lint` | 0 findings, exit 0 (195 rules) |
| `pnpm typecheck` | exit 0 |
| `pnpm build` | succeeds |
| `pnpm format:check` | exit 0 (whole repo formatted with oxfmt) |

Both phases landed as many small commits, one rule per commit per area, so
`git log --grep '<rule-id>'` shows how any single rule was resolved, e.g.
`git log --grep 'strict-boolean-expressions'`.

### How it was done

1. Two-tier autofix: `--fix` (safe) then `--fix-suggestions`
   (behaviour-affecting — always review that diff), followed by a typecheck.
   Autofix can break `tsc`: `prefer-dom-node-dataset` on `Element`,
   `prefer-global-this` widening `window` to `globalThis`, `no-implicit-coercion`
   replacing `!!` narrowing with `Boolean(...)`, `no-inferrable-types` widening
   inferred types.
2. Mechanical-but-unfixable rules by codemod or sweep: `eslint/eqeqeq` (222
   loose comparisons rewritten over 46 files with a TypeScript-AST codemod that
   only replaces the operator token; `== null` idioms are untouched because the
   rule is configured with `{ null: ignore }`).
3. Everything else by hand, rule by rule and area by area.
4. **The heavy rules were unlocked by one structural change**: `MicrioElement`
   kept its props in a `Record<string, any>`, so every subclass read `any`.
   `_props` is now `Partial<_P>` and `_setProps` takes `Partial<_P>`, matching
   the `Partial<XProps>` overrides the subclasses already declared. That single
   change took the heavy-rule findings from 1209 to 181 and removed two of the
   documented disables.
5. Remaining `any` came from real boundaries (JSON/archive payloads, the
   `GalleryConfig.settings` bag, `window.YT`/`window.Vimeo`, CustomEvent
   details, worker messages) and was narrowed with predicates (`isRecord`,
   `isUnknownArray`, small `value is X` guards) instead of casts.
6. `build/stubs/**` was missing from `tsconfig.json`, so neither `tsc` nor the
   type-aware rules could see it; it is now part of the program.

Largest squalls for reference: `eslint/curly` 1339,
`typescript/no-inferrable-types` 335, `eslint/eqeqeq` 222,
`eslint/no-implicit-coercion` 169, `typescript/no-unsafe-type-assertion` 161,
`typescript/no-non-null-assertion` 158, `typescript/strict-boolean-expressions`
693 (at the chosen options), `typescript/no-unsafe-member-access` 193.

## Scope of the type-aware rules

`typescript/no-confusing-void-expression`, `no-unsafe-member-access`,
`no-unsafe-assignment`, `no-unsafe-argument`, `no-unsafe-return` and
`strict-boolean-expressions` are turned off for `**/*.js` by an `overrides`
entry. The build scripts (`bundle.js`, `publish.js`, `vite.config.js`,
`templates/grid/build-grid.js`) are outside the TS program (`allowJs` is off),
so every value there is `any`/`error` and the rules say nothing useful. Every
other rule still applies to them. If the build scripts are ever given
`// @ts-check` + JSDoc types, the override can be dropped.

`strict-boolean-expressions` is configured as:

```jsonc
["error", { "allowNullableBoolean": true, "allowNullableString": true, "allowNullableNumber": true }]
```

Two oxlint 1.86 behaviours worth knowing before touching it:

- **`allowNullableObject` is a no-op** (the rule is still marked WIP), so
  nullable-object truthiness is always reported and the checks are written out
  explicitly (`x !== undefined`, `x == null`) in the code.
- **`Boolean(x)` does not satisfy the rule** — the condition itself must be an
  explicit comparison. Do not "fix" a condition by wrapping it.

When converting a check, preserve the old falsiness set exactly: for object
values `x !== undefined` is equivalent, but for `string | number | undefined`
the old truthiness also excluded `''`/`0`, and for WebGL objects created with
`createBuffer()`/`createProgram()` etc. a `null` return means failure — those
use `x != null` on purpose.

## Formatting

Code is formatted with [oxfmt](https://oxc.rs/docs/guide/usage/formatter), the
formatter from the same project as oxlint:

```sh
pnpm format        # rewrite in place
pnpm format:check  # verify only (exit 1 + file list when something is unformatted)
```

`.oxfmtrc.json` holds the options: tabs, single quotes, no semicolons,
`printWidth` 120, trailing commas everywhere, and `sortPackageJson: false` so
`package.json` keys are left in their curated order.

- oxfmt skips `public/**` and `templates/grid/grid.js` via `.gitignore`, so build
  output is never touched (`node_modules`, lock files and `.git` are always
  skipped).
- `.glsl` shaders have no oxfmt parser and are left alone.
- Formatting is whitespace/quote-only; the gates above (`typecheck`, `lint`,
  `build`) are what prove it stayed that way. In particular `lint` fails on
  unused disable directives, so a formatter bug that detaches an
  `oxlint-disable-next-line` or `@ts-expect-error` from its target shows up as a
  finding rather than passing silently.

## Deliberate rule exclusions

These are off on purpose rather than forgotten:

- `eslint/no-underscore-dangle` — 3437 findings; `_`-prefixed internals are an
  intentional convention (`this.#camera._panBoundsMin`).
- `unicorn/no-null` — 189 findings; `null` and `undefined` carry distinct
  meanings in the state model.
- `unicorn/no-array-sort` — its remedy (`Array#toSorted`) is an ES2023 API and
  the project targets ES2022 (`tsconfig.json` has no `lib` override, so
  `toSorted` does not type-check). The remaining call sites sort throwaway local
  arrays. Revisit if the target moves to ES2023.
- Whole `style`, `restriction` and `pedantic` **categories** are not enabled.
  They contain rules that contradict each other or fight the codebase's
  deliberate style (`no-magic-numbers`, `id-length`, `no-ternary`, `sort-keys`,
  `max-statements`, `oxc/no-optional-chaining`, `oxc/no-async-await`,
  `import/no-named-export` vs `import/prefer-default-export`, …). Individual
  rules from those categories are enabled in `.oxlintrc.json` instead.
- Generated output (`public/**`, `templates/grid/grid.js`, `*.min.js`) is
  ignored: `templates/grid/grid.js` is built from `templates/grid/grid.ts` by
  `pnpm build:grid`.

## Accepted inline exceptions

Every `oxlint-disable-next-line` in the codebase, with its reason. There are no
others; `options.reportUnusedDisableDirectives` is `error`, so a stale one fails
lint. Prefer a real fix over adding to this list.

| Location | Rule | Why |
| --- | --- | --- |
| `src/core/frame.ts:22` | `unicorn/prefer-global-this` | typed as the rAF host `Window`; `globalThis` is not assignable |
| `src/render/webgl.ts:43` | `unicorn/prefer-global-this` | typed as `Window` for the WebGL display host |
| `src/layout/logo.ts:19` | `unicorn/prefer-global-this` | compares the parent frame against this `Window` |
| `src/render/textures.ts:63` | `unicorn/require-post-message-target-origin` | `Worker.postMessage` takes a transfer list, not a target origin |
| `src/types/models/info.ts:470` | `typescript/no-explicit-any` | `GalleryConfig.settings` custom-JSON bag; consumers spread and read arbitrary nested keys |
| `src/types/models/data.ts:81` | `eslint/no-shadow` | nested interface is the public `Models.ImageData.ImageData` API type; renaming breaks consumers |
| `src/core/store.ts:96` | `typescript/no-unsafe-type-assertion` | initial store value is optional; narrowing would drop the initial `undefined` emission that `skipFirst` relies on |
| `src/core/image.ts:450` | `typescript/no-unsafe-type-assertion` | embed info is intentionally partial; fabricating required fields would change runtime data |
| `src/utils/fetch.ts:29,31,48` | `typescript/no-unsafe-type-assertion` | unverifiable JSON; the shape is the caller-declared generic `T` |
| `src/utils/archive.ts:135` | `typescript/no-unsafe-type-assertion` | archived JSON has no runtime schema; the caller declares `T` |
| `templates/grid/grid.ts:585,758,762` | `eslint/no-await-in-loop` | `gotoId` mutates shared gallery state; tour steps must run strictly in order |

The props-bag disables (`MicrioElement<_P>` and `_props`) that used to be listed
here are gone: the props plumbing is typed now.

## Working notes

- `pnpm lint` must exit 0 with zero findings; there is no warning allowance
  (`options.denyWarnings`).
- Do not add lint to `build`/`publish`: publishing must never rewrite sources.
- Keep `public/**` and `templates/grid/grid.js` ignored — they are build output.
- For type-aware rules, verify by filtering the JSON output on the rule code
  (`-A all -D <rule>` also reports every existing disable directive as
  "unused", which inflates raw counts).
- The typing cleanup made a few public types honest (runtime unchanged), e.g.
  `HTMLMicrioElement.open()` now returns `Promise<MicrioImage | undefined>`,
  `GalleryConfig.type` is optional, and `MicrioEventDetails['print']` is
  `Partial<ImageInfo.ImageInfo>`. Worth mentioning in release notes.
