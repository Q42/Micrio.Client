import { describe, expect, it } from 'vitest'
import { mountViewer } from '../../helpers/viewer'
import { box, expectFillsViewport, mountUi, rendered, style, styleNumber } from './helpers'
import { DESKTOP, MOBILE, TABLET, currentViewport, useViewport } from './setup'
import { uiBundle } from '../../fixtures/ui'

/**
 * The suite's own plumbing, pinned before any rule is.
 *
 * The `css` project only proves anything if the stylesheets are really in the page: the
 * whole point of the project is that the shared stub is off, and a regression there would
 * turn every other file in this directory into a test of the *browser's* default styles.
 * `document.styleSheets` counts what Vite injected; the `micr-io` rule and the canvas pin
 * below are the two rules the rest of the client's layout rests on.
 *
 * The viewport side is pinned the same way: `micr-io` is `container-type: size`, so a
 * responsive test is only meaningful on an element that actually measures the viewport.
 */
describe('css suite plumbing', () => {
	it('has the stylesheets injected', () => {
		expect(document.styleSheets.length).toBeGreaterThan(0)
	})

	it('applies the host and canvas rules from element.css', () => {
		const viewer = mountViewer()
		const host = viewer.el

		// micr-io { display: block; position: relative; overflow: hidden; width/height: 100% }
		expect(style(host, 'display')).toBe('block')
		expect(style(host, 'position')).toBe('relative')
		expect(style(host, 'overflow')).toBe('hidden')

		// canvas.micrio { position: absolute; width/height: 100% !important }
		const canvas = host.querySelector('canvas.micrio')
		expect(canvas).not.toBeNull()
		expect(style(canvas as Element, 'position')).toBe('absolute')
		expect(Math.round(box(canvas as Element).width)).toBe(Math.round(box(host).width))

		viewer.destroy()
	})

	it('resolves the theme variables element.css declares', () => {
		const viewer = mountViewer()
		expect(styleNumber(viewer.el, '--micrio-button-size')).toBe(48)
		viewer.destroy()
	})
})

describe('css suite viewports', () => {
	it('mounts at the viewport size, which is what a container-query rule reads', async () => {
		expect(currentViewport()).toEqual(DESKTOP)
		const viewer = await mountUi(uiBundle())
		expectFillsViewport(viewer.el)
		viewer.destroy()
	})

	it('resizes per test and restores the project default afterwards', async () => {
		await useViewport(MOBILE)
		expect(currentViewport()).toEqual(MOBILE)
		expect(window.innerWidth).toBe(MOBILE.width)

		const viewer = await mountUi(uiBundle())
		expect(rendered(viewer.el)).toBe(true)
		expectFillsViewport(viewer.el)
		viewer.destroy()
	})

	it('is back at the desktop default', () => {
		expect(currentViewport()).toEqual(DESKTOP)
		expect(window.innerWidth).toBe(DESKTOP.width)
	})

	it('reaches the tablet band the desktop viewport does not', async () => {
		await useViewport(TABLET)
		expect(window.innerWidth).toBe(TABLET.width)
	})
})
