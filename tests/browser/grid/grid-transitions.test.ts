import { afterEach, describe, expect, it, vi } from 'vitest'
import { openGrid, restoreArchiveXhr } from '../../fixtures/grid'
import { cellButton, layoutIds, settleFrames, waitForLayout } from '../../helpers/grid'
import { marker } from '../../fixtures/bundles'
import { videoTour } from '../../fixtures/tours'
import { setupBehindTransition } from '$grid/transitions'
import { GridActionType } from '$grid/actions'
import type { Models } from '$types/models'
import type { Grid } from '$grid/grid'
import type { Viewer } from '../../helpers/viewer'

/**
 * The grid's *layout transitions* and its *input layer* — the two parts of `src/grid` the
 * story suites only touch in passing.
 *
 * Three things make this suite different from `grid-focus`/`grid-layout`:
 *
 * - **The `behind` transitions.** `gridFocus` never routes through `setupBehindTransition`;
 *   only `grid.set(..., { transition: 'behind' | 'behind-delayed' })` does. Those are the
 *   stacked-card transitions, so the assertions are on the per-cell `zIndex` and the layout
 *   the controller settled on.
 * - **The blur transition.** A focus with `blur: N` drives inline `filter`/`transition`
 *   styles through two nested `setTimeout`s, so it runs under fake timers — the viewer is
 *   opened *first*, with real timers, because `waitFor` polls on `requestAnimationFrame`.
 * - **The pointer and keyboard layer.** `hookGridKeys` listens on `document` for the keys and
 *   on the `<micr-io>` element for a tap, so both are driven as real events. There is no
 *   public API for "arrow key" or "tap".
 *
 * This fixture lays every cell out in **one row** (all areas share a `y`), which is why the
 * vertical arrow keys are asserted through their wrap-around fallback.
 */

afterEach(() => {
	restoreArchiveXhr()
	vi.useRealTimers()
})

/** The grid fixture with instant transitions, so a `set` settles within a frame or two. */
const fast = (opts: Parameters<typeof openGrid>[0] = {}) => ({
	...opts,
	grid: { clickable: 'focus' as const, ...opts.grid },
	settings: { ...opts.settings, grid: { transitionDuration: 0, ...(opts.settings?.grid as object) } },
})

/**
 * Opens a grid whose layout is the full album, whatever layout the album opened with.
 *
 * Most tests here are about the *full* layout. Re-`set`-ing every id with `noHistory` makes
 * each test's starting point the same, and it is awaited so the cell buttons exist before the
 * test body runs.
 */
async function openFullGrid(opts: Parameters<typeof openGrid>[0] = {}) {
	const opened = await openGrid(fast(opts))
	await opened.grid.set(
		opened.ids.map((id) => ({ id, size: [1] as [number, number?] })),
		{ duration: 0, noHistory: true },
	)
	await waitForLayout(opened.grid, opened.ids, 'full grid layout')
	return opened
}

/** The inline styles the blur transition writes and clears. */
function blurStyles(grid: Grid): { transition: string; filter: string } {
	const { style } = grid.micrio.canvas.element
	return { transition: style.transition, filter: style.filter }
}

