import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Models } from '$types/models'
import { get } from '$core/store'
import { marker } from '../../fixtures/bundles'
import { markerBundle, openMarkers, waitForPopup } from '../../fixtures/markers'
import { markerTour, videoTour } from '../../fixtures/tours'
import { mockJson } from '../../helpers/network'
import { settle } from '../../helpers/tour'
import { waitFor } from '../../helpers/viewer'

/**
 * What happens when a marker is opened: the state it writes, the events it fires, the
 * camera it moves, the tour it starts or stops, and the image links it follows. All of it
 * is driven through the real element — the button click or the image state — so the
 * production resolution path is the one under test.
 */

afterEach(() => {
	vi.useRealTimers()
})

describe('marker open and close', () => {
	it('opens a marker when its button is clicked', async () => {
		const fixture = markerBundle()
		const opened = await openMarkers(fixture)
		const events: string[] = []
		for (const type of ['marker-open', 'marker-opened', 'marker-closed']) {
			opened.viewer.el.addEventListener(type, () => events.push(type))
		}

		opened.button('m1')?.click()
		await waitFor(() => opened.image().state.$marker?.id === fixture.mid('m1'), 6000, 'the marker open')

		expect(opened.markerEl('m1')?.classList.contains('opened')).toBe(true)
		expect(events).toContain('marker-open')
		await waitFor(() => events.includes('marker-opened'), 6000, 'marker-opened')

		expect(get(opened.viewer.el.state.popup)?.id).toBe(fixture.mid('m1'))
		opened.viewer.destroy()
	})

	it('clears an open marker when it is clicked again and shows no popup', async () => {
		// A popup marker with no content opens nothing, so a second click closes it
		const bare: Models.ImageData.Marker = { id: 'm1', x: 0.5, y: 0.5, type: 'default', popupType: 'popup' }
		const opened = await openMarkers(markerBundle({ markers: [bare] }))
		const btn = opened.button('m1')

		btn?.click()
		await waitFor(() => opened.image().state.$marker !== undefined, 6000, 'the marker open')
		expect(get(opened.viewer.el.state.popup)).toBeUndefined()

		btn?.click()
		await waitFor(() => opened.image().state.$marker === undefined, 6000, 'the marker closed')
		opened.viewer.destroy()
	})

	it('clears an open marker when it is closed', async () => {
		const opened = await openMarkers(markerBundle())
		const events: string[] = []
		opened.viewer.el.addEventListener('marker-closed', () => events.push('marker-closed'))

		await opened.openMarker('m1')
		await opened.closeMarker()
		expect(events).toContain('marker-closed')
		expect(opened.markerEl('m1')?.classList.contains('opened')).toBe(false)
		opened.viewer.destroy()
	})

	it('lets a marker override everything with its own onclick', async () => {
		const onclick = vi.fn()
		const fixture = markerBundle({ markers: [marker('m1', { onclick })] })
		const opened = await openMarkers(fixture)

		opened.button('m1')?.click()
		await settle(2)

		expect(onclick).toHaveBeenCalledTimes(1)
		expect(onclick.mock.calls[0]?.[0]?.id).toBe(fixture.mid('m1'))
		expect(opened.image().state.$marker).toBeUndefined()
		expect(get(opened.viewer.el.state.popup)).toBeUndefined()
		opened.viewer.destroy()
	})
})

describe('markers with actions disabled', () => {
	it('ignores a click and fires no open event', async () => {
		const opened = await openMarkers(markerBundle({ settings: { _markers: { noMarkerActions: true } } }))
		const events: string[] = []
		opened.viewer.el.addEventListener('marker-open', () => events.push('marker-open'))

		opened.button('m1')?.click()
		await settle(3)

		expect(opened.image().state.$marker).toBeUndefined()
		expect(events).toHaveLength(0)
		opened.viewer.destroy()
	})

	it('still marks the element opened when the state is set from outside', async () => {
		const opened = await openMarkers(markerBundle({ settings: { _markers: { noMarkerActions: true } } }))
		let opens = 0
		opened.viewer.el.addEventListener('marker-open', () => opens++)

		await opened.openMarker('m1')
		expect(opened.markerEl('m1')?.classList.contains('opened')).toBe(true)
		// The guard sits before the dispatch, so nothing is reported
		expect(opens).toBe(0)
		expect(get(opened.viewer.el.state.popup)).toBeUndefined()
		opened.viewer.destroy()
	})
})

