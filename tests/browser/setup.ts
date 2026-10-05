/**
 * Browser test setup: registers the `<micr-io>` custom element once per test file,
 * and resets the page between tests.
 *
 * The element is registered through the production entry point so the exact same
 * wiring as a real page (`customElements.define` + `VERSION`) is exercised.
 */
import { afterEach, beforeEach } from 'vitest'

import { restoreNetwork } from '../helpers/network'
import { installTextureWorker } from './textures'

/**
 * Drops the client's version banner.
 *
 * `src/main.ts` logs it once per page load through `console.info`, which in
 * browser mode means once per *test file* — attributed to "unknown test" because
 * it fires while the module is still being imported. `console.info` is not used
 * anywhere else in the client, and this filter keeps every other call intact.
 */
const info = console.info.bind(console)
console.info = (...args: unknown[]) => {
	const [first] = args
	if (typeof first === 'string' && first.includes('Micrio') && first.includes('https://micr.io/')) {
		return
	}
	info(...args)
}

// The texture worker bootstrap is created at module load, so the fake worker has
// to be in place *before* the client is imported.
installTextureWorker()
await import('../../src/main')

beforeEach(() => {
	document.body.replaceChildren()
	for (const el of document.head.querySelectorAll('link[data-test-style]')) {
		el.remove()
	}
	localStorage.clear()
})

afterEach(() => {
	document.body.replaceChildren()
	restoreNetwork()
	localStorage.clear()
})