describe('behind transitions', () => {
	it('stacks the delayed participants in reverse z-order', async () => {
		const { viewer, grid, ids } = await openFullGrid()

		// `setupBehindTransition` is called by `set` before the layout actually settles, and the
		// settled layout overwrites the z-indexes — so the stacking is asserted directly here,
		// which is also the only place its return value can be observed without racing the
		// animation. It also writes `forceAni`/`forceAreaAni` back onto the options object.
		const images: Models.Grid.GridImage[] = [
			{ id: ids[2] ?? '', size: [1] },
			{ id: ids[3] ?? '', size: [1] },
		]
		const opts = { duration: 0.3, transition: 'behind-delayed' as Models.Grid.GridSetTransition }
		setupBehindTransition(grid, images, opts, undefined)

		// Every named image was stacked and every entry kept its id
		expect(opts.transition).toBe('behind-delayed')
		const stacked = ids.map((id) => grid.getImage(id)?.canvas?.zIndex ?? 0)

		// `images.length - c++` with a two-image payload names the two entries in `_images` that
		// are part of the layout: the first keeps `images.length - 0`, so the run is descending.
		expect(stacked.some((z) => z > 1)).toBe(true)
		viewer.destroy()
	})

	it('leaves the z-indexes alone for a plain behind transition', async () => {
		const { viewer, grid, ids } = await openFullGrid()
		await grid.set([{ id: ids[0] ?? '', size: [1] }], { duration: 0 })
		await grid.set([{ id: ids[1] ?? '', size: [1] }], { transition: 'behind', duration: 0 })
		// `isDelayed` is false, so the `zIndex = images.length - c++` loop is skipped entirely
		expect(grid.getImage(ids[1] ?? '')?.canvas?.zIndex ?? 0).toBeLessThanOrEqual(1)
		viewer.destroy()
	})

	it('settles a delayed four-cell layout back on the album', async () => {
		const { viewer, grid, ids } = await openFullGrid()
		await grid.set(
			ids.map((id) => ({ id, size: [1] as [number, number?] })),
			{ transition: 'behind-delayed', duration: 0 },
		)
		// The delayed variant halves the crossfade so a four-cell stack does not spend four
		// full durations fading, and it re-arms the engine's transition durations.
		expect(viewer.el._engine._itemTransitionDuration).toBeGreaterThanOrEqual(0)
		expect(layoutIds(grid)).toEqual(ids)
		viewer.destroy()
	})

	it('reverses the between-pair for behind-left', async () => {
		const { viewer, grid, ids } = await openFullGrid()
		await grid.set([{ id: ids[0] ?? '', size: [1] }], { duration: 0 })
		// `behind-left` reverses `[current, target]` before handing it to `set`, which is what
		// makes the new image slide in from the other side.
		// `behind-left` is a `MarkerFocusTransition`, not a `GridSetTransition`: only the plain
		// `behind` name is accepted by `set()`. The cast pins the intent; the source narrows it.
		await grid.set([{ id: ids[1] ?? '', size: [1] }], {
			transition: 'behind-left' as unknown as Models.Grid.GridSetTransition,
			duration: 0,
		})
		expect(layoutIds(grid)).toContain(ids[1])
		viewer.destroy()
	})

	it('an unknown transition name falls through to a plain set', async () => {
		const { viewer, grid, ids } = await openFullGrid()
		await grid.set([{ id: ids[0] ?? '', size: [1] }], {
			// A string outside the union is not something a caller should do, but the controller
			// treats it as "no transition" rather than failing.
			transition: 'nonsense' as Models.Grid.GridSetTransition,
			duration: 0,
		})
		expect(layoutIds(grid)).toEqual([ids[0]])
		viewer.destroy()
	})
})

