import { describe, expect, it } from 'vitest'
import { get } from '$core/store'
import { markerTour, tourBundle } from '../../fixtures/tours'
import { mountTour, settle } from '../../helpers/tour'
import { waitFor } from '../../helpers/viewer'

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

/**
 * `_markers.tourControlsInPopup` moves the tour's aside out of `<micrio-tour>`
 * and into the marker popup, so the prev/next buttons sit next to the step's
 * content. The element that is empty in that mode is the tour element itself —
 * the controls live in the popup.
 */
describe('marker tour controls in the popup', () => {
	it('renders the step controls inside the popup when the setting is on', async () => {
		const tour = markerTour({ steps: ['m1', 'm2'] })
		const bundle = tourBundle({ markerTours: [tour], settings: { _markers: { tourControlsInPopup: true } } })
		const viewer = await mountTour(bundle)
		viewer.el.state.tour.set(tour)
		await waitFor(
			() => viewer.el.querySelector('micrio-marker-popup aside.marker-tour') !== null,
			4000,
			'popup tour controls',
		)

		const popupAside = viewer.el.querySelector('micrio-marker-popup aside.marker-tour')
		expect(popupAside).not.toBeNull()
		expect(popupAside?.querySelectorAll('micrio-button').length).toBeGreaterThanOrEqual(3)
		expect(button(popupAside, 'micrio-button.prev button')).not.toBeNull()
		expect(button(popupAside, 'micrio-button.next button')).not.toBeNull()
		// The popup mode puts the close button first, before the step buttons
		expect(popupAside?.firstElementChild?.classList.contains('close')).toBe(true)
		// and the tour element itself keeps no controls
		expect(tourEl(viewer)?.querySelector('aside.marker-tour')).toBeNull()
		viewer.destroy()
	})

	it('does not leave a stale aside behind when the tour moves to another step', async () => {
		const tour = markerTour({ steps: ['m1', 'm2'] })
		const bundle = tourBundle({ markerTours: [tour], settings: { _markers: { tourControlsInPopup: true } } })
		const viewer = await mountTour(bundle)
		viewer.el.state.tour.set(tour)
		await waitFor(() => viewer.el.querySelector('micrio-marker-popup aside.marker-tour') !== null, 4000, 'tour aside')

		tour.next?.()
		await waitFor(() => viewer.el.$current?.state.$marker?.id === 'm2', 4000, 'step 2 marker')
		const asides = viewer.el.querySelectorAll('micrio-marker-popup aside.marker-tour')
		expect(asides).toHaveLength(1)
		expect(asides[0]?.querySelector('span')?.textContent).toBe('2/2')
		viewer.destroy()
	})

	it('keeps the controls inside the tour element without the setting', async () => {
		const tour = markerTour({ steps: ['m1', 'm2'] })
		const viewer = await mountTour(tourBundle({ markerTours: [tour] }))
		viewer.el.state.tour.set(tour)
		await settle(3)

		expect(tourEl(viewer)?.querySelector('aside.marker-tour')).not.toBeNull()
		expect(viewer.el.querySelector('micrio-marker-popup aside.marker-tour')).toBeNull()
		viewer.destroy()
	})

	/**
	 * The setting is read from the tour state, but the popup can already be open
	 * when a tour starts on the marker it shows — that popup is not recreated, so
	 * nothing would re-render it into the controls layout unless it watches the
	 * tour state itself.
	 */
	it('moves the controls in when a tour starts on the marker whose popup is open', async () => {
		const tour = markerTour({ steps: ['m3', 'm1'] })
		const bundle = tourBundle({ markerTours: [tour], settings: { _markers: { tourControlsInPopup: true } } })
		const viewer = await mountTour(bundle)

		viewer.el.$current?.state.marker.set('m3')
		await waitFor(() => viewer.el.$current?.state.$marker?.id === 'm3', 4000, 'popup marker')
		await waitFor(() => viewer.el.querySelector('micrio-marker-popup') !== null, 4000, 'marker popup')
		expect(viewer.el.querySelector('micrio-marker-popup aside.marker-tour')).toBeNull()

		viewer.el.state.tour.set(tour)
		await waitFor(
			() => viewer.el.querySelector('micrio-marker-popup aside.marker-tour') !== null,
			4000,
			'popup tour controls',
		)
		expect(viewer.el.querySelectorAll('micrio-marker-popup aside.marker-tour')).toHaveLength(1)
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
