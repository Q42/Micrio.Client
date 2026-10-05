import { describe, expect, it, vi } from 'vitest'
import type { Models } from '../../src/types/models'
import { freshSpace, linkPair, openVisibleSpace, type SpaceLink } from '../fixtures/space-fixture'
import { get } from '../../src/core/store'
import { mockJson } from '../helpers/network'
import { mountViewer, waitFor } from '../helpers/viewer'
import { settle } from '../helpers/tour'

/**
 * `<micrio-waypoint>` is the 3D link between two images in a 360 space.
 *
 * `markers.ts` creates one element per `spaceData.links` entry that touches the current
 * image, and the element then emits `wp-print` with the coordinates it resolved. The
 * elements only exist once the image is actually on screen, so every test waits for
 * `_visible` first.
 */
async function openLinked(opts: { links?: (ids: string[]) => SpaceLink[]; index?: number } = {}) {
	const space = await openVisibleSpace(opts.index ?? 0, { links: opts.links })
	await settle(2)
	return space
}

/** The waypoints currently rendered for the open image. */
const waypoints = (el: Element) => [...el.querySelectorAll<HTMLElement>('micrio-waypoint')]

/** The target image id a waypoint points at. */
const targetOf = (el: HTMLElement) => el.dataset.targetId ?? ''

/**
 * Reads the `wp-print` payload of a rendered waypoint.
 *
 * `wp-print` fires while the element sets itself up, which is before the test can
 * attach a listener, so the element's props are re-applied to fire it again — exactly
 * what `markers.ts` does when it updates a waypoint.
 */
async function printedDetail(space: Awaited<ReturnType<typeof openLinked>>, index = 0) {
	const micrio = space.viewer.el
	const seen: Models.Spaces.WaypointInterface[] = []
	const onPrint = (e: Event) => seen.push((e as CustomEvent<Models.Spaces.WaypointInterface>).detail)
	micrio.addEventListener('wp-print', onPrint)

	const waypointEl = waypoints(micrio)[index]
	const image = space.viewer.el.$current
	if (!waypointEl || !image) {
		throw new Error('no waypoint to inspect')
	}
	;(waypointEl as unknown as { _setProps?: (p: unknown) => void })._setProps?.({
		targetId: targetOf(waypointEl),
		image,
	})
	await settle(2)
	micrio.removeEventListener('wp-print', onPrint)
	return seen.at(-1)
}

/**
 * Opens a fresh space whose waypoints sit at the given heights and asserts the
 * direction class the element derives for them.
 */
async function expectDirectionClass(fromY: number, toY: number, expected: string) {
	const { images, spaces } = freshSpace()
	const [space] = spaces
	if (!space) {
		throw new Error('no space')
	}
	space.data.images = [
		{ ...(space.data.images[0] ?? { id: '', x: 0, z: 0, rotationY: 0 }), y: fromY },
		{ ...(space.data.images[1] ?? { id: '', x: 1, z: 0, rotationY: 0 }), y: toY },
	]
	mockJson(/bundle\.json/, { images, spaces })
	const viewer = mountViewer('', 'width: 512px; height: 256px; display: block;')
	await viewer.open(images[0]?.id ?? '')
	await waitFor(() => get(viewer.el._visible).length > 0, 8000, 'image visible')
	await settle(3)

	const [el] = waypoints(viewer.el)
	expect(el?.classList.contains(expected), `${fromY} -> ${toY}`).toBe(true)
	expect(el?.classList.contains('direction-up') && el?.classList.contains('direction-down')).toBe(false)
	viewer.destroy()
}

describe('waypoint creation', () => {
	it('renders one waypoint per link that touches the current image', async () => {
		const { viewer, ids } = await openLinked()
		const els = waypoints(viewer.el)
		expect(els).toHaveLength(1)
		expect(els[0] ? targetOf(els[0]) : '').toBe(ids[1])
		viewer.destroy()
	})

	it('swaps the waypoint when the other image is opened', async () => {
		const { viewer, ids } = await openLinked({ index: 1 })
		const els = waypoints(viewer.el)
		expect(els).toHaveLength(1)
		expect(els[0] ? targetOf(els[0]) : '').toBe(ids[0])
		viewer.destroy()
	})

	it('renders none for a link between two other images', async () => {
		const { viewer, ids } = await openLinked({
			links: ([a, b]) =>
				[
					// A third image links to the second, and not to the first
					[`other${a}`, b, undefined],
				] as SpaceLink[],
		})
		expect(ids).toHaveLength(2)
		expect(waypoints(viewer.el)).toHaveLength(0)
		viewer.destroy()
	})

	it('renders no waypoints when the space has no links', async () => {
		const { viewer } = await openLinked({ links: () => [] })
		expect(waypoints(viewer.el)).toHaveLength(0)
		viewer.destroy()
	})
})