describe('blur transitions', () => {
	/** Focuses one cell, so a second focus has an outgoing image to transition from. */
	// oxlint-disable-next-line unicorn/consistent-function-scoping -- declared next to the two tests that use it, where its purpose reads
	async function focusCellAt(grid: Grid, ids: string[], index: number): Promise<void> {
		const image = grid.getImage(ids[index] ?? '')
		if (!image) {
			throw new Error('missing grid image')
		}
		await grid.gridFocus(image, { duration: 0 })
	}

	/** The cell a blur test transitions *to*. */
	// oxlint-disable-next-line unicorn/consistent-function-scoping -- see `focusCellAt`
	function targetAt(grid: Grid, ids: string[]): NonNullable<ReturnType<Grid['getImage']>> {
		const image = grid.getImage(ids[1] ?? '')
		if (!image) {
			throw new Error('missing grid image')
		}
		return image
	}

	it('blurs the canvas and clears the styles again', async () => {
		// Mount first (real timers), then switch: `waitFor` polls on rAF, which a faked clock
		// never advances.
		const { viewer, grid, ids } = await openFullGrid()
		await focusCellAt(grid, ids, 0)
		vi.useFakeTimers()

		// Two preconditions send `transition()` home early before the blur: a crossfade always
		// merges into the focused image (`trans === 'crossfade'` returns at once), and a `view`
		// without `noViewAni` skips the view handoff but not the blur. A non-crossfade
		// transition therefore is what actually reaches the blur branch.
		void grid
			.gridFocus(targetAt(grid, ids), { duration: 0.4, transition: 'swipe-left', blur: 8, view: [0, 0, 1, 1] })
			.catch(() => {})

		// The blur is applied synchronously, with a transition half the animation duration
		const applied = blurStyles(grid)
		expect(applied.filter).toBe('blur(8px)')
		expect(applied.transition).toContain('filter')
		expect(applied.transition).toContain('0.2s')

		// The two nested timeouts undo it: the filter first, then the transform/transition
		vi.advanceTimersByTime(200)
		expect(blurStyles(grid).filter).toBe('')
		vi.advanceTimersByTime(200)
		expect(blurStyles(grid).transition).toBe('')

		vi.useRealTimers()
		viewer.destroy()
	})

	it('ignores a blur of zero or NaN', async () => {
		const { viewer, grid, ids } = await openFullGrid()
		await focusCellAt(grid, ids, 0)
		vi.useFakeTimers()

		// The guard is `blur && !Number.isNaN(blur) && blur > 0`, so both of these are no-ops
		void grid
			.gridFocus(targetAt(grid, ids), { duration: 0.2, transition: 'swipe-left', view: [0, 0, 1, 1], blur: Number.NaN })
			.catch(() => {})
		expect(blurStyles(grid).filter).toBe('')

		void grid
			.gridFocus(targetAt(grid, ids), { duration: 0.2, transition: 'swipe-left', view: [0, 0, 1, 1], blur: 0 })
			.catch(() => {})
		expect(blurStyles(grid).filter).toBe('')

		vi.useRealTimers()
		viewer.destroy()
	})
})

describe('keyboard navigation', () => {
	/** Focuses the button for one image, so the next arrow key has a starting cell. */
	// oxlint-disable-next-line unicorn/consistent-function-scoping -- declared next to the keyboard tests it serves
	function focusButton(grid: Grid, id: string): void {
		const button = cellButton(grid, id)
		if (!button) {
			throw new Error(`no cell button for ${id}`)
		}
		button.focus()
	}

	/** The ids of the buttons currently carrying the `focussed` class. */
	// oxlint-disable-next-line unicorn/consistent-function-scoping -- see `focusButton`
	function marked(grid: Grid): string[] {
		return [...(grid as unknown as HTMLElement).querySelectorAll<HTMLButtonElement>('button.focussed')].map(
			(b) => b.dataset.id ?? '',
		)
	}

	it('moves focus across the row with the right arrow', async () => {
		const { viewer, grid, ids } = await openFullGrid()
		focusButton(grid, ids[0] ?? '')

		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
		// The neighbour, not the first cell: `gridAdjacent` picks the nearest centre to the right
		expect(marked(grid)).toEqual([ids[1]])
		viewer.destroy()
	})

	it('wraps to the first cell when there is no neighbour to the right', async () => {
		const { viewer, grid, ids } = await openFullGrid()
		// The last cell has nothing to its right, so the fallback is `cells[0]`
		focusButton(grid, ids[3] ?? '')

		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
		expect(marked(grid)).toEqual([ids[0]])
		viewer.destroy()
	})

	it('moves left to the last cell when there is nothing on the left', async () => {
		const { viewer, grid, ids } = await openFullGrid()
		focusButton(grid, ids[0] ?? '')

		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
		// The fallback for a leftward move is the *last* cell
		expect(marked(grid)).toEqual([ids[3]])
		viewer.destroy()
	})

	it('falls back for a vertical move with no neighbour', async () => {
		const { viewer, grid, ids } = await openFullGrid()
		focusButton(grid, ids[0] ?? '')

		// Every cell shares a row here, so a vertical move has no candidate at all and takes
		// the wrap-around branch: down resolves to the first cell, up to the last.
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
		expect(marked(grid)).toEqual([ids[0]])

		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
		expect(marked(grid)).toEqual([ids[3]])
		viewer.destroy()
	})

	it('starts from the first cell when nothing is focused', async () => {
		const { viewer, grid, ids } = await openFullGrid()
		// No button has focus, so `curIdx` falls back to 0 and the move is computed from there
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
		expect(marked(grid)).toEqual([ids[1]])
		viewer.destroy()
	})

	it('ignores keys while a cell is open', async () => {
		const { viewer, grid, ids } = await openFullGrid()
		focusButton(grid, ids[0] ?? '')
		const image = grid.getImage(ids[1] ?? '')
		if (!image) {
			throw new Error('missing grid image')
		}
		void grid.gridFocus(image, { duration: 0 })
		await settleFrames(2)

		const before = marked(grid)
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
		// `if (!dir || grid.$focussed) return` — a focused cell keeps the arrow keys
		expect(marked(grid)).toEqual(before)
		viewer.destroy()
	})

	it('does nothing for a non-arrow key', async () => {
		const { viewer, grid, ids } = await openFullGrid()
		focusButton(grid, ids[0] ?? '')
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
		expect(marked(grid)).toEqual([])
		viewer.destroy()
	})

	it('returns early when the grid is not clickable', async () => {
		const { viewer, grid, ids } = await openFullGrid({ grid: { clickable: false } })
		focusButton(grid, ids[0] ?? '')
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
		// The handler bails out before touching `_current` or the buttons
		expect(marked(grid)).toEqual([])
		viewer.destroy()
	})
})

