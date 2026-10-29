import { afterEach, describe, expect, it } from 'vitest'
import { get } from '$core/store'
import { restoreArchiveXhr } from '../../fixtures/grid'
import { albumOf, awaitAlbum, destroyAlbums, mountAlbum, press } from '../../fixtures/albums'
import type { MountedAlbum, OpenAlbum } from '../../fixtures/albums'
import { waitFor } from '../../helpers/viewer'

/**
 * The swipe album: the `SwipeGallery` strip, the album API it drives, and the
 * pointer drag that slides the strip.
 */

afterEach(() => {
	destroyAlbums()
	restoreArchiveXhr()
})

async function openSwipe(count = 3): Promise<OpenAlbum> {
	const mounted = mountAlbum({ count })
	return await awaitAlbum(mounted)
}

/** A spread album whose two halves differ in width, so the spine flush is visible. */
function openSpread(count = 2, widths: [number, number] = [1000, 800]): Promise<OpenAlbum> {
	const mounted = mountAlbum({
		count,
		isSpreads: true,
		coverPages: 0,
		index: (_id, i) => ({ width: i % 2 === 0 ? widths[0] : widths[1], height: 1400 }),
	})
	return awaitAlbum(mounted)
}

/** The `<canvas>` the strip drag is attached to. */
function stripCanvas(mounted: MountedAlbum): HTMLCanvasElement {
	return mounted.viewer.el.canvas.element
}

/** A pointer event whose `timeStamp` is fixed, so the drag velocity is deterministic. */
type PointerInit = PointerEventInit & { timeStamp?: number }
function pointer(type: string, init: PointerInit): PointerEvent {
	const { timeStamp, ...rest } = init
	const ev = new PointerEvent(type, { ...rest, bubbles: true, cancelable: true })
	if (timeStamp !== undefined) {
		Object.defineProperty(ev, 'timeStamp', { value: timeStamp })
	}
	return ev
}

/** The strip drags on the canvas element and captures the pointer, which a synthetic event cannot do. */
function stubCapture(canvas: HTMLCanvasElement): void {
	canvas.setPointerCapture = () => {}
	canvas.releasePointerCapture = () => {}
}

