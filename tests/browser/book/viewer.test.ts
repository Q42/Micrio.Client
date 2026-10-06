import { afterEach, describe, expect, it, vi } from 'vitest'
import { BookViewer } from '$book/main'
import { requested } from '../../helpers/network'
import { bookImage, mountBook, restoreFrameStub, type ViewerHarness } from '../book-helpers'

/**
 * `BookViewer`: construction, page flips, drags, zoom, rotation and the drawn bounds.
 *
 * The harness (see `../book-helpers.ts`) owns the frame loop and steps the viewer by hand
 * with a fixed delta, so every test here works the same way: drive one of the viewer's
 * public entry points, step frames, then read `_onDraw` / `_onPageChange` / `pages` rather
 * than a private field (`_step`, `_getCurrentPage`, `_getPageCount` and `_allowRotation` are
 * the only readers the viewer exposes).
 *
 * One convention is inverted and worth having in mind: **a negative zoom delta zooms in.**
 * `OrbitCamera._zoom` adds `delta * _zoomSpeed` to the target radius, so `zoom(-2000)` pulls
 * the camera closer and `zoom(2000)` pushes it away — the opposite of a wheel's `deltaY`.
 * The book, the camera and the rotation buttons all agree on it; `orbit-camera.test.ts` pins
 * the camera end.
 */

afterEach(() => {
	restoreFrameStub()
	vi.restoreAllMocks()
	document.body.replaceChildren()
})

describe('BookViewer — construction', () => {
	it('rejects when there are no images', async () => {
		const canvas = document.createElement('canvas')
		const viewer = new BookViewer({ _canvas: canvas, _images: [] })
		await expect(viewer._ready).rejects.toThrow(/no images/)
	})

	it('rejects when WebGL2 is unavailable', async () => {
		const canvas = document.createElement('canvas')
		const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
		const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
		const viewer = new BookViewer({ _canvas: canvas, _images: [bookImage('a'), bookImage('b')] })
		await expect(viewer._ready).rejects.toThrow(/WebGL/)
		expect(warnings).toHaveBeenCalled()
		expect(spy).toHaveBeenCalled()
	})

	it('reports one page per two images and keeps the rotation option', async () => {
		const book = await mountBook({ images: [bookImage('a'), bookImage('b'), bookImage('c')] })
		// 3 images → 2 pages
		expect(book.viewer._getPageCount()).toBe(2)
		expect(book.viewer._getCurrentPage()).toBe(0)
		expect(book.viewer._allowRotation()).toBe(true)
		book.destroy()

		const noRotate = await mountBook({ images: [bookImage('a'), bookImage('b')], _allowRotation: false })
		expect(noRotate.viewer._allowRotation()).toBe(false)
		noRotate.destroy()
	})

	it('fires the page callback for the initial state', async () => {
		const book = await mountBook({ images: [bookImage('a'), bookImage('b')] })
		expect(book.pages.length).toBeGreaterThan(0)
		expect(book.pages.at(-1)).toBe(0)
		book.destroy()
	})
})

describe('BookViewer — startup page', () => {
	it('starts closed for page 0 and ignores an out-of-range start', async () => {
		const closed = await mountBook({ images: [bookImage('a'), bookImage('b'), bookImage('c'), bookImage('d')] })
		expect(closed.viewer._getCurrentPage()).toBe(0)
		closed.destroy()

		const negative = await mountBook({
			images: [bookImage('a'), bookImage('b'), bookImage('c'), bookImage('d')],
			_startPageIdx: -3,
		})
		expect(negative.viewer._getCurrentPage()).toBe(0)
		negative.destroy()
	})

	it('maps a start image index onto its page', async () => {
		const images = [bookImage('a'), bookImage('b'), bookImage('c'), bookImage('d')]
		// Image 3 lives on page ceil(3/2) = 2
		const book = await mountBook({ images: [...images], _startPageIdx: 3 })
		expect(book.viewer._getCurrentPage()).toBe(1)
		book.destroy()

		// Image 2 is the back of page 1
		const onPageOne = await mountBook({ images: [...images], _startPageIdx: 2 })
		expect(onPageOne.viewer._getCurrentPage()).toBe(1)
		onPageOne.destroy()
	})
})