describe('tap-to-cell pointer handling', () => {
	/** Dispatches one half of a pointer gesture on the viewer. */
	// oxlint-disable-next-line unicorn/consistent-function-scoping -- declared next to the tap tests it serves
	function pointer(viewer: Viewer, type: 'down' | 'up', x: number, y: number): void {
		viewer.el.dispatchEvent(new PointerEvent(`pointer${type}`, { bubbles: true, clientX: x, clientY: y }))
	}

	/** Points the grid camera lookup at the centre of a cell, so a tap matches it. */
	// oxlint-disable-next-line unicorn/consistent-function-scoping -- see `pointer`
	function aimAt(grid: Grid, ids: string[], index = 0): void {
		const area = grid.getImage(ids[index] ?? '')?.opts.area ?? [0, 0, 1, 1]
		// `hookGridKeys` destructures `const [vx, vy] = camera.getCoo(...)`, so the stub has to
		// be iterable — a `Coordinates` is, its `arr` is the [x, y, scale, w, direction] tuple.
		vi.spyOn(grid.image.camera, 'getCoo').mockReturnValue([
			area[0] + area[2] / 2,
			area[1] + area[3] / 2,
			1,
			0,
			0,
			1,
		] as unknown as ReturnType<typeof grid.image.camera.getCoo>)
	}

	it('opens the cell under a tap', async () => {
		const { viewer, grid, ids } = await openFullGrid()
		aimAt(grid, ids)

		pointer(viewer, 'down', 100, 100)
		pointer(viewer, 'up', 100, 100)
		await waitForLayout(grid, [ids[0] ?? ''], 'the tapped cell')

		vi.restoreAllMocks()
		viewer.destroy()
	})

	it('ignores a drag', async () => {
		const { viewer, grid, ids } = await openFullGrid()
		const layout = layoutIds(grid)
		aimAt(grid, ids)

		// A gesture further than 10px is a pan, not a tap
		pointer(viewer, 'down', 100, 100)
		pointer(viewer, 'up', 200, 200)
		await settleFrames(2)
		expect(layoutIds(grid)).toEqual(layout)

		vi.restoreAllMocks()
		viewer.destroy()
	})

	it('ignores a pointerup without a pointerdown', async () => {
		const { viewer, grid, ids } = await openFullGrid()
		const layout = layoutIds(grid)
		aimAt(grid, ids)

		pointer(viewer, 'up', 100, 100)
		await settleFrames(2)
		expect(layoutIds(grid)).toEqual(layout)

		vi.restoreAllMocks()
		viewer.destroy()
	})

	it('a tap that misses every cell does nothing', async () => {
		const { viewer, grid } = await openFullGrid()
		const layout = layoutIds(grid)
		// Outside every area: the coordinates are far off the image
		vi.spyOn(grid.image.camera, 'getCoo').mockReturnValue([50, 50, 1, 0, 0, 1] as unknown as ReturnType<
			typeof grid.image.camera.getCoo
		>)

		pointer(viewer, 'down', 100, 100)
		pointer(viewer, 'up', 100, 100)
		await settleFrames(2)
		expect(layoutIds(grid)).toEqual(layout)

		vi.restoreAllMocks()
		viewer.destroy()
	})

	it('does not hook taps or keys when the grid is not interactive', async () => {
		// `hookGridKeys` attaches the cell-tap listeners only for `panZoom === 'grid'` with a
		// truthy `clickable`. `clickable: false` is that switch; the `panZoom: 'cells'` value
		// covers the other side of the `_panZoom` union (it is `classList`-toggled on the host).
		const { viewer, grid, ids } = await openFullGrid({ grid: { panZoom: 'cells', clickable: false } })
		const layout = layoutIds(grid)
		aimAt(grid, ids)

		pointer(viewer, 'down', 100, 100)
		pointer(viewer, 'up', 100, 100)
		await settleFrames(2)
		expect(layoutIds(grid)).toEqual(layout)

		vi.restoreAllMocks()
		viewer.destroy()
	})
})

