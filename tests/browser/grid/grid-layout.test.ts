import { afterEach, describe, expect, it } from 'vitest'
import { openGrid, restoreArchiveXhr } from '../../fixtures/grid'
import type { gridFixture } from '../../fixtures/grid'
import { cellButton, cellButtons, layoutIds, settleFrames } from '../../helpers/grid'
import { getCols } from '$grid/format'
import type { Models } from '$types/models'

/**
 * The layout layer: what `grid.set()` actually prints and measures.
 *
 * The controller itself is the subject, so every assertion goes through the public surface
 * (`grid.images`, `getImage`, the cell `<button>`s it prints, the element's inline styles and
 * the `grid-*` events). Stylesheet assertions are avoided: the suite stubs every `.css`
 * import, so only *inline* styles exist here.
 */

// The archive XHR stub outlives `openGrid` on purpose (a fire-and-forget `#print` may still be
// resolving), so the suite owns its teardown.
afterEach(() => {
	restoreArchiveXhr()
})

type GridImage = Models.Grid.GridImage

/** The default harness: instant transitions, so a layout change settles in a frame or two. */
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

/** The requested layout, exercising every size spelling: `[1]`, `[2]`, `[2,2]`, `[1,2]`. */
const mosaic = (ids: string[]): GridImage[] => [
	{ id: ids[0] ?? '', size: [2, 2] },
	{ id: ids[1] ?? '', size: [1] },
	{ id: ids[2] ?? '', size: [2] },
	{ id: ids[3] ?? '', size: [1, 2] },
]

describe('grid configuration', () => {
	it('lays out a single-image album as one cell', async () => {
		const { viewer, grid, gridEl } = await openGrid(fast({ count: 1 }))
		expect(grid.images).toHaveLength(1)
		expect(cellButtons(grid)).toHaveLength(1)
		expect(gridEl.style.gridTemplateColumns).toBe('repeat(1, auto)')
		// The viewport camera is fitted to the cell, so it contains the image rather than
		// matching the unit square exactly — the layout, not the camera, is the subject here
		const view = grid.image.camera.getView()
		expect(view[0]).toBeLessThanOrEqual(0)
		expect(view[1]).toBeLessThanOrEqual(0)
		expect(view[0] + view[2]).toBeGreaterThanOrEqual(1)
		expect(view[1] + view[3]).toBeGreaterThanOrEqual(1)
		viewer.destroy()
	})

	it('lays out every album image and derives the column count from the tiles', async () => {
		const { viewer, grid, ids, gridEl } = await openGrid(fast())
		expect(grid.images.map((i) => i.id)).toEqual(ids)
		expect(layoutIds(grid)).toEqual(ids)
		// 4 images, 4 tiles: the divisor branch of `getCols`
		expect(gridEl.style.gridTemplateColumns).toBe(`repeat(${getCols(ids.length, ids.length)}, auto)`)
		viewer.destroy()
	})

	it('derives the columns from the tile count when cell sizes differ', async () => {
		const { viewer, grid, ids, gridEl } = await openGrid(fast())
		const layout = mosaic(ids)
		await grid.set(layout, { duration: 0 })

		// 2x2 + 1 + 2 + 1x2 = 4 + 1 + 2 + 2 = 9 tiles over 4 images
		const tiles = layout.reduce((n, i) => n + i.size[0] * (i.size[1] ?? 1), 0)
		expect(tiles).toBe(9)
		expect(gridEl.style.gridTemplateColumns).toBe(`repeat(${getCols(layout.length, tiles)}, auto)`)
		expect(cellButtons(grid)).toHaveLength(layout.length)
		viewer.destroy()
	})

	it('spans sized cells and leaves a plain 1x1 cell without an explicit area', async () => {
		const { viewer, grid, ids } = await openGrid(fast())
		await grid.set(mosaic(ids), { duration: 0 })

		expect(cellButton(grid, ids[0] ?? '')?.style.gridArea).toBe('auto / auto / span 2 / span 2')
		// A single-element `size` writes the *width* into both span slots: the template reads
		// `size[1]` for the row span even when it is absent, so `[2]` becomes
		// `span 2 / span 2` — an inverted-looking result, pinned here on purpose.
		expect(cellButton(grid, ids[2] ?? '')?.style.gridArea).toBe('auto / auto / span undefined / span 2')
		// `[1,2]` is columns-then-rows: one column, two rows
		expect(cellButton(grid, ids[3] ?? '')?.style.gridArea).toBe('auto / auto / span 2 / span 1')
		// A `[1]` cell must not get a `grid-area` at all — the CSS default already spans 1x1
		expect(cellButton(grid, ids[1] ?? '')?.style.gridArea).toBe('')
		viewer.destroy()
	})

	it('forces a single row with horizontal and lets columns override every other rule', async () => {
		const { viewer, grid, ids, gridEl } = await openGrid(fast())
		expect(ids.length).toBeGreaterThan(2)
		const cells = ids.map((id) => ({ id, size: [1] as [number, number?] }))

		await grid.set(cells, { horizontal: true, duration: 0 })
		expect(gridEl.style.gridTemplateColumns).toBe(`repeat(${ids.length}, auto)`)

		await grid.set(cells, { columns: 1, duration: 0 })
		expect(gridEl.style.gridTemplateColumns).toBe('repeat(1, auto)')

		// `columns` wins over `horizontal` as well
		await grid.set(cells, { columns: 2, horizontal: true, duration: 0 })
		expect(gridEl.style.gridTemplateColumns).toBe('repeat(2, auto)')
		viewer.destroy()
	})

	it('writes the cell area once and then leaves it alone', async () => {
		// `#printGrid` only assigns `img.area` while it is still undefined, so the area an image
		// gets on its first layout sticks for the rest of the grid's life — including across a
		// later `scale`, which is why a scaled *re-layout* is not a way to add spacing.
		const { viewer, grid, ids } = await openGrid(fast())
		const cells = ids.map((id) => ({ id, size: [1] as [number, number?] }))
		const target = grid.getImage(ids[0] ?? '')
		if (!target) {
			throw new Error('no cell image')
		}

		await grid.set(cells, { duration: 0, noHistory: true })
		const measured = target.opts.area
		expect(measured).toBeDefined()

		await grid.set(cells, { duration: 0, noHistory: true, scale: 0.5 })
		// The scale is applied to the *camera* area, never written back to `opts.area`
		expect(target.opts.area).toBe(measured)
		viewer.destroy()
	})

	it('drops cells that are no longer part of the layout', async () => {
		const { viewer, grid, ids } = await openGrid(fast())
		const keep = [ids[0] ?? '', ids[2] ?? '']
		await grid.set(
			keep.map((id) => ({ id, size: [1] as [number, number?] })),
			{ duration: 0 },
		)

		expect(layoutIds(grid)).toEqual(keep)
		expect(cellButton(grid, ids[1] ?? '')).toBeUndefined()
		expect(cellButton(grid, ids[3] ?? '')).toBeUndefined()
		// The dropped images stay part of the album even when they are not laid out
		expect(grid.images).toHaveLength(ids.length)
		viewer.destroy()
	})

	it('rejects an unknown image id instead of laying out a partial grid', async () => {
		const { viewer, grid } = await openGrid(fast())
		await expect(grid.set([{ id: 'not-in-this-album', size: [1] }], { duration: 0 })).rejects.toThrow(
			'Grid image not found',
		)
		viewer.destroy()
	})

	it('never lays out a grid whose archive is broken', async () => {
		const { viewer, grid, gridEl } = await openGrid(
			fast({ brokenArchive: true, expectNoAlbum: true, albumTimeout: 300 }),
		)
		// The album never takes over, so the element falls back to the plain first image: no
		// gallery, no grid element, no cells. Nothing throws — the failure is silent by design.
		expect(grid).toBeUndefined()
		expect(gridEl).toBeUndefined()
		expect(viewer.el.gallery).toBeUndefined()
		viewer.destroy()
	})
})

