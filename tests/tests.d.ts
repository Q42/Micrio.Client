/**
 * Ambient globals injected by the Micrio build (see `vite.config.js` `define`).
 * Declared project-wide so test files and config files can be type-checked
 * independently of the source files that read them.
 *
 * The `.css`/`.glsl` wildcard module shapes are declared once, in
 * `src/types/imports.d.ts` (which `tsconfig.tests.json` includes): a second
 * declaration of the same wildcard module merges with the first and collides on
 * its `content` const.
 */

declare const __VERSION__: string
declare const __CORE__: boolean
/** `true` when the browser suite runs with `MICRIO_LIVE=1` (see TESTING.md). */
declare const __MICRIO_LIVE__: boolean