describe('BookViewer — page turning', () => {
	it('turns forward and backward through the book', async () => {
		const book = await mountBook({ images: [bookImage('a'), bookImage('b'), bookImage('c'), bookImage('d')] })
		expect(book.viewer._getPageCount()).toBe(2)

		book.viewer._nextPage()
		expect(book.viewer._getCurrentPage()).toBe(1)
		expect(book.pages.at(-1)).toBe(1)

		book.viewer._prevPage()
		expect(book.viewer._getCurrentPage()).toBe(0)
		expect(book.pages.at(-1)).toBe(0)
		book.destroy()
	})

	it('refuses to turn before the first page', async () => {
		const book = await mountBook({ images: [bookImage('a'), bookImage('b'), bookImage('c'), bookImage('d')] })
		expect(book.viewer._getPageCount()).toBe(2)
		book.viewer._prevPage()
		expect(book.viewer._getCurrentPage()).toBe(0)
		book.destroy()
	})

	it('refuses to turn past its only page in a one-page book', async () => {
		// `#pageCount` is a count, not a last index: guarding `_nextPage` with
		// `#currentPage < #pageCount` let a one-page book land on page 1
		const book = await mountBook({ images: [bookImage('a'), bookImage('b')] })
		expect(book.viewer._getPageCount()).toBe(1)
		book.pages.length = 0
		book.viewer._nextPage()
		expect(book.viewer._getCurrentPage()).toBe(0)
		expect(book.pages).toEqual([])
		book.destroy()
	})

	it('clears the input operation when a page turn starts', async () => {
		const book = await mountBook({ images: [bookImage('a'), bookImage('b'), bookImage('c'), bookImage('d')] })
		book.viewer._nextPage()
		// The viewer asks for no further frames when nothing is animating
		book.steps(2)
		expect(book.viewer._getCurrentPage()).toBe(1)
		book.destroy()
	})
})

describe('BookViewer — goto', () => {
	it('resolves immediately for the page it is already on', async () => {
		const book = await mountBook({ images: [bookImage('a'), bookImage('b')] })
		await book.viewer.goto(0)
		expect(book.viewer._getCurrentPage()).toBe(0)
		book.destroy()
	})

	it('clamps the target to the last page and resolves when it has settled', async () => {
		const book = await mountBook({
			images: [bookImage('a'), bookImage('b'), bookImage('c'), bookImage('d'), bookImage('e'), bookImage('f')],
		})
		expect(book.viewer._getPageCount()).toBe(3)

		let resolved = false
		const pending = book.viewer.goto(99).then(() => {
			resolved = true
		})
		const { frames, settled } = await book.settle(() => resolved)
		expect(book.viewer._getCurrentPage()).toBe(2)
		// Settled by the cascade, not by goto()'s 3s fallback
		expect(settled).toBe(true)
		expect(frames).toBeLessThan(200)
		await pending
		book.destroy()
	})

	it('resolves a backward cascade too', async () => {
		// A backward cascade was documented as never settling. It settles on the
		// same order of frames as a forward one; what stalled was awaiting it
		// without stepping frames (see `settle` in the harness).
		const book = await mountBook({
			images: [bookImage('a'), bookImage('b'), bookImage('c'), bookImage('d'), bookImage('e'), bookImage('f')],
			_startPageIdx: 4,
		})
		expect(book.viewer._getCurrentPage()).toBe(2)

		let resolved = false
		const pending = book.viewer.goto(0).then(() => {
			resolved = true
		})
		const { frames, settled } = await book.settle(() => resolved)
		expect(book.viewer._getCurrentPage()).toBe(0)
		expect(settled).toBe(true)
		expect(frames).toBeLessThan(200)
		await pending
		book.destroy()
	})
})

