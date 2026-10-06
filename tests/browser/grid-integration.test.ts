import { afterEach, describe, expect, it, vi } from 'vitest'
import { restoreArchiveXhr, openGrid } from '../fixtures/grid'
import type { gridFixture } from '../fixtures/grid'
import { layoutIds, settleFrames } from '../helpers/grid'
import { waitFor } from '../helpers/viewer'
import { marker } from '../fixtures/bundles'
import { videoTour } from '../fixtures/tours'
import { VideoTourInstance } from '../../src/media/videotour'
import type { Models } from '../../src/types/models'
import type { HTMLMicrioElement } from '../../src/core/element'

/**
 * Storytelling end to end: the paths a *published* grid album actually takes.
 *
 * This is where the pieces meet — `micrio.open()` with a grid gallery, a multi-image marker tour
 * whose steps live on different cells, and a step marker whose video tour fires `grid:` events on
 * its timeline.
 */

afterEach(() => {
	restoreArchiveXhr()
	vi.useRealTimers()
})

const fast = (opts: Parameters<typeof gridFixture>[0] = {}) => ({
	...opts,
	grid: { clickable: 'focus' as const, ...opts.grid },
	settings: { ...opts.settings, grid: { transitionDuration: 0, ...(opts.settings?.grid as object) } },
})

const actionMarker = (id: string, gridAction: string, extra: Partial<Models.ImageData.Marker> = {}) =>
	marker(id, {
		popupType: 'none',
		data: { _meta: { gridAction } },
		i18n: { en: { title: id } },
		...extra,
	})

/**
 * Opens a marker on one cell and waits for its grid action to take effect.
 *
 * The marker *object* is set rather than its id, because resolving an id is the rendered
 * `micrio-marker` element's job and that is a race in this fixture (the cells never become
 * visible, so no marker elements are rendered). The open is retried until `effect` holds: under
 * load the marker can be cleared again before the grid's `tick`-deferred action runs, and a lost
 * action is precisely the bug this suite should report rather than absorb.
 */
async function openMarker(
	viewer: { el: HTMLMicrioElement },
	imageId: string,
	id: string,
	effect: () => boolean,
	label: string,
): Promise<void> {
	const image = viewer.el.gallery?._images.find((i) => i.id === imageId)
	const found = image?.$data?.markers?.find((m) => m.id === id)
	if (!image || !found) {
		throw new Error(`no marker ${id} on ${imageId}`)
	}
	const deadline = performance.now() + 8000
	while (performance.now() < deadline) {
		image.state.marker.set(found)
		// oxlint-disable-next-line eslint/no-await-in-loop -- a retry must be sequential: each round depends on the effect of the previous one
		await settleFrames(2)
		if (effect()) {
			return
		}
	}
	throw new Error(`marker ${id} never produced: ${label}`)
}

describe('opening images in a grid', () => {
	// `micrio.open(id)` with a grid gallery short-circuits to `gallery.gotoId(id)` and returns
	// that image — it never focuses it, and it never switches `$current` either. Focusing a cell
	// is the grid API's job. Both halves are pinned here, because the short-circuit is the
	// documented grid gotcha and the "does not switch" part is what makes it surprising.
	it('resolves the image through the gallery without focusing or switching', async () => {
		const { viewer, grid, ids } = await openGrid(fast())
		const image = await viewer.el.open(ids[2] ?? '')
		await settleFrames(4)

		expect(image?.id).toBe(ids[2])
		expect(grid.$focussed).toBeUndefined()
		expect(viewer.el.$current?.id).toBe('')
		expect(layoutIds(grid)).toHaveLength(ids.length)
		viewer.destroy()
	})

	it('behaves the same for open(id, { gridView: true })', async () => {
		const { viewer, grid, ids } = await openGrid(fast())
		const image = await viewer.el.open(ids[1] ?? '', { gridView: true })
		await settleFrames(4)

		expect(image?.id).toBe(ids[1])
		expect(grid.$focussed).toBeUndefined()
		expect(layoutIds(grid)).toHaveLength(ids.length)
		viewer.destroy()
	})

	it('focuses when the grid API is used instead of open()', async () => {
		const { viewer, grid, ids } = await openGrid(fast())
		await grid.gridFocus(grid.getImage(ids[1] ?? ''), { duration: 0 })
		await waitFor(() => grid.$focussed?.id === ids[1], 4000, 'focused')
		expect(layoutIds(grid)).toEqual([ids[1]])
		// `gridFocus` is what moves the current image
		expect(viewer.el.$current?.id).toBe(ids[1])
		viewer.destroy()
	})
})