describe('marker camera behaviour', () => {
	it('flies to the marker view before showing the content', async () => {
		const view: Models.Camera.View = [0.2, 0.2, 0.5, 0.5]
		const opened = await openMarkers(markerBundle({ markers: [marker('m1', { view })] }))
		const spy = vi.spyOn(opened.image().camera, 'flyToView').mockImplementation(() => Promise.resolve())

		await opened.openMarker('m1')
		await waitForPopup(opened.viewer.el)

		expect(spy).toHaveBeenCalledWith(view, expect.objectContaining({ isJump: true }))
		spy.mockRestore()
		opened.viewer.destroy()
	})

	it('does not animate when the marker asks for none', async () => {
		const opened = await openMarkers(
			markerBundle({ markers: [marker('m1', { view: [0.2, 0.2, 0.5, 0.5], data: { noAnimate: true } })] }),
		)
		const spy = vi.spyOn(opened.image().camera, 'flyToView')

		await opened.openMarker('m1')
		await waitForPopup(opened.viewer.el)

		expect(spy).not.toHaveBeenCalled()
		spy.mockRestore()
		opened.viewer.destroy()
	})

	it('stops the camera when a marker closes', async () => {
		const opened = await openMarkers(markerBundle({ markers: [marker('m1', { view: [0.2, 0.2, 0.5, 0.5] })] }))
		await opened.openMarker('m1')
		await waitForPopup(opened.viewer.el)

		const spy = vi.spyOn(opened.image().camera, 'stop')
		opened.image().state.marker.set(undefined)
		await settle(3)

		expect(spy).toHaveBeenCalled()
		spy.mockRestore()
		opened.viewer.destroy()
	})

	it('does not stop the camera while a tour is running', async () => {
		const fixture = markerBundle({ markerTours: [markerTour({ steps: ['m1'] })] })
		const opened = await openMarkers(fixture)
		await opened.openMarker('m1')

		const tour = fixture.markerTours[0]
		if (!tour) {
			throw new Error('no tour')
		}
		opened.viewer.el.state.tour.set(tour)
		await settle(2)

		const spy = vi.spyOn(opened.image().camera, 'stop')
		opened.image().state.marker.set(undefined)
		// The store notifies synchronously, so the guard's decision is observable here
		expect(spy).not.toHaveBeenCalled()
		spy.mockRestore()
		opened.viewer.destroy()
	})
})

describe('markers and tours', () => {
	it('stops an unrelated tour when a marker opens', async () => {
		const fixture = markerBundle({ markerTours: [markerTour({ id: 'mt-other', steps: ['m1'] })] })
		const opened = await openMarkers(fixture)
		// Only m1 is a step; open m2, which the tour does not cover
		const unrelated = fixture.markerTours[0]
		if (!unrelated) {
			throw new Error('no tour')
		}
		opened.viewer.el.state.tour.set(unrelated)
		await settle(2)

		await opened.openMarker('m2')
		await waitFor(() => get(opened.viewer.el.state.tour) === undefined, 6000, 'the unrelated tour stopped')
		opened.viewer.destroy()
	})

	it('keeps a tour that contains the marker being opened', async () => {
		const fixture = markerBundle({ markerTours: [markerTour({ id: 'mt-own', steps: ['m1', 'm2'] })] })
		const own = fixture.markerTours[0]
		if (!own) {
			throw new Error('no tour')
		}
		const opened = await openMarkers(fixture)
		opened.viewer.el.state.tour.set(own)
		await settle(2)

		await opened.openMarker('m2')
		await settle(2)
		expect(get(opened.viewer.el.state.tour)).toBe(own)
		opened.viewer.destroy()
	})

	it('keeps a marker’s own video tour when it reopens', async () => {
		const video = videoTour({ id: 'vt-own' })
		const fixture = markerBundle({ markers: [marker('m1', { popupType: 'none', videoTour: video })] })
		const opened = await openMarkers(fixture)

		await opened.openMarker('m1')
		expect(get(opened.viewer.el.state.tour)).toBe(video)
		// A video tour carries no steps, so reopening must not cancel it
		opened.image().state.marker.set(fixture.mid('m1'))
		await settle(2)
		expect(get(opened.viewer.el.state.tour)).toBe(video)
		opened.viewer.destroy()
	})

	it('starts a video tour and clears the marker when the tour ends', async () => {
		const video = videoTour({ id: 'vt-clear' })
		const opened = await openMarkers(markerBundle({ markers: [marker('m1', { popupType: 'none', videoTour: video })] }))

		await opened.openMarker('m1')
		expect(get(opened.viewer.el.state.tour)).toBe(video)

		opened.viewer.el.state.tour.set(undefined)
		await waitFor(() => opened.image().state.$marker === undefined, 6000, 'the marker cleared with the tour')
		opened.viewer.destroy()
	})
})

