import { describe, expect, it } from 'vitest'
import { markerTour, tourBundle } from '../../fixtures/tours'
import { mountTour, settle } from '../../helpers/tour'
import { waitFor } from '../../helpers/viewer'
import { box, intersectsViewport, rendered, style } from './helpers'
import { MOBILE, useViewport } from './setup'

/**
 * `src/tour/tour.css` and `serial-tour.css` — where the tour controls land, and what the
 * `tourControlsInPopup` setting does to that.
 *
 * The browser project's `marker-tour.test.ts` already pins the controls' *behaviour*
 * (stepping, the counter, disabled ends, the aside moving into the popup). What lives only
 * in CSS is where they sit: a bar centred along the bottom edge, above the step list rather
 * than on top of it, hidden while the viewer is idle, and on a phone the step list moves up
 * out of the bar's way. The `serial-tour.css` rules are the ones a refactor dropped once
 * already — three `display: contents` rules that turn the tour, its media and its controls
 * into the flex items of that bar.
 */

/** Mounts a marker tour that fills the iframe, and starts it. */
async function openTour(options: { popupControls?: boolean } = {}) {
	const tour = markerTour({ steps: ['m1', 'm2', 'm3'] })
	const bundle = tourBundle({
		markerTours: [tour],
		...(options.popupControls ? { settings: { _markers: { tourControlsInPopup: true } } } : {}),
	})
	const viewer = await mountTour(bundle)
	viewer.el.style.cssText = 'width: 100vw; height: 100vh; display: block;'
	viewer.el.state.tour.set(tour)
	await waitFor(() => viewer.el.querySelector('micrio-tour') !== null, 4000, 'the tour element')
	await settle(3)
	return viewer
}

/** The tour's control bar. */
const aside = (viewer: Awaited<ReturnType<typeof openTour>>) =>
	viewer.el.querySelector<HTMLElement>('micrio-tour > aside.marker-tour')

describe('the tour control bar', () => {
	it('is centred along the bottom edge on the desktop', async () => {
		const viewer = await openTour()
		const bar = aside(viewer) as HTMLElement

		// tour.css: `micrio-tour > aside.marker-tour { bottom: var(--micrio-border-margin);
		// left: 50%; transform: translateX(-50%) }` with the absolute base that gives it the
		// glass background and the `z-index: 5` above the gallery.
		expect(bar).not.toBeNull()
		expect(style(bar, 'position')).toBe('absolute')
		expect(style(bar, 'display')).toBe('flex')
		expect(style(bar, 'z-index')).toBe('5')
		expect(Math.round(box(bar).left + box(bar).width / 2)).toBeCloseTo(Math.round(window.innerWidth / 2), 0)
		expect(Math.round(window.innerHeight - box(bar).bottom)).toBe(16)
		expect(intersectsViewport(bar)).toBe(true)
		expect(rendered(bar)).toBe(true)
		viewer.destroy()
	})

	it('hides the fullscreen toggle for a marker tour', async () => {
		const viewer = await openTour()
		const bar = aside(viewer) as HTMLElement
		const fullscreen = bar.querySelector('micrio-fullscreen') as HTMLElement

		// `micr-io:not([data-video-tour-active]) aside.marker-tour micrio-fullscreen {
		// display: none }` — the toggle only exists while a *video* tour runs.
		expect(fullscreen).not.toBeNull()
		expect(style(fullscreen, 'display')).toBe('none')

		viewer.el.dataset.videoTourActive = ''
		expect(style(fullscreen, 'display')).not.toBe('none')
		viewer.destroy()
	})

	it('keeps the step buttons in the bar', async () => {
		const viewer = await openTour()
		const bar = aside(viewer) as HTMLElement

		// `aside.marker-tour micrio-button { --micrio-button-background: transparent; … }` strips
		// the buttons' own chrome inside the bar — including the negative margins that keep them
		// flush, so the bar reads as one panel rather than a row of separate buttons.
		const buttons = bar.querySelectorAll('micrio-button')
		expect(buttons.length).toBeGreaterThanOrEqual(3)
		for (const button of Array.from(buttons)) {
			expect(style(button, '--micrio-button-background')).toBe('transparent')
			expect(style(button, '--micrio-border-radius')).toBe('0')
		}
		viewer.destroy()
	})

	it('moves the controls into the marker popup when the image asks for it', async () => {
		const viewer = await openTour({ popupControls: true })
		await waitFor(
			() => viewer.el.querySelector('micrio-marker-popup aside.marker-tour') !== null,
			6000,
			'the popup tour aside',
		)
		const popupBar = viewer.el.querySelector<HTMLElement>('micrio-marker-popup aside.marker-tour') as HTMLElement

		// With the setting on, the bar is a child of the popup: it takes the popup's
		// positioning context (absolute inside `micrio-marker-popup`), not the viewport's
		// (`position: fixed`-like centring of `micrio-tour > aside.marker-tour`).
		expect(aside(viewer)).toBeNull()
		expect(style(popupBar, 'position')).toBe('absolute')
		expect(intersectsViewport(popupBar)).toBe(true)
		viewer.destroy()
	})

	it('raises the step list above the bar on a phone', async () => {
		const tour = markerTour({ steps: ['m1', 'm2', 'm3'] })
		const viewer = await mountTour(tourBundle({ markerTours: [tour] }))
		viewer.el.style.cssText = 'width: 100vw; height: 100vh; display: block;'
		await useViewport(MOBILE)

		// The serial tour's step list is what the media query moves; a marker tour renders a
		// counter instead, so the rule is read from the sheet (`serial-tour.css` is the file
		// whose three lost rules this suite exists for).
		void viewer
		const raised = Array.from(document.styleSheets).some((sheet) => {
			let rules: CSSRuleList | undefined
			try {
				rules = sheet.cssRules
			} catch {
				return false
			}
			return Array.from(rules ?? []).some((rule) => {
				if (!(rule instanceof CSSMediaRule) || !rule.conditionText.includes('500px')) {
					return false
				}
				return Array.from(rule.cssRules).some(
					(inner) =>
						inner instanceof CSSStyleRule && inner.selectorText.includes('serial-tour ol') && inner.style.bottom !== '',
				)
			})
		})
		expect(raised).toBe(true)
		viewer.destroy()
	})
})

describe('the serial tour bar', () => {
	it('stays a flex row through the pass-through rules', async () => {
		const tour = markerTour({ steps: ['m1', 'm2'] })
		const viewer = await mountTour(tourBundle({ markerTours: [tour] }))

		// `serial-tour.css` opens with the three `display: contents` rules that were lost when
		// the component's inline styles moved into the file: without them the bar is not a flex
		// row at all and the progress bars stack. Asserted as CSS text, because a marker tour
		// (the only tour this fixture can start) renders `micrio-tour`, not a serial tour.
		const contents = Array.from(document.styleSheets).flatMap((sheet) => {
			try {
				return Array.from(sheet.cssRules)
			} catch {
				return []
			}
		})
		const selectors = contents
			.filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.style.display === 'contents')
			.map((rule) => rule.selectorText)
			.filter((selector) => selector.includes('micrio-serial-tour'))
		expect(selectors.join(' ')).toContain('micrio-serial-tour micrio-media-controls')
		viewer.destroy()
	})
})
