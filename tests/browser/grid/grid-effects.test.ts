import { afterEach, describe, expect, it } from 'vitest'
import { openGrid, restoreArchiveXhr } from '../../fixtures/grid'
import type { gridFixture } from '../../fixtures/grid'
import { cellButton, layoutIds, settleFrames } from '../../helpers/grid'
import { marker } from '../../fixtures/bundles'
import type { Viewer } from '../../helpers/viewer'
import { waitFor } from '../../helpers/viewer'
import type { Models } from '$types/models'

afterEach(() => {
	restoreArchiveXhr()
})

const fast = (opts: Parameters<typeof gridFixture>[0] = {}) => ({
	...opts,
	grid: { clickable: 'focus' as const, ...opts.grid },
	settings: { ...opts.settings, grid: { transitionDuration: 0, ...(opts.settings?.grid as object) } },
})

async function openMarker(viewer: Viewer, imageId: string, id: string): Promise<void> {
	const image = viewer.el.gallery?._images.find((i) => i.id === imageId)
	const found = image?.$data?.markers?.find((m) => m.id === id)
	if (!image || !found) {
		throw new Error(`no marker ${id} on ${imageId}`)
	}
	image.state.marker.set(found)
	await waitFor(() => viewer.el.state.$marker?.id === id, 3000, `marker ${id}`)
	await settleFrames(2)
}

