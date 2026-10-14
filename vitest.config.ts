import { defaultExclude, defineConfig, type UserWorkspaceConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import { availableParallelism } from 'node:os'
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
 * Chromium flags for the browser projects, or nothing when `CI` is unset.
 *
 * A GitHub-hosted runner has no GPU, so WebGL there is SwiftShader (software) whatever we
 * do. Naming that renderer makes CI deterministic instead of dependent on what the runner
 * image picks, and `--enable-unsafe-swiftshader` is required by recent Chromium for
 * software WebGL at all (without it the context is refused and the renderer warns).
 * `--disable-gpu` is deliberately *not* here: it closes the GL path rather than selecting a
 * renderer, which is the one thing these suites cannot afford. `--disable-dev-shm-usage`
 * matters to them specifically: Chromium's `/dev/shm` is small in a container and they
 * allocate textures heavily.
 *
 * CI-only on purpose — a local run on a machine with a GPU keeps hardware GL, so this never
 * hides a driver-specific difference from the developer who has to fix it.
 */
const chromiumArgs =
	process.env.CI === undefined
		? []
		: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage']

/**
 * Optional override for the browser binary, unset by default.
 *
 * Playwright's own pinned Chromium is what a local `pnpm test:browser` uses, so CI failing on
 * the same build is reproducible by hand. Setting `MICRIO_BROWSER_CHANNEL=chrome` (the
 * `tests` workflow passes the repository variable of that name through) switches to the
 * runner's preinstalled Chrome, which skips the browser download but drifts from local.
 */
const chromiumChannel = process.env.MICRIO_BROWSER_CHANNEL

/**
 * Worker count for the browser projects on CI, where the machine is the whole problem.
 *
 * Vitest defaults to one worker per CPU, and every worker is a Playwright worker driving its
 * own Chromium, rendering WebGL in software, while `browser`, `css` and `coverage` are three
 * concurrent jobs. On a 4-vCPU runner that starves the suites: a starved page is exactly what
 * the deadline waits in `waitFor` (`tests/helpers/viewer.ts`) cannot survive, because they
 * poll on `requestAnimationFrame`, the first thing Chromium throttles under load. That is
 * what the first instrumented CI run showed — 144s for `browser` with **96% worker, 3%
 * tests** — and it is why the previous default (four workers on four vCPUs, each a Chromium)
 * produced one timeout in a different suite per job.
 *
 * Half the CPUs, floors at 2 so a small runner still uses both cores, and caps at 4 because
 * past that the contention is worth more than the parallelism. The runner's real vCPU count
 * is visible in the `Install Node` log on the first run; set `MICRIO_TEST_WORKERS` to pin a
 * number instead. Local runs are deliberately untouched — a developer's machine is not the
 * constraint — and `--maxWorkers` still overrides this on the command line.
 */
const ciMaxWorkers = (() => {
	if (process.env.CI === undefined) {
		// Not CI: leave the option unset so Vitest keeps its own default.
		return 0
	}
	const override = Number(process.env.MICRIO_TEST_WORKERS)
	if (Number.isInteger(override) && override > 0) {
		return override
	}
	return Math.max(2, Math.min(4, Math.floor(availableParallelism() / 2)))
})()

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
		// Only set when CI actually chose a number (see `ciMaxWorkers`); leaving the key out
		// keeps Vitest's own default rather than relying on a falsy `0`.
		...(ciMaxWorkers > 0 ? { maxWorkers: ciMaxWorkers } : {}),
		setupFiles,
		browser: {
			enabled: true,
			headless: true,
			viewport,
			provider: playwright({ launchOptions: { args: chromiumArgs, channel: chromiumChannel } }),
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
