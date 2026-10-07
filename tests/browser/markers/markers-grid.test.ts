import { afterEach, describe, expect, it } from 'vitest'
import type { Models } from '$types/models'
import { marker } from '../../fixtures/bundles'
import { openGrid, restoreArchiveXhr } from '../../fixtures/grid'
import type { gridFixture } from '../../fixtures/grid'
import { focusCell } from '../../helpers/grid'
import { waitFor } from '../../helpers/viewer'

/**
 * `<micrio-markers>` on a grid cell.
 *
 * The layer drops its markers, waypoints and clickable-area embeds while the grid says the
 * cell is inactive (`$focussed !== image` and not in `_markersShown`). Reaching that state
 * offline needs a *hand-built visible cell*: the layout only mounts a layer for an image in
 * `micrio._visible`, and a cell never gets there on its own because its canvas keeps a
 * zero-size visible rect (see `helpers/grid.ts`). One `cell.visible.set(true)` is enough —
 * the image's own `visible` subscription is what fills `micrio._visible`.
 *
 * Three fixture rules matter here:
 *
 * - **`fast()` (a zero transition duration) is mandatory.** `Grid.set()` only places its cells
 *   synchronously when its duration resolves to 0; `openGrid` waits for `grid.images`, not for
 *   placement.
 * - **Marker ids must be unique per call.** `MicrioElement._markerImages` is module-level and
 *   never cleared, so marker ids are derived from the fixture's fresh image ids.
 * - **Assert synchronously after the layer appears.** A later frame can revoke the cell's
 *   visibility (and with it the layer), whereas every store write below rebuilds in place.
 */

afterEach(() => {
	restoreArchiveXhr()
})

/** The grid suites' standard harness: clickable, instant transitions. */
const fast = (opts: Parameters<typeof gridFixture>[0] = {}) => ({
	...opts,
	grid: { clickable: 'focus' as const, ...opts.grid },
	settings: { ...opts.settings, grid: { transitionDuration: 0, ...(opts.settings?.grid as object) } },
})

/** A clickable-area embed that opens its own marker. */
const clickableArea = (id: string) =>
	marker(id, {
		clickableArea: {
			area: [0.1, 0.1, 0.2, 0.2],
			clickAction: 'markerId',
			clickTarget: id,
		} as Models.ImageData.Embed,
	})

describe('markers — grid inactive cells', () => {
	it('drops the markers and clickable areas of a non-focused cell, and restores them on focus', async () => {
		const { viewer, grid, ids } = await openGrid(
			fast({
				count: 2,
				// Only the first cell carries a marker, so exactly one layer is ever mounted
				withIds: (all) => ({ 0: [clickableArea(`area-${all[0]}`)] }),
			}),
		)

		const cell = grid.getImage(ids[0] ?? '')
		if (!cell) {
			throw new Error('no grid cell')
		}
		// `fast()` placed it; nothing has focused it, and `_markersShown` is always empty
		expect(cell._placed).toBe(true)
		expect(grid.$focussed).toBeUndefined()

		// Hand-built visible cell: this is the one step a real grid gets for free
		cell.visible.set(true)
		await waitFor(() => viewer.el.querySelector('micrio-markers') !== null, 4000, 'the marker layer')
		const layer = viewer.el.querySelector<HTMLElement>('micrio-markers')
		if (!layer) {
			throw new Error('no marker layer')
		}

		expect(layer.classList.contains('inactive')).toBe(true)
		expect(layer.querySelectorAll(':scope > micrio-marker')).toHaveLength(0)
		expect(layer.querySelectorAll(':scope > micrio-embed[data-marker-id]')).toHaveLength(0)

		// Focusing the cell is what re-activates the layer (the `_focussed` write rebuilds)
		await focusCell(grid, ids[0] ?? '')
		expect(grid.$focussed?.id).toBe(ids[0])
		expect(layer.classList.contains('inactive')).toBe(false)
		expect(layer.querySelectorAll(':scope > micrio-marker')).toHaveLength(1)
		expect(layer.querySelectorAll(':scope > micrio-embed[data-marker-id]')).toHaveLength(1)

		// Blurring it drops both again, in the same synchronous rebuild
		grid.blur()
		expect(layer.classList.contains('inactive')).toBe(true)
		expect(layer.querySelectorAll(':scope > micrio-marker')).toHaveLength(0)
		expect(layer.querySelectorAll(':scope > micrio-embed[data-marker-id]')).toHaveLength(0)

		viewer.destroy()
	})
})
