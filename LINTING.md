# Linting

This repo is linted with [oxlint](https://oxc.rs/docs/guide/usage/linter) in
type-aware mode. The rule set is deliberately strict: `correctness`,
`suspicious` and `perf` are errors, plus a curated list of `pedantic`/`style`/
type-aware rules.

```sh
pnpm lint        # oxlint --type-aware
pnpm lint:fix    # oxlint --type-aware --fix
```

`oxlint-tsgolint` is required for `--type-aware` and is a devDependency, so a
plain `pnpm i` is enough. On Node, oxlint needs `^20.19.0 || >=22.12.0` (the
same floor as vite 8); see `.nvmrc` (24.4.0).

## Status: complete

The strict-rules migration is done. Baseline when `.oxlintrc.json` was
introduced: **3568 findings across 65 rules** in 154 files. Current state:
**0 findings**, with every rule in the config at `error`.

| Gate | Result |
| --- | --- |
| `pnpm lint` | 0 findings, exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm build` | succeeds |

Work was committed as ~135 atomic commits, one rule per commit per area, so
`git log --grep '<rule-id>'` shows how any single rule was resolved, e.g.
`git log --grep 'no-non-null-assertion'`.

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
3. Everything else by hand, rule by rule and area by area:
   `typescript/no-unsafe-type-assertion`, `typescript/no-non-null-assertion`,
   `typescript/no-explicit-any`, `typescript/no-floating-promises`,
   `unicorn/no-array-for-each`, `eslint/sort-vars`, `eslint/no-nested-ternary`,
   `eslint/no-shadow`, `typescript/method-signature-style`,
   `typescript/consistent-return`, `typescript/unbound-method`, and the rest of
   the 65 rules.

Largest baseline squalls, for reference: `eslint/curly` 1339,
`typescript/no-inferrable-types` 335, `eslint/eqeqeq` 222,
`eslint/no-implicit-coercion` 169, `typescript/no-unsafe-type-assertion` 161,
`typescript/no-non-null-assertion` 158, `typescript/no-unnecessary-type-assertion`
106, `unicorn/no-zero-fractions` 97, `typescript/no-floating-promises` 90.

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
| `src/render/textures.ts:60` | `unicorn/require-post-message-target-origin` | `Worker.postMessage` takes a transfer list, not a target origin |
| `src/core/component.ts:24` | `typescript/no-unnecessary-type-parameters` | `_P` is the props type each subclass declares as `extends MicrioElement<Props>` |
| `src/core/component.ts:37` | `typescript/no-explicit-any` | shared props bag: every subclass destructures its own typed props from it |
| `src/types/models/info.ts:470` | `typescript/no-explicit-any` | `GalleryConfig.settings` custom-JSON bag; consumers spread and read arbitrary nested keys |
| `src/types/models/data.ts:81` | `eslint/no-shadow` | nested interface is the public `Models.ImageData.ImageData` API type; renaming breaks consumers |
| `src/core/store.ts:96` | `typescript/no-unsafe-type-assertion` | initial store value is optional; narrowing would drop the initial `undefined` emission that `skipFirst` relies on |
| `src/core/image.ts:450` | `typescript/no-unsafe-type-assertion` | embed info is intentionally partial; fabricating required fields would change runtime data |
| `src/utils/fetch.ts:29,31` | `typescript/no-unsafe-type-assertion` | unverifiable cached JSON; the shape is the caller-declared generic `T` |
| `templates/grid/grid.ts:579,752,756` | `eslint/no-await-in-loop` | `gotoId` mutates shared gallery state; tour steps must run strictly in order |

## To fix later

1. **Heavy type-aware rules.** These are off by default in oxlint and stay off
   for now; each needs its own migration. Baseline counts with this config:

   | Rule | Findings |
   | --- | --- |
   | `typescript/strict-boolean-expressions` | 875 |
   | `typescript/no-unsafe-member-access` | 725 |
   | `typescript/no-unsafe-assignment` | 323 |
   | `typescript/no-confusing-void-expression` | 130 |
   | `typescript/no-unsafe-argument` | 129 |
   | `typescript/no-unsafe-return` | 41 |

2. **`public/dist/package.json` `engines.node`** still says `>=18.17.0`. That is
   the manifest of the *published* `@micrio/client` bundle, which needs no Node
   runtime of its own, so it was deliberately left alone when the source-repo
   floor moved to `^20.19.0 || >=22.12.0` (`package.json` and the README state
   that range now, and `.nvmrc` is `24.4.0`). Align it if the published package
   should gate on the same range.
3. **CI.** There is no workflow directory yet, so lint/typecheck are local-only
   gates. Add `pnpm lint` + `pnpm typecheck` to CI if/when one exists.

## Working notes

- `pnpm lint` must exit 0 with zero findings; there is no warning allowance
  (`options.denyWarnings`).
- Do not add lint to `build`/`publish`: publishing must never rewrite sources.
- Keep `public/**` and `templates/grid/grid.js` ignored — they are build output.
- The typing cleanup made a few public types honest (runtime unchanged), e.g.
  `HTMLMicrioElement.open()` now returns `Promise<MicrioImage | undefined>`,
  `GalleryConfig.type` is optional, and `MicrioEventDetails['print']` is
  `Partial<ImageInfo.ImageInfo>`. Worth mentioning in release notes.
