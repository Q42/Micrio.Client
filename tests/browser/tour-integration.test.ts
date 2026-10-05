import { describe, expect, it } from 'vitest'
import { get } from '../../src/core/store'
import { markerTour, tourBundle, videoTour } from '../fixtures/tours'
import { mountTour, settle, startTour } from '../helpers/tour'
import { waitFor } from '../helpers/viewer'

/**
 * The full tour path: the toolbar offers tours, choosing one sets the tour store,
 * the layout mounts the matching UI element, and `settings.start` can autostart a
 * tour. These are the seams where the individual suites stop and the client has to
 * wire everything together.
 */
const menuButton = (viewer: Awaited<ReturnType<typeof mountTour>>, title: string) =>
	viewer.el.querySelector<HTMLButtonElement>(`micrio-menu[data-title="${title}"] button`)

describe('tour integration', () => {
	it('mounts the tour UI for a tour set through the store', async () => {
		const tour = markerTour({ steps: ['m1', 'm2'] })
		const viewer = await mountTour(tourBundle({ markerTours: [tour] }))

		expect(viewer.el.querySelector('micrio-tour')).toBeNull()
		await startTour(viewer, tour)
		expect(viewer.el.querySelector('micrio-tour')).not.toBeNull()

		viewer.el.state.tour.set(undefined)
		await settle(3)
		expect(viewer.el.querySelector('micrio-tour')).toBeNull()
		viewer.destroy()
	})

	it('mounts a media element for a video tour', async () => {
		const tour = videoTour({ id: 'vt-int', duration: 6 })
		const viewer = await mountTour(tourBundle({ tours: [tour] }))
		await startTour(viewer, tour)

		expect(viewer.el.querySelector('micrio-tour')).not.toBeNull()
		await waitFor(() => viewer.el.querySelector('micrio-media') !== null, 4000, 'media element')
		expect(tour.instance).toBeDefined()
		viewer.destroy()
	})
})

describe('tour toolbar entries', () => {
	it('lists marker tours and video tours as separate menus', async () => {
		const viewer = await mountTour(
			tourBundle({
				markerTours: [markerTour({ id: 'mt1' })],
				tours: [videoTour({ id: 'vt1' })],
			}),
		)
		await settle(6)
		expect(viewer.el.querySelector('micrio-menu[data-title="marker tours"]')).not.toBeNull()
		expect(viewer.el.querySelector('micrio-menu[data-title="video tours"]')).not.toBeNull()
		viewer.destroy()
	})

	it('starts a marker tour from its menu entry', async () => {
		const tour = markerTour({ id: 'mt1', steps: ['m1', 'm2'] })
		const viewer = await mountTour(tourBundle({ markerTours: [tour] }))
		await settle(6)

		menuButton(viewer, 'marker tour')?.click()
		await waitFor(() => get(viewer.el.state.tour) !== undefined, 4000, 'tour started')
		expect(get(viewer.el.state.tour)).toBe(tour)
		expect(tour.initialStep).toBe(0)
		viewer.destroy()
	})

	it('starts a video tour from its menu entry', async () => {
		const tour = videoTour({ id: 'vt1', duration: 6 })
		const viewer = await mountTour(tourBundle({ tours: [tour] }))
		await settle(6)

		menuButton(viewer, 'video tour')?.click()
		await waitFor(() => get(viewer.el.state.tour) !== undefined, 4000, 'tour started')
		expect(get(viewer.el.state.tour)).toBe(tour)
		viewer.destroy()
	})

	it('hides the toolbar while a tour is running', async () => {
		const tour = markerTour({ steps: ['m1', 'm2'] })
		const viewer = await mountTour(tourBundle({ markerTours: [tour] }))
		await settle(6)
		expect(viewer.el.querySelector('micrio-toolbar menu')).not.toBeNull()

		await startTour(viewer, tour)
		// The toolbar stays mounted but renders nothing while a tour, marker or
		// popover is active
		await waitFor(
			() => viewer.el.querySelector('micrio-toolbar')?.querySelector('menu') === null,
			4000,
			'toolbar emptied',
		)
		viewer.destroy()
	})

	it('uses the generic label when only one tour type exists', async () => {
		const onlyMarker = await mountTour(tourBundle({ markerTours: [markerTour({ id: 'mt1' })] }))
		await settle(6)
		const markerTitles = [...onlyMarker.el.querySelectorAll('micrio-menu')].map((m) => (m as HTMLElement).dataset.title)
		// Only marker tours: the parent falls back to the generic "Tours" label
		expect(markerTitles).toContain('tours')
		expect(markerTitles).not.toContain('marker tours')
		expect(markerTitles).not.toContain('video tours')
		onlyMarker.destroy()

		const both = await mountTour(
			tourBundle({ markerTours: [markerTour({ id: 'mt1' })], tours: [videoTour({ id: 'vt1' })] }),
		)
		await settle(6)
		const bothTitles = [...both.el.querySelectorAll('micrio-menu')].map((m) => (m as HTMLElement).dataset.title)
		expect(bothTitles).toContain('marker tours')
		expect(bothTitles).toContain('video tours')
		both.destroy()
	})
})

describe('tour autostart', () => {
	it('starts a marker tour from settings.start', async () => {
		const tour = markerTour({ id: 'mt1', steps: ['m1', 'm2'] })
		const viewer = await mountTour(
			tourBundle({ markerTours: [tour], settings: { start: { type: 'markerTour', id: 'mt1' } } }),
		)
		await waitFor(() => get(viewer.el.state.tour) !== undefined, 4000, 'autostarted tour')
		expect(get(viewer.el.state.tour)).toBe(tour)
		viewer.destroy()
	})

	it('starts a video tour from settings.start', async () => {
		const tour = videoTour({ id: 'vt1', duration: 6 })
		const viewer = await mountTour(tourBundle({ tours: [tour], settings: { start: { type: 'tour', id: 'vt1' } } }))
		await waitFor(() => get(viewer.el.state.tour) !== undefined, 4000, 'autostarted video tour')
		expect(get(viewer.el.state.tour)).toBe(tour)
		viewer.destroy()
	})

	it('ignores an unknown tour id', async () => {
		const viewer = await mountTour(
			tourBundle({ tours: [videoTour({ id: 'vt1' })], settings: { start: { type: 'tour', id: 'nope' } } }),
		)
		await settle(8)
		expect(get(viewer.el.state.tour)).toBeUndefined()
		viewer.destroy()
	})

	it('does not autostart while a tour is already running', async () => {
		const running = markerTour({ id: 'running', steps: ['m1', 'm2'] })
		const viewer = await mountTour(
			tourBundle({ markerTours: [running], settings: { start: { type: 'markerTour', id: 'running' } } }),
		)
		await settle(2)
		// Claim the tour store before the deferred autostart runs
		viewer.el.state.tour.set(running)
		await settle(8)
		expect(get(viewer.el.state.tour)).toBe(running)
		viewer.destroy()
	})
})
