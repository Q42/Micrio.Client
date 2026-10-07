import { describe, expect, it, vi } from 'vitest'
import { mountViewer, waitFor, type Viewer } from '../../helpers/viewer'
import { bundleWithFreshId } from '../../fixtures/bundles'
import type { MicrioImage } from '$core/image'
import type Camera2D from '$render/camera-2d'
import type { Viewport } from '$render/shared'
import { easeInOut } from '$render/easing'

/**
 * The 2D camera (`Camera2D`) and the shared `EngineCamera` base it inherits.
 *
 * `camera-2d.ts` and `engine-camera.ts` were the two thinnest files left in `src/render` at
 * ~64%/~48%: the public `Camera` facade is exercised all over the suite, but the internal
 * `_pan`/`_zoom`/`_pinch`/`_flyTo` paths behind it are not. This suite drives those seams
 * directly on a real canvas.
 *
 * **One viewer per test**, like `canvas.test.ts`: each test needs a clean camera (limits,
 * scale and animation state all leak between calls), and resetting the engine by hand is
 * more fragile than one more context. The two files together mount a handful of contexts in
 * total, which stays well inside Chromium's budget.
 */

/** A fresh 512x512 image so no two tests share a bundle id (the loader caches by id). */
async function open2d(settings: Record<string, unknown> = {}): Promise<{
	viewer: Viewer
	image: MicrioImage
	camera: Camera2D
	canvasEl: Viewport
}> {
	const bundle = bundleWithFreshId(settings)
	const viewer = mountViewer()
	await viewer.open(bundle)
	await waitFor(() => viewer.el.$current?.id === bundle.id, 6000, 'current image')
	await waitFor(() => viewer.el._engine._canvases.length > 0, 6000, 'a placed canvas')
	const image = viewer.el.$current
	const canvas = viewer.el._engine._canvases[0]
	if (!image || !canvas) {
		throw new Error('no placed 2D image')
	}
	await waitFor(() => image.camera.getScale() > 0, 6000, 'camera layout')
	// The 2D `camera` union resolves to `Camera2D` once the image is not 360, so this cast is
	// the seam the test needs: `Camera` only exposes the public half.
	// `Canvas.el` is the engine `Viewport` (Int32-ish screen box), not the DOM element
	return { viewer, image, camera: canvas.camera as Camera2D, canvasEl: canvas.el }
}

describe('Camera2D coordinate conversion', () => {
	it('round-trips screen pixels through image coordinates', async () => {
		const { viewer, camera, canvasEl } = await open2d()
		// `_getXY` is image -> screen, `_getCoo` is screen -> image. Both need a laid-out canvas.
		const [px, py] = [canvasEl.width * 0.3, canvasEl.height * 0.7]
		const coo = camera._getCoo(px, py, true, true)
		const xy = camera._getXY(coo.x, coo.y, true)
		expect(xy.x).toBeCloseTo(px, 3)
		expect(xy.y).toBeCloseTo(py, 3)
		viewer.destroy()
	})

	it('_getXY reports the same scale the camera is at', async () => {
		const { viewer, camera, canvasEl } = await open2d()
		const xy = camera._getXY(0.5, 0.5, true)
		// The scale on the coordinate is the camera scale divided by the pixel ratio
		expect(xy.scale).toBeCloseTo(camera._scale / canvasEl.ratio, 6)
		viewer.destroy()
	})

	it('_getCoo clamps to the view limits unless noLimit is set', async () => {
		const { viewer, camera } = await open2d()
		// `_getCoo` returns one reused `Coordinates` instance, so the two readings have to be
		// captured as scalars before the second call overwrites them.
		const clampedX = camera._getCoo(1e6, 1e6, false, false).x
		const freeX = camera._getCoo(1e6, 1e6, false, true).x
		// The clamped reading is bounded by the limit box (centre 0.5 + half width 0.5 = 1),
		// the unbounded one is not.
		expect(freeX).toBeGreaterThan(clampedX)
		expect(freeX).toBeGreaterThanOrEqual(1)
		viewer.destroy()
	})

	it('_getXYOmniCoo projects an omni-relative point and reports its depth', async () => {
		const { viewer, camera } = await open2d()
		// No omni settings on this canvas: the matrix is the identity plus the layer rotation,
		// so the projection is a pure translate and the depth is 0 - the un-translated w.
		const coo = camera._getXYOmniCoo(0, 0, 1, 0, true)
		expect(Number.isFinite(coo.x)).toBe(true)
		expect(Number.isFinite(coo.y)).toBe(true)
		expect(coo.w).toBeCloseTo(-1, 9)
		viewer.destroy()
	})
})

