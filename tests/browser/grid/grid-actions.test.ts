import { afterEach, describe, expect, it } from 'vitest'
import { openGrid, restoreArchiveXhr } from '../../fixtures/grid'
import type { gridFixture } from '../../fixtures/grid'
import { cellButton, layoutIds, settleFrames } from '../../helpers/grid'
import { marker } from '../../fixtures/bundles'
import { videoTour } from '../../fixtures/tours'
import type { Viewer } from '../../helpers/viewer'
import { waitFor } from '../../helpers/viewer'
import type { Models } from '$types/models'

/**
 * Grid actions driven from *data*: a marker opening runs `data._meta.gridAction`, and a marker
 * that carries a `videoTour` starts that tour instead of a popup.
 *
 * The chain is `image.state.marker.set(id)` → `micrio.state.marker` resolves the id to the
 * object → the grid reads `_meta.gridAction` on the `tick` and runs it. Note that the grid
 * fixture renders no `micrio-marker` elements (its images never enter the viewer's visible list),
 * so the `Image.State` store is the trigger and `micrio.state.$marker` is the observable — not
 * the DOM.
 */

afterEach(() => {
	restoreArchiveXhr()
})

const fast = (opts: Parameters<typeof gridFixture>[0] = {}) => ({
	...opts,
	grid: { clickable: 'focus' as const, ...opts.grid },
	settings: { ...opts.settings, grid: { transitionDuration: 0, ...(opts.settings?.grid as object) } },
})

/** A plain marker that runs a grid action as soon as it opens. */
const actionMarker = (id: string, gridAction: string, extra: Partial<Models.ImageData.Marker> = {}) =>
	marker(id, {
		popupType: 'none',
		data: { _meta: { gridAction } },
		i18n: { en: { title: id } },
		...extra,
	})

/** A marker that only grabs attention, for the metadata cases. */
const plainMarker = (id: string, data: Models.ImageData.Marker['data']) =>
	marker(id, { popupType: 'none', data, i18n: { en: { title: id } } })

/**
 * Opens a marker on a specific cell and waits until the grid can see it.
 *
 * The marker *object* is set rather than its id: `image.state.marker.set(id)` publishes the
 * string, which a rendered `micrio-marker` element is also listening for — and resolving that is
 * a race against any leftover marker from an earlier test. The object goes straight to
 * `micrio.state.marker`, which is what the grid watches.
 *
 * The wait is a poll rather than a single `waitFor`: under a loaded browser a marker can be
 * cleared again (a leftover marker element from an earlier test reacting to the global state)
 * before the grid's `tick`-deferred action runs, so the open is repeated until it sticks.
 */
async function openMarker(viewer: Viewer, imageId: string, id: string): Promise<void> {
	const image = viewer.el.gallery?._images.find((i) => i.id === imageId)
	const found = image?.$data?.markers?.find((m) => m.id === id)
	if (!image || !found) {
		throw new Error(`no marker ${id} on ${imageId}`)
	}
	const deadline = performance.now() + 8000
	while (performance.now() < deadline) {
		image.state.marker.set(found)
		try {
			// oxlint-disable-next-line eslint/no-await-in-loop -- a retry must be sequential: each round depends on the effect of the previous one
			await waitFor(() => viewer.el.state.$marker?.id === id, 1200, `marker ${id}`)
			// oxlint-disable-next-line eslint/no-await-in-loop -- see above
			await settleFrames(2)
			return
		} catch {
			// Retry: the marker did not stick this round
		}
	}
	throw new Error(`marker ${id} never reached the grid state`)
}