describe('grid effects', () => {
	it('executes a named visual mosaic layout effect with spans and empty spacers', async () => {
		const { viewer, grid, ids } = await openGrid(fast())
		const effect: Models.Grid.GridEffect = {
			id: 'eff-mosaic',
			name: '2x2 side by side',
			steps: [
				{
					type: 'layout',
					cells: [
						{ id: ids[0], size: [2, 2] },
						{ empty: true, size: [1] },
						{ id: ids[1], size: [2, 2] },
					],
					arrangement: 'columns',
					columns: 5,
					duration: 0,
				},
			],
		}
		grid.setEffects([effect])
		await grid.runEffect('eff-mosaic')

		expect(layoutIds(grid)).toEqual([ids[0], ids[1]])
		expect(cellButton(grid, ids[0] ?? '')?.style.gridArea).toContain('span 2 / span 2')
		expect(grid.querySelectorAll('button.grid-empty').length).toBe(1)
		expect(grid.getLayout().length).toBe(3)
		viewer.destroy()
	})

	it('combines multi-tag filtering with include, exclude, prepend, and $current resize rules', async () => {
		const { viewer, grid, ids } = await openGrid(
			fast({
				markers: {
					0: [marker('m0', { tags: ['boats'], view: [0.1, 0.1, 0.4, 0.4], popupType: 'none' })],
					1: [marker('m1', { tags: ['boats', 'architecture'], view: [0.2, 0.2, 0.3, 0.3], popupType: 'none' })],
					2: [marker('m2', { tags: ['architecture'], view: [0.3, 0.3, 0.3, 0.3], popupType: 'none' })],
				},
			}),
		)

		const effect: Models.Grid.GridEffect = {
			id: 'eff-combined',
			name: 'Boats + Hero',
			steps: [
				{
					type: 'layout',
					source: { mode: 'tags', tags: ['boats'], match: 'any', zoomToMarker: true },
					rules: [
						{ target: ids[3] ?? '', include: true, position: 'prepend', size: [2, 2] },
						{ target: ids[0] ?? '', exclude: true },
					],
					duration: 0,
				},
			],
		}
		await grid.runEffect(effect)

		expect(layoutIds(grid)).toEqual([ids[3], ids[1]])
		expect(cellButton(grid, ids[3] ?? '')?.style.gridArea).toContain('span 2 / span 2')

		// match: 'all' narrows strictly to images having both tags
		await grid.runEffect({
			id: 'eff-all-tags',
			name: 'Both tags',
			steps: [
				{
					type: 'layout',
					source: { mode: 'tags', tags: ['boats', 'architecture'], match: 'all' },
					duration: 0,
				},
			],
		})
		expect(layoutIds(grid)).toEqual([ids[1]])
		viewer.destroy()
	})

	it('resizes $current even when invoked from single-image focus', async () => {
		const { viewer, grid, ids } = await openGrid(fast())
		const target = grid.getImage(ids[1] ?? '')
		expect(target).toBeDefined()
		await grid.gridFocus(target, { duration: 0 })
		expect(grid.$focussed?.id).toBe(ids[1])

		await grid.runEffect(
			{
				id: 'eff-resize',
				name: 'Enlarge current 2x2',
				steps: [{ type: 'resize', imageId: '$current', size: [2, 2], duration: 0 }],
			},
			{ sourceImageId: ids[1] },
		)

		expect(grid.$focussed).toBeUndefined()
		expect(layoutIds(grid).length).toBe(ids.length)
		expect(cellButton(grid, ids[1] ?? '')?.style.gridArea).toContain('span 2 / span 2')
		viewer.destroy()
	})

	it('triggers a named GridEffect via tour-event grid:effect', async () => {
		const { viewer, grid, ids } = await openGrid(fast())
		grid.setEffects([
			{
				id: 'eff-tour',
				name: 'Pair',
				steps: [
					{
						type: 'layout',
						cells: [
							{ id: ids[0], size: [1] },
							{ id: ids[2], size: [1] },
						],
						arrangement: 'row',
					},
				],
			},
		])

		viewer.el.dispatchEvent(
			new CustomEvent('tour-event', {
				detail: { start: 1, end: 1, action: 'grid:effect', data: 'eff-tour', active: true },
			}),
		)

		await waitFor(() => layoutIds(grid).length === 2, 4000, 'tour-event grid:effect')
		expect(layoutIds(grid)).toEqual([ids[0], ids[2]])
		viewer.destroy()
	})

	it('triggers marker.data.gridEffect on open, handles gridEffectOnClose, and respects editMode', async () => {
		const { viewer, grid, ids } = await openGrid(
			fast({
				withIds: (all) => ({
					0: [
						marker('m-eff', {
							popupType: 'none',
							data: {
								gridEffect: 'eff-marker',
								gridEffectOnClose: 'reset',
							},
						}),
						marker('m-inline', {
							popupType: 'none',
							data: {
								gridEffect: {
									id: 'inline-1',
									name: 'Focus #2',
									steps: [{ type: 'focus', imageId: all[2] ?? '', duration: 0 }],
								},
							},
						}),
					],
				}),
			}),
		)
		const opening = layoutIds(grid)
		grid.setEffects([
			{
				id: 'eff-marker',
				name: 'Two tiles',
				steps: [
					{
						type: 'layout',
						cells: [
							{ id: ids[0], size: [2, 2] },
							{ id: ids[1], size: [1] },
						],
						duration: 0,
					},
				],
			},
		])

		// In editMode, opening a marker does NOT execute gridEffect
		viewer.el.editMode.set(true)
		await openMarker(viewer, ids[0] ?? '', 'm-eff')
		await settleFrames(3)
		expect(layoutIds(grid)).toEqual(opening)
		viewer.el.state.marker.set(undefined)
		viewer.el.editMode.set(false)

		// In normal viewer mode, opening runs the named gridEffect
		await openMarker(viewer, ids[0] ?? '', 'm-eff')
		await waitFor(() => layoutIds(grid).length === 2, 4000, 'marker gridEffect')
		expect(layoutIds(grid)).toEqual([ids[0], ids[1]])

		// Closing the marker runs gridEffectOnClose: 'reset'
		viewer.el.state.marker.set(undefined)
		await waitFor(() => layoutIds(grid).length === opening.length, 4000, 'marker gridEffectOnClose reset')
		expect(layoutIds(grid)).toEqual(opening)

		// Inline marker effect focuses target image
		await openMarker(viewer, ids[0] ?? '', 'm-inline')
		await waitFor(() => grid.$focussed?.id === ids[2], 4000, 'inline marker gridEffect focus')
		viewer.destroy()
	})

	it('cancels an in-flight multi-step effect when superseded by reset()', async () => {
		const { viewer, grid, ids } = await openGrid(fast())
		const opening = layoutIds(grid)

		const pending = grid.runEffect({
			id: 'eff-cancel',
			name: 'Delayed focus',
			steps: [
				{ type: 'layout', cells: [{ id: ids[0], size: [1] }], duration: 0 },
				{ type: 'delay', seconds: 0.25 },
				{ type: 'focus', imageId: ids[2] ?? '', duration: 0 },
			],
		})

		await waitFor(() => layoutIds(grid).length === 1, 2000, 'first step applied')
		await grid.reset(0)
		await pending
		await settleFrames(4)

		expect(grid.$focussed).toBeUndefined()
		expect(layoutIds(grid)).toEqual(opening)
		viewer.destroy()
	})

	it('opens immediately on startEffectId without animating or delaying', async () => {
		const startEffect: Models.Grid.GridEffect = {
			id: 'eff-start',
			name: 'Hero Start',
			steps: [
				{ type: 'delay', seconds: 5 },
				{
					type: 'layout',
					source: { mode: 'all' },
					rules: [{ target: '$first', size: [2, 2] }],
					transition: 'behind-delayed',
					duration: 4,
				},
			],
		}
		const t0 = performance.now()
		const { viewer, grid, ids } = await openGrid({
			grid: { clickable: 'focus' },
			settings: {
				grid: {
					transitionDuration: 2,
					effects: [startEffect],
					startEffectId: 'eff-start',
				},
			},
		})
		await waitFor(() => layoutIds(grid).length === ids.length, 3000, 'startEffectId layout')
		const elapsed = performance.now() - t0

		// Must open immediately without waiting for the 5s delay or 4s transition!
		expect(elapsed).toBeLessThan(2000)
		expect(cellButton(grid, ids[0] ?? '')?.style.gridArea).toContain('span 2 / span 2')
		viewer.destroy()
	})

	it('lets a tagged marker keep its own view AND trigger a tag-zoom gridEffect targeting that tag', async () => {
		const boatView1: Models.Camera.View = [0.05, 0.05, 0.2, 0.2]
		const boatView2: Models.Camera.View = [0.6, 0.6, 0.25, 0.25]
		const boatViewOther: Models.Camera.View = [0.2, 0.3, 0.3, 0.3]

		const { viewer, grid, ids } = await openGrid(
			fast({
				markers: {
					0: [
						marker('boat-1', { tags: ['boats'], view: boatView1, popupType: 'none' }),
						marker('boat-2', {
							tags: ['boats'],
							view: boatView2,
							popupType: 'none',
							data: { gridEffect: 'eff-boats-zoom' },
						}),
					],
					2: [marker('boat-other', { tags: ['boats'], view: boatViewOther, popupType: 'none' })],
				},
			}),
		)

		grid.setEffects([
			{
				id: 'eff-boats-zoom',
				name: 'Boats Spotlight',
				steps: [
					{
						type: 'layout',
						source: { mode: 'tags', tags: ['boats'], match: 'any', zoomToMarker: true },
						duration: 0,
					},
				],
			},
		])

		await openMarker(viewer, ids[0] ?? '', 'boat-2')
		await waitFor(() => layoutIds(grid).length === 2, 4000, 'boats tag-zoom effect')
		expect(layoutIds(grid)).toEqual([ids[0], ids[2]])

		// The layout entry on image 0 must prefer the clicked marker's view (`boatView2`) over `boatView1`
		const entry0 = grid.getLayout().find((e) => e.id === ids[0])
		expect(entry0 && 'view' in entry0 ? entry0.view : undefined).toEqual(boatView2)
		viewer.destroy()
	})
})