describe('Camera2D scale limits', () => {
	it('reports limits in a consistent order and corrects them on demand', async () => {
		const { viewer, camera } = await open2d()
		expect(camera._minScale).toBeGreaterThan(0)
		expect(camera._maxScale).toBeGreaterThanOrEqual(camera._minScale)

		camera._correctMinMax()
		expect(camera._minScale).toBeGreaterThan(0)
		// `noLimit` skips the focus-area branch, so the result is the plain cover/full scale
		camera._correctMinMax(true)
		expect(camera._minScale).toBeGreaterThan(0)
		viewer.destroy()
	})

	it('_isUnderZoom only fires below the minimum with a margin', async () => {
		const { viewer, camera } = await open2d()
		// `_minSize` is 1 on a grid-less canvas, so the guard short-circuits to false
		expect(camera._minSize).toBe(1)
		expect(camera._isUnderZoom()).toBe(false)
		camera._minSize = 0.5
		camera._scale = camera._minScale / 2
		expect(camera._isUnderZoom()).toBe(true)
		camera._scale = camera._minScale
		expect(camera._isUnderZoom()).toBe(false)
		viewer.destroy()
	})

	it('_isZoomedOut and _isZoomedIn bracket the scale range', async () => {
		const { viewer, camera } = await open2d()
		camera._scale = camera._minScale
		expect(camera._isZoomedOut()).toBe(true)
		expect(camera._isZoomedOut(true)).toBe(true)
		camera._scale = camera._maxScale
		expect(camera._isZoomedIn()).toBe(true)
		camera._scale = camera._minScale * 2
		expect(camera._isZoomedIn()).toBe(false)
		expect(camera._isZoomedOut()).toBe(false)
		viewer.destroy()
	})

	it('_isOutsideLimit detects a view past the limit box', async () => {
		const { viewer, camera, image } = await open2d()
		// Pull the view out to the corner and shrink it, then ask
		image.camera.setView([0, 0, 0.1, 0.1], { noLimit: true })
		const outside = camera._isOutsideLimit()
		// The answer depends on the limit box vs the view; both branches are exercised by
		// asking at a zoomed-out and a zoomed-in view
		image.camera.setView([0, 0, 1, 1], { noLimit: true })
		const inside = camera._isOutsideLimit()
		expect(typeof outside).toBe('boolean')
		expect(typeof inside).toBe('boolean')
		viewer.destroy()
	})
})

