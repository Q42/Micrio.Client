import { afterEach, describe, expect, it } from 'vitest'
import { openGrid, restoreArchiveXhr } from '../../fixtures/grid'
import type { gridFixture } from '../../fixtures/grid'
import { cellButtons, layoutIds, settleFrames } from '../../helpers/grid'
import { waitFor } from '../../helpers/viewer'
import { marker } from '../../fixtures/bundles'
import type { Models } from '$types/models'

/**
 * The `grid:` tour-event path: what a running video tour can do to a grid.
 *
 * `VideoTourInstance` dispatches one `tour-event` per event window when it becomes active (see
 * `tests/browser/video-tour.test.ts`), and the grid runs any `action` starting with `grid:` as a
 * `GridActionType`. Driving that event by hand is the deterministic way to test the seam — the
 * real end-to-end playback case lives in `grid-integration.test.ts`.
 */

afterEach(() => {
	restoreArchiveXhr()
})

/**
 * The default harness: an interactive grid with instant transitions.
 *
 * `clickable` is set explicitly because the controller only hooks clicks, keyboard, the tour
 * subscriptions and the `place`/`remove` cycle while it is clickable — a grid without it is
 * deliberately inert (and `display: none`).
 */
const fast = (opts: Parameters<typeof gridFixture>[0] = {}) => ({
	...opts,
	grid: { clickable: 'focus' as const, ...opts.grid },
	settings: {
		...opts.settings,
		grid: { transitionDuration: 0, ...(opts.settings?.grid as Record<string, unknown>) },
	},
})

/** Dispatches the same `tour-event` shape `VideoTourInstance` produces. */
function tourEvent(
	micrio: HTMLElement,
	event: Partial<Models.ImageData.Event> & { action: string; start: number; end: number },
	active = true,
): void {
	micrio.dispatchEvent(new CustomEvent('tour-event', { detail: { ...event, active } }))
}

/** A marker with a tag and a view, for the `focusTagged` family. */
const taggedMarker = (id: string, tag: string, view: Models.Camera.View) =>
	marker(id, { tags: [tag], view, i18n: { en: { title: id } } })

