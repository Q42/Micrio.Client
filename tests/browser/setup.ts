/**
 * Browser test setup: registers the `<micr-io>` custom element once per test file,
 * and resets the page between tests.
 *
 * The element is registered through the production entry point so the exact same
 * wiring as a real page (`customElements.define` + `VERSION`) is exercised.
 */
import { afterEach, beforeEach } from 'vitest'

import { restoreNetwork } from '../helpers/network'
import { installAudioContext } from './audio-context'
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
// to be in place *before* the client is imported. The audio controller likewise
// keeps its AudioContext in module state and only ever initialises it once, so the
// fake has to be installed up front rather than per test.
installTextureWorker()
installAudioContext()

/**
 * Makes `play()` on a media element resolve instead of rejecting.
 *
 * Headless Chromium refuses playback without a user gesture and has no decoder for the
 * fixture sources, so every real `<audio>`/`<video>` the client creates rejects — as an
 * *unhandled* rejection for the playlist, which reports it as a test-run error. No test
 * asserts on successful playback (they assert element attributes, routing and control
 * state), and the code paths that deliberately handle a blocked play, like the
 * autoplay probe in the audio controller, stub `play` themselves.
 */
HTMLMediaElement.prototype.play = function play() {
	return Promise.resolve()
}

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
