import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Models } from '$types/models'
import { get } from '$core/store'
import { marker } from '../../fixtures/bundles'
import { markerBundle, openMarkers, waitForPopup, type MarkerFixture } from '../../fixtures/markers'
import { markerTour, videoTour } from '../../fixtures/tours'
import { pollUntil } from '../../helpers/async'
import { mockJson } from '../../helpers/network'
import { settle } from '../../helpers/tour'
import { waitFor, type Viewer } from '../../helpers/viewer'

/**
 * What happens when a marker is opened: the state it writes, the events it fires, the
 * camera it moves, the tour it starts or stops, and the image links it follows. All of it
 * is driven through the real element — the button click or the image state — so the
 * production resolution path is the one under test.
 */

afterEach(() => {
	vi.useRealTimers()
})

/** Whether the marker layer is hidden by a running tour. */
const layerHidden = (opened: Awaited<ReturnType<typeof openMarkers>>) => opened.layer()?.classList.contains('hidden')

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

		// The tour clears synchronously from the state notification, before the tick;
		// the tour element's own teardown then decides the marker state.
		opened.image().state.marker.set(fixture.mid('m2'))
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

	it('keeps the popup open between tour steps when the image asks for it', async () => {
		const fixture = markerBundle({
			markerTours: [markerTour({ id: 'mt-keep', steps: ['m1', 'm2'] })],
			settings: { _markers: { keepPopupsDuringTourTransitions: true } },
		})
		const tour = fixture.markerTours[0]
		if (!tour) {
			throw new Error('no tour')
		}
		const opened = await openMarkers(fixture)
		opened.viewer.el.state.tour.set(tour)
		await waitForPopup(opened.viewer.el)

		const popups: (string | undefined)[] = []
		const unsub = opened.viewer.el.state.popup.subscribe((p) => popups.push(p?.id))
		tour.next?.()
		await waitFor(() => opened.image().state.$marker?.id === fixture.mid('m2'), 6000, 'the second step')
		unsub()

		// The old step's clear must not blank the popup on the way to the new step
		expect(popups).not.toContain(undefined)
		opened.viewer.destroy()
	})

	it('clears the popup between tour steps without the setting', async () => {
		const fixture = markerBundle({ markerTours: [markerTour({ id: 'mt-clear', steps: ['m1', 'm2'] })] })
		const tour = fixture.markerTours[0]
		if (!tour) {
			throw new Error('no tour')
		}
		const opened = await openMarkers(fixture)
		opened.viewer.el.state.tour.set(tour)
		await waitForPopup(opened.viewer.el)

		const popups: (string | undefined)[] = []
		const unsub = opened.viewer.el.state.popup.subscribe((p) => popups.push(p?.id))
		tour.next?.()
		await waitFor(() => opened.image().state.$marker?.id === fixture.mid('m2'), 6000, 'the second step')
		unsub()

		expect(popups).toContain(undefined)
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

describe('marker hiding during tours', () => {
	it('hides the markers during a marker tour only when the image asks for it', async () => {
		const withSetting = markerBundle({
			markerTours: [markerTour({ steps: ['m1', 'm2'] })],
			settings: { _markers: { hideMarkersDuringTour: true } },
		})
		const opened = await openMarkers(withSetting)
		expect(layerHidden(opened)).toBe(false)

		opened.viewer.el.state.tour.set(withSetting.markerTours[0])
		// `pollUntil`, not `waitFor`: this asserts pure state (a class the image's own settings
		// decide), and a `waitFor` deadline is checked inside its `requestAnimationFrame`
		// callback. On a loaded CI runner that callback can be starved past the deadline while
		// the class has long since landed, which failed this test on `main` only in CI.
		await pollUntil(() => layerHidden(opened) === true, 4000, 'the hidden layer')
		opened.viewer.destroy()

		// A marker tour is its steps, so without the setting the markers stay
		const plain = await openMarkers(markerBundle({ markerTours: [markerTour({ steps: ['m1', 'm2'] })] }))
		plain.viewer.el.state.tour.set(plain.markerTours[0])
		await settle(3)
		expect(layerHidden(plain)).toBe(false)
		plain.viewer.destroy()
	})

	it('hides the markers during a video tour unless the tour keeps them', async () => {
		const shown = await openMarkers(markerBundle())
		shown.viewer.el.state.tour.set(videoTour({ id: 'vt-hide' }))
		await waitFor(() => layerHidden(shown) === true, 4000, 'the hidden layer')
		shown.viewer.destroy()

		const kept = await openMarkers(markerBundle())
		kept.viewer.el.state.tour.set(videoTour({ id: 'vt-keep', keepMarkers: true }))
		await settle(3)
		expect(layerHidden(kept)).toBe(false)
		kept.viewer.destroy()
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

/** The `<micrio-markers>` layer that currently holds a marker element, if one exists. */
const layerFor = (el: HTMLElement, markerId: string): Element | null =>
	[...el.querySelectorAll('micrio-markers')].find(
		(layer) => layer.querySelector(`micrio-marker[data-marker-id="${CSS.escape(markerId)}"]`) !== null,
	) ?? null

/** Opens a marker on a loaded image the way its clickable area does: through the state, by id. */
async function openMarkerOn(viewer: Viewer, imageId: string, markerId: string): Promise<void> {
	const image = viewer.el._canvases.find((c) => c.id === imageId)
	if (!image) {
		throw new Error(`image ${imageId} is not loaded`)
	}
	await waitFor(() => layerFor(viewer.el, markerId) !== null, 8000, `the layer of marker ${markerId}`)
	image.state.marker.set(markerId)
	await waitFor(() => image.state.$marker?.id === markerId, 6000, `marker ${markerId} open`)
}

/**
 * Opens a link-only marker and waits for the image it links to.
 *
 * The marker object it sets is transient — the link clears it in microtasks — so waiting for
 * the state would miss it. The layer may also not have mounted yet, in which case the id is
 * only resolved (and the link followed) when it does.
 */
async function followLink(viewer: Viewer, imageId: string, markerId: string, targetId: string): Promise<void> {
	const image = viewer.el._canvases.find((c) => c.id === imageId)
	if (!image) {
		throw new Error(`image ${imageId} is not loaded`)
	}
	image.state.marker.set(markerId)
	await waitFor(() => viewer.el.$current?.id === targetId, 8000, `the linked image ${targetId}`)
}

/** Points a fixture's marker at another image, the way the editor's marker link does. */
function linkMarker(fixture: MarkerFixture, short: string, id: string): void {
	const m = fixture.bundle.data?.markers?.find((mk) => mk.id === fixture.mid(short))
	if (!m) {
		throw new Error(`no marker ${short} in the fixture`)
	}
	m.data = { ...m.data, micrioLink: { id } }
}

/**
 * Two images whose markers link to each other, both served from one mocked `bundle.json`: the
 * main image is opened as an object, so a link back to it has to resolve its id through
 * `DataLoader` to reach the canvas that is already there.
 *
 * `popup` gives the main marker its own popup content (`marker()` defaults to
 * `popupType: 'popup'`); without it the marker is the editor's link-only `micrioLink` type.
 * Both link markers are `noMarker`, like the clickable areas that carry this data in practice.
 */
function linkedPair({
	popup = false,
	extraTargetMarkers = [],
}: {
	popup?: boolean
	extraTargetMarkers?: Models.ImageData.Marker[]
} = {}): { main: MarkerFixture; target: MarkerFixture } {
	const main = markerBundle({
		markers: [marker('m1', { noMarker: true, ...(popup ? {} : { popupType: 'micrioLink' }) })],
	})
	const target = markerBundle({
		markers: [marker('t1', { noMarker: true, popupType: 'micrioLink' }), ...extraTargetMarkers],
	})
	linkMarker(main, 'm1', target.id)
	linkMarker(target, 't1', main.id)
	mockJson(/bundle\.json/, { images: [main.bundle, target.bundle] })
	return { main, target }
}

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

	it('does not bounce between two images whose markers link to each other', async () => {
		const { main, target } = linkedPair()
		const opened = await openMarkers(main)

		const seen: (string | undefined)[] = []
		const unsub = opened.viewer.el.current.subscribe((c) => seen.push(c?.id))

		await followLink(opened.viewer, main.id, main.mid('m1'), target.id)
		await followLink(opened.viewer, target.id, target.mid('t1'), main.id)

		// The link-only marker is closed by the navigation, so showing the image again has
		// nothing left to follow the link with.
		expect(opened.image().state.$marker).toBeUndefined()
		// Let the deferred work run before asserting that no further navigation came: the wait
		// is expected to time out.
		await pollUntil(() => seen.length !== 3, 500, 'a second navigation').catch(() => {})
		unsub()
		expect(seen).toEqual([main.id, target.id, main.id])
		opened.viewer.destroy()
	})

	it('follows its link again after the original image is shown a second time', async () => {
		const { main, target } = linkedPair()
		const opened = await openMarkers(main)

		await followLink(opened.viewer, main.id, main.mid('m1'), target.id)
		await followLink(opened.viewer, target.id, target.mid('t1'), main.id)

		// Coming back leaves no marker set, so the area opens the link straight away
		await followLink(opened.viewer, main.id, main.mid('m1'), target.id)
		opened.viewer.destroy()
	})

	it('keeps a link marker’s popup in the linked image, and returns to the original when it is closed', async () => {
		const { main, target } = linkedPair({ popup: true })
		const opened = await openMarkers(main)

		await opened.openMarker('m1')
		await waitFor(() => opened.viewer.el.$current?.id === target.id, 8000, 'the linked image')
		await waitForPopup(opened.viewer.el, 8000)

		// The marker stays open, with its popup visible, in the image the link opened
		expect(opened.viewer.el.state.$marker?.id).toBe(main.mid('m1'))

		opened.viewer.el.querySelector<HTMLButtonElement>('micrio-marker-popup micrio-button.close button')?.click()
		// Timer-based for the same reason as the tour test above: the click starts an
		// asynchronous `micrio.open()`, and a frame-polled deadline can expire before it lands.
		await pollUntil(() => opened.viewer.el.$current?.id === main.id, 8000, 'the original image')
		expect(opened.image().state.$marker).toBeUndefined()
		opened.viewer.destroy()
	})

	it('drops a link marker whose popup was replaced while its image was away', async () => {
		const { main, target } = linkedPair({ popup: true, extraTargetMarkers: [marker('t2')] })
		const opened = await openMarkers(main)

		await opened.openMarker('m1')
		await waitFor(() => opened.viewer.el.$current?.id === target.id, 8000, 'the linked image')

		// Another marker takes the popup while the main image is off screen ...
		await openMarkerOn(opened.viewer, target.id, target.mid('t2'))
		await waitFor(() => opened.viewer.el.state.$marker?.id === target.mid('t2'), 6000, 'the second marker')
		// ... and the main image's layer is gone, so showing it again re-mounts its markers
		await pollUntil(() => layerFor(opened.viewer.el, main.mid('m1')) === null, 4000, 'the main layer to go')

		await opened.viewer.open(main.id)
		await waitFor(() => opened.viewer.el.$current?.id === main.id, 8000, 'the original image')
		await waitFor(() => layerFor(opened.viewer.el, main.mid('m1')) !== null, 8000, 'the main layer back')
		await settle(2)

		// The stale marker is not restored, so nothing follows its link again
		expect(opened.image().state.$marker).toBeUndefined()
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