describe('marker grid actions', () => {
	it('focuses the named image when the marker opens', async () => {
		const { viewer, grid, ids } = await openGrid(
			fast({ withIds: (all) => ({ 0: [actionMarker('focus-me', `focus|${all[3] ?? ''}`)] }) }),
		)

		await openMarker(viewer, ids[0] ?? '', 'focus-me')
		await waitFor(() => grid.$focussed?.id === ids[3], 4000, 'marker focus')
		expect(layoutIds(grid)).toEqual([ids[3]])
		viewer.destroy()
	})

	it('resets the grid when its marker opens', async () => {
		const { viewer, grid, ids } = await openGrid(fast({ markers: { 1: [actionMarker('go-reset', 'reset')] } }))
		const opening = layoutIds(grid)

		// Filter first, so `reset` has something to undo
		await grid.set([{ id: ids[0] ?? '', size: [1] }], { duration: 0 })
		expect(layoutIds(grid)).toEqual([ids[0]])

		await openMarker(viewer, ids[1] ?? '', 'go-reset')
		await waitFor(() => layoutIds(grid).length === opening.length, 4000, 'reset layout')
		expect(layoutIds(grid)).toEqual(opening)
		viewer.destroy()
	})

	it('runs a tagged action when its marker opens', async () => {
		const tagged = marker('tagged-on-2', {
			tags: ['boats'],
			view: [0.2, 0.2, 0.4, 0.4],
			popupType: 'none',
			i18n: { en: { title: 'tagged' } },
		})
		const { viewer, grid, ids } = await openGrid(
			fast({
				markers: {
					0: [actionMarker('tagged-trigger', 'focusTagged|boats')],
					2: [tagged],
				},
			}),
		)

		await openMarker(viewer, ids[0] ?? '', 'tagged-trigger')
		await waitFor(() => layoutIds(grid).join() === (ids[2] ?? ''), 4000, 'tagged layout')
		viewer.destroy()
	})

	it('runs the action again on a second open', async () => {
		const { viewer, grid, ids } = await openGrid(
			fast({ withIds: (all) => ({ 3: [actionMarker('once', `focus|${all[0] ?? ''}`)] }) }),
		)
		const trigger = grid.getImage(ids[3] ?? '')

		await openMarker(viewer, ids[3] ?? '', 'once')
		await waitFor(() => layoutIds(grid).join() === (ids[0] ?? ''), 4000, 'first open focuses')

		// Closing and re-opening the same marker runs its action again (`_lastAction` was cleared
		// by the `set` the first run performed)
		trigger?.state.marker.set(undefined)
		await settleFrames(2)
		await grid.reset(0.1)
		await settleFrames(2)
		expect(layoutIds(grid)).toHaveLength(ids.length)

		await openMarker(viewer, ids[3] ?? '', 'once')
		await waitFor(() => layoutIds(grid).join() === (ids[0] ?? ''), 4000, 'second open focuses')
		viewer.destroy()
	})

	it('ignores a marker without a grid action', async () => {
		const plain = marker('plain', { popupType: 'none', i18n: { en: { title: 'plain' } } })
		const { viewer, grid, ids } = await openGrid(fast({ markers: { 0: [plain] } }))
		const opening = layoutIds(grid)

		await openMarker(viewer, ids[0] ?? '', 'plain')
		await settleFrames(6)
		expect(layoutIds(grid)).toEqual(opening)
		expect(grid.$focussed).toBeUndefined()
		viewer.destroy()
	})
})

