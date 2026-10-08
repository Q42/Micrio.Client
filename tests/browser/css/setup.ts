/**
 * Setup for the `css` project (see `vitest.config.ts`): the same browser, the same fakes and
 * the same offline default as the `browser` project — `tests/browser/setup.ts` still runs
 * first — plus the viewport contract the stylesheet suites share.
 *
 * The difference that makes this project possible is in the config, not here: with
 * `MICRIO_TEST_CSS=1` (which only `npm run test:css` sets) the shared stub stops rewriting
 * every `.css` import to `{}`, so Vite injects the real stylesheets into the test page.
 *
 * That is exactly why this is a separate run. When a stylesheet applies, the measured
 * geometry of every component changes (`micr-io` is `position: relative; overflow: hidden`
 * with a pinned canvas `100%`, 15 containers are `display: contents`, empty ones are
 * `display: none`), and five existing browser assertions depend on the stubbed sizes — so
 * enabling it suite-wide rewrites their assumptions. Here it is opt-in, and the existing
 * suites keep the stub.
 */
import { afterEach } from 'vitest'
import { afterFrame } from '$utils/dom'
import { page } from 'vitest/browser'

/** A viewport the suite pins, in CSS pixels of the test iframe. */
export interface Viewport {
	width: number
	height: number
}

/** The `css` project's own default. A test that resizes returns to this one. */
export const DESKTOP: Viewport = { width: 1024, height: 768 }

/**
 * A phone width. 400 sits below every `max-width` rule that breaks the layout (500, 520,
 * 600, 639, 640) and above none of them, and 800 is taller than wide so the bottom-anchored
 * mobile sheet has room to be off-canvas.
 */
export const MOBILE: Viewport = { width: 400, height: 800 }

/**
 * A tablet width, for the 640–1023 band the desktop viewport does not reach: above the
 * marker/subtitles/popover `max-width: 640` rules, below nothing. The CSS suite runs at
 * `DESKTOP` and resizes per test with {@link useViewport}, so this is a value, not a
 * project; should tablet rules ever need a pinned environment, add
 * `browserProject('css-tablet', TABLET, ...)` to `vitest.config.ts`.
 */
export const TABLET: Viewport = { width: 820, height: 1180 }

/**
 * A window much wider than it is tall, for the `min-aspect-ratio` branches. Not as short as
 * a real 16:9 window: the book's fit is extreme at that ratio and crops the spread.
 */
export const WIDE: Viewport = { width: 1280, height: 800 }

let size: Viewport = DESKTOP

/**
 * Resizes the test iframe and waits for the resulting layout to settle.
 *
 * `page.viewport` resizes the iframe from the outside, so the page's own `resize` listeners
 * and the client's `window.innerWidth` readers run on their own; the two frames cover the
 * one-frame deferrals in the client's resize path. The size is remembered so `afterEach`
 * can restore it — the browser context (and therefore the viewport) lives for a whole test
 * file, so a leaked size would re-point every test after it.
 */
export async function useViewport(next: Viewport): Promise<void> {
	await page.viewport(next.width, next.height)
	size = next
	await afterFrame()
	await afterFrame()
}

/** The viewport the suite is currently at, for assertions about the page rather than an element. */
export const currentViewport = (): Viewport => size

afterEach(async () => {
	if (size !== DESKTOP) {
		await useViewport(DESKTOP)
	}
})