describe('marker content routing', () => {
	it('sets the popover state for a popover marker', async () => {
		const fixture = markerBundle({ markers: [marker('m1', { popupType: 'popover' })] })
		const opened = await openMarkers(fixture)

		await opened.openMarker('m1')
		await waitFor(() => get(opened.viewer.el.state.popover)?.marker?.id === fixture.mid('m1'), 6000, 'the popover')

		expect(get(opened.viewer.el.state.popover)?.image).toBe(opened.image())
		expect(get(opened.viewer.el.state.popup)).toBeUndefined()
		opened.viewer.destroy()
	})

	it('opens nothing for a marker with popupType none', async () => {
		const opened = await openMarkers(markerBundle({ markers: [marker('m1', { popupType: 'none' })] }))

		await opened.openMarker('m1')
		await settle(3)

		expect(get(opened.viewer.el.state.popup)).toBeUndefined()
		expect(get(opened.viewer.el.state.popover)).toBeUndefined()
		expect(get(opened.viewer.el.state.tour)).toBeUndefined()
		opened.viewer.destroy()
	})

	it('shows the popup for a content marker', async () => {
		const fixture = markerBundle()
		const opened = await openMarkers(fixture)

		await opened.openMarker('m1')
		await waitForPopup(opened.viewer.el)
		expect(get(opened.viewer.el.state.popup)?.id).toBe(fixture.mid('m1'))
		opened.viewer.destroy()
	})
})

describe('always-open markers', () => {
	it('does not close when the marker state is cleared', async () => {
		const opened = await openMarkers(markerBundle({ markers: [marker('m1', { data: { alwaysOpen: true } })] }))
		let closed = 0
		opened.viewer.el.addEventListener('marker-closed', () => closed++)

		await opened.openMarker('m1')
		await waitForPopup(opened.viewer.el)
		opened.image().state.marker.set(undefined)
		await settle(3)

		expect(opened.markerEl('m1')?.classList.contains('opened')).toBe(true)
		expect(closed).toBe(0)
		opened.viewer.destroy()
	})
})

describe('marker links to another image', () => {
	it('opens the linked image', async () => {
		const target = markerBundle({ markers: [marker('t1')] })
		const main = markerBundle({
			markers: [marker('m1', { data: { micrioLink: { id: target.id } } })],
		})
		mockJson(/bundle\.json/, { images: [target.bundle] })

		const opened = await openMarkers(main)
		await opened.openMarker('m1')
		await waitFor(() => opened.viewer.el.$current?.id === target.id, 8000, 'the linked image')
		opened.viewer.destroy()
	})
})

describe('marker focus', () => {
	it('flies to an off-screen marker on focus and cancels on blur', async () => {
		// A marker outside the image: its screen position is past the element
		const opened = await openMarkers(markerBundle({ markers: [marker('m1', { x: 2, y: 0.5 })] }))
		const spy = vi.spyOn(opened.image().camera, 'flyToCoo').mockImplementation(() => Promise.resolve())
		vi.useFakeTimers()

		const btn = opened.button('m1')
		btn?.focus()
		vi.advanceTimersByTime(200)
		expect(spy).toHaveBeenCalledTimes(1)

		// Blur cancels the pending flight
		btn?.blur()
		spy.mockClear()
		btn?.focus()
		btn?.blur()
		vi.advanceTimersByTime(200)
		expect(spy).not.toHaveBeenCalled()

		spy.mockRestore()
		opened.viewer.destroy()
	})
})
