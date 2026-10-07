import { afterEach, describe, expect, it } from 'vitest'
import { openGrid, restoreArchiveXhr } from '../../fixtures/grid'
import type { gridFixture } from '../../fixtures/grid'
import { cellButton, cellButtons, focusCell, layoutIds, settleFrames } from '../../helpers/grid'
import { waitFor } from '../../helpers/viewer'
import type { HTMLMicrioElement } from '$core/element'
import type { Models } from '$types/models'

/**
 * Focus: the single-image view inside a grid, its transitions and the two ways of leaving it.
 *
 * The interesting part of `gridFocus` is that it is a *transition into a layout of one image*:
 * the settled state is deliberately narrow (the cell fills the viewport), and almost everything
 * that can be observed is the side-effect list — `$focussed`, the switched `$current`, the
 * `grid-focus` / `grid-blur` events, the close button, the cell buttons' `focussed` class.
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

/** The close button `_onMount` appends while an image is focussed. */
const closeButton = (el: HTMLElement) => el.querySelector('micrio-button.close')

/** Records the events the controller dispatches on the element, with their details. */
function record(micrio: HTMLMicrioElement, types: string[]) {
	const seen: { type: string; detail: unknown }[] = []
	const handlers = types.map((type) => {
		const fn = (e: Event) => seen.push({ type, detail: (e as CustomEvent).detail })
		micrio.addEventListener(type, fn)
		return [type, fn] as const
	})
	return {
		seen,
		stop: () => {
			for (const [type, fn] of handlers) {
				micrio.removeEventListener(type, fn)
			}
		},
	}
}

describe('grid focus', () => {
	it('focuses one image, switches the current image and announces it', async () => {
		const { viewer, grid, ids } = await openGrid(fast())
		const rec = record(viewer.el, ['grid-focus'])

		await focusCell(grid, ids[1] ?? '')
		rec.stop()

		expect(grid.$focussed?.id).toBe(ids[1])
		expect(viewer.el.$current?.id).toBe(ids[1])
		expect(rec.seen.map((e) => e.type)).toEqual(['grid-focus'])
		expect((rec.seen[0]?.detail as { id?: string } | undefined)?.id).toBe(ids[1])
		// A focus is a layout of exactly that one image
		expect(layoutIds(grid)).toEqual([ids[1]])
		viewer.destroy()
	})

	it('blurs to the overview, clearing the current image and the close button', async () => {
		// `back()` first, so there *is* an overview on the history stack. `blur()` on its own
		// only drops the focus (it does not re-lay-out); a focus taken straight from the initial
		// layout has no history entry, so `back()` is what reprints the grid.
		const { viewer, grid, ids } = await openGrid(fast())
		await grid.set(
			ids.map((id) => ({ id, size: [1] as [number, number?] })),
			{ duration: 0, transition: 'crossfade' },
		)
		await focusCell(grid, ids[0] ?? '')
		expect(closeButton(grid)).not.toBeNull()
		expect(grid.$focussed?.id).toBe(ids[0])

		const rec = record(viewer.el, ['grid-blur'])
		grid.blur()
		rec.stop()

		expect(grid.$focussed).toBeUndefined()
		expect(rec.seen.map((e) => e.type)).toEqual(['grid-blur'])
		// The current image falls back to the grid viewport, not the last cell
		expect(viewer.el.$current?.id).toBe('')
		await waitFor(() => closeButton(grid) === null, 2000, 'close button removed')

		// The layout itself comes back through `back()`, which is the other half of the pair
		await grid.back(0.1)
		expect(layoutIds(grid)).toHaveLength(ids.length)
		viewer.destroy()
	})

	it('blur() without a focus is a no-op and does not dispatch', async () => {
		const { viewer, grid } = await openGrid(fast())
		const rec = record(viewer.el, ['grid-blur'])
		grid.blur()
		rec.stop()
		expect(rec.seen).toEqual([])
		viewer.destroy()
	})

	it('ignores a second focus on the already-focussed image', async () => {
		const { viewer, grid, ids } = await openGrid(fast())
		await focusCell(grid, ids[0] ?? '')
		const rec = record(viewer.el, ['grid-focus'])

		// `gridFocus` early-returns for the image it is already on
		await grid.gridFocus(grid.getImage(ids[0] ?? ''))
		expect(rec.seen).toEqual([])
		rec.stop()
		viewer.destroy()
	})

	it('routes gridFocus(undefined) to back()', async () => {
		const { viewer, grid, ids } = await openGrid(fast())
		await focusCell(grid, ids[2] ?? '')
		// oxlint-disable-next-line unicorn/no-useless-undefined -- passing nothing is the case under test: `gridFocus(undefined)` must delegate to `back()`
		await grid.gridFocus(undefined)
		expect(grid.$focussed).toBeUndefined()
		expect(layoutIds(grid)).toHaveLength(ids.length)
		viewer.destroy()
	})
})