describe('marker grid metadata', () => {
	it('resizes the marker image\'s cell for _meta.gridSize "2,2"', async () => {
		const sized = plainMarker('size-me', { _meta: { gridSize: '2,2' } })
		const { viewer, grid, ids } = await openGrid(fast({ markers: { 0: [sized] } }))
		const before = cellButton(grid, ids[0] ?? '')?.style.gridArea ?? ''
		expect(before).toBe('')

		await openMarker(viewer, ids[0] ?? '', 'size-me')
		await settleFrames(4)
		const area = cellButton(grid, ids[0] ?? '')?.style.gridArea ?? ''
		expect(area).toContain('span 2')
		// The other cells keep their size: only the marker's image grows
		expect(cellButton(grid, ids[1] ?? '')?.style.gridArea ?? '').toBe('')
		viewer.destroy()
	})

	it('treats a numeric _meta.gridSize as a square', async () => {
		const sized = plainMarker('square', { _meta: { gridSize: 2 } })
		const { viewer, grid, ids } = await openGrid(fast({ markers: { 0: [sized] } }))

		await openMarker(viewer, ids[0] ?? '', 'square')
		await settleFrames(4)
		const area = cellButton(grid, ids[0] ?? '')?.style.gridArea ?? ''
		// `auto / auto / span 2 / span 2` — a single number means rows and columns alike
		expect(area.match(/span 2/g)?.length).toBe(2)
		viewer.destroy()
	})

	it('ignores a non-numeric _meta.gridSize', async () => {
		const sized = plainMarker('garbage', { _meta: { gridSize: 'abc' } })
		const { viewer, grid, ids } = await openGrid(fast({ markers: { 0: [sized] } }))
		const opening = layoutIds(grid)

		await openMarker(viewer, ids[0] ?? '', 'garbage')
		await settleFrames(4)
		expect(layoutIds(grid)).toEqual(opening)
		expect(cellButton(grid, ids[0] ?? '')?.style.gridArea ?? '').toBe('')
		viewer.destroy()
	})

	it('accepts a marker with _meta.gridView without changing the layout', async () => {
		// `gridView` is a hint for `micrio.open(id, { gridView: true })` on the element side (the
		// tour passes it through); the controller itself never reads it.
		const gridView = plainMarker('grid-view', { _meta: { gridView: true } })
		const { viewer, grid, ids } = await openGrid(fast({ markers: { 0: [gridView] } }))
		const opening = layoutIds(grid)

		await openMarker(viewer, ids[0] ?? '', 'grid-view')
		await settleFrames(6)
		expect(layoutIds(grid)).toEqual(opening)
		expect(grid.$focussed).toBeUndefined()
		viewer.destroy()
	})

	it('accepts a marker with gridTourTransition without changing the layout', async () => {
		const transition = plainMarker('transition', { gridTourTransition: 'slide-up' })
		const { viewer, grid, ids } = await openGrid(fast({ markers: { 0: [transition] } }))
		const opening = layoutIds(grid)

		await openMarker(viewer, ids[0] ?? '', 'transition')
		await settleFrames(6)
		expect(layoutIds(grid)).toEqual(opening)
		viewer.destroy()
	})

	it('focuses with the marker gridTourTransition', async () => {
		// A marker's `gridTourTransition` is the focus animation its own `gridAction` uses. The
		// controller hands it to `gridFocus` as the transition option; the settled layout is the
		// same whatever the transition, so the assertion is on the call.
		const { viewer, grid, ids } = await openGrid(
			fast({
				withIds: (all) => ({
					0: [
						marker('moving', {
							popupType: 'none',
							i18n: { en: { title: 'moving' } },
							data: { _meta: { gridAction: `focus|${all[2] ?? ''}` }, gridTourTransition: 'swipe-left' },
						}),
					],
				}),
			}),
		)

		const transitions: (string | undefined)[] = []
		const original = grid.gridFocus.bind(grid)
		grid.gridFocus = ((img, opts) => {
			transitions.push(opts?.transition)
			return original(img, opts)
		}) as typeof grid.gridFocus

		await openMarker(viewer, ids[0] ?? '', 'moving')
		await settleFrames(4)
		expect(transitions).toEqual(['swipe-left'])
		expect(grid.$focussed?.id).toBe(ids[2])
		viewer.destroy()
	})

	it('starts a marker video tour and hides the grid while it runs', async () => {
		const vt = videoTour({ id: 'marker-vt', duration: 4 })
		const withVideo = marker('play-me', {
			popupType: 'none',
			videoTour: vt,
			i18n: { en: { title: 'play me' } },
		})
		const { viewer, gridEl, ids } = await openGrid(fast({ markers: { 0: [withVideo] } }))

		// The marker open is retried: the *effect* under test is the tour starting, and a marker
		// that was cleared before the activation chain ran would otherwise fail on the wrong thing.
		const deadline = performance.now() + 8000
		while (viewer.el.state.$tour === undefined && performance.now() < deadline) {
			// oxlint-disable-next-line eslint/no-await-in-loop -- sequential by design: each attempt depends on the previous one's outcome
			await openMarker(viewer, ids[0] ?? '', 'play-me')
		}
		// `VideoTourInstance` writes itself onto the tour data, so this compares by id, not by
		// the (now extended) object identity
		expect(viewer.el.state.$tour?.id).toBe('marker-vt')
		await waitFor(() => gridEl.classList.contains('grid-cells-hidden'), 4000, 'grid hidden for the tour')
		viewer.destroy()
	})
})