describe('swipe album — the album API', () => {
	it('exposes the strip parent and its page count', async () => {
		const { viewer, ids } = await openSwipe(3)
		const album = albumOf(viewer.el)
		expect(viewer.el.gallery?._config.type).toBe('swipe')
		expect(viewer.el.$current?.id).toBe('')
		expect(album?.numPages).toBe(3)
		expect(album?.currentIndex).toBe(0)
		expect(album?.hooked).toBe(true)
		expect(viewer.el.gallery?._images.map((i) => i.id)).toEqual(ids)
	})

	it('navigates with next, prev and goto', async () => {
		const { viewer, ids } = await openSwipe(3)
		const album = albumOf(viewer.el)
		if (!album) {
			throw new Error('no album')
		}

		album.next()
		await waitFor(() => album.currentIndex === 1, 4000, 'the second page')

		album.prev()
		await waitFor(() => album.currentIndex === 0, 4000, 'the first page')

		const image = await album.goto(2)
		expect(image?.id).toBe(ids[2])
		expect(album.currentIndex).toBe(2)
	})

	it('does not move on an image index outside the album', async () => {
		const { viewer } = await openSwipe(3)
		const album = albumOf(viewer.el)
		if (!album) {
			throw new Error('no album')
		}
		await album.goto(2)
		expect(album.currentIndex).toBe(2)

		// `album.goto` maps an image index to its page, and an unmapped index
		// resolves `undefined` without moving — a miss must not jump to page 0
		expect(await album.goto(99)).toBeUndefined()
		expect(album.currentIndex).toBe(2)

		// A negative index behaves the same way
		expect(await album.goto(-5)).toBeUndefined()
		expect(album.currentIndex).toBe(2)

		// ...and so does `open(id)` for an id that is not in the album: it
		// short-circuits into `gotoId`, which resolves to the current image
		expect(await viewer.el.open('zzzzzzz')).toBe(viewer.el.$current)
		expect(album.currentIndex).toBe(2)

		// next() past the last page is a no-op: the page is set synchronously
		album.next()
		expect(album.currentIndex).toBe(2)
	})

	it('reports gallery-show with the page image ids', async () => {
		const mounted = mountAlbum({ count: 3 })
		const shown: string[][] = []
		mounted.viewer.el.addEventListener('gallery-show', (e) => {
			if (e instanceof CustomEvent) {
				shown.push(e.detail as string[])
			}
		})
		const { viewer, ids } = await awaitAlbum(mounted)

		expect(shown.at(-1)).toEqual([ids[0]])
		albumOf(viewer.el)?.next()
		await waitFor(() => albumOf(viewer.el)?.currentIndex === 1, 4000, 'the second page')
		expect(shown.at(-1)).toEqual([ids[1]])
	})

	it('keeps the currentImage store on the active child', async () => {
		const { viewer, ids } = await openSwipe(3)
		const album = albumOf(viewer.el)
		if (!album?.currentImage) {
			throw new Error('no currentImage store')
		}
		const { currentImage } = album
		expect(get(currentImage)?.id).toBe(ids[0])

		album.next()
		await waitFor(() => album.currentIndex === 1, 4000, 'the second page')
		await waitFor(() => get(currentImage)?.id === ids[1], 4000, 'the second child')
	})

	it('navigates with the keyboard', async () => {
		const { viewer } = await openSwipe(3)
		const album = albumOf(viewer.el)
		if (!album) {
			throw new Error('no album')
		}

		press('ArrowRight')
		await waitFor(() => album.currentIndex === 1, 4000, 'the second page')

		press('PageUp')
		await waitFor(() => album.currentIndex === 0, 4000, 'the first page')

		press('End')
		await waitFor(() => album.currentIndex === 2, 4000, 'the last page')

		press('Home')
		await waitFor(() => album.currentIndex === 0, 4000, 'the first page again')
	})

	it('routes open(imageId) through the gallery', async () => {
		const { viewer, ids } = await openSwipe(3)
		const album = albumOf(viewer.el)
		if (!album?.currentImage) {
			throw new Error('no currentImage store')
		}

		await viewer.open(ids[1] ?? '')
		await waitFor(() => album.currentIndex === 1, 4000, 'the second page')

		// The short-circuit never switches the current image away from the parent
		expect(viewer.el.$current?.id).toBe('')
		expect(get(album.currentImage)?.id).toBe(ids[1])
	})
})

