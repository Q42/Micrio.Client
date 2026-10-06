import { describe, expect, it } from 'vitest'
import { get } from '$core/store'
import type { Models } from '$types/models'
import { crossImageMarkerTour, markerTour, serialStoryBundle, tourBundle, tourSeriesBundle } from '../../fixtures/tours'
import { mountTour, settle } from '../../helpers/tour'
import { mockFetch } from '../../helpers/network'
import { mountViewer, waitFor } from '../../helpers/viewer'

/** A serial tour with step markers that carry video tours, as published tours have. */
const serialTour = (opts: Parameters<typeof markerTour>[0] = {}) =>
	markerTour({ steps: ['m1', 'm2'], isSerialTour: true, ...opts })

/**
 * The layout picks `<micrio-serial-tour>` for a serial tour and `<micrio-tour>` otherwise.
 */
async function startSerial(tour: Models.ImageData.MarkerTour) {
	const viewer = await mountTour(tourBundle({ markerTours: [tour], markersWithVideo: tour.steps }))
	viewer.el.state.tour.set(tour)
	await waitFor(() => viewer.el.querySelector('micrio-serial-tour') !== null, 4000, 'serial tour element')
	await settle(4)
	return viewer
}

/**
 * Mounts a story-shaped serial tour through `bundle.json`, the path the client takes
 * in production. It matters here: the serial element resolves every step's marker
 * through `DataLoader._getStepMarker`, which only sees the bundle cache the fetch fills.
 */
async function startStorySerial(opts: { steps?: number; printChapters?: boolean } = {}) {
	const { images, ids, serialTour: buildTour } = serialStoryBundle(`ser${String(++serialIds)}`, opts)
	mockFetch([{ match: /bundle\.json/, json: { images } }])
	const viewer = mountViewer()
	await viewer.open(ids[0])
	await waitFor(() => viewer.el.$current?.id === ids[0], 4000, 'first story image')

	const tour = buildTour()
	viewer.el.state.tour.set(tour)
	await waitFor(() => viewer.el.querySelector('micrio-serial-tour') !== null, 4000, 'serial tour element')
	await settle(4)
	return { viewer, tour, ids }
}

/** Unique per call: `DataLoader` caches bundles by id for the whole file. */
let serialIds = 0

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

describe('serial tour controls', () => {
	it('renders a media element and one progress bar per step', async () => {
		const { viewer } = await startStorySerial({ steps: 2 })
		const serialEl = viewer.el.querySelector('micrio-serial-tour')

		await waitFor(() => serialEl?.querySelector('micrio-media') !== null, 4000, 'step media element')
		const bars = serialEl?.querySelectorAll('micrio-media-controls [data-part="bars"] > [data-part="bar"]')
		expect(bars).toHaveLength(2)
		expect(bars?.[0]?.classList.contains('active')).toBe(true)
		expect(bars?.[1]?.classList.contains('active')).toBe(false)
		expect(bars?.[0]?.getAttribute('title')).toBe('Chapter 1')
		viewer.destroy()
	})

	it('moves the active bar to the step the tour advances to', async () => {
		const { viewer, tour, ids } = await startStorySerial({ steps: 2 })
		const serialEl = viewer.el.querySelector('micrio-serial-tour')
		await waitFor(
			() => serialEl?.querySelectorAll('[data-part="bars"] > [data-part="bar"]').length === 2,
			4000,
			'progress bars',
		)

		tour.next?.()
		await waitFor(() => viewer.el.$current?.id === ids[1], 8000, 'second story image')
		await waitFor(
			() =>
				viewer.el.querySelector('micrio-serial-tour [data-part="bar"][data-idx="1"]')?.classList.contains('active') ===
				true,
			4000,
			'second bar active',
		)
		viewer.destroy()
	})

	it('renders the chapter list with printChapters', async () => {
		const { viewer, ids } = await startStorySerial({ steps: 2, printChapters: true })
		const serialEl = viewer.el.querySelector('micrio-serial-tour')
		await waitFor(() => serialEl?.querySelector('ol') !== null, 4000, 'chapter list')

		const buttons = serialEl?.querySelectorAll('ol li button')
		expect(buttons).toHaveLength(2)
		expect(buttons?.[0]?.textContent).toBe('Chapter 1')
		expect(serialEl?.querySelector('ol li')?.classList.contains('active')).toBe(true)

		// The chapter buttons jump between steps
		const second = buttons?.[1]
		if (second instanceof HTMLButtonElement) {
			second.click()
		}
		await waitFor(() => viewer.el.$current?.id === ids[1], 8000, 'chapter jump')
		await waitFor(
			() => serialEl?.querySelectorAll('ol li')[1]?.classList.contains('active') === true,
			4000,
			'second chapter active',
		)
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
