import { describe, expect, it } from 'vitest'
import { get } from '../../src/core/store'
import type { Models } from '../../src/types/models'
import { crossImageMarkerTour, markerTour, tourBundle, tourSeriesBundle } from '../fixtures/tours'
import { mountTour, settle } from '../helpers/tour'
import { mockFetch } from '../helpers/network'
import { mountViewer, waitFor } from '../helpers/viewer'

/** A serial tour with step markers that carry video tours, as published tours have. */
const serialTour = (opts: Parameters<typeof markerTour>[0] = {}) =>
	markerTour({ steps: ['m1', 'm2'], isSerialTour: true, ...opts })

/**
 * The layout picks `<micrio-serial-tour>` for a serial tour and `<micrio-tour>` otherwise.
 *
 * The serial element's *own* controls (progress bars, chapters, time display) are not
 * covered yet: with a mounted tour the element currently renders no children at all,
 * which needs investigating separately — see the note in TESTING.md.
 */
async function startSerial(tour: Models.ImageData.MarkerTour) {
	const viewer = await mountTour(tourBundle({ markerTours: [tour], markersWithVideo: tour.steps }))
	viewer.el.state.tour.set(tour)
	await waitFor(() => viewer.el.querySelector('micrio-serial-tour') !== null, 4000, 'serial tour element')
	await settle(4)
	return viewer
}

describe('serial tour element', () => {
	it('is used by the layout for a serial marker tour', async () => {
		const viewer = await startSerial(serialTour())
		expect(viewer.el.querySelector('micrio-serial-tour')).not.toBeNull()
		viewer.destroy()
	})

	it('is not used for a plain marker tour', async () => {
		const tour = markerTour({ steps: ['m1', 'm2'] })
		const viewer = await mountTour(tourBundle({ markerTours: [tour] }))
		viewer.el.state.tour.set(tour)
		await settle(4)
		expect(viewer.el.querySelector('micrio-serial-tour')).toBeNull()
		expect(viewer.el.querySelector('micrio-tour')).not.toBeNull()
		viewer.destroy()
	})

	it('marks the client as having an active marker tour', async () => {
		const viewer = await startSerial(serialTour())
		expect(viewer.el.dataset.markerTourActive).toBeDefined()
		viewer.el.state.tour.set(undefined)
		await settle(3)
		expect(viewer.el.dataset.markerTourActive).toBeUndefined()
		viewer.destroy()
	})
})

describe('serial tour steps across images', () => {
	it('moves the viewer to the step image when the step lives elsewhere', async () => {
		const { images, ids } = tourSeriesBundle('serial1')
		mockFetch([{ match: /bundle\.json/, json: { images } }])
		const viewer = mountViewer()
		await viewer.open(ids[0])
		await waitFor(() => viewer.el.$current?.id === ids[0], 4000, 'first image')
		await waitFor(() => get(viewer.el._loading) === false, 4000, 'loading to finish')

		const tour = crossImageMarkerTour(ids[0], ids[1])
		tour.isSerialTour = true
		viewer.el.state.tour.set(tour)
		await waitFor(() => viewer.el.querySelector('micrio-serial-tour') !== null, 4000, 'serial element')
		await settle(4)
		expect(viewer.el.$current?.id).toBe(ids[0])

		// The second step lives on the second image: advancing switches the viewer
		tour.next?.()
		await waitFor(() => viewer.el.$current?.id === ids[1], 8000, 'second image')
		expect(viewer.el.$current?.id).toBe(ids[1])
		viewer.destroy()
	})
})

describe('serial tour state bookkeeping', () => {
	it('exposes next/prev hooks on the tour data once it is mounted', async () => {
		const tour = serialTour()
		const viewer = await startSerial(tour)
		expect(typeof tour.next).toBe('function')
		expect(typeof tour.prev).toBe('function')
		viewer.destroy()
	})

	it('stopping the tour clears the store and the active marker tour flag', async () => {
		const tour = serialTour()
		const viewer = await startSerial(tour)
		viewer.el.state.tour.set(undefined)
		await settle(4)
		expect(get(viewer.el.state.tour)).toBeUndefined()
		expect(viewer.el.dataset.markerTourActive).toBeUndefined()
		viewer.destroy()
	})
})
