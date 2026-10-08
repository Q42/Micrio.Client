import { defaultExclude, defineConfig, type UserWorkspaceConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import { readFileSync, rmSync } from 'node:fs'
import { aliases, glslMinifyPlugin } from './vite.config.js'

// Vitest writes failure screenshots and `context.annotate` attachments into
// `.vitest/` (gitignored) and never removes them, so the directory grows run over
// run. Clear those once per run — here, at config load, so `npm test`, `pnpm
// test:browser`, `npx vitest` and an IDE run all behave the same. What is on disk
// afterwards therefore always belongs to the latest run, which is exactly when a
// failure's screenshot is worth looking at.
//
// `render-proof/` is deliberately left alone: those images are the stylesheet suite's
// visual proof (see `tests/browser/css/render-proof.test.ts`) and exist to be opened by a
// human, so wiping them on every `npm test` would defeat the point. `test:css` clears the
// whole directory first and rebuilds them.
rmSync(new URL('.vitest/attachments', import.meta.url), { recursive: true, force: true })
if (process.env.MICRIO_TEST_CSS === '1') {
	rmSync(new URL('.vitest/render-proof', import.meta.url), { recursive: true, force: true })
}

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string }

/**
 * Stubs stylesheet imports. Every suite but `css` asserts on state and DOM, never on
 * styles, and the source imports `.css` files (including from component modules a test
 * may pull in transitively) — so the `css` project, which does assert on them, turns the
 * stub off with `MICRIO_TEST_CSS=1` and lets Vite inject the real stylesheets. Browser
 * mode always renders real CSS (`resolved.css = true` in Vitest's own config resolution);
 * this stub is the only thing that was hiding it.
 */
const cssStub = {
	name: 'micrio-css-stub',
	enforce: 'pre' as const,
	transform(_src: string, id: string) {
		if (id.endsWith('.css') && process.env.MICRIO_TEST_CSS !== '1') {
			return { code: 'export default {}', map: null }
		}
		return null
	},
}

/** A browser project's viewport, in the test iframe's CSS pixels. */
interface Viewport {
	width: number
	height: number
}

/**
 * The Playwright/Chromium setup every browser project shares: one headless Chromium
 * instance, the element registered through the production entry (`tests/browser/setup.ts`),
 * headless and 20s timeouts. `setupFiles` is a parameter so the `css` project can add its
 * own viewport helpers after the shared setup rather than forking it.
 */
const browserProject = (
	name: string,
	viewport: Viewport,
	include: string[],
	exclude: string[] = [],
	setupFiles: string[] = ['./tests/browser/setup.ts'],
): UserWorkspaceConfig & { extends: true } => ({
	extends: true,
	test: {
		name,
		include,
		exclude: [...defaultExclude, ...exclude],
		testTimeout: 20000,
		hookTimeout: 20000,
		setupFiles,
		browser: {
			enabled: true,
			headless: true,
			viewport,
			provider: playwright(),
			instances: [{ browser: 'chromium' }],
		},
	},
})

/** The stylesheet suite, selected by `npm run test:css`. See the note on `projects` below. */
const cssProject = browserProject(
	'css',
	{ width: 1024, height: 768 },
	['tests/browser/css/**/*.test.ts'],
	[],
	['./tests/browser/setup.ts', './tests/browser/css/setup.ts'],
)

/**
 * The Micrio client test configuration.
 *
 * Three projects, each reached through its own script (see TESTING.md):
 *
 * - `core`: bare Node, no DOM, no browser, no network. Pure logic only.
 * - `browser`: headless Chromium through Playwright. Everything that needs a real
 *   DOM, layout, WebGL or the `<micr-io>` element itself.
 * - `css`: the same browser with the real stylesheets, for placement, visibility,
 *   layering and interactivity.
 *
 * The `css` project only joins `projects` when `MICRIO_TEST_CSS=1` is set — the switch the
 * stub plugin reads and `test:css` is the only script that sets. Two things follow from
 * that, both measured rather than assumed:
 *
 * - without the flag it must not be listed, or `vitest run` would collect it with the stub
 *   still on and fail every test in it;
 * - with the flag it must not share a run with `browser`. A global flag turns the real
 *   stylesheets on for *every* browser test, and five of them then fail on the sizes the
 *   stubbed layout was giving them (`camera-2d`'s scale brackets, `ui-primitives`'s
 *   width-less dial, `input-integration`'s wheel zoom, `event-contract`, `grid-transitions`).
 *
 * So `css` is a separate run: `test:css` for the suite, and `test:coverage` leaves it out
 * entirely for the same reason. All three projects come from the one factory above.
 */
export default defineConfig({
	plugins: [cssStub, glslMinifyPlugin()],
	resolve: { alias: aliases },
	define: {
		__VERSION__: JSON.stringify(pkg.version),
		__CORE__: 'false',
		// Opt-in live suite: `MICRIO_LIVE=1 npm run test:browser:live`
		__MICRIO_LIVE__: JSON.stringify(process.env.MICRIO_LIVE === '1'),
	},
	test: {
		// Collected over the projects `test:coverage` runs (`core` + `browser`), one merged
		// report. The `css` project is not part of it: a global `MICRIO_TEST_CSS=1` would
		// enable the stylesheets for `browser` too, which breaks five of its geometry tests
		// (they assert on sizes the stubbed layout gives them).
		coverage: {
			provider: 'v8',
			// The whole source tree, not just what the tests happen to import: a file
			// nothing touches has to show as 0%, not drop out of the report.
			include: ['src/**/*.ts'],
			exclude: ['src/types/**'], // type-only (see src/types/models.ts)
			reporter: ['text'],
			// The ratchet: floors sit 1–2 points under the recorded baseline (TESTING.md,
			// "Coverage"), so a real coverage loss fails the run while ordinary
			// refactoring does not. Raise them when the baseline moves up.
			thresholds: {
				statements: 90,
				branches: 82,
				functions: 89,
				lines: 90,
			},
		},
		// The root config holds no tests itself; only the projects below do.
		projects: [
			{
				extends: true,
				test: {
					name: 'core',
					include: ['tests/core/**/*.test.ts'],
					environment: 'node',
					testTimeout: 5000,
					hookTimeout: 5000,
				},
			},
			// The stylesheet directory is excluded even though the glob is recursive: those files
			// only pass with the stub off, and the `css` project is the one that runs them that way.
			browserProject('browser', { width: 1024, height: 768 }, ['tests/browser/**/*.test.ts'], ['tests/browser/css/**']),
			// The stylesheet suite. It is in this list only when its switch is on, so a run
			// without `MICRIO_TEST_CSS` cannot collect it with the stub still in place; the
			// project object still comes from the one factory in this file.
			...(process.env.MICRIO_TEST_CSS === '1' ? [cssProject] : []),
		],
	},
})