describe('waypoint coordinates', () => {
	it('reports the auto-resolved coordinates through wp-print', async () => {
		const space = await openLinked()
		const { viewer } = space
		const detail = await printedDetail(space)
		expect(detail).toBeDefined()
		const coords = detail?.coords
		if (!coords) {
			throw new Error('no coords')
		}

		// The waypoint sits in the direction of the target: directionX is the yaw fraction
		expect(coords.x).toBeCloseTo(0.75, 6)
		// A level target sits slightly above the horizon
		expect(coords.y).toBeCloseTo(0.65, 6)
		// baseScale is derived from the source image width
		expect(coords.baseScale).toBeCloseTo(512 / 1024, 6)
		expect(coords.scale).toBe(1)
		expect(coords.custom).toBeUndefined()
		expect(Number.isFinite(coords.rotX)).toBe(true)
		viewer.destroy()
	})

	it('keeps hand-authored coordinates when they are marked custom', async () => {
		const custom: Models.Spaces.WaypointCoords = {
			x: 0.1,
			y: 0.2,
			baseScale: 2,
			scale: 3,
			rotX: 0.4,
			rotY: 0.5,
			rotZ: 0.6,
			custom: true,
		}
		const space = await openLinked({
			links: (ids) => linkPair(ids[0] ?? '', ids[1] ?? '', { i18n: {}, coords: custom }),
		})
		const { viewer } = space

		const detail = await printedDetail(space)
		// `markers.ts` can only hand the element what the link carries, so the
		// coordinates survive verbatim
		expect(detail?.coords).toEqual(custom)
		viewer.destroy()
	})

	it('classifies a downward move when the target sits lower in the space', async () => {
		// Y is inverted in the space vector, so moving to a lower `y` in the space is a
		// downward camera move and gets the matching class.
		await expectDirectionClass(0.9, 0.1, 'direction-down')
	})

	it('classifies an upward move when the target sits higher in the space', async () => {
		await expectDirectionClass(0.1, 0.9, 'direction-up')
	})
})

describe('waypoint rendering', () => {
	it('positions itself with a matrix3d transform', async () => {
		const { viewer } = await openLinked()
		const el = waypoints(viewer.el)[0]
		expect(el?.style.transform.startsWith('matrix3d(')).toBe(true)
		expect(el?.style.transform.endsWith(')')).toBe(true)
		const values = el?.style.transform.slice('matrix3d('.length, -1).split(',').map(Number) ?? []
		expect(values).toHaveLength(16)
		expect(values.every(Number.isFinite)).toBe(true)
		viewer.destroy()
	})

	it('uses the link title when the space provides one', async () => {
		const { viewer } = await openLinked()
		const button = waypoints(viewer.el)[0]?.querySelector('button')
		// The fixture links carry a per-end title; without one the button falls back
		// to the generic "Go this way" string from the i18n store
		expect(button?.getAttribute('title')).toBe('To the second room')
		expect(button?.getAttribute('aria-label')).toBe('To the second room')
		viewer.destroy()
	})

	it('falls back to the localised follow label without a title', async () => {
		const { viewer } = await openLinked({
			links: (ids) => linkPair(ids[0] ?? '', ids[1] ?? ''),
		})
		const button = waypoints(viewer.el)[0]?.querySelector('button')
		expect(button?.getAttribute('title')).toBe('Go this way')
		viewer.destroy()
	})
})

describe('waypoint navigation', () => {
	it('opens the target when the waypoint is clicked', async () => {
		const { viewer, ids } = await openLinked()
		const before = viewer.el.$current?.id
		expect(before).toBe(ids[0])

		waypoints(viewer.el)[0]?.querySelector<HTMLButtonElement>('button')?.click()
		await waitFor(() => viewer.el.$current?.id !== before, 8000, 'opened the target')
		expect(viewer.el.$current?.id).toBe(ids[1])
		viewer.destroy()
	})

	it('clears the active marker before navigating', async () => {
		const { viewer, ids } = await openLinked()
		const image = viewer.el.$current
		if (!image) {
			throw new Error('no current image')
		}
		image.state.marker.set(undefined)
		waypoints(viewer.el)[0]?.querySelector<HTMLButtonElement>('button')?.click()
		await waitFor(() => viewer.el.$current?.id === ids[1], 8000, 'opened the target')
		// The new image has no open marker, and the source image's marker was cleared
		expect(viewer.el.$current?.state.$marker).toBeUndefined()
		expect(image.state.$marker).toBeUndefined()
		viewer.destroy()
	})

	it('does nothing when marker actions are disabled', async () => {
		const { viewer, ids } = await openLinked()
		const image = viewer.el.$current
		if (!image) {
			throw new Error('no current image')
		}
		image._settings.set({ _markers: { noMarkerActions: true } })
		await settle(2)

		waypoints(viewer.el)[0]?.querySelector<HTMLButtonElement>('button')?.click()
		await settle(4)
		expect(viewer.el.$current?.id).toBe(ids[0])
		viewer.destroy()
	})
})

describe('waypoint teardown and errors', () => {
	it('removes the waypoint when the space link disappears', async () => {
		const { viewer, ids } = await openLinked()
		expect(waypoints(viewer.el)).toHaveLength(1)

		// Dropping the link and re-resolving the space data removes the element
		const state = viewer.el.spaceData
		if (!state) {
			throw new Error('no space data')
		}
		state.links = state.links.filter(([a, b]) => a !== ids[0] && b !== ids[0])
		// Touch the data store so the markers layer rebuilds
		viewer.el.$current?.data.set({ markers: [] })
		await settle(4)
		expect(waypoints(viewer.el)).toHaveLength(0)
		viewer.destroy()
	})

	it('logs instead of throwing when a link targets an unknown image', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const { viewer, ids } = await openLinked({
			links: (imageIds) => [[imageIds[0] ?? '', 'ghost-target', undefined]],
		})

		// The link names an image that is not in the space, so no vector can be
		// resolved; the element logs and stays empty rather than breaking the layer.
		expect(viewer.el.$current?.id).toBe(ids[0])
		const el = viewer.el.querySelector('micrio-waypoint')
		expect(el?.textContent ?? '').toBe('')
		expect(errorSpy).toHaveBeenCalled()
		errorSpy.mockRestore()
		viewer.destroy()
	})

	it('destroys cleanly with a pending focus timer', async () => {
		const { viewer } = await openLinked()
		const el = waypoints(viewer.el)[0]
		el?.querySelector<HTMLButtonElement>('button')?.focus()
		await settle(2)
		expect(() => {
			viewer.destroy()
		}).not.toThrow()
	})
})
