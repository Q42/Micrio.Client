import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Models } from '$types/models'
import { marker } from '../../fixtures/bundles'
import { markerBundle, openMarkers } from '../../fixtures/markers'
import { markerTour, videoTour } from '../../fixtures/tours'
import { settle } from '../../helpers/tour'
import { waitFor } from '../../helpers/viewer'

/**
 * `<micrio-markers>` is the per-visible-image layer the layout mounts: it decides which
 * markers exist for the active language, injects each marker's clickable area, syncs the
 * 360 waypoints and owns the clustering pass. The element-level behaviour lives in the
 * sibling suites; this one covers the layer.
 *
 * The fixture prefixes marker ids per call because `MicrioElement._markerImages` is a
 * module-level map that is never cleared (see `fixtures/markers.ts`).
 */

afterEach(() => {
	vi.useRealTimers()
})

/** A clickable-area embed that opens its own marker. */
const clickableMarker = (id: string) =>
	marker(id, {
		clickableArea: {
			area: [0.1, 0.1, 0.2, 0.2],
			clickAction: 'markerId',
			clickTarget: id,
		} as Models.ImageData.Embed,
	})

describe('markers', () => {
	it('renders one element per marker in the bundle data', async () => {
		const opened = await openMarkers(markerBundle())
		expect(opened.markerEls()).toHaveLength(2)
		expect(opened.image().$data?.markers).toHaveLength(2)
		opened.viewer.destroy()
	})

	it('opens a marker through the image state and reports it globally', async () => {
		const fixture = markerBundle()
		const opened = await openMarkers(fixture)
		const seen: string[] = []
		for (const type of ['marker-open', 'marker-opened', 'marker-closed']) {
			opened.viewer.el.addEventListener(type, () => seen.push(type))
		}

		await opened.openMarker('m1')

		expect(opened.image().state.$marker?.id).toBe(fixture.mid('m1'))
		expect(opened.viewer.el.state.$marker?.id).toBe(fixture.mid('m1'))
		expect(opened.viewer.el.state.$marker?.i18n?.en?.title).toBeDefined()
		expect(seen).toContain('marker-open')
		await waitFor(() => seen.includes('marker-opened'), 4000, 'marker-opened')
		opened.viewer.destroy()
	})

	it('clears the marker state when the marker is closed', async () => {
		const opened = await openMarkers(markerBundle())
		await opened.openMarker('m1')
		await opened.closeMarker()
		expect(opened.viewer.el.state.$marker).toBeUndefined()
		opened.viewer.destroy()
	})

	it('keeps marker identity stable across a re-render', async () => {
		const opened = await openMarkers(markerBundle())
		const before = opened.markerEl('m1')
		const data = opened.image().$data
		expect(before).not.toBeNull()

		// Re-setting the same data must rebuild in place, not recreate the elements
		opened.image().data.set({ ...data })
		await settle(2)
		expect(opened.markerEl('m1')).toBe(before)

		// Dropping a marker removes exactly that element
		const remaining = data?.markers?.filter((m) => m.id !== opened.mid('m1')) ?? []
		opened.image().data.set({ ...data, markers: remaining })
		await settle(2)
		expect(opened.markerEl('m1')).toBeNull()
		expect(opened.markerEl('m2')).not.toBeNull()
		opened.viewer.destroy()
	})

	it('exposes the marker tour data for a later tour session', async () => {
		const fixture = markerBundle({ markerTours: [markerTour({ steps: ['m1', 'm2'] })] })
		const opened = await openMarkers(fixture)
		const tours = opened.image().$data?.markerTours ?? []
		expect(tours).toHaveLength(1)
		expect(tours[0]?.steps).toEqual([fixture.mid('m1'), fixture.mid('m2')])
		expect(tours[0]?.stepInfo?.map((s) => s.markerId)).toEqual([fixture.mid('m1'), fixture.mid('m2')])
		expect(tours[0]?.duration).toBe(8)
		opened.viewer.destroy()
	})

	it('exposes the video tour timeline for a later tour session', async () => {
		const opened = await openMarkers(markerBundle({ tours: [videoTour()] }))
		const tours = opened.image().$data?.tours ?? []
		expect(tours).toHaveLength(1)
		const timeline = tours[0]?.i18n?.en?.timeline ?? []
		expect(timeline.map((v) => [v.start, v.end])).toEqual([
			[0, 4],
			[4, 10],
		])
		opened.viewer.destroy()
	})

	it('KNOWN GAP: a changed marker with the same id is not re-rendered', async () => {
		// `rebuild` only creates missing elements, so a marker whose data changed under
		// the same id keeps its old label. When `_setProps` starts being re-applied,
		// this test changes.
		const opened = await openMarkers(markerBundle({ markers: [marker('m1')] }))
		expect(opened.markerEl('m1')?.querySelector('label')?.textContent).toBe('Marker m1')

		const data = opened.image().$data
		const changed: Models.ImageData.Marker[] = []
		for (const m of data?.markers ?? []) {
			changed.push(Object.assign({}, m, { i18n: { en: { title: 'Updated title' } } }))
		}
		opened.image().data.set({ ...data, markers: changed })
		await settle(2)

		expect(opened.markerEl('m1')?.querySelector('label')?.textContent).toBe('Marker m1')
		opened.viewer.destroy()
	})
})