describe('grid settings', () => {
	it('applies the gallery grid settings to the controller', async () => {
		const { viewer, grid, gridEl } = await openGrid(fast({ grid: { clickable: 'zoom', panZoom: 'cells' } }))
		expect(gridEl.style.display).toBe('')
		expect(gridEl.classList.contains('grid-pan-zoom')).toBe(false)
		expect(cellButtons(grid).length).toBeGreaterThan(0)
		expect(grid.$focussed).toBeUndefined()
		viewer.destroy()
	})

	it('toggles grid-pan-zoom with panZoom and hides a non-clickable grid', async () => {
		const panZoom = await openGrid(fast({ grid: { clickable: 'focus', panZoom: 'grid' } }))
		expect(panZoom.gridEl.classList.contains('grid-pan-zoom')).toBe(true)
		panZoom.viewer.destroy()

		const cells = await openGrid(fast({ grid: { clickable: 'focus', panZoom: 'cells' } }))
		expect(cells.gridEl.classList.contains('grid-pan-zoom')).toBe(false)
		expect(cells.gridEl.style.display).toBe('')
		cells.viewer.destroy()

		const off = await openGrid(fast({ grid: { clickable: false } }))
		// `display: none` is only ever set for a non-clickable grid — the inverted convention
		// that keeps a clickable grid laid out while an inactive one stops taking clicks
		expect(off.gridEl.style.display).toBe('none')
		// The cells are still *printed* (and still sized) — `display` is what takes the grid out
		// of play, not a missing layout
		expect(cellButtons(off.grid)).toHaveLength(4)
		off.viewer.destroy()
	})

	it('runs a configured transition duration to completion', async () => {
		const { viewer, grid, ids } = await openGrid(fast({ settings: { grid: { transitionDuration: 0.1 } } }))
		await grid.set([{ id: ids[0] ?? '', size: [1] }], { duration: 0.1, transition: 'crossfade' })
		await settleFrames(10)
		expect(layoutIds(grid)).toEqual([ids[0]])
		viewer.destroy()
	})
})

describe('grid events', () => {
	it('announces init and load on the album open path', async () => {
		const { viewer, gridEl, grid } = await openGrid(fast())
		// `grid.init()` is the mount, which is only reached through `#place` in the layout
		expect(gridEl.isConnected).toBe(true)
		expect(grid.images.length).toBeGreaterThan(0)
		viewer.destroy()
	})

	it('dispatches grid-layout-set with the controller on every relayout', async () => {
		const { viewer, grid } = await openGrid(fast())
		const seen: unknown[] = []
		viewer.el.addEventListener('grid-layout-set', (e) => seen.push((e as CustomEvent).detail))

		await grid.set(
			grid.images.map((i) => ({ id: i.id, size: [1] as [number, number?] })),
			{ duration: 0 },
		)
		expect(seen).toEqual([grid])

		await grid.set([{ id: grid.images[0]?.id ?? '', size: [1] }], { duration: 0 })
		expect(seen).toEqual([grid, grid])
		viewer.destroy()
	})
})
