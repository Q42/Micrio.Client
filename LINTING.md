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
same floor as vite 8); see `.nvmrc`.

## Status of the strict-rules migration

Baseline when `.oxlintrc.json` was introduced: **3568 findings across 65 rules**
(154 files: `src/**`, `build/stubs/**`, `templates/**`, `bundle.js`,
`publish.js`, `vite.config.js`).

Legend: ✅ done · 🚧 in progress · ⬜ not started

### Mechanical (oxlint --fix)

| Rule | Baseline | Status |
| --- | --- | --- |
| `eslint/curly` | 1339 | ⬜ |
| `unicorn/no-zero-fractions` | 97 | ⬜ |
| `unicorn/switch-case-braces` | 42 | ⬜ |
| `typescript/consistent-type-definitions` | 30 | ⬜ |
| `unicorn/prefer-dom-node-append` | 27 | ⬜ |
| `typescript/consistent-generic-constructors` | 26 | ⬜ |
| `eslint/prefer-template` | 40 | ⬜ |
| `eslint/no-implicit-coercion` | 169 | ⬜ |
| `eslint/prefer-destructuring` (objects only) | 81 | ⬜ |
| `unicorn/prefer-global-this` | 72 | ⬜ |
| `unicorn/prefer-number-properties` | 20 | ⬜ |
| `unicorn/prefer-modern-math-apis` | 19 | ⬜ |
| `unicorn/prefer-dom-node-dataset` | 52 | ⬜ |
| `typescript/consistent-type-imports` | 19 | ⬜ |
| `typescript/no-inferrable-types` | 335 | ⬜ |
| `typescript/no-unnecessary-type-assertion` | 106 | ⬜ |
| long tail (< 7 findings each) | ~20 | ⬜ |

### Manual

| Rule | Baseline | Status |
| --- | --- | --- |
| `eslint/eqeqeq` (no fixer) | 222 | ⬜ |
| `typescript/no-unsafe-type-assertion` | 161 | ⬜ |
| `typescript/no-non-null-assertion` | 158 | ⬜ |
| `typescript/no-floating-promises` | 90 | ⬜ |
| `typescript/no-explicit-any` | 60 | ⬜ |
| `eslint/no-nested-ternary` | 44 | ⬜ |
| `eslint/sort-vars` | 43 | ⬜ |
| `unicorn/explicit-length-check` | 37 | ⬜ |
| `unicorn/no-array-for-each` | 35 | ⬜ |
| `typescript/no-unnecessary-type-conversion` | 22 | ⬜ |
| `eslint/require-await` | 21 | ⬜ |
| `typescript/method-signature-style` | 20 | ⬜ |
| `eslint/no-shadow` | 18 | ⬜ |
| `unicorn/prefer-add-event-listener` | 18 | ⬜ |
| `typescript/prefer-for-of` | 17 | ⬜ |
| `typescript/consistent-return` | 14 | ⬜ |
| `eslint/no-promise-executor-return` | 10 | ⬜ |
| `typescript/unbound-method` | 9 | ⬜ |
| `typescript/no-misused-promises` | 7 | ⬜ |
| `typescript/ban-ts-comment` + `prefer-ts-expect-error` | 8 | ⬜ |
| long tail (< 7 findings each) | ~40 | ⬜ |

`pnpm lint` must exit 0 with **zero findings** for the migration to be
considered complete.

## Deliberate exclusions

These are off on purpose rather than forgotten:

- `eslint/no-underscore-dangle` — 3437 findings; `_`-prefixed internals are an
  intentional convention (`this.#camera._panBoundsMin`).
- `unicorn/no-null` — 189 findings; `null` and `undefined` carry distinct
  meanings in the state model.
- Whole `style`, `restriction` and `pedantic` **categories** are not enabled.
  They contain rules that contradict each other or fight the codebase's
  deliberate style (`no-magic-numbers`, `id-length`, `no-ternary`, `sort-keys`,
  `max-statements`, `oxc/no-optional-chaining`, `oxc/no-async-await`,
  `import/no-named-export` vs `import/prefer-default-export`, …). Individual
  rules from those categories are enabled in `.oxlintrc.json` instead.
- Generated output (`public/**`, `templates/grid/grid.js`, `*.min.js`) is
  ignored: `templates/grid/grid.js` is built from `templates/grid/grid.ts` by
  `pnpm build:grid`.
- `unicorn/no-array-sort` — its remedy (`Array#toSorted`) is an ES2023 API and
  the project targets ES2022 (`tsconfig.json` has no `lib` override, so
  `toSorted` does not type-check). The remaining call sites sort throwaway
  local arrays. Revisit if the target moves to ES2023.

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

2. **`package.json` `engines.node`** still says `>=18.17.0`, which neither vite
   8 nor oxlint satisfies. `.nvmrc` is at `24.4.0`; the engines range should
   probably become `^20.19.0 || >=22.12.0`.
3. **CI.** There is no workflow directory yet, so lint/typecheck are local-only
   gates. Add `pnpm lint` + `pnpm typecheck` to CI if/when one exists.

## Working notes

- Autofix happens in two tiers: `--fix` (safe) and `--fix-suggestions`
  (behavior-affecting — always review that diff). Both can break `tsc`:
  `prefer-dom-node-dataset` on `Element`, `prefer-global-this` widening
  `window` to `globalThis`, `no-inferrable-types` widening inferred types.
  Run `pnpm typecheck` after each batch.
- Prefer real fixes over `// oxlint-disable-next-line <rule> -- <reason>`.
  Disables must carry a reason;
  `options.reportUnusedDisableDirectives` is `error` so stale ones fail lint.