describe('markers — language filter', () => {
	it('only renders markers that have culture data for the active language', async () => {
		const fixture = markerBundle({
			markers: [
				marker('m1', { i18n: { en: { title: 'One' }, nl: { title: 'Een' } } }),
				marker('m2', { i18n: { en: { title: 'Two' } } }),
			],
			langs: ['en', 'nl'],
		})
		const opened = await openMarkers(fixture, { attrs: { lang: 'nl' } })

		expect(opened.markerEls()).toHaveLength(1)
		expect(opened.markerEl('m1')).not.toBeNull()
		expect(opened.markerEl('m2')).toBeNull()

		// Switching the element's language is how a real page switches
		opened.viewer.el.setAttribute('lang', 'en')
		await waitFor(() => opened.markerEls().length === 2, 4000, 'both markers after the language switch')
		opened.viewer.destroy()
	})
})

describe('markers — element setup', () => {
	it('mirrors marker tags as classes on the element', async () => {
		const opened = await openMarkers(markerBundle({ markers: [marker('m1', { tags: ['focus', 'custom'] })] }))
		const el = opened.markerEl('m1')
		expect(el?.classList.contains('focus')).toBe(true)
		expect(el?.classList.contains('custom')).toBe(true)
		opened.viewer.destroy()
	})

	it('flags the layer when titles are forced on', async () => {
		const on = await openMarkers(markerBundle({ settings: { _markers: { showTitles: true } } }))
		expect(on.layer()?.classList.contains('show-titles')).toBe(true)
		on.viewer.destroy()

		const off = await openMarkers(markerBundle())
		expect(off.layer()?.classList.contains('show-titles')).toBe(false)
		off.viewer.destroy()
	})

	it('tracks a noMarker marker without building a button or a position', async () => {
		const opened = await openMarkers(markerBundle({ markers: [marker('m1', { noMarker: true })] }))
		const el = opened.markerEl('m1')
		expect(el).not.toBeNull()
		expect(el?.querySelector('button')).toBeNull()
		expect(el?.style.getPropertyValue('--x')).toBe('')
		opened.viewer.destroy()
	})

	it('leaves a marker with its own htmlElement alone', async () => {
		const html = document.createElement('div')
		html.textContent = 'own element'
		const opened = await openMarkers(markerBundle({ markers: [marker('m1', { htmlElement: html })] }))
		const el = opened.markerEl('m1')
		expect(el?.querySelector('button')).toBeNull()
		// The element marker.ts builds is empty: the authored element is placed elsewhere
		expect(el?.textContent).toBe('')
		opened.viewer.destroy()
	})
})

