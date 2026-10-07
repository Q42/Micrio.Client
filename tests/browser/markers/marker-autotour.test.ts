import { describe, expect, it } from 'vitest'
import type { Models } from '$types/models'
import { get } from '$core/store'
import { marker } from '../../fixtures/bundles'
import { markerBundle, openMarkers, type MarkerFixture } from '../../fixtures/markers'
import { markerTour } from '../../fixtures/tours'
import { mockJson } from '../../helpers/network'
import { settle } from '../../helpers/tour'
import { waitFor } from '../../helpers/viewer'

/**
 * `_markers.autoStartTour`: opening a marker that is a step in a marker tour starts that
 * tour, at the marker's own step — or, with `autoStartTourAtBeginning`, from step 0 even
 * when that step lives on another image.
 *
 * The tour is discovered on the opened canvas, on `micrio.bundleTours` (only filled when
 * the image was opened *by id* through a served `bundle.json`) or on a gallery image.
 */

/** A tour over the fixture's own markers, with a per-test id. */
const tourOver = (fixture: MarkerFixture, id: string, steps: string[]): Models.ImageData.MarkerTour => ({
	id,
	steps: steps.map((s) => fixture.mid(s)),
	duration: 6,
	i18n: { en: { title: `Tour ${id}` } },
	stepInfo: steps.map((s) => ({ markerId: fixture.mid(s), micrioId: fixture.id, duration: 3 })),
})

/** The image data's marker with a short id, for reading and mutating it. */
const markerOf = (fixture: MarkerFixture, markers: Models.ImageData.Marker[] | undefined, short: string) =>
	markers?.find((m) => m.id === fixture.mid(short))

describe('marker tour auto-start', () => {
	it('starts the tour at the opened marker’s own step', async () => {
		const fixture = markerBundle({
			markerTours: [markerTour({ id: 'mt-auto', steps: ['m1', 'm2'] })],
			settings: { _markers: { autoStartTour: true } },
		})
		const opened = await openMarkers(fixture)
		await opened.openMarker('m2')
		await settle(2)

		const tour = fixture.markerTours[0]
		expect(get(opened.viewer.el.state.tour)).toBe(tour)
		expect(tour?.initialStep).toBe(1)
		expect(tour?.currentStep).toBe(1)
		opened.viewer.destroy()
	})

	it('starts at the beginning when the marker is the first step', async () => {
		const fixture = markerBundle({
			markerTours: [markerTour({ id: 'mt-first', steps: ['m1', 'm2'] })],
			settings: { _markers: { autoStartTour: true } },
		})
		const opened = await openMarkers(fixture)
		await opened.openMarker('m1')
		await settle(2)

		expect(fixture.markerTours[0]?.currentStep).toBe(0)
		opened.viewer.destroy()
	})

	it('restarts at step 0 and hands the marker over to the tour', async () => {
		const fixture = markerBundle({
			markerTours: [markerTour({ id: 'mt-begin', steps: ['m1', 'm2'] })],
			settings: { _markers: { autoStartTour: true, autoStartTourAtBeginning: true } },
		})
		const opened = await openMarkers(fixture)

		// Opening the second step clears the marker instead of opening it
		opened.image().state.marker.set(fixture.mid('m2'))
		await waitFor(() => get(opened.viewer.el.state.tour) === fixture.markerTours[0], 6000, 'the tour started')

		expect(fixture.markerTours[0]?.currentStep).toBe(0)
		await waitFor(() => opened.image().state.$marker?.id === fixture.mid('m1'), 6000, 'the first step marker')
		opened.viewer.destroy()
	})

	it('suppresses the marker grid action until the tour has taken over', async () => {
		const fixture = markerBundle({
			markers: [marker('m1'), marker('m2', { data: { _meta: { gridAction: 'focus|target' } } })],
			markerTours: [markerTour({ id: 'mt-grid', steps: ['m1', 'm2'] })],
			settings: { _markers: { autoStartTour: true, autoStartTourAtBeginning: true } },
		})
		const opened = await openMarkers(fixture)
		const m2 = markerOf(fixture, opened.image().$data?.markers, 'm2')

		opened.image().state.marker.set(fixture.mid('m2'))
		// The suppression is part of the synchronous activation
		expect(m2?.data?._meta?.gridAction).toBeUndefined()

		await waitFor(() => m2?.data?._meta?.gridAction === 'focus|target', 3000, 'the grid action restored')
		opened.viewer.destroy()
	})

	it('starts nothing when the marker belongs to no tour', async () => {
		const fixture = markerBundle({ settings: { _markers: { autoStartTour: true } } })
		const opened = await openMarkers(fixture)
		await opened.openMarker('m1')
		await settle(3)

		expect(get(opened.viewer.el.state.tour)).toBeUndefined()
		opened.viewer.destroy()
	})

	it('does not replace a tour that is already running', async () => {
		const fixture = markerBundle({
			markers: [marker('m1')],
			markerTours: [markerTour({ id: 'mt-first', steps: ['m1'] }), markerTour({ id: 'mt-second', steps: ['m1'] })],
			settings: { _markers: { autoStartTour: true } },
		})
		const opened = await openMarkers(fixture)
		const second = fixture.markerTours[1]
		if (!second) {
			throw new Error('no second tour')
		}
		opened.viewer.el.state.tour.set(second)
		await settle(2)

		await opened.openMarker('m1')
		await settle(2)
		expect(get(opened.viewer.el.state.tour)).toBe(second)
		opened.viewer.destroy()
	})
})

describe('marker tour auto-start from another image', () => {
	it('finds the tour in the bundle-level tours of an id-opened image', async () => {
		const fixture = markerBundle({ settings: { _markers: { autoStartTour: true } } })
		const tour = tourOver(fixture, 'mt-bundle', ['m1', 'm2'])
		mockJson(/bundle\.json/, { images: [fixture.bundle], tours: [tour] })

		const opened = await openMarkers(fixture, { byId: true })
		await opened.openMarker('m2')
		await waitFor(() => get(opened.viewer.el.state.tour)?.id === 'mt-bundle', 6000, 'the bundle tour')
		expect(opened.image().state.$marker?.id).toBe(fixture.mid('m2'))
		opened.viewer.destroy()
	})

	it('opens the first step’s image when it lives elsewhere', async () => {
		const first = markerBundle({ markers: [marker('b1')] })
		const main = markerBundle({
			markers: [marker('m1'), marker('m2')],
			settings: { _markers: { autoStartTour: true, autoStartTourAtBeginning: true } },
		})
		const tour: Models.ImageData.MarkerTour = {
			id: 'mt-cross',
			duration: 6,
			i18n: { en: { title: 'Cross image' } },
			steps: [first.mid('b1'), main.mid('m2')],
			stepInfo: [
				{ markerId: first.mid('b1'), micrioId: first.id, duration: 3 },
				{ markerId: main.mid('m2'), micrioId: main.id, duration: 3 },
			],
		}
		main.bundle.data = { ...main.bundle.data, markerTours: [tour] }
		mockJson(/bundle\.json/, { images: [main.bundle, first.bundle] })

		const opened = await openMarkers(main, { byId: true })
		opened.image().state.marker.set(main.mid('m2'))
		await waitFor(() => opened.viewer.el.$current?.id === first.id, 8000, 'the first step image')
		expect(get(opened.viewer.el.state.tour)?.id).toBe('mt-cross')
		opened.viewer.destroy()
	})
})