describe('grid focus transitions', () => {
	const TRANSITIONS: Models.Grid.MarkerFocusTransition[] = [
		'crossfade',
		'slide-up',
		'slide-down',
		'slide-left',
		'slide-right',
		'slide',
		'swipe',
		'behind',
		'behind-left',
	]

	it.each(TRANSITIONS)('settles on the single image with %s', async (transition) => {
		const { viewer, grid, ids } = await openGrid(fast())
		await focusCell(grid, ids[1] ?? '', { duration: 0, transition })
		await settleFrames(4)

		expect(grid.$focussed?.id).toBe(ids[1])
		expect(layoutIds(grid)).toEqual([ids[1]])
		viewer.destroy()
	})

	it('lays out the outgoing image beside the incoming one during a swipe', async () => {
		// A swipe is the one focus transition that puts *two* images in the layout: the outgoing
		// one with an exit area and the incoming one full-screen. It only does so when there is
		// an outgoing *focussed* image — the very first focus has nothing to swipe away, which
		// is the boundary this test pins.
		const { viewer, grid, ids } = await openGrid(fast())
		const layouts: (string | undefined)[][] = []
		viewer.el.addEventListener('grid-layout-set', () => layouts.push(layoutIds(grid)))

		await focusCell(grid, ids[0] ?? '', { duration: 0.2, transition: 'swipe-left' })
		// The first focus has no outgoing image, so it stays a single-image layout
		expect(layouts.every((l) => l.length === 1)).toBe(true)

		layouts.length = 0
		// A non-zero duration keeps `gridFocus` on the transition path, which is where the
		// outgoing image is placed with an exit area
		await focusCell(grid, ids[1] ?? '', { duration: 0.2, transition: 'swipe-left' })
		await settleFrames(6)

		expect(layouts.some((l) => l.length === 2 && l.includes(ids[0] ?? '') && l.includes(ids[1] ?? ''))).toBe(true)
		// The transient layout is what `set` keeps: `gridFocus` hands the swipe's exit+entry pair
		// to `set`, and the exiting image is only faded out, not dropped from the layout.
		expect(layoutIds(grid)).toEqual([ids[0], ids[1]])
		viewer.destroy()
	})

	it('hands an explicit view to the target camera', async () => {
		// A cell's camera has no readable view in this fixture (it is placed by the engine, whose
		// views only become meaningful after a real render), so the contract asserted here is
		// the hand-off itself: the target camera is animated to the requested view.
		const { viewer, grid, ids } = await openGrid(fast())
		const target = grid.getImage(ids[0] ?? '')
		if (!target) {
			throw new Error('no cell image')
		}
		const view: Models.Camera.View = [0.25, 0.25, 0.5, 0.5]
		const calls: Models.Camera.View[] = []
		const original = target.camera.flyToView.bind(target.camera)
		target.camera.flyToView = (v: Models.Camera.View, o?: Models.Camera.AnimationOptions) => {
			calls.push(v)
			return original(v, o)
		}

		await focusCell(grid, ids[0] ?? '', { duration: 0, view, noViewAni: true })
		expect(calls.some((v) => v[0] === view[0] && v[1] === view[1] && v[2] === view[2] && v[3] === view[3])).toBe(true)
		viewer.destroy()
	})
})

describe('grid cell interaction', () => {
	it('focuses the clicked cell when clickable is focus', async () => {
		const { viewer, grid, ids } = await openGrid(fast({ grid: { clickable: 'focus' } }))
		const cell = cellButton(grid, ids[1] ?? '')
		if (!cell) {
			throw new Error('no cell button')
		}
		cell.click()
		await waitFor(() => grid.$focussed?.id === ids[1], 4000, 'cell focus')
		expect(cell.classList.contains('focussed')).toBe(true)
		viewer.destroy()
	})

	it('does not focus but zooms the viewport when clickable is zoom', async () => {
		const { viewer, grid, ids } = await openGrid(fast({ grid: { clickable: 'zoom' } }))
		const cell = cellButton(grid, ids[0] ?? '')
		if (!cell) {
			throw new Error('no cell button')
		}
		const before = grid.image.camera.getView()
		cell.click()
		await settleFrames(6)

		// `zoom` is the viewport camera moving to the cell, not a single-image focus
		expect(grid.$focussed).toBeUndefined()
		expect(grid.image.camera.getView()).not.toEqual(before)
		expect(cell.classList.contains('focussed')).toBe(true)
		viewer.destroy()
	})

	it('ignores cell clicks on a non-clickable grid', async () => {
		const { viewer, grid, ids } = await openGrid(fast({ grid: { clickable: false } }))
		const cell = cellButton(grid, ids[0] ?? '')
		expect(cell).toBeDefined()
		cell?.click()
		await settleFrames(3)
		expect(grid.$focussed).toBeUndefined()
		viewer.destroy()
	})

	it('moves the arrow keys through adjacent cells and Escape leaves the grid', async () => {
		const { viewer, grid, ids } = await openGrid(
			fast({ grid: { clickable: 'focus', panZoom: 'grid' }, settings: { hookKeys: true } }),
		)
		const buttons = cellButtons(grid)
		expect(buttons.length).toBe(ids.length)
		buttons[0]?.focus()

		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
		await settleFrames(2)
		const focusedId = (grid.querySelector(':focus') as HTMLElement | null)?.dataset.id
		expect(focusedId).toBe(ids[1])

		// Escape with nothing focussed and a zoomed-out camera does nothing
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
		await settleFrames(2)
		expect(grid.$focussed).toBeUndefined()

		// Focus an image, then Escape goes back to the overview
		await focusCell(grid, ids[0] ?? '')
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
		await waitFor(() => grid.$focussed === undefined, 4000, 'escape blur')
		viewer.destroy()
	})
})
