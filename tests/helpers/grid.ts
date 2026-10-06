import type { Grid } from '../../src/grid/grid'
import type { Models } from '../../src/types/models'
import type { HTMLMicrioElement } from '../../src/core/element'
import { afterFrame } from '../../src/utils/dom'
import { waitFor } from './viewer'

/**
 * Helpers for the grid suites.
 *
 * Everything here goes through the *public* surface (`grid.image`, `grid.images`,
 * `getImage`, the cell `<button>`s the controller prints) so the assertions stay
 * minification-safe and do not restate the implementation.
 */

/** The `<button>` cells the grid currently prints, in layout order. */
export function cellButtons(grid: Grid): HTMLButtonElement[] {
	return [...(grid as unknown as HTMLElement).querySelectorAll<HTMLButtonElement>('button[data-id]')]
}

/** The cell `<button>` for one image id, if that image is in the current layout. */
export function cellButton(grid: Grid, id: string): HTMLButtonElement | undefined {
	return cellButtons(grid).find((b) => b.dataset.id === id)
}

/** The ids of the current layout, in order. */
export function layoutIds(grid: Grid): (string | undefined)[] {
	return cellButtons(grid).map((b) => b.dataset.id)
}

/**
 * Focuses one grid cell and waits for the controller to report it.
 *
 * `gridFocus` resolves once its own `set()` settles, but the `grid-focus` dispatch and the
 * `$focussed` write happen after that, so the wait is on the store, not the promise.
 */
export async function focusCell(
	grid: Grid,
	id: string,
	opts: Models.Grid.FocusOptions = { duration: 0 },
): Promise<void> {
	const img = grid.getImage(id)
	if (!img) {
		throw new Error(`image ${id} is not part of the grid`)
	}
	await grid.gridFocus(img, opts)
	await waitFor(() => grid.$focussed?.id === id, 4000, `focused cell ${id}`)
}

/** Runs `fn` for the image that carries the given marker, waiting until its marker opens. */
export async function openMarker(micrio: HTMLMicrioElement, markerId: string): Promise<void> {
	const image = micrio.$current
	if (!image) {
		throw new Error('no current image')
	}
	image.state.marker.set(markerId)
	await waitFor(() => micrio.state.$marker?.id === markerId, 4000, `marker ${markerId}`)
}

/** Waits for the layout to be exactly the given ids, in order. */
export async function waitForLayout(grid: Grid, ids: string[], label = 'grid layout'): Promise<void> {
	await waitFor(
		() => {
			const current = layoutIds(grid)
			return current.length === ids.length && current.every((id, i) => id === ids[i])
		},
		4000,
		label,
	)
}

/** Waits until the grid element is no longer hidden by an active tour or marker. */
export async function waitForGridVisible(grid: Grid): Promise<void> {
	await waitFor(() => !(grid as unknown as HTMLElement).classList.contains('grid-cells-hidden'), 4000, 'grid visible')
}

/** Two animation frames, for the controller's one-frame deferrals (`tick`, `Frame.request`). */
export async function settleFrames(frames = 2): Promise<void> {
	await Promise.all(Array.from({ length: frames }, () => afterFrame()))
}