describe('multi-image marker tours in a grid', () => {
	it('drives the layout from each step marker gridAction', async () => {
		// Three cells, each carrying the marker for one tour step. The steps themselves live in a
		// separate tour object so the test can advance it by hand.
		const { viewer, grid, ids } = await openGrid(
			fast({
				withIds: (all) => ({
					0: [actionMarker('step-0', `focus|${all[0] ?? ''}`)],
					1: [actionMarker('step-1', 'reset')],
					2: [actionMarker('step-2', `focus|${all[3] ?? ''}`)],
				}),
			}),
		)
		const tour: Models.ImageData.MarkerTour = {
			id: 'story',
			steps: ['step-0', 'step-1', 'step-2'],
			duration: 9,
			i18n: { en: { title: 'Story' } },
			stepInfo: [
				{ markerId: 'step-0', micrioId: ids[0] ?? '', duration: 3 },
				{ markerId: 'step-1', micrioId: ids[1] ?? '', duration: 3 },
				{ markerId: 'step-2', micrioId: ids[2] ?? '', duration: 3 },
			],
		}
		viewer.el.state.tour.set(tour)
		await settleFrames(4)

		// Step 0: the tour opening its first step puts that step's marker on the image, and each
		// step marker's `gridAction` is what changes the grid. The marker is re-applied in a poll,
		// because `micrio-tour` can also be cleared (and its marker with it) while the tour is
		// still settling — the grid's own reaction is what this asserts.
		const stepZero = () => {
			const image = grid.getImage(ids[0] ?? '')
			const stepMarker = image?.$data?.markers?.find((m) => m.id === 'step-0')
			if (image && stepMarker) {
				image.state.marker.set(stepMarker)
			}
			return grid.$focussed?.id === ids[0]
		}
		const stepZeroDeadline = performance.now() + 6000
		while (!stepZero() && performance.now() < stepZeroDeadline) {
			// oxlint-disable-next-line eslint/no-await-in-loop -- a poll: each round re-applies the marker and waits for the grid to react
			await settleFrames(2)
		}
		expect(grid.$focussed?.id).toBe(ids[0])
		// Step 1 resets
		await openMarker(viewer, ids[1] ?? '', 'step-1', () => layoutIds(grid).length === ids.length, 'step 1 reset')
		// Step 2 focuses cell 3, reached through the marker that lives on cell 2
		await openMarker(viewer, ids[2] ?? '', 'step-2', () => grid.$focussed?.id === ids[3], 'step 2 focus')
		viewer.destroy()
	})
})

/** A video tour that resets at 1s, focuses one cell at 3s and resets again at 5s. */
const guidedTour = (focusId: string) =>
	videoTour({
		id: 'guided',
		duration: 8,
		timeline: [
			{ start: 0, end: 2, rect: [0, 0, 1, 1] },
			{ start: 4, end: 8, rect: [0.3, 0.2, 0.4, 0.4] },
		],
		events: [
			{ start: 1, end: 2, action: 'grid:reset' },
			{ start: 3, end: 4, action: 'grid:focus', data: focusId },
			{ start: 5, end: 6, action: 'grid:reset' },
		],
	})

describe('a step marker with a video tour carrying grid events', () => {
	it('runs the grid events on the tour timeline', async () => {
		const { viewer, grid, ids } = await openGrid(
			fast({
				withIds: (all) => ({ 0: [actionMarker('guide', '', { videoTour: guidedTour(all[2] ?? '') })] }),
			}),
		)
		const image = grid.getImage(ids[0] ?? '')
		const tour = image?.$data?.markers?.[0]?.videoTour
		if (!image || !tour) {
			throw new Error('no video tour on the marker')
		}

		// Mount with real timers (the grid's waits poll on requestAnimationFrame) and only fake the
		// clock afterwards, the pattern `tests/browser/video-tour.test.ts` uses. Seeking the tour
		// is what a real timeline reaches through `play()`; seeking keeps the test deterministic
		// without waiting on the camera animation.
		vi.useFakeTimers()
		viewer.el.state.tour.set(tour)
		// `micrio-media` builds the instance asynchronously (its element is only created on the next
		// layout render); building it here is the same class on the same image, and keeps the test
		// independent of that timing.
		const instance = new VideoTourInstance(image, tour)

		// Past the 3s focus event: the grid focused the named cell
		instance.currentTime = 3.5
		await vi.advanceTimersByTimeAsync(0)
		expect(grid.$focussed?.id).toBe(ids[2])

		// Past the 5s reset event: the overview is back
		instance.currentTime = 5.5
		await vi.advanceTimersByTimeAsync(0)
		expect(grid.$focussed).toBeUndefined()
		expect(layoutIds(grid)).toHaveLength(ids.length)
		instance.destroy()
		viewer.destroy()
	})
})