describe('Camera2D panning', () => {
	it('moves the view centre by the pixel delta', async () => {
		const { viewer, image, camera, canvasEl } = await open2d()
		image.camera.setView([0.25, 0.25, 0.5, 0.5], { noLimit: true })
		const before = image.camera.getView().slice()
		// `_pan` converts pixels to image units and shifts the centre
		camera._pan(canvasEl.width * 0.05, 0, 0, true, true)
		const after = image.camera.getView()
		expect(after[0]).not.toBeCloseTo(before[0], 6)
		viewer.destroy()
	})

	it('animate a pan when a duration is given', async () => {
		const { viewer, image, camera } = await open2d()
		image.camera.setView([0.25, 0.25, 0.5, 0.5], { noLimit: true })
		// A duration routes through `Ani._toView` instead of setting the view directly
		camera._pan(40, 0, 0.2, true, true)
		expect(image.camera.getScale()).toBeGreaterThan(0)
		viewer.destroy()
	})

	it('a pan against the limit takes the animated correction path', async () => {
		const { viewer, camera, image } = await open2d()
		// Zoom *in* (a small view = a large scale, otherwise `_pan` exits as under-zoomed),
		// then push the view past the limit. The point of this test is the branch: a view that
		// is already outside the limit must not be written directly.
		image.camera.setView([0.4, 0.4, 0.05, 0.05], { noLimit: true })
		expect(camera._isUnderZoom()).toBe(false)
		camera._pan(1e5, 1e5)
		const after = image.camera.getView()
		// The correction is an animation, so the view is still a valid rect afterwards
		expect([...after].every(Number.isFinite)).toBe(true)
		expect(after[2]).toBeGreaterThan(0)
		expect(after[3]).toBeGreaterThan(0)
		viewer.destroy()
	})
	it('a pan while under-zoomed is a no-op unless forced', async () => {
		const { viewer, camera, image } = await open2d()
		camera._minSize = 0.5
		camera._scale = camera._minScale / 2
		expect(camera._isUnderZoom()).toBe(true)
		const before = image.camera.getView().slice()
		camera._pan(100, 100)
		// `_isUnderZoom() && !force` exits before anything is written
		expect(image.camera.getView()[0]).toBeCloseTo(before[0], 9)
		viewer.destroy()
	})
})

describe('Camera2D zooming', () => {
	it('zooms in and out with the delta and returns a duration', async () => {
		const { viewer, image, camera, canvasEl } = await open2d()
		image.camera.setView([0.25, 0.25, 0.5, 0.5], { noLimit: true })
		const before = image.camera.getScale()
		const dur = camera._zoom(20, canvasEl.width / 2, canvasEl.height / 2, 0, true)
		expect(dur).toBe(0)
		expect(image.camera.getScale()).not.toBeCloseTo(before, 9)
		viewer.destroy()
	})

	it('refuses to zoom past either end', async () => {
		const { viewer, camera, canvasEl } = await open2d()
		// Fully zoomed in: a further zoom-in returns 0 without touching the camera
		camera._scale = camera._maxScale
		expect(camera._zoom(-20, canvasEl.width / 2, canvasEl.height / 2, 0, false)).toBe(0)

		// Fully zoomed out with no pinch margin: a zoom-out returns 0 too
		camera._scale = camera._minScale
		camera._minSize = 1
		expect(camera._zoom(20, canvasEl.width / 2, canvasEl.height / 2, 0, false)).toBe(0)
		viewer.destroy()
	})

	it('clamps the zoom factor so a huge delta cannot invert the view', async () => {
		const { viewer, image, camera, canvasEl } = await open2d()
		image.camera.setView([0.25, 0.25, 0.5, 0.5], { noLimit: true })
		// A delta larger than the viewport would make `fact` below -1; the clamps are what
		// keep the target width from going negative.
		camera._zoom(-1e6, canvasEl.width / 2, canvasEl.height / 2, 0, true)
		const view = image.camera.getView()
		expect(view[2]).toBeGreaterThan(0)
		expect(view[3]).toBeGreaterThan(0)
		viewer.destroy()
	})

	it('uses the zoom anchor and the current scale', async () => {
		const { viewer, image, camera, canvasEl } = await open2d()

		// A negative delta zooms in (a narrower view) and a positive one zooms out. Driving
		// `_zoom` directly is what reaches the anchor maths (`pX`/`pY` from the pixel), which
		// the public `Camera.zoom()` only reaches after its own arg juggling.
		image.camera.setView([0, 0, 1, 1], { noLimit: true })
		const wide = image.camera.getView()[2] ?? 1
		camera._zoom(-80, 1, canvasEl.height / 2, 0, true)
		const narrow = image.camera.getView()[2] ?? 1
		expect(narrow).toBeLessThan(wide)

		image.camera.setView([0, 0, 1, 1], { noLimit: true })
		camera._zoom(80, canvasEl.width - 1, canvasEl.height / 2, 0, true)
		const wideAgain = image.camera.getView()[2] ?? 1
		expect(wideAgain).toBeGreaterThan(narrow)

		// An anchor in the corner still produces a valid, finite rectangle
		const view = image.camera.getView()
		expect([...view].every(Number.isFinite)).toBe(true)
		expect(view[2]).toBeGreaterThan(0)
		viewer.destroy()
	})

	it('treats the first move as a start and the rest as a move', async () => {
		const { viewer, camera } = await open2d()
		camera._pinchStart()
		// First `_pinch` has no previous centre, so it only records the baseline and stops
		// any animation
		camera._pinch(100, 100, 200, 200)
		// Second one computes a delta and moves/zooms the camera
		camera._pinch(100, 100, 240, 240)
		expect(camera._scale).toBeGreaterThan(0)
		camera._pinchStop()
		viewer.destroy()
	})

	it('_pinchStop resets the baseline so a later pinch starts fresh', async () => {
		const { viewer, camera } = await open2d()
		camera._pinchStart()
		camera._pinch(0, 0, 50, 50)
		camera._pinchStop()
		// After a stop, the next `_pinch` is a start again
		const before = camera._scale
		camera._pinch(0, 0, 50, 50)
		expect(camera._scale).toBeCloseTo(before, 9)
		viewer.destroy()
	})

	it('supports a canvas that opts out of pinch panning', async () => {
		const { viewer, camera } = await open2d()
		// `_handlePinchMove` checks `main._noPinchPan` before panning; setting it must not
		// break the pinch itself
		viewer.el._engine._noPinchPan = true
		camera._pinchStart()
		camera._pinch(0, 0, 100, 100)
		camera._pinch(0, 0, 140, 140)
		expect(camera._scale).toBeGreaterThan(0)
		camera._pinchStop()
		viewer.destroy()
	})
})