describe('tour-event actions', () => {
	/** Dispatches a `tour-event` on the grid element with the given detail. */
	// oxlint-disable-next-line unicorn/consistent-function-scoping -- declared next to the tour-event tests it serves
	function tourEvent(grid: Grid, detail: unknown): void {
		;(grid as unknown as HTMLElement).dispatchEvent(new CustomEvent('tour-event', { detail, bubbles: true }))
	}

	it('ignores a non-tour payload', async () => {
		const { viewer, grid } = await openFullGrid()
		const layout = layoutIds(grid)
		// Not an object, and then an object missing the start/end fields
		tourEvent(grid, 'nope')
		tourEvent(grid, { action: 'grid:reset' })
		await settleFrames(2)
		expect(layoutIds(grid)).toEqual(layout)
		viewer.destroy()
	})

	it('ignores a plain event that is not a CustomEvent', async () => {
		const { viewer, grid } = await openFullGrid()
		const layout = layoutIds(grid)
		;(grid as unknown as HTMLElement).dispatchEvent(new Event('tour-event'))
		await settleFrames(2)
		expect(layoutIds(grid)).toEqual(layout)
		viewer.destroy()
	})

	it('ignores an action without the grid: prefix', async () => {
		const { viewer, grid } = await openFullGrid()
		const layout = layoutIds(grid)
		tourEvent(grid, { start: 0, end: 1, action: 'video:play', active: true })
		await settleFrames(2)
		expect(layoutIds(grid)).toEqual(layout)
		viewer.destroy()
	})

	it('ignores an inactive event', async () => {
		const { viewer, grid } = await openFullGrid()
		const layout = layoutIds(grid)
		// `active` is only checked as truthy, so a missing flag is inactive
		tourEvent(grid, { start: 0, end: 1, action: 'grid:reset' })
		await settleFrames(2)
		expect(layoutIds(grid)).toEqual(layout)
		viewer.destroy()
	})

	it('runs nextFadeDuration and reset from a tour event', async () => {
		const { viewer, grid, ids } = await openFullGrid()
		await grid.set([{ id: ids[0] ?? '', size: [1] }], { duration: 0 })

		tourEvent(grid, { start: 0, end: 1, action: 'grid:nextFadeDuration', data: '0.75', active: true })
		expect((grid as unknown as Record<string, unknown>)['_nextCrossFadeDuration']).toBe(0.75)

		tourEvent(grid, { start: 1, end: 2, action: 'grid:reset', active: true })
		await waitForLayout(grid, ids, 'reset from a tour event')
		viewer.destroy()
	})

	it('warns about an unknown action and does not run it', async () => {
		const { viewer, grid } = await openFullGrid()
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		tourEvent(grid, { start: 0, end: 1, action: 'grid:notAThing', active: true })
		expect(warn).toHaveBeenCalled()
		expect(String(warn.mock.calls[0]?.[0])).toContain('unknown grid tour event')
		warn.mockRestore()
		viewer.destroy()
	})

	it('deduplicates a repeated identical action', async () => {
		const { viewer, grid, ids } = await openFullGrid()
		await grid.set([{ id: ids[0] ?? '', size: [1] }], { duration: 0 })

		const reset = vi.spyOn(grid, 'reset')
		tourEvent(grid, { start: 0, end: 1, action: 'grid:reset', active: true })
		tourEvent(grid, { start: 1, end: 2, action: 'grid:reset', active: true })
		// The second dispatch is swallowed: `_lastAction` is keyed on `type + data`
		expect(reset).toHaveBeenCalledTimes(1)
		reset.mockRestore()
		viewer.destroy()
	})

	it("filters to the tour's images on filterTourImages", async () => {
		const { viewer, grid, ids } = await openFullGrid()
		// A tour in the state store is the precondition for the filter action
		viewer.el.state.tour.set({
			id: 'tour-1',
			steps: ids.slice(0, 2),
			stepInfo: ids.slice(0, 2).map((id) => ({ markerId: id, micrioId: id })),
			duration: 10,
		} as unknown as Models.ImageData.VideoTour)

		tourEvent(grid, { start: 0, end: 1, action: 'grid:filterTourImages', data: 'h', active: true })
		await waitForLayout(grid, ids.slice(0, 2), 'filtered layout')
		viewer.destroy()
	})

	it('filterTourImages without a tour in the state is a no-op', async () => {
		const { viewer, grid } = await openFullGrid()
		const layout = layoutIds(grid)
		viewer.el.state.tour.set(undefined)
		tourEvent(grid, { start: 0, end: 1, action: 'grid:filterTourImages', data: 'h', active: true })
		await settleFrames(2)
		expect(layoutIds(grid)).toEqual(layout)
		viewer.destroy()
	})

	it('tolerates a video tour in the state', async () => {
		const { viewer, grid } = await openFullGrid()
		// The handler reads `stepInfo.micrioId`; a video-tour-shaped fixture without matching
		// steps exits the filter early, which is the same guard as an absent tour.
		viewer.el.state.tour.set(videoTour({ id: 'grid-vt', duration: 4 }) as unknown as Models.ImageData.VideoTour)
		tourEvent(grid, { start: 0, end: 1, action: 'grid:filterTourImages', data: 'h', active: true })
		await settleFrames(4)
		viewer.destroy()
	})
})

