import { defineConfig, type UserWorkspaceConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import { readFileSync, rmSync } from 'node:fs'
import { aliases, glslMinifyPlugin } from './vite.config.js'

// Vitest writes failure screenshots and `context.annotate` attachments into
// `.vitest/` (gitignored) and never removes them, so the directory grows run over
// run. Clear it once per run — here, at config load, so `npm test`, `pnpm
// test:browser`, `npx vitest` and an IDE run all behave the same. What is on disk
// afterwards therefore always belongs to the latest run, which is exactly when a
// failure's screenshot is worth looking at.
rmSync(new URL('.vitest', import.meta.url), { recursive: true, force: true })

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
	setupFiles: string[] = ['./tests/browser/setup.ts'],
): UserWorkspaceConfig & { extends: true } => ({
	extends: true,
	test: {
		name,
		include,
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

/**
 * The Micrio client test configuration.
 *
 * Three projects, run separately via `npm run test:core` / `test:browser` / `test:css`
 * (see TESTING.md):
 *
 * - `core`: bare Node, no DOM, no browser, no network. Pure logic only.
 * - `browser`: headless Chromium through Playwright. Everything that needs a real
 *   DOM, layout, WebGL or the `<micr-io>` element itself.
 * - `css`: the same browser with the real stylesheets, for placement, visibility,
 *   layering and interactivity. Needs `MICRIO_TEST_CSS=1`, which `test:css` sets.
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
		// Collected over both projects (`npm run test:coverage`), one merged report.
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
				statements: 89,
				branches: 81,
				functions: 89,
				lines: 89,
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
			browserProject('browser', { width: 1024, height: 768 }, ['tests/browser/**/*.test.ts']),
			// The stylesheet suite: same browser, real CSS, its own viewport helpers.
			// Run it with `npm run test:css`; the flag it needs lives in the script, so the
			// other projects keep the stub whatever command is used.
			browserProject('css', { width: 1024, height: 768 }, ['tests/browser/css/**/*.test.ts']),
		],
	},
})