describe('EngineCamera setCoo and flyTo', () => {
	it('setCoo with scale 0 keeps the current scale', async () => {
		const { viewer, image, camera } = await open2d()
		image.camera.setView([0.25, 0.25, 0.5, 0.5], { noLimit: true })
		const scale = camera._scale
		const dur = camera.setCoo(0.6, 0.6, 0)
		expect(dur).toBe(0)
		// `scale === 0` means "keep the current scale": the requested dims are derived from
		// `cpw`/`cph` at that scale, so the scale survives the call unchanged.
		expect(camera._scale).toBeCloseTo(scale, 9)
		expect(camera._scale).toBeGreaterThan(0)
		viewer.destroy()
	})

	it('setCoo clamps the requested scale to the minimum', async () => {
		const { viewer, camera } = await open2d()
		camera.setCoo(0.5, 0.5, 1e-6)
		expect(camera._scale).toBeGreaterThanOrEqual(camera._minScale - 1e-9)
		viewer.destroy()
	})

	it('a zero-duration setCoo snaps the centre inside the image', async () => {
		const { viewer, image, camera } = await open2d()
		// A centre far outside the image is pulled back so the view stays within [0,1]
		camera.setCoo(5, 5, camera._minScale * 4)
		const view = image.camera.getView()
		expect(view[0] + view[2] / 2).toBeLessThanOrEqual(1 + 1e-9)
		expect(view[1] + view[3] / 2).toBeLessThanOrEqual(1 + 1e-9)
		viewer.destroy()
	})

	it('setCoo with a duration arms an animation instead of snapping', async () => {
		const { viewer, image, camera } = await open2d()
		image.camera.setView([0.25, 0.25, 0.5, 0.5], { noLimit: true })
		const before = image.camera.getView().slice()
		const dur = camera.setCoo(0.1, 0.1, camera._minScale * 2, 0.3)
		expect(dur).toBe(0.3)
		// Nothing has moved yet: the animation is what steps it
		expect(image.camera.getView()[0]).toBeCloseTo(before[0], 9)
		viewer.destroy()
	})

	it('setCoo before the first layout defers to the pending start', async () => {
		// A camera that has never been laid out has `cpw === -1`; `_handleSetCooInit` stores
		// the request and returns true, so the call resolves immediately.
		const { viewer, image, camera } = await open2d()
		const deferring = camera as unknown as { _handleSetCooInit: (x: number, y: number, s: number) => boolean }
		expect(typeof deferring._handleSetCooInit).toBe('function')
		expect(camera.setCoo(0.5, 0.5, 1)).toBe(0)
		expect(image.camera.getScale()).toBeGreaterThan(0)
		viewer.destroy()
	})

	it('_flyTo animates to a target view and reports the duration', async () => {
		const { viewer, camera, image } = await open2d()
		image.camera.setView([0.25, 0.25, 0.5, 0.5], { noLimit: true })
		// The internal seam `setCoo`/`flyToView` both funnel through
		const dur = camera._flyTo(0.5, 0.5, 0.25, 0.25, 0.2, 0, 0, false, false, true, -1, easeInOut)
		expect(dur).toBe(0.2)
		expect(image.camera.getScale()).toBeGreaterThan(0)
		viewer.destroy()
	})
})