describe('markers — zoom out after close', () => {
	it('restores the view that was active before the marker opened', async () => {
		const opened = await openMarkers(markerBundle({ markers: [marker('m1', { view: [0.2, 0.2, 0.5, 0.5] })] }))
		await opened.openMarker('m1')
		await settle(2)

		const image = opened.image()
		vi.useFakeTimers()
		const spy = vi.spyOn(image.camera, 'flyToView').mockImplementation(() => Promise.resolve())

		image.state.marker.set(undefined)
		vi.advanceTimersByTime(20)

		expect(spy).toHaveBeenCalledTimes(1)
		const [view] = spy.mock.calls[0] ?? []
		expect(view).toHaveLength(4)
		// The restored view is clamped into the image
		expect(view?.[2]).toBeLessThanOrEqual(1)
		expect(view?.[3]).toBeLessThanOrEqual(1)

		spy.mockRestore()
		opened.viewer.destroy()
	})

	it('does nothing when the setting is off', async () => {
		const opened = await openMarkers(
			markerBundle({
				markers: [marker('m1', { view: [0.2, 0.2, 0.5, 0.5] })],
				settings: { _markers: { zoomOutAfterClose: false } },
			}),
		)
		await opened.openMarker('m1')
		await settle(2)

		const image = opened.image()
		vi.useFakeTimers()
		const spy = vi.spyOn(image.camera, 'flyToView').mockImplementation(() => Promise.resolve())

		image.state.marker.set(undefined)
		vi.advanceTimersByTime(20)

		expect(spy).not.toHaveBeenCalled()
		spy.mockRestore()
		opened.viewer.destroy()
	})
})

describe('markers — viewport sync', () => {
	it('positions the layer on the image viewport', async () => {
		const opened = await openMarkers(markerBundle())
		const image = opened.image()
		const layer = opened.layer()

		image._viewport.set([10.123, 20.456, 300.789, 400.111])
		await settle(1)
		expect(layer?.style.left).toBe('10.12px')
		expect(layer?.style.top).toBe('20.46px')
		expect(layer?.style.width).toBe('300.79px')
		expect(layer?.style.height).toBe('400.11px')

		// A viewport that matches the canvas keeps the dimension unpinned
		const size = opened.viewer.el.canvas.viewport
		image._viewport.set([1, 2, size.width, size.height])
		await settle(1)
		expect(layer?.style.left).toBe('1px')
		expect(layer?.style.width).toBe('')
		expect(layer?.style.height).toBe('')

		// A missing viewport is ignored rather than clearing the last one
		image._viewport.set(undefined as unknown as Models.Camera.View)
		await settle(1)
		expect(layer?.style.left).toBe('1px')
		opened.viewer.destroy()
	})
})

describe('markers — clickable areas', () => {
	it('renders the area embed before the marker elements', async () => {
		const opened = await openMarkers(markerBundle({ prefix: false, markers: [clickableMarker('click1')] }))
		const layer = opened.layer()
		const embed = layer?.querySelector('micrio-embed[data-marker-id="click1"]')

		expect(embed).not.toBeNull()
		// Marker dots stay on top of the area, so the embed is inserted first
		expect(layer?.firstElementChild?.tagName.toLowerCase()).toBe('micrio-embed')
		opened.viewer.destroy()
	})

	it('opens its own marker when the area is clicked', async () => {
		const opened = await openMarkers(markerBundle({ prefix: false, markers: [clickableMarker('click2')] }))
		await waitFor(() => opened.layer() !== null, 4000, 'the layer')

		const container = opened.layer()?.querySelector<HTMLElement>('micrio-embed[data-marker-id="click2"] > div')
		expect(container).not.toBeNull()
		container?.click()
		await waitFor(() => opened.image().state.$marker?.id === 'click2', 4000, 'the marker opened from its area')
		opened.viewer.destroy()
	})

	it('removes the area when the marker is filtered out by language', async () => {
		const onlyEnglish = clickableMarker('click3')
		onlyEnglish.i18n = { en: { title: 'Only English' } }
		const opened = await openMarkers(markerBundle({ prefix: false, markers: [onlyEnglish], langs: ['en', 'nl'] }), {
			attrs: { lang: 'nl' },
		})

		expect(opened.markerEl('click3')).toBeNull()
		expect(opened.layer()?.querySelectorAll('micrio-embed[data-marker-id]').length).toBe(0)
		opened.viewer.destroy()
	})
})
