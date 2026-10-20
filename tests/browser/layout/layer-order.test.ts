import { describe, expect, it } from 'vitest'
import type { HTMLMicrioElement } from '$core/element'
import type { MicrioImage } from '$core/image'
import { markerBundle, openMarkers } from '../../fixtures/markers'
import { settle } from '../../helpers/tour'

/**
 * The stacking order of the layers inside `<micrio-main>`.
 *
 * The layers are all absolutely positioned over the same box, so their DOM order alone decides
 * which one paints on top. `layout/main.ts` keeps that order in `#layers` and inserts a new
 * layer before the next layer that is on screen, using `#elements` as the anchor. These tests
 * pin the order at the points where the anchor is recorded and the marker overlay is created.
 */

/** The direct children of `<micrio-main>`, in paint order, as tag names. */
function layerOrder(viewer: Element): string[] {
	return [...viewer.querySelectorAll('micrio-main > *')].map((c) => c.localName)
}

const indexOf = (order: string[], tag: string): number => order.indexOf(tag)

/** Makes `image` the one the layer sync counts as visible, the way a drawn frame does. */
function markVisible(viewer: { el: HTMLMicrioElement }, image: MicrioImage): void {
	viewer.el._visible.update((l) => (l.includes(image) ? l : [image]))
}

describe('layer stacking order', () => {
	it('keeps the popup above the marker overlay', async () => {
		const opened = await openMarkers(markerBundle())
		// `state.popup` is the documented way to open a marker's popup (a click does the same)
		const target = opened.image().$data?.markers?.[0]
		if (!target) {
			throw new Error('the fixture has no markers')
		}
		opened.viewer.el.state.popup.set(target)
		await settle()

		const order = layerOrder(opened.viewer.el)
		expect(indexOf(order, 'micrio-markers')).toBeGreaterThanOrEqual(0)
		expect(indexOf(order, 'micrio-marker-popup')).toBeGreaterThan(indexOf(order, 'micrio-markers'))

		opened.viewer.destroy()
	})

	it('places a layer created before the marker overlay ahead of it', async () => {
		// A split gallery has one overlay per visible image. The first one is created while only
		// an image *without* markers is visible; the overlay then only appears when the image
		// with markers becomes visible too, and must not jump behind the layers already placed.
		const opened = await openMarkers(markerBundle())
		const { el } = opened.viewer
		el._visible.set([])
		await settle()

		// A layer that follows `markers` in `#layers`, created while the overlay does not exist
		const target = opened.image().$data?.markers?.[0]
		if (!target) {
			throw new Error('the fixture has no markers')
		}
		el.state.popup.set(target)
		await settle()
		expect(indexOf(layerOrder(el), 'micrio-markers')).toBe(-1)

		// Now an image with markers becomes visible, creating the overlay
		markVisible(opened.viewer, opened.image())
		await settle()

		const order = layerOrder(el)
		expect(indexOf(order, 'micrio-markers')).toBeGreaterThanOrEqual(0)
		expect(indexOf(order, 'micrio-marker-popup')).toBeGreaterThan(indexOf(order, 'micrio-markers'))

		opened.viewer.destroy()
	})
})