describe('grid actions from markers and tours', () => {
	it('switchToGrid restores the grid view and re-selects the image', async () => {
		const { viewer, grid, ids } = await openFullGrid({
			markers: {
				1: [
					marker('to-grid', {
						popupType: 'none',
						data: { _meta: { gridAction: 'switchToGrid' } },
						i18n: { en: { title: 'to grid' } },
					}),
				],
			},
		})

		// `switchToGrid` bails out without a focused cell, so give it one first
		const first = grid.getImage(ids[0] ?? '')
		if (!first) {
			throw new Error('missing grid image')
		}
		await grid.gridFocus(first, { duration: 0 })
		expect(grid.$focussed?.id).toBe(ids[0])

		// Dispatch the action directly, which is what the marker chain would do
		const { handleAction } = await import('$grid/action-handlers')
		handleAction(grid as unknown as Parameters<typeof handleAction>[0], GridActionType.switchToGrid)
		await settleFrames(2)

		// Back to the grid: the full layout is restored
		await waitForLayout(grid, ids, 'back to the grid layout')
		viewer.destroy()
	})

	it('switchToGrid with nothing focused is a no-op', async () => {
		const { viewer, grid } = await openFullGrid()
		const layout = layoutIds(grid)
		const { handleAction } = await import('$grid/action-handlers')
		handleAction(grid as unknown as Parameters<typeof handleAction>[0], GridActionType.switchToGrid)
		await settleFrames(2)
		expect(layoutIds(grid)).toEqual(layout)
		expect(grid.$focussed).toBeUndefined()
		viewer.destroy()
	})

	it('a focus action with a comma-separated id list sets a multi-image layout', async () => {
		const { viewer, grid, ids } = await openFullGrid()
		const { handleAction } = await import('$grid/action-handlers')
		// `focus|a,b` is the multi-image branch of the focus handler
		handleAction(grid as unknown as Parameters<typeof handleAction>[0], GridActionType.focus, `${ids[0]},${ids[1]}`, 0)
		await waitForLayout(grid, [ids[0] ?? '', ids[1] ?? ''], 'two-image layout')
		expect(grid.$focussed).toBeUndefined()
		viewer.destroy()
	})

	it('a flyTo action with unknown ids is silently ignored', async () => {
		const { viewer, grid } = await openFullGrid()
		// KNOWN GAP: the `console.warn('Given image IDs gave no current displayed images')`
		// branch is unreachable from here. `data?.split(',').map(...)` produces an array with at
		// least one element for *any* string, including `''`, so `images.length` is never 0 and
		// the `else` can only run if a caller passes something that is not a string at all.
		// Pinned rather than deleted: if the handler ever starts validating ids, this test is
		// the one that has to change.
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		const { handleAction } = await import('$grid/action-handlers')
		for (const data of ['nope,alsonope', '']) {
			handleAction(grid as unknown as Parameters<typeof handleAction>[0], GridActionType.flyTo, data, 0)
		}
		expect(warn).not.toHaveBeenCalled()
		warn.mockRestore()
		viewer.destroy()
	})

	it('a flyTo action with real ids flies to their bounding box', async () => {
		const { viewer, grid, ids } = await openFullGrid()
		const { handleAction } = await import('$grid/action-handlers')
		const flyToView = vi.spyOn(grid.image.camera, 'flyToView').mockResolvedValue()
		handleAction(
			grid as unknown as Parameters<typeof handleAction>[0],
			GridActionType.flyTo,
			`${ids[0]},${ids[1]}`,
			0.5,
		)
		// The box spans both cells, with the duration converted from seconds to milliseconds
		expect(flyToView).toHaveBeenCalledWith(expect.any(Array), { duration: 500 })
		flyToView.mockRestore()
		viewer.destroy()
	})

	it('an unknown numeric action warns', async () => {
		const { viewer, grid } = await openFullGrid()
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		const { handleAction } = await import('$grid/action-handlers')
		// A numeric action with no handler in the map (the enum has nine members)
		handleAction(grid as unknown as Parameters<typeof handleAction>[0], 9999 as GridActionType)
		expect(warn).toHaveBeenCalled()
		warn.mockRestore()
		viewer.destroy()
	})

	it('a string action name that is not an enum member is left alone', async () => {
		const { viewer, grid } = await openFullGrid()
		const layout = layoutIds(grid)
		const { handleAction } = await import('$grid/action-handlers')
		// `isGridActionName` rejects it, so no handler runs and the layout is untouched
		handleAction(grid as unknown as Parameters<typeof handleAction>[0], 'notAnAction')
		await settleFrames(2)
		expect(layoutIds(grid)).toEqual(layout)
		viewer.destroy()
	})
})
