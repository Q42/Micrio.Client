import { afterEach, describe, expect, it } from 'vitest'
import type { Models } from '$types/models'
import { get } from '$core/store'
import { restoreArchiveXhr } from '../../fixtures/grid'
import { marker } from '../../fixtures/bundles'
import { markerTour } from '../../fixtures/tours'
import { destroyOmni, openOmni, waitForOmniMarkers } from '../../fixtures/omni'
import { waitFor } from '../../helpers/viewer'
import { settle } from '../../helpers/tour'

/**
 * Markers on an omni object: the frame a marker's `rotation`/`backside` targets,
 * the `visibleArc` that hides it behind the object, marker content, and a marker
 * tour whose steps turn the object.
 */

afterEach(() => {
	destroyOmni()
	restoreArchiveXhr()
})

/** 36 frames, so one frame is 10 degrees. */
const FRAMES = 36
const DEG = (Math.PI * 2) / FRAMES

/** A marker that turns to a frame when opened, with its own view. */
const omniMarker = (id: string, frame: number, extra: Partial<Models.ImageData.Marker> = {}) =>
	marker(id, {
		x: 0.5,
		y: 0.5,
		rotation: frame * DEG,
		view: [0.25, 0.25, 0.5, 0.5],
		popupType: 'popup',
		i18n: { en: { title: `Marker ${id}`, body: `<p>${id}</p>` } },
		...extra,
	})

/** Re-runs the marker positioning, which only recomputes on a `state.view` change. */
async function refreshMarkers(image: { state: { view: { set: (v: number[]) => void } } }): Promise<void> {
	image.state.view.set([0, 0, 1, 1])
	await settle(1)
}

describe('omni — marker rotation', () => {
	it('turns to the frame a marker rotation points at', async () => {
		const omni = await openOmni({ frames: FRAMES, markers: [omniMarker('om1', 1)] })
		const markers = await waitForOmniMarkers(omni.viewer.el)
		expect(markers).toHaveLength(1)
		expect(markers[0]?.dataset.markerId).toBe('om1')

		// Clicking the marker button opens it through the image state
		markers[0]?.querySelector('button')?.click()
		await waitFor(() => get(omni.image.state.marker) !== undefined, 4000, 'the marker open')
		await waitFor(() => omni.image.canvas?._activeImageIdx === 1, 8000, 'the omni frame')
		expect(omni.omni.currentIndex).toBe(1)
	})

	it('adds half a turn for a backside marker', async () => {
		const omni = await openOmni({ frames: FRAMES, markers: [omniMarker('back', 0, { backside: true })] })
		await waitForOmniMarkers(omni.viewer.el)

		omni.image.state.marker.set('back')
		// 0 + PI is frame 18 of 36; the omni animation takes the shortest way round
		await waitFor(() => omni.image.canvas?._activeImageIdx === 18, 10_000, 'the backside frame')
		expect(omni.omni.currentIndex).toBe(18)
	})
})

describe('omni — visibleArc', () => {
	it('hides a marker while the object has turned away from its arc', async () => {
		// The arc [90deg, 180deg] is frames [9, 18]; a delta outside it is `behind`
		const omni = await openOmni({
			frames: FRAMES,
			markers: [omniMarker('arc', 0, { visibleArc: [Math.PI / 2, Math.PI] })],
		})
		const [el] = await waitForOmniMarkers(omni.viewer.el)
		if (!el) {
			throw new Error('no marker')
		}

		// At frame 0 the delta is 0, outside the arc
		await refreshMarkers(omni.image)
		expect(el.classList.contains('behind')).toBe(true)

		// At frame 12 the delta is inside the arc
		omni.omni.goto(12)
		await refreshMarkers(omni.image)
		expect(el.classList.contains('behind')).toBe(false)
	})
})

describe('omni — marker content', () => {
	it('opens a popup marker through the image state', async () => {
		const omni = await openOmni({ frames: FRAMES, markers: [omniMarker('pop', 0, { view: undefined })] })
		await waitForOmniMarkers(omni.viewer.el)

		omni.image.state.marker.set('pop')
		// Without a view the content opens without a camera animation
		await waitFor(() => get(omni.viewer.el.state.popup)?.id === 'pop', 4000, 'the popup')
		expect(omni.viewer.el.state.$marker?.id).toBe('pop')
	})

	it('opens a popover marker with its image', async () => {
		const omni = await openOmni({
			frames: FRAMES,
			markers: [omniMarker('over', 0, { popupType: 'popover', view: undefined })],
		})
		await waitForOmniMarkers(omni.viewer.el)

		omni.image.state.marker.set('over')
		await waitFor(() => get(omni.viewer.el.state.popover)?.marker?.id === 'over', 4000, 'the popover')
		expect(get(omni.viewer.el.state.popover)?.image).toBe(omni.image)
	})
})

describe('omni — marker tour', () => {
	it('turns the object to each step marker frame', async () => {
		const omni = await openOmni({ frames: FRAMES, markers: [omniMarker('om1', 1), omniMarker('om2', 5)] })
		await waitForOmniMarkers(omni.viewer.el)

		// The steps live on the omni image itself, so `micrio-tour` does not switch images
		const tour = markerTour({
			id: 'mt-omni',
			steps: ['om1', 'om2'],
			duration: 6,
			stepInfo: [
				{ markerId: 'om1', micrioId: omni.fixture.id, duration: 3 },
				{ markerId: 'om2', micrioId: omni.fixture.id, duration: 3 },
			],
		})
		omni.viewer.el.state.tour.set(tour)
		await waitFor(() => omni.viewer.el.querySelector('micrio-tour') !== null, 4000, 'the tour UI')
		// The tour opens its first step, which turns the object to that marker
		await waitFor(() => omni.image.canvas?._activeImageIdx === 1, 8000, 'step 1 frame')
		expect(tour.currentStep).toBe(0)

		omni.viewer.el.querySelector<HTMLButtonElement>('micrio-tour micrio-button.next button')?.click()
		await waitFor(() => tour.currentStep === 1, 4000, 'step 2')
		await waitFor(() => omni.image.canvas?._activeImageIdx === 5, 8000, 'step 2 frame')
	})
})