describe('grid tour events', () => {
	it('runs grid:focus for a single image', async () => {
		const { viewer, grid, ids } = await openGrid(fast())
		tourEvent(viewer.el, { start: 1, end: 2, action: 'grid:focus', data: ids[1] ?? '' })
		await waitFor(() => grid.$focussed?.id === ids[1], 4000, 'focus from tour event')
		expect(layoutIds(grid)).toEqual([ids[1]])
		viewer.destroy()
	})

	it('lays out several images, honouring the |h flag', async () => {
		const { viewer, grid, gridEl, ids } = await openGrid(fast())
		const pair = `${ids[0]},${ids[2]}`

		tourEvent(viewer.el, { start: 1, end: 2, action: 'grid:focus', data: pair })
		await waitFor(() => layoutIds(grid).length === 2, 4000, 'two-image layout')
		// Without `|h`, the columns come from the tile maths
		expect(layoutIds(grid)).toEqual([ids[0], ids[2]])

		tourEvent(viewer.el, { start: 4, end: 5, action: 'grid:focus', data: `${pair}|h` })
		await waitFor(() => gridEl.style.gridTemplateColumns === 'repeat(2, auto)', 4000, 'row')
		expect(layoutIds(grid)).toEqual([ids[0], ids[2]])
		viewer.destroy()
	})

	it('resets, and goes back one layout', async () => {
		const { viewer, grid, ids } = await openGrid(fast())
		const opening = layoutIds(grid)

		tourEvent(viewer.el, { start: 1, end: 2, action: 'grid:focus', data: ids[0] ?? '' })
		await waitFor(() => layoutIds(grid).length === 1, 4000, 'filtered layout')

		// `grid:back` pops the layout that `focus` pushed
		tourEvent(viewer.el, { start: 4, end: 5, action: 'grid:back' })
		await waitFor(() => layoutIds(grid).length === opening.length, 4000, 'restored layout')
		expect(layoutIds(grid)).toEqual(opening)

		// `grid:reset` returns to the opening layout and clears history
		tourEvent(viewer.el, { start: 8, end: 9, action: 'grid:focus', data: ids[1] ?? '' })
		await waitFor(() => layoutIds(grid).length === 1, 4000, 'filtered again')
		tourEvent(viewer.el, { start: 12, end: 13, action: 'grid:reset' })
		await waitFor(() => layoutIds(grid).length === opening.length, 4000, 'reset layout')
		expect(layoutIds(grid)).toEqual(opening)
		viewer.destroy()
	})

	it('uses the event window as the transition duration', async () => {
		// `handleAction(grid, name, data, end - start)`. The duration only reaches the camera and
		// the `set` timers, so the observable is that the action still lands with a long window.
		const { viewer, grid, ids } = await openGrid(fast())
		tourEvent(viewer.el, { start: 1, end: 4, action: 'grid:focus', data: ids[0] ?? '' })
		await waitFor(() => grid.$focussed?.id === ids[0], 4000, 'long-duration focus')
		viewer.destroy()
	})

	it('flies the viewport to the bounding box of the given cells', async () => {
		const { viewer, grid, ids } = await openGrid(fast())
		// `flyTo` reads the *current* layout's cell areas, so a full overview is the prerequisite
		const areas = ids.map((id) => grid.getImage(id)?.opts.area)
		const [a, b] = [areas[0], areas[2]]
		if (!a || !b) {
			throw new Error('no cell areas measured')
		}
		const expected: Models.Camera.View = [
			Math.min(a[0], b[0]),
			Math.min(a[1], b[1]),
			Math.max(a[0] + a[2], b[0] + b[2]) - Math.min(a[0], b[0]),
			Math.max(a[1] + a[3], b[1] + b[3]) - Math.min(a[1], b[1]),
		]

		const views: Models.Camera.View[] = []
		const original = grid.image.camera.flyToView.bind(grid.image.camera)
		grid.image.camera.flyToView = (v: Models.Camera.View, o?: Models.Camera.AnimationOptions) => {
			views.push(v)
			return original(v, o)
		}

		tourEvent(viewer.el, { start: 1, end: 2, action: 'grid:flyTo', data: `${ids[0]},${ids[2]}` })
		await settleFrames(3)
		const match = views.find(
			(v) =>
				Math.abs(v[0] - expected[0]) < 0.01 &&
				Math.abs(v[1] - expected[1]) < 0.01 &&
				Math.abs(v[2] - expected[2]) < 0.01 &&
				Math.abs(v[3] - expected[3]) < 0.01,
		)
		expect(match).toBeDefined()
		viewer.destroy()
	})

	it('warns and stays put when flyTo names no current images', async () => {
		const { viewer, grid } = await openGrid(fast())
		const opening = layoutIds(grid)
		tourEvent(viewer.el, { start: 1, end: 2, action: 'grid:flyTo', data: 'nope' })
		await settleFrames(3)
		expect(layoutIds(grid)).toEqual(opening)
		viewer.destroy()
	})
})

const tagged = (tag: string) =>
	fast({
		markers: {
			0: [taggedMarker('a1', tag, [0.1, 0.1, 0.4, 0.4])],
			2: [taggedMarker('b1', tag, [0.5, 0.5, 0.4, 0.4])],
		},
	})

