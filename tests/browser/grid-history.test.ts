import { afterEach, describe, expect, it } from 'vitest'
import { openGrid, restoreArchiveXhr } from '../fixtures/grid'
import type { gridFixture } from '../fixtures/grid'
import { cellButton, cellButtons, focusCell, layoutIds, settleFrames } from '../helpers/grid'

/**
 * Layout history: what `back()` undoes, what `reset()` forgets and what `enlarge()` reads.
 *
 * The three are easy to confuse, and they disagree in two places that this suite pins down:
 * `back()` walks the stack while `reset()` jumps to the *opening* layout and empties it, and
 * `enlarge()` starts from the last history entry rather than from the current layout.
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

describe('grid history', () => {
	it('undoes a layout change with back()', async () => {
		const { viewer, grid, ids: all } = await openGrid(fast())
		const opening = layoutIds(grid)
		const row = [all[0] ?? '', all[3] ?? '']

		await grid.set(
			row.map((id) => ({ id, size: [1] as [number, number?] })),
			{ duration: 0 },
		)
		expect(layoutIds(grid)).toEqual(row)

		await grid.back(0.1)
		expect(layoutIds(grid)).toEqual(opening)
		viewer.destroy()
	})

	it('restores the horizontal flag of the entry it returns to', async () => {
		const { viewer, grid, ids: all, gridEl } = await openGrid(fast())
		const cells = all.map((id) => ({ id, size: [1] as [number, number?] }))

		await grid.set(cells, { duration: 0, horizontal: true })
		expect(gridEl.style.gridTemplateColumns).toBe(`repeat(${all.length}, auto)`)

		await grid.set(cells, { duration: 0, columns: 1 })
		expect(gridEl.style.gridTemplateColumns).toBe('repeat(1, auto)')

		// The entry saved before the column change carries `horizontal: true`
		await grid.back(0.1)
		expect(gridEl.style.gridTemplateColumns).toBe(`repeat(${all.length}, auto)`)
		viewer.destroy()
	})

	it('does not record a layout change when noHistory is set', async () => {
		const { viewer, grid, ids: all } = await openGrid(fast())
		const opening = layoutIds(grid)
		await grid.set([{ id: all[0] ?? '', size: [1] }], { duration: 0, noHistory: true })

		// Nothing to undo, so `back()` is a no-op and the layout stays filtered
		await grid.back(0.1)
		expect(layoutIds(grid)).toEqual([all[0]])
		expect(opening).toHaveLength(all.length)
		viewer.destroy()
	})

	it('makes back() on an empty stack a no-op', async () => {
		const { viewer, grid } = await openGrid(fast())
		const opening = layoutIds(grid)
		await grid.back(0.1)
		expect(layoutIds(grid)).toEqual(opening)
		viewer.destroy()
	})

	it('undoes a focus with back()', async () => {
		const { viewer, grid, ids: all } = await openGrid(fast())
		const opening = layoutIds(grid)

		await focusCell(grid, all[1] ?? '', { duration: 0 })
		expect(grid.$focussed?.id).toBe(all[1])

		await grid.back(0.1)
		await settleFrames(2)
		expect(grid.$focussed).toBeUndefined()
		expect(layoutIds(grid)).toEqual(opening)
		viewer.destroy()
	})

	it('walks back through several layout changes in order', async () => {
		const { viewer, grid, ids: all } = await openGrid(fast())
		const first = [all[0] ?? '', all[1] ?? '']
		const second = [all[2] ?? '', all[3] ?? '']

		await grid.set(
			first.map((id) => ({ id, size: [1] as [number, number?] })),
			{ duration: 0 },
		)
		await grid.set(
			second.map((id) => ({ id, size: [1] as [number, number?] })),
			{ duration: 0 },
		)
		expect(layoutIds(grid)).toEqual(second)

		await grid.back(0.1)
		expect(layoutIds(grid)).toEqual(first)

		await grid.back(0.1)
		expect(layoutIds(grid)).toEqual(all)
		viewer.destroy()
	})
})

describe('grid reset', () => {
	it('returns to the opening layout and clears the history', async () => {
		const { viewer, grid, ids: all } = await openGrid(fast())
		const opening = layoutIds(grid)

		await grid.set([{ id: all[0] ?? '', size: [1] }], { duration: 0 })
		await settleFrames(2)

		await grid.reset(0.1)
		await settleFrames(2)
		expect(layoutIds(grid)).toEqual(opening)
		// The reset dropped the filtered layout instead of pushing it
		await grid.back(0.1)
		expect(layoutIds(grid)).toEqual(opening)
		viewer.destroy()
	})

	it('switches the current image back to the grid viewport', async () => {
		const { viewer, grid, ids: all } = await openGrid(fast())
		await focusCell(grid, all[0] ?? '', { duration: 0 })
		expect(viewer.el.$current?.id).toBe(all[0])

		await grid.reset(0.1)
		await settleFrames(2)
		expect(viewer.el.$current?.id).toBe('')
		expect(grid.$focussed).toBeUndefined()
		viewer.destroy()
	})

	it('jumps to the opening layout, not the last entry, from a deeper stack', async () => {
		// The two differ: `back()` steps one entry, `reset()` returns to the root layout the
		// controller opened with.
		const { viewer, grid, ids: all } = await openGrid(fast())
		const opening = layoutIds(grid)
		const first = [all[0] ?? '']
		const second = [all[1] ?? '', all[2] ?? '']

		await grid.set(
			first.map((id) => ({ id, size: [1] as [number, number?] })),
			{ duration: 0 },
		)
		await grid.set(
			second.map((id) => ({ id, size: [1] as [number, number?] })),
			{ duration: 0 },
		)
		await grid.reset(0.1)
		await settleFrames(2)

		expect(layoutIds(grid)).toEqual(opening)
		viewer.destroy()
	})
})

describe('grid enlarge', () => {
	it('grows the indexed cell to the requested span', async () => {
		const { viewer, grid, ids: all } = await openGrid(fast())
		await grid.enlarge(1, 2, 2)
		await settleFrames(2)

		expect(cellButton(grid, all[1] ?? '')?.style.gridArea).toBe('auto / auto / span 2 / span 2')
		// The other cells keep their plain 1x1 span
		expect(cellButton(grid, all[0] ?? '')?.style.gridArea).toBe('')
		viewer.destroy()
	})

	it('reads the last history entry rather than the current layout', async () => {
		// `enlarge` rebuilds from `#history[len - 1]`, which is the layout that was current when
		// the most recent `set` pushed. So enlarging after a `set` grows the cell of the layout
		// *before* that set — a sharp edge, pinned here.
		const { viewer, grid, ids: all } = await openGrid(fast())
		const first = [all[0] ?? '', all[1] ?? '']

		await grid.set(
			first.map((id) => ({ id, size: [1] as [number, number?] })),
			{ duration: 0 },
		)
		// Second set: history now ends with `first`
		await grid.set(
			[all[2] ?? '', all[3] ?? ''].map((id) => ({ id, size: [1] as [number, number?] })),
			{ duration: 0 },
		)

		await grid.enlarge(0, 2, 2)
		await settleFrames(2)
		expect(layoutIds(grid)).toEqual(first)
		expect(cellButton(grid, all[0] ?? '')?.style.gridArea).toBe('auto / auto / span 2 / span 2')
		viewer.destroy()
	})

	it('records no history, so a later back() still steps the older entry', async () => {
		const { viewer, grid, ids: all } = await openGrid(fast())
		const opening = layoutIds(grid)
		const filtered = [all[0] ?? '']

		await grid.set(
			filtered.map((id) => ({ id, size: [1] as [number, number?] })),
			{ duration: 0 },
		)
		await grid.enlarge(0, 2, 2)
		await settleFrames(2)

		await grid.back(0.1)
		expect(layoutIds(grid)).toEqual(opening)
		viewer.destroy()
	})

	it('works from the album layout when the history is empty', async () => {
		const { viewer, grid, ids: all } = await openGrid(fast())
		await grid.enlarge(0, 2, 2)
		await settleFrames(2)
		expect(cellButtons(grid)).toHaveLength(all.length)
		expect(cellButton(grid, all[0] ?? '')?.style.gridArea).toBe('auto / auto / span 2 / span 2')
		viewer.destroy()
	})
})