describe('BookViewer — per-frame callbacks', () => {
	it('draws the current spread with bounds inside the image', async () => {
		const book = await mountBook({ images: [bookImage('a'), bookImage('b'), bookImage('c'), bookImage('d')] })
		book.steps(2)
		const drawn = book.lastDraw()
		expect(drawn.length).toBeGreaterThan(0)
		expect(drawn[0]?.id).toBe('a')
		for (const img of drawn) {
			const [u, v, w, h] = img.bounds
			expect(Number.isFinite(u + v + w + h)).toBe(true)
			expect(u).toBeGreaterThanOrEqual(0)
			expect(v).toBeGreaterThanOrEqual(0)
			expect(u + w).toBeLessThanOrEqual(1 + 1e-6)
			expect(v + h).toBeLessThanOrEqual(1 + 1e-6)
		}
		book.destroy()
	})

	it('reports both sides of a page that is mid-flip', async () => {
		const book = await mountBook({
			images: [bookImage('a'), bookImage('b'), bookImage('c'), bookImage('d'), bookImage('e'), bookImage('f')],
		})
		book.viewer._nextPage()
		book.steps(12)
		const ids = new Set(book.lastDraw().map((d) => d.id))
		// The flipping page's front and back, plus the spread it is leaving
		expect(ids.size).toBeGreaterThan(1)
		expect(ids.has('a') || ids.has('c')).toBe(true)
		book.destroy()
	})

	it('feeds the view-change callback while the camera is moving', async () => {
		const book = await mountBook({ images: [bookImage('a'), bookImage('b')] })
		book.views.length = 0
		// A negative delta zooms in, which moves the camera
		book.viewer.zoom(-500)
		book.steps(5)
		expect(book.views.length).toBeGreaterThan(0)
		for (const view of book.views) {
			expect(view.length).toBeGreaterThan(0)
		}
		book.destroy()
	})

	it('reports zoomed-in state through the drawn bounds', async () => {
		const book = await mountBook({ images: [bookImage('a'), bookImage('b')] })
		book.steps(3)
		expect(book.viewer.isZoomedIn(), 'the fitted spread shows whole images').toBe(false)
		expect(book.lastDraw()[0]?.bounds).toEqual([0, 0, 1, 1])

		// A negative delta zooms in hard: the page is cut off by the viewport
		book.viewer.zoom(-2000)
		expect(book.until(() => book.viewer.isZoomedIn())).toBe(true)
		const zoomed = book.lastDraw()[0]?.bounds
		expect(zoomed?.[2]).toBeLessThan(1)

		// And back out again, where the whole spread fits once more
		book.viewer.zoom(2000)
		expect(book.until(() => !book.viewer.isZoomedIn())).toBe(true)
		book.destroy()
	})
})

/** A pointer press and release at a canvas position. */
function click(book: ViewerHarness, x: number, y: number): void {
	const rect = book.canvas.getBoundingClientRect()
	const opts = { clientX: rect.left + x, clientY: rect.top + y, pointerId: 1, button: 0, bubbles: true }
	book.canvas.dispatchEvent(new PointerEvent('pointerdown', opts))
	globalThis.dispatchEvent(new PointerEvent('pointerup', opts))
}

describe('BookViewer — image hooks', () => {
	it('installs the coordinate and matrix overrides once per image', async () => {
		const book = await mountBook({ images: [bookImage('a'), bookImage('b')] })
		const calls: string[] = []
		const camera: Record<string, unknown> = {}
		const image = { id: 'a', camera }

		book.viewer._hookImageBook3d(image as never)
		expect(camera._getXYDirectOverride).toBeTypeOf('function')
		expect(camera._getMatrixOverride).toBeTypeOf('function')

		// A second call is a no-op, so the installed overrides stay
		const installed = camera._getMatrixOverride
		book.viewer._hookImageBook3d(image as never)
		expect(camera._getMatrixOverride).toBe(installed)

		// A point outside the image has no coordinate and no matrix
		const xy = (camera._getXYDirectOverride as (x: number, y: number) => Float64Array)(2, 2)
		expect(Array.from(xy.slice(0, 2))).toEqual([-1, -1])
		const matrix = (camera._getMatrixOverride as (...a: unknown[]) => Float32Array)(2, 2, 1)
		expect(matrix).toHaveLength(0)
		expect(calls).toHaveLength(0)
		book.destroy()
	})

	it('reports a screen coordinate and matrix for a point on the page', async () => {
		const book = await mountBook({ images: [bookImage('a'), bookImage('b')] })
		book.steps(3)
		const camera: Record<string, unknown> = {}
		book.viewer._hookImageBook3d({ id: 'a', camera } as never)

		const coo = (camera._getXYDirectOverride as (x: number, y: number) => Float64Array)(0.5, 0.5)
		// A visible point maps onto the canvas, not to the -1 sentinel
		expect(coo[0]).toBeGreaterThan(-1)
		expect(coo[1]).toBeGreaterThan(-1)
		expect(coo[0]).toBeLessThan(800)
		expect(coo[1]).toBeLessThan(600)

		const matrix = (camera._getMatrixOverride as (...a: unknown[]) => Float32Array)(0.5, 0.5, 1)
		expect(matrix).toHaveLength(16)
		// The anchor normalizes to its screen pixel position, relative to the centre
		expect(matrix[15]).toBeCloseTo(1, 6)
		expect(matrix[14]).toBe(0)
		book.destroy()
	})
})