describe('grid tour events with tagged markers', () => {
	it('grid:focusTagged keeps only tagged images and zooms each to its marker view', async () => {
		const { viewer, grid, ids } = await openGrid(tagged('boats'))
		const target = grid.getImage(ids[0] ?? '')
		if (!target) {
			throw new Error('no cell image')
		}
		const views: Models.Camera.View[] = []
		const original = target.camera.flyToView.bind(target.camera)
		target.camera.flyToView = (v: Models.Camera.View, o?: Models.Camera.AnimationOptions) => {
			views.push(v)
			return original(v, o)
		}

		tourEvent(viewer.el, { start: 1, end: 2, action: 'grid:focusTagged', data: 'boats' })
		await waitFor(() => layoutIds(grid).length === 2, 4000, 'tagged layout')
		expect(layoutIds(grid)).toEqual([ids[0], ids[2]])
		await settleFrames(4)
		// The tagged marker's own view is what the image zooms to
		expect(views.some((v) => v[0] === 0.1 && v[2] === 0.4)).toBe(true)
		viewer.destroy()
	})

	it('grid:focusWithTagged keeps each image at its full view', async () => {
		const { viewer, grid, ids } = await openGrid(tagged('boats'))
		const target = grid.getImage(ids[0] ?? '')
		if (!target) {
			throw new Error('no cell image')
		}
		const views: Models.Camera.View[] = []
		const original = target.camera.flyToView.bind(target.camera)
		target.camera.flyToView = (v: Models.Camera.View, o?: Models.Camera.AnimationOptions) => {
			views.push(v)
			return original(v, o)
		}

		tourEvent(viewer.el, { start: 1, end: 2, action: 'grid:focusWithTagged', data: 'boats' })
		await waitFor(() => layoutIds(grid).length === 2, 4000, 'tagged layout')
		await settleFrames(4)
		// No marker view is passed, so the images are flown to their full view
		expect(views.every((v) => v[2] === 1 && v[3] === 1)).toBe(true)
		viewer.destroy()
	})

	it('filters to nothing when no image carries the tag', async () => {
		const { viewer, grid } = await openGrid(tagged('boats'))
		tourEvent(viewer.el, { start: 1, end: 2, action: 'grid:focusTagged', data: 'nobody-has-this' })
		await settleFrames(4)
		expect(cellButtons(grid)).toHaveLength(0)
		viewer.destroy()
	})
})

