/**
 * Browser test setup: registers the `<micr-io>` custom element once per test file,
 * and resets the page between tests.
 *
 * The element is registered through the production entry point so the exact same
 * wiring as a real page (`customElements.define` + `VERSION`) is exercised.
 */
import { afterEach, beforeEach } from 'vitest'

import { restoreNetwork, mockFetch } from '../helpers/network'
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

/**
 * Drops Chromium's ResizeObserver loop-protection warning.
 *
 * `Canvas` observes the `<canvas class="micrio">` element, and `onresize` already
 * returns early when the viewport did not change. The warning still fires here because
 * every `.css` import is stubbed in the browser project (see `vitest.config.ts`): the
 * production rule that pins the canvas box (`canvas.micrio { width: 100% !important;
 * height: 100% !important }`, `src/core/element.css`) is missing, so the observed box
 * follows the canvas `width`/`height` attributes that `onresize` writes, and Chromium
 * reports the extra delivery it needs. It is not an error from the client and cannot
 * happen with the production stylesheet, so only that exact message is swallowed.
 */
const resizeObserverLoop = 'ResizeObserver loop completed with undelivered notifications'
const error = console.error.bind(console)
console.error = (...args: unknown[]) => {
	if (args.some((a) => a instanceof Error && a.message.includes(resizeObserverLoop))) {
		return
	}
	error(...args)
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
	// Offline by default: the fetch patch answers every un-mocked URL with a 404, so
	// a suite that forgets to mock cannot silently reach the real network. Tests
	// override it with `mockJson`/`mockText`; the opt-in live suite opts out.
	if (!__MICRIO_LIVE__) {
		mockFetch([])
	}
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