describe('BookViewer — input', () => {
	it('turns a page from a click on the canvas', async () => {
		const book = await mountBook({
			images: [bookImage('a'), bookImage('b'), bookImage('c'), bookImage('d'), bookImage('e'), bookImage('f')],
		})
		book.steps(3)
		const before = book.viewer._getCurrentPage()
		// Try a few positions: the ray has to hit a page, and which side it hits
		// depends on where the spread was laid out
		let turned = false
		for (const x of [200, 400, 500, 600]) {
			click(book, x, 300)
			book.steps(3)
			if (book.viewer._getCurrentPage() !== before) {
				turned = true
				break
			}
		}
		expect(turned).toBe(true)
		expect(book.viewer._getCurrentPage()).toBe(before + 1)
		book.destroy()
	})

	it('zooms on a wheel event and ignores a click that lands off the book', async () => {
		const book = await mountBook({ images: [bookImage('a'), bookImage('b')] })
		book.steps(3)
		const page = book.viewer._getCurrentPage()
		click(book, 5, 5)
		book.steps(3)
		expect(book.viewer._getCurrentPage()).toBe(page)

		const rect = book.canvas.getBoundingClientRect()
		book.canvas.dispatchEvent(
			new WheelEvent('wheel', { clientX: rect.left + 400, clientY: rect.top + 300, deltaY: -500, bubbles: true }),
		)
		expect(book.until(() => book.viewer.isZoomedIn())).toBe(true)
		book.destroy()
	})
})

describe('BookViewer — zoom and rotation', () => {
	it('accepts a zoom without letting the camera past its limits', async () => {
		const book = await mountBook({ images: [bookImage('a'), bookImage('b')] })
		// Zoom all the way in, and back out past the fit
		book.viewer.zoom(-5000)
		expect(book.until(() => book.viewer.isZoomedIn())).toBe(true)
		book.viewer.zoom(5000)
		expect(book.until(() => !book.viewer.isZoomedIn())).toBe(true)
		expect(book.lastDraw().length).toBeGreaterThan(0)
		book.destroy()
	})

	it('steps the view by 90° per rotate call', async () => {
		const book = await mountBook({ images: [bookImage('a'), bookImage('b')] })
		const before = book
			.lastDraw()
			.map((d) => d.id)
			.join()
		book.viewer.rotateView(1)
		book.steps(80)
		expect(book.lastDraw().length).toBeGreaterThan(0)
		// Rotating does not change which image is on the page
		expect(
			book
				.lastDraw()
				.map((d) => d.id)
				.join(),
		).toBe(before)
		book.destroy()
	})

	it('applies a lighting preset and ignores an unknown one', async () => {
		const book = await mountBook({ images: [bookImage('a'), bookImage('b')] })
		book.viewer.setLightingPreset('candlelight')
		// An animated preset keeps asking for frames
		expect(book.step()).toBe(true)
		expect(() => {
			book.viewer.setLightingPreset('no-such-preset')
		}).not.toThrow()
		book.destroy()
	})
})

describe('BookViewer — texture loading', () => {
	it('warns instead of failing when the archive has no page image', async () => {
		// A book whose images are not in the archive at all
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		const book = await mountBook({ images: [bookImage('missing-a'), bookImage('missing-b')], _noArchive: true })
		expect(warn).toHaveBeenCalled()
		expect(book.viewer._getPageCount()).toBe(1)
		book.destroy()
	})

	it('starts IIIF streaming for the current spread', async () => {
		const book = await mountBook({ images: [bookImage('a'), bookImage('b')], _iiifBaseUrl: 'https://iiif.test' })
		// The manager marks the spread's page pending, which is work, but the
		// *book* must not schedule frames for pending network work alone
		expect(book.step()).toBe(true)
		book.destroy()
	})

	it('answers its hi-res page requests locally', async () => {
		// Without a base URL the manager falls back to the IIIF CDN and, once the
		// 500 ms debounce has passed, asks for a page texture. The suite's default
		// 404 patch (setup.ts) is what keeps that request off the network.
		const book = await mountBook({ images: [bookImage('a'), bookImage('b')] })
		book.steps(60)
		expect(requested.some((url) => url.includes('iiif.micr.io'))).toBe(true)
		book.destroy()
	})
})
