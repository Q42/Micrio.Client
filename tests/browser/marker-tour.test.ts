import { describe, expect, it } from 'vitest'
import { get } from '../../src/core/store'
import { markerTour, tourBundle } from '../fixtures/tours'
import { mountTour, settle } from '../helpers/tour'
import { waitFor } from '../helpers/viewer'

/** The `<micrio-tour>` UI is created by the layout once the tour store is set. */
const tourEl = (viewer: Awaited<ReturnType<typeof mountTour>>) => viewer.el.querySelector('micrio-tour')

/** The real `<button>` a `<micrio-button>` renders, typed so `disabled` is readable. */
const button = (root: Element | null | undefined, selector: string): HTMLButtonElement | null =>
	root?.querySelector<HTMLButtonElement>(selector) ?? null

describe('marker tour UI', () => {
	it('renders the step controls once the tour starts', async () => {
		const tour = markerTour({ steps: ['m1', 'm2', 'm3'] })
		const viewer = await mountTour(tourBundle({ markerTours: [tour] }))
		viewer.el.state.tour.set(tour)
		await settle()

		const el = tourEl(viewer)
		expect(el).not.toBeNull()
		const aside = el?.querySelector('aside.marker-tour')
		expect(aside).not.toBeNull()
		expect(aside?.querySelectorAll('micrio-button').length).toBeGreaterThanOrEqual(3)
		viewer.destroy()
	})

	it('shows the 1-based step counter and disables the ends', async () => {
		const tour = markerTour({ steps: ['m1', 'm2', 'm3'] })
		const viewer = await mountTour(tourBundle({ markerTours: [tour] }))
		viewer.el.state.tour.set(tour)
		await settle()

		const aside = tourEl(viewer)?.querySelector('aside.marker-tour')
		expect(aside?.querySelector('span')?.textContent).toBe('1/3')

		const prev = button(aside, 'micrio-button.prev button')
		const next = button(aside, 'micrio-button.next button')
		expect(prev?.disabled).toBe(true)
		expect(next?.disabled).toBe(false)
		viewer.destroy()
	})

	it('advances and rewinds through the steps', async () => {
		const tour = markerTour({ steps: ['m1', 'm2', 'm3'] })
		const viewer = await mountTour(tourBundle({ markerTours: [tour] }))
		viewer.el.state.tour.set(tour)
		await settle()

		const counter = () => tourEl(viewer)?.querySelector('aside.marker-tour span')?.textContent
		const click = async (selector: string) => {
			button(tourEl(viewer), selector)?.click()
			await settle(3)
		}

		await click('micrio-button.next button')
		expect(counter()).toBe('2/3')
		expect(tour.currentStep).toBe(1)
		// The step's marker is the active one
		await waitFor(() => viewer.el.$current?.state.$marker?.id === 'm2', 4000, 'step 2 marker')

		await click('micrio-button.prev button')
		expect(counter()).toBe('1/3')
		expect(tour.currentStep).toBe(0)
		await waitFor(() => viewer.el.$current?.state.$marker?.id === 'm1', 4000, 'step 1 marker')
		viewer.destroy()
	})

	it('does not advance past the last step', async () => {
		const tour = markerTour({ steps: ['m1', 'm2'] })
		const viewer = await mountTour(tourBundle({ markerTours: [tour] }))
		viewer.el.state.tour.set(tour)
		await settle()

		tour.next?.()
		await settle(3)
		expect(tour.currentStep).toBe(1)
		const next = button(tourEl(viewer), 'micrio-button.next button')
		expect(next?.disabled).toBe(true)

		tour.next?.()
		await settle(2)
		expect(tour.currentStep).toBe(1)
		viewer.destroy()
	})

	it('does not rewind before the first step', async () => {
		const tour = markerTour({ steps: ['m1', 'm2'] })
		const viewer = await mountTour(tourBundle({ markerTours: [tour] }))
		viewer.el.state.tour.set(tour)
		await settle()

		tour.prev?.()
		await settle(2)
		expect(tour.currentStep).toBe(0)
		viewer.destroy()
	})

	it('honours initialStep when the tour starts', async () => {
		const tour = markerTour({ steps: ['m1', 'm2', 'm3'], initialStep: 2 })
		const viewer = await mountTour(tourBundle({ markerTours: [tour] }))
		viewer.el.state.tour.set(tour)
		await settle()

		expect(tour.currentStep).toBe(2)
		expect(tourEl(viewer)?.querySelector('aside.marker-tour span')?.textContent).toBe('3/3')
		viewer.destroy()
	})
})

describe('marker tour navigation from the markers', () => {
	it('follows a marker that belongs to the tour', async () => {
		const tour = markerTour({ steps: ['m1', 'm2', 'm3'] })
		const viewer = await mountTour(tourBundle({ markerTours: [tour] }))
		viewer.el.state.tour.set(tour)
		await settle()

		// Opening the third step's marker from outside the UI must move the tour to it
		viewer.el.$current?.state.marker.set('m3')
		await waitFor(() => tour.currentStep === 2, 4000, 'tour follows the marker')
		expect(tourEl(viewer)?.querySelector('aside.marker-tour span')?.textContent).toBe('3/3')
		viewer.destroy()
	})
})

describe('marker tour closing', () => {
	it('stops the tour and clears the active step marker', async () => {
		const tour = markerTour({ steps: ['m1', 'm2'] })
		const viewer = await mountTour(tourBundle({ markerTours: [tour] }))
		viewer.el.state.tour.set(tour)
		await settle(3)
		await waitFor(() => viewer.el.$current?.state.$marker?.id === 'm1', 4000, 'step 1 marker')

		button(tourEl(viewer), 'micrio-button.close button')?.click()
		await settle(3)

		expect(get(viewer.el.state.tour)).toBeUndefined()
		await waitFor(() => viewer.el.$current?.state.$marker === undefined, 4000, 'marker cleared')
		viewer.destroy()
	})

	it('omits the close button for a tour that cannot be closed', async () => {
		const tour = markerTour({ steps: ['m1', 'm2'], cannotClose: true })
		const viewer = await mountTour(tourBundle({ markerTours: [tour] }))
		viewer.el.state.tour.set(tour)
		await settle()

		const aside = tourEl(viewer)?.querySelector('aside.marker-tour')
		expect(aside?.querySelector('micrio-button.close')).toBeNull()
		viewer.destroy()
	})
})
