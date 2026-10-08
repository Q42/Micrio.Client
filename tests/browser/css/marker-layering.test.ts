import { describe, expect, it } from 'vitest'
import { markerBundle, openMarkers, waitForMarker, type OpenMarkers } from '../../fixtures/markers'
import { expectFillsViewport, rendered, style, styleNumber, waitForStyle } from './helpers'

/**
 * `src/markers/marker.css` and `src/markers/markers.css` — the rules that decide whether a
 * marker is visible and whether it can be clicked.
 *
 * The layer is `pointer-events: none` with `pointer-events: all` on its children, and a
 * marker's own button is the click target. So the facts worth pinning are the *cascade*
 * states: which element receives a hit where a marker is, what the `inactive` class does to
 * that, how a default marker is drawn from the theme variables, and the two ways a label or
 * a covered marker is kept out of the way.
 *
 * Hit tests are used rather than comparing boxes because a marker is moved by
 * `transform: translate3d(var(--x), var(--y), 0) …`, which is exactly what a refactor gets
 * wrong while every element still reports plausible numbers.
 *
 * The fixture cannot drive marker positions: its image never finishes loading, so the client
 * keeps every marker at the viewport centre (and its fade-in animation leaves them at
 * `opacity: 0` until it has run). The assertions below are therefore about one marker's own
 * states — not about two markers at two projected positions.
 */

/** Opens a marker viewer that fills the iframe, and waits for a marker element. */
async function openFull(short = 'm1'): Promise<OpenMarkers> {
	const opened = await openMarkers(markerBundle(), { style: 'width: 100vw; height: 100vh; display: block;' })
	await waitForMarker(opened.viewer.el, opened.mid(short))
	expectFillsViewport(opened.viewer.el)
	// `micrio-marker:not(.cluster) { animation: micrio-marker-fade 0.25s forwards }` starts at
	// `opacity: 0`, so wait for the fade before asking about visibility.
	await waitForStyle(opened.markerEl(short) as HTMLElement, 'opacity', '1')
	return opened
}

/** The point at an element's own centre, in viewport coordinates. */
const at = (el: Element): { x: number; y: number } => {
	const rect = el.getBoundingClientRect()
	return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

describe('the marker layer', () => {
	it('sits above the canvas and lets a click through where no marker is', async () => {
		const opened = await openFull()
		const layer = opened.layer() as HTMLElement
		const canvas = opened.viewer.el.querySelector('canvas.micrio') as HTMLCanvasElement

		expect(style(layer, 'pointer-events')).toBe('none')
		expect(style(layer, 'position')).toBe('absolute')

		// The overlay is later in the DOM than the canvas, so it would win a hit test
		// everywhere; `pointer-events: none` is what lets the viewer receive a pan that
		// starts between the markers.
		expect(layer.contains(document.elementFromPoint(4, 4))).toBe(false)
		expect(canvas.contains(document.elementFromPoint(4, 4))).toBe(true)
		opened.viewer.destroy()
	})

	it('gives a marker a click target of its own', async () => {
		const opened = await openFull()
		const markerEl = opened.markerEl('m1') as HTMLElement
		const layer = opened.layer() as HTMLElement
		const button = opened.button('m1') as HTMLButtonElement

		// markers.css: `micrio-markers > * { pointer-events: all }` — transparent layer,
		// interactive markers.
		expect(style(markerEl, 'pointer-events')).toBe('all')
		expect(style(markerEl, 'position')).toBe('absolute')
		expect(style(markerEl, 'display')).toBe('block')
		expect(rendered(markerEl)).toBe(true)

		const point = at(markerEl)
		// The fixture's two markers stack at the viewport centre, so the point may resolve to
		// the other marker's button; what matters is that it resolves inside the layer.
		const hit = document.elementFromPoint(point.x, point.y)
		expect(layer.contains(hit)).toBe(true)
		expect(button.disabled).toBe(false)
		opened.viewer.destroy()
	})

	it('takes the markers out of the click path when the layer is inactive', async () => {
		const opened = await openFull()
		const layer = opened.layer() as HTMLElement
		const markerEl = opened.markerEl('m1') as HTMLElement
		const point = at(markerEl)

		expect(layer.contains(document.elementFromPoint(point.x, point.y))).toBe(true)
		layer.classList.add('inactive')
		// `micrio-markers.inactive > * { pointer-events: none }` wins over the `> *` rule: the
		// markers stay laid out and painted (the 360 branch fades the layer itself), but the
		// point now reaches the canvas under them.
		await waitForStyle(markerEl, 'pointer-events', 'none')
		expect(rendered(markerEl)).toBe(true)
		expect(layer.contains(document.elementFromPoint(point.x, point.y))).toBe(false)
		opened.viewer.destroy()
	})
})

describe('a default marker', () => {
	it('draws the round marker from the theme variables', async () => {
		const opened = await openFull()
		const button = opened.button('m1') as HTMLButtonElement

		// marker.css: `.default button { width/height: var(--micrio-marker-size);
		// border: var(--micrio-marker-border-size) solid … }`, with element.css declaring the
		// defaults (a 16px marker inside an 8px border).
		expect(styleNumber(button, 'width')).toBe(16)
		expect(styleNumber(button, 'height')).toBe(16)
		expect(styleNumber(button, 'border-top-width')).toBe(8)
		expect(style(button, 'border-top-style')).toBe('solid')
		expect(style(button, 'cursor')).toBe('pointer')
		opened.viewer.destroy()
	})

	it('hides the label until titles are shown', async () => {
		const opened = await openFull()
		const layer = opened.layer() as HTMLElement
		const label = (opened.markerEl('m1') as HTMLElement).querySelector('label') as HTMLElement

		// `label { opacity: 0; pointer-events: none }`, re-shown by `:hover` or by the
		// `.show-titles` class the client puts on the layer when marker titles are enabled.
		// The `:hover` half is pinned in `toolbar-responsive.test.ts`, where a real hover is
		// reachable; this class sets the same two declarations.
		expect(style(label, 'opacity')).toBe('0')
		expect(style(label, 'pointer-events')).toBe('none')

		layer.classList.add('show-titles')
		// The label has its own 0.1s opacity transition, so read it after it has landed.
		await waitForStyle(label, 'opacity', '1')
		expect(style(label, 'pointer-events')).toBe('all')
		opened.viewer.destroy()
	})

	it('leaves a covered marker unable to receive clicks', async () => {
		const opened = await openFull()
		const markerEl = opened.markerEl('m1') as HTMLElement
		const layer = opened.layer() as HTMLElement
		const point = at(markerEl)

		// The two fixture markers stack at the viewport centre, so the point may resolve to
		// either of them; all this needs is that it is on a marker before the class goes on.
		expect(layer.contains(document.elementFromPoint(point.x, point.y))).toBe(true)

		// `micrio-marker.behind { pointer-events: none; opacity: 0 !important }` — the class
		// the client's covered-marker pass adds, and the one place a marker is invisible and
		// must not be clickable either.
		markerEl.classList.add('behind')
		expect(style(markerEl, 'pointer-events')).toBe('none')
		expect(style(markerEl, 'opacity')).toBe('0')
		// `!important`, so a later `.opened` rule cannot bring it back into view.
		markerEl.classList.add('opened')
		expect(style(markerEl, 'opacity')).toBe('0')
		// The covering marker still receives the click; the covered one cannot.
		expect(markerEl.contains(document.elementFromPoint(point.x, point.y))).toBe(false)
		expect(layer.contains(document.elementFromPoint(point.x, point.y))).toBe(true)
		opened.viewer.destroy()
	})
})