describe('swipe album — strip drag', () => {
	it('ignores a drag below the threshold', async () => {
		const mounted = await openSwipe(3)
		const canvas = stripCanvas(mounted)
		stubCapture(canvas)

		canvas.dispatchEvent(pointer('pointerdown', { pointerId: 7, clientX: 600, clientY: 300, button: 0, timeStamp: 0 }))
		globalThis.dispatchEvent(pointer('pointermove', { pointerId: 7, clientX: 597, clientY: 300, timeStamp: 20 }))
		globalThis.dispatchEvent(pointer('pointerup', { pointerId: 7, clientX: 597, clientY: 300, timeStamp: 30 }))

		expect(mounted.viewer.el.dataset.panning).toBeUndefined()
		expect(albumOf(mounted.viewer.el)?.currentIndex).toBe(0)
	})

	it('ignores a mostly vertical drag', async () => {
		const mounted = await openSwipe(3)
		const canvas = stripCanvas(mounted)
		stubCapture(canvas)

		canvas.dispatchEvent(pointer('pointerdown', { pointerId: 8, clientX: 600, clientY: 300, button: 0, timeStamp: 0 }))
		globalThis.dispatchEvent(pointer('pointermove', { pointerId: 8, clientX: 604, clientY: 360, timeStamp: 20 }))

		expect(mounted.viewer.el.dataset.panning).toBeUndefined()
		expect(albumOf(mounted.viewer.el)?.currentIndex).toBe(0)
	})

	it('advances on a leftward drag and rewinds on a rightward one', async () => {
		const mounted = await openSwipe(3)
		const canvas = stripCanvas(mounted)
		stubCapture(canvas)
		const album = albumOf(mounted.viewer.el)
		if (!album) {
			throw new Error('no album')
		}

		canvas.dispatchEvent(pointer('pointerdown', { pointerId: 9, clientX: 600, clientY: 300, button: 0, timeStamp: 0 }))
		globalThis.dispatchEvent(pointer('pointermove', { pointerId: 9, clientX: 300, clientY: 300, timeStamp: 100 }))
		// Mid-drag the strip is panned and the frame loop is kept awake
		expect(mounted.viewer.el.dataset.panning).toBe('')
		expect(mounted.viewer.el._keepRendering).toBe(true)

		globalThis.dispatchEvent(pointer('pointerup', { pointerId: 9, clientX: 300, clientY: 300, timeStamp: 110 }))
		await waitFor(() => album.currentIndex === 1, 4000, 'the second page')
		expect(mounted.viewer.el.dataset.panning).toBeUndefined()
		expect(mounted.viewer.el._keepRendering).toBe(false)

		canvas.dispatchEvent(pointer('pointerdown', { pointerId: 10, clientX: 300, clientY: 300, button: 0, timeStamp: 0 }))
		globalThis.dispatchEvent(pointer('pointermove', { pointerId: 10, clientX: 600, clientY: 300, timeStamp: 100 }))
		globalThis.dispatchEvent(pointer('pointerup', { pointerId: 10, clientX: 600, clientY: 300, timeStamp: 110 }))
		await waitFor(() => album.currentIndex === 0, 4000, 'the first page again')
	})

	it('advances on velocity alone, under the progress threshold', async () => {
		const mounted = await openSwipe(3)
		const canvas = stripCanvas(mounted)
		stubCapture(canvas)
		const album = albumOf(mounted.viewer.el)
		if (!album) {
			throw new Error('no album')
		}

		// A 20px flick in 5ms is -4px/ms, well past the -0.5 velocity threshold
		canvas.dispatchEvent(pointer('pointerdown', { pointerId: 11, clientX: 400, clientY: 300, button: 0, timeStamp: 0 }))
		globalThis.dispatchEvent(pointer('pointermove', { pointerId: 11, clientX: 380, clientY: 300, timeStamp: 5 }))
		globalThis.dispatchEvent(pointer('pointerup', { pointerId: 11, clientX: 380, clientY: 300, timeStamp: 5 }))

		await waitFor(() => album.currentIndex === 1, 4000, 'the second page')
	})

	it('eases at the edges instead of wrapping', async () => {
		const mounted = await openSwipe(3)
		const canvas = stripCanvas(mounted)
		stubCapture(canvas)
		const album = albumOf(mounted.viewer.el)
		if (!album) {
			throw new Error('no album')
		}

		// A rightward drag from the first page has nowhere to go
		canvas.dispatchEvent(pointer('pointerdown', { pointerId: 12, clientX: 200, clientY: 300, button: 0, timeStamp: 0 }))
		globalThis.dispatchEvent(pointer('pointermove', { pointerId: 12, clientX: 700, clientY: 300, timeStamp: 100 }))
		globalThis.dispatchEvent(pointer('pointerup', { pointerId: 12, clientX: 700, clientY: 300, timeStamp: 110 }))
		await waitFor(() => album.currentIndex === 0, 2000, 'still the first page').catch(() => {})
		expect(album.currentIndex).toBe(0)

		// ...and a leftward drag from the last page has none either
		await album.goto(2)
		canvas.dispatchEvent(pointer('pointerdown', { pointerId: 13, clientX: 700, clientY: 300, button: 0, timeStamp: 0 }))
		globalThis.dispatchEvent(pointer('pointermove', { pointerId: 13, clientX: 100, clientY: 300, timeStamp: 100 }))
		globalThis.dispatchEvent(pointer('pointerup', { pointerId: 13, clientX: 100, clientY: 300, timeStamp: 110 }))
		await waitFor(() => album.currentIndex === 2, 2000, 'still the last page').catch(() => {})
		expect(album.currentIndex).toBe(2)
	})
})

