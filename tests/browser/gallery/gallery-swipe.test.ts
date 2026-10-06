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

		// ...and so does `open(id)` for an id that is not in the album, which
		// short-circuits into `gotoId`
		expect(await viewer.open('zzzzzzz')).toBeUndefined()
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