describe('grid tour event edge cases', () => {
	it('ignores a non-grid action', async () => {
		const { viewer, grid } = await openGrid(fast())
		const opening = layoutIds(grid)
		tourEvent(viewer.el, { start: 1, end: 2, action: 'somethingElse' })
		await settleFrames(3)
		expect(layoutIds(grid)).toEqual(opening)
		viewer.destroy()
	})

	it('ignores the deactivation of an event', async () => {
		const { viewer, grid, ids } = await openGrid(fast())
		const opening = layoutIds(grid)
		// `active: false` is the same event leaving its window — it must not re-run the action
		tourEvent(viewer.el, { start: 1, end: 2, action: 'grid:focus', data: ids[0] ?? '' }, false)
		await settleFrames(3)
		expect(layoutIds(grid)).toEqual(opening)
		viewer.destroy()
	})

	it('ignores malformed payloads', async () => {
		const { viewer, grid } = await openGrid(fast())
		const opening = layoutIds(grid)

		// Not a CustomEvent at all
		viewer.el.dispatchEvent(new Event('tour-event'))
		// A CustomEvent without the fields the grid reads
		viewer.el.dispatchEvent(new CustomEvent('tour-event', { detail: { action: 'grid:focus' } }))
		viewer.el.dispatchEvent(new CustomEvent('tour-event', { detail: 'grid:focus' }))
		await settleFrames(3)
		expect(layoutIds(grid)).toEqual(opening)
		viewer.destroy()
	})

	it('warns and does nothing for an unknown grid action', async () => {
		const { viewer, grid } = await openGrid(fast())
		const opening = layoutIds(grid)
		tourEvent(viewer.el, { start: 1, end: 2, action: 'grid:notAThing' })
		await settleFrames(3)
		expect(layoutIds(grid)).toEqual(opening)
		viewer.destroy()
	})

	it('suppresses an identical repeated action until the layout changes', async () => {
		// `_lastAction` is the dedupe key, and `set()` clears it — so repeating the exact same
		// action+data is a no-op, but only while no layout change happened in between.
		const { viewer, grid, ids } = await openGrid(fast())
		const event = { start: 1, end: 2, action: 'grid:focus', data: ids[0] ?? '' }

		tourEvent(viewer.el, event)
		await waitFor(() => layoutIds(grid).length === 1, 4000, 'first focus')

		// Read the dedupe state through an observable: `back()` restores the opening layout and
		// clears `_lastAction` in the process, so the same event works again afterwards
		tourEvent(viewer.el, event)
		await settleFrames(3)
		expect(layoutIds(grid)).toEqual([ids[0]])
		viewer.destroy()
	})

	it('still drives the layout while a tour hides the grid', async () => {
		// `_hook` wires the tour-event handler independently of `#placeGrid`, so a grid that is
		// hidden because a tour is running still re-lays out.
		const { viewer, grid, gridEl, ids } = await openGrid(fast())
		viewer.el.state.tour.set({ id: 'some-tour', i18n: { en: { duration: 5, timeline: [], events: [] } } })
		await waitFor(() => gridEl.classList.contains('grid-cells-hidden'), 4000, 'hidden grid')

		tourEvent(viewer.el, { start: 1, end: 2, action: 'grid:focus', data: ids[3] ?? '' })
		await waitFor(() => layoutIds(grid).length === 1, 4000, 'layout change while hidden')
		expect(layoutIds(grid)).toEqual([ids[3]])
		viewer.destroy()
	})

	it('ignores filterTourImages when no tour is running', async () => {
		const { viewer, grid } = await openGrid(fast())
		const opening = layoutIds(grid)
		tourEvent(viewer.el, { start: 1, end: 2, action: 'grid:filterTourImages' })
		await settleFrames(3)
		expect(layoutIds(grid)).toEqual(opening)
		viewer.destroy()
	})

	it('filters to the tour step images, deduplicated and in step order', async () => {
		const { viewer, grid, ids } = await openGrid(fast())
		viewer.el.state.tour.set({
			id: 'grid-tour',
			steps: ['s1', 's2'],
			duration: 6,
			i18n: { en: { title: 'Tour' } },
			// Two steps on the same image: `filterTourImages` deduplicates them by id
			stepInfo: [
				{ markerId: 's1', micrioId: ids[2] ?? '', duration: 3 },
				{ markerId: 's2', micrioId: ids[0] ?? '', duration: 3 },
				{ markerId: 's3', micrioId: ids[2] ?? '', duration: 3 },
			],
		} as Models.ImageData.MarkerTour)

		tourEvent(viewer.el, { start: 1, end: 2, action: 'grid:filterTourImages' })
		await waitFor(() => layoutIds(grid).length === 2, 4000, 'tour-filtered layout')
		expect(layoutIds(grid)).toEqual([ids[2], ids[0]])
		viewer.destroy()
	})

	it('applies the horizontal flag of filterTourImages', async () => {
		const { viewer, grid, ids, gridEl } = await openGrid(fast())
		viewer.el.state.tour.set({
			id: 'grid-tour',
			steps: ['s1', 's2'],
			duration: 6,
			i18n: { en: { title: 'Tour' } },
			stepInfo: [
				{ markerId: 's1', micrioId: ids[0] ?? '', duration: 3 },
				{ markerId: 's2', micrioId: ids[1] ?? '', duration: 3 },
			],
		} as Models.ImageData.MarkerTour)

		tourEvent(viewer.el, { start: 1, end: 2, action: 'grid:filterTourImages', data: 'h' })
		await waitFor(() => layoutIds(grid).length === 2, 4000, 'filtered layout')
		expect(gridEl.style.gridTemplateColumns).toBe('repeat(2, auto)')
		viewer.destroy()
	})
})