describe('swipe album — spreads', () => {
	it('renders a spread page as one canvas, flush at the spine', async () => {
		const { viewer } = await openSpread()
		const [left, right] = viewer.el.gallery?._images ?? []

		// One page canvas and one camera: the page is a single zoomable entity
		expect(right?.canvas).toBe(left?.canvas)
		expect(left?.opts.area).toEqual([0, 0, 1, 1])
		// The right half starts exactly where the left one ends, at the same pixel scale
		expect(right?.opts.area).toEqual([1, 0, 0.8, 1])
	})

	it('renders the right half when the view moves onto it', async () => {
		const mounted = mountAlbum({ count: 2, isSpreads: true, coverPages: 0 })
		const { viewer } = await awaitAlbum(mounted)
		const [left, right] = viewer.el.gallery?._images ?? []
		const canvas = left?.canvas
		if (!left || !right || !canvas) {
			throw new Error('no spread page')
		}
		const rightImage = viewer.el._engine._getEngImage(right)
		if (rightImage === undefined) {
			throw new Error('no engine image for the right half')
		}

		// Move the page camera onto the right half: the visible region has to follow the view,
		// or the canvas counts itself as hidden and queues no tiles for that half.
		left.camera.setCoo(1.5, 0.5, Math.max(left.camera.getMinScale(), 1))
		await waitFor(
			() => canvas.visible.x1 >= canvas.view.x1 - 0.01,
			4000,
			'the visible region following the view onto the right half',
		)
		expect(canvas.visible.width).toBeGreaterThan(0)
		expect(canvas._toDraw.some((tile) => tile >= rightImage._startOffset)).toBe(true)
	})

	it('zooms both halves of a spread together', async () => {
		const { viewer } = await openSpread()
		const [left, right] = viewer.el.gallery?._images ?? []
		const parent = viewer.el.$current
		if (!left) {
			throw new Error('no left page')
		}
		expect(left.camera.isZoomedOut()).toBe(true)

		await left.camera.zoom(-300, 0)
		await waitFor(() => !left.camera.isZoomedOut(), 2000, 'the page zoom')

		// The right half follows the page camera, and the album parent reports the page's zoom
		expect(right?.camera.getScale()).toBe(left.camera.getScale())
		expect(right?.camera.isZoomedOut()).toBe(false)
		expect(parent?.camera.isZoomedOut()).toBe(false)
	})

	it('pans a zoomed spread page instead of switching pages', async () => {
		const mounted = mountAlbum({ count: 4, isSpreads: true, coverPages: 0 })
		const { viewer } = await awaitAlbum(mounted)
		const album = albumOf(viewer.el)
		const [left] = viewer.el.gallery?._images ?? []
		const canvas = stripCanvas(mounted)
		stubCapture(canvas)
		if (!album || !left) {
			throw new Error('no album')
		}

		await left.camera.zoom(-300, 0)
		await waitFor(() => !left.camera.isZoomedOut(), 2000, 'the page zoom')
		const before = Array.from(left.camera.getView())

		canvas.dispatchEvent(pointer('pointerdown', { pointerId: 20, clientX: 200, clientY: 300, button: 0 }))
		globalThis.dispatchEvent(pointer('pointermove', { pointerId: 20, clientX: 350, clientY: 300 }))
		globalThis.dispatchEvent(pointer('pointermove', { pointerId: 20, clientX: 500, clientY: 300 }))
		globalThis.dispatchEvent(pointer('pointerup', { pointerId: 20, clientX: 500, clientY: 300 }))

		expect(album.currentIndex).toBe(0)
		// The page kept its zoom and panned; it was not reset and no page change happened
		expect(left.camera.isZoomedOut()).toBe(false)
		expect(Array.from(left.camera.getView())).not.toEqual(before)
	})

	it('zooms a spread page back to fit before navigating away', async () => {
		const mounted = mountAlbum({ count: 4, isSpreads: true, coverPages: 0 })
		const { viewer } = await awaitAlbum(mounted)
		const album = albumOf(viewer.el)
		const [left] = viewer.el.gallery?._images ?? []
		if (!album || !left) {
			throw new Error('no album')
		}

		await left.camera.zoom(-300, 0)
		await waitFor(() => !left.camera.isZoomedOut(), 2000, 'the page zoom')

		album.next()
		await waitFor(() => album.currentIndex === 1, 4000, 'the second page')
		await waitFor(() => left.camera.isZoomedOut(), 4000, 'the zoom-out')
		expect(album.currentIndex).toBe(1)
	})

	it('keeps cover and unpaired pages on their own canvas', async () => {
		const mounted = mountAlbum({ count: 5, isSpreads: true, coverPages: 1 })
		const { viewer } = await awaitAlbum(mounted)
		const imgs = viewer.el.gallery?._images ?? []

		// Pages: [0], [1,2], [3,4]
		expect(imgs[0]?.canvas).not.toBe(imgs[1]?.canvas)
		expect(imgs[1]?.canvas).toBe(imgs[2]?.canvas)
		expect(imgs[3]?.canvas).toBe(imgs[4]?.canvas)
	})
})
