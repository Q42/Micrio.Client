import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import { readFileSync } from 'node:fs'
import { aliases, glslMinifyPlugin } from './vite.config.js'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string }

/**
 * Stubs stylesheet imports. Tests never assert on styles, and the source imports
 * `.css` files (including from component modules a test may pull in transitively).
 */
const cssStub = {
	name: 'micrio-css-stub',
	enforce: 'pre' as const,
	transform(_src: string, id: string) {
		if (id.endsWith('.css')) {
			return { code: 'export default {}', map: null }
		}
		return null
	},
}

/**
 * The Micrio client test configuration.
 *
 * Two independent projects, run separately via `npm run test:core` /
 * `npm run test:browser` (see TESTING.md):
 *
 * - `core`: bare Node, no DOM, no browser, no network. Pure logic only.
 * - `browser`: headless Chromium through Playwright. Everything that needs a real
 *   DOM, layout, WebGL or the `<micr-io>` element itself.
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
			{
				extends: true,
				test: {
					name: 'browser',
					include: ['tests/browser/**/*.test.ts'],
					testTimeout: 20000,
					hookTimeout: 20000,
					setupFiles: ['./tests/browser/setup.ts'],
					browser: {
						enabled: true,
						headless: true,
						viewport: { width: 1024, height: 768 },
						provider: playwright(),
						instances: [{ browser: 'chromium' }],
					},
				},
			},
		],
	},
})