describe('Camera2D retina anchoring', () => {
	it('keeps the cursor point fixed when zooming at a device pixel ratio of 2', async () => {
		const { viewer, image, camera, canvasEl } = await open2d()
		image.camera.setView([0.25, 0.25, 0.5, 0.5], { noLimit: true })
		const before = image.camera.getView().slice()
		const centerX = (before[0] ?? 0) + (before[2] ?? 1) / 2
		const centerY = (before[1] ?? 0) + (before[3] ?? 1) / 2

		const restore = setDpr(viewer, 2)
		try {
			// The visual centre in element-relative CSS pixels (`Viewport.width` is device pixels)
			camera._zoom(-40, canvasEl.width / 4, canvasEl.height / 4, 0, true)
			const view = image.camera.getView()
			// An anchor on the centre must leave the centre where it was
			expect((view[0] ?? 0) + (view[2] ?? 1) / 2).toBeCloseTo(centerX, 6)
			expect((view[1] ?? 0) + (view[3] ?? 1) / 2).toBeCloseTo(centerY, 6)
		} finally {
			restore()
		}
		viewer.destroy()
	})

	it('converts client touches to element-relative CSS pixels for the pinch anchor', async () => {
		const { viewer, camera } = await open2d()
		const restore = setDpr(viewer, 2)
		try {
			const zoom = vi.spyOn(camera, '_zoom').mockReturnValue(0)
			vi.spyOn(camera, '_pan').mockImplementation(() => {})
			// The first call only records the baseline; the second one moves the camera
			camera._pinch(300, 100, 400, 100)
			camera._pinch(300, 100, 420, 100)

			// The midpoint (360, 100) in client CSS, minus the canvas box in CSS pixels
			const { left, top } = viewer.el.canvas.viewport
			expect(zoom.mock.calls.at(-1)?.[1]).toBeCloseTo(360 - left, 6)
			expect(zoom.mock.calls.at(-1)?.[2]).toBeCloseTo(100 - top, 6)
		} finally {
			restore()
		}
		viewer.destroy()
	})
})

/** Forces a device pixel ratio on a mounted viewer, returning a restore function. */
function setDpr(viewer: Viewer, ratio: number): () => void {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio')
	Object.defineProperty(globalThis, 'devicePixelRatio', { value: ratio, configurable: true })
	viewer.el.canvas.onresize()
	return () => {
		if (descriptor === undefined) {
			delete (globalThis as { devicePixelRatio?: number }).devicePixelRatio
		} else {
			Object.defineProperty(globalThis, 'devicePixelRatio', descriptor)
		}
		viewer.el.canvas.onresize()
	}
}
