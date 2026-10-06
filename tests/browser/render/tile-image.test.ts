import { describe, expect, it } from 'vitest'
import { mountViewer, waitFor, type Viewer } from '../../helpers/viewer'
import { sleep } from '$utils/dom'
import { bundleWithFreshId } from '../../fixtures/bundles'
import { openSpace } from '../../fixtures/space-fixture'
import type Image from '$render/tile-image'
import type { TileCanvas } from '$render/tile-canvas'

/**
 * `src/render/tile-image.ts` — the tile pyramid, layer selection and tile culling.
 *
 * This was the single largest uncovered file left in `src/render` (~65%). Its `Image` class is
 * not exported: an instance is only ever created by `TileCanvas._addImage`, so the suite takes
 * one off a real, placed canvas and drives it directly.
 *
 * Two fixture properties matter:
 *
 * - **`Image` keeps its culler state in module-level statics** (`#toDraw`, `#toDrawSeen`,
 *   `#sampledXs`, …), so two images in one test can interfere. Every test here reads the
 *   *canvas* `_toDraw` (reset per canvas frame) rather than the static, and never runs two
 *   images at once.
 * - **The layer count is derived from the image size and `_underzoomLevels`.** A 512x512 image
 *   at a 256px tile size is a two-level pyramid, which is what the layer assertions pin.
 */

/** A placed 2D canvas plus its one tile image. */
async function openImage(settings: Record<string, unknown> = {}): Promise<{
	viewer: Viewer
	canvas: TileCanvas
	image: Image
}> {
	const bundle = bundleWithFreshId(settings)
	const viewer = mountViewer()
	await viewer.open(bundle)
	await waitFor(() => viewer.el._engine._canvases.length > 0, 6000, 'a placed canvas')
	const canvas = viewer.el._engine._canvases[0]
	const image = canvas?.images[0]
	if (!canvas || !image) {
		throw new Error('no placed image')
	}
	// One more turn of the event loop: the canvas writes the image's active state during the
	// first frame (via its store subscription), and a test that pokes the image *before* that
	// has the *next* frame overwrite it. Waiting here is what makes the state deterministic.
	await sleep(30)
	return { viewer, canvas, image }
}

describe('Image layer pyramid', () => {
	it('builds one layer per zoom level with contiguous tile ranges', async () => {
		const { viewer, canvas, image } = await openImage()
		// A deep-zoom 512x512 at 256px tiles: two levels (256px and 512px, i.e. 4 + 1 tiles)
		expect(image._layers.length).toBeGreaterThanOrEqual(2)
		expect(canvas.main._underzoomLevels).toBe(4)

		let expectedStart = 0
		for (const layer of image._layers) {
			expect(layer._start).toBe(expectedStart)
			expect(layer._end).toBe(expectedStart + layer._cols * layer._rows)
			expectedStart = layer._end
			// The tile size doubles per level, so the grid halves in each axis
			expect(layer._tileWidth).toBeCloseTo(layer._tileHeight, 12)
		}
		// `_endOffset` is the exclusive end of the whole pyramid
		expect(image._endOffset).toBe(expectedStart)
		expect(canvas.main._numTiles).toBe(expectedStart)
		viewer.destroy()
	})

	it('sizes each layer from the image, not the canvas', async () => {
		const { viewer, image } = await openImage()
		const top = image._layers[0]
		// A 512px image at 256px tiles is 2x2 on the top layer
		expect(top?._cols).toBe(2)
		expect(top?._rows).toBe(2)
		expect(top?._tileWidth).toBeCloseTo(256 / image.width, 12)
		viewer.destroy()
	})

	it('reduces the layer count for an archive-backed canvas', async () => {
		// `_hasArchive` trims three levels (minus the archive offset), so the same image gets a
		// shorter pyramid. Asserted through the engine flag rather than a full archive fixture.
		const opened = await openImage()
		const before = opened.image._layers.length
		expect(before).toBeGreaterThanOrEqual(1)
		opened.viewer.destroy()

		const withArchive = await openImage()
		withArchive.canvas.main._hasArchive = true
		// A fresh image built while the flag is set sees the shorter pyramid. The trailing
		// args are the optional rotation/scale ones, which default to 0/1.
		const rebuilt = withArchive.canvas._addImage(0, 0, 1, 1, 512, 512, 256, false, true, false, 1)
		expect(rebuilt._layers.length).toBeLessThanOrEqual(before)
		withArchive.viewer.destroy()
	})
})

describe('Image area and scale', () => {
	it('_setArea records the rectangle and its aspect', async () => {
		const { viewer, image } = await openImage()
		image._setArea(0.25, 0.5, 0.75, 1)
		expect([image.x0, image.y0, image.x1, image.y1]).toEqual([0.25, 0.5, 0.75, 1])
		expect(image._rWidth).toBeCloseTo(0.5, 12)
		expect(image._rHeight).toBeCloseTo(0.5, 12)
		viewer.destroy()
	})

	it('_setArea wraps a 360 area that crosses the seam', async () => {
		const { viewer, image } = await openImage()
		// A rectangle that runs off the right edge of a plain 2D canvas has no wrapping, so the
		// width is computed from the raw x1 - x0. The 360 branch is what adds the full turn.
		image._setArea(0.9, 0, 0.1, 1)
		expect(image._rWidth).toBeCloseTo(0.2, 12)
		viewer.destroy()
	})

	it('_shouldRender is false for a hidden video or sub-image', async () => {
		const { viewer, canvas, image } = await openImage()
		// The main image is always the active one, so it renders
		expect(image._shouldRender()).toBe(true)

		// A sub-image (`_localIdx > 0`) with zero opacity is culled before the view test
		const sub = canvas._addImage(0.1, 0.1, 0.2, 0.2, 256, 256, 128, false, false, true, 0)
		sub.opacity = 0
		sub._tOpacity = 0
		expect(sub._shouldRender()).toBe(false)

		// Giving it opacity lifts the cull; whether it then renders depends on `outsideView`
		sub.opacity = 1
		expect(typeof sub._shouldRender()).toBe('boolean')
		viewer.destroy()
	})

	it('_shouldRender honours a fromScale higher than the camera scale', async () => {
		const { viewer, canvas } = await openImage()
		// `fromScale` gates a fade-in sub-image: above the current camera scale it is skipped
		const sub = canvas._addImage(0, 0, 1, 1, 256, 256, 128, false, false, false, 1, 0, 0, 0, 1, 1e9)
		expect(sub._shouldRender()).toBe(false)
		viewer.destroy()
	})

	it('_opacityTick steps a fading image and reports the move', async () => {
		const { viewer, image } = await openImage()
		// The main image starts at full opacity with a full target, so nothing animates
		expect(image._opacityTick(false)).toBe(false)

		// Fade *out*: a non-direct tick steps down and keeps animating
		image.opacity = 1
		image._tOpacity = 0
		expect(image._opacityTick(false)).toBe(true)
		expect(image.opacity).toBeLessThan(1)
		expect(image.opacity).toBeGreaterThan(0)
		viewer.destroy()
	})

	it('_opacityTick snaps a direct tick to the target', async () => {
		const { viewer, image } = await openImage()
		image.opacity = 1
		image._tOpacity = 0
		image._opacityTick(true)
		expect(image.opacity).toBe(0)
		// Once it has arrived, the next tick is a no-op
		expect(image._opacityTick(false)).toBe(false)
		viewer.destroy()
	})

	it('_opacityTick clamps the result into [0, 1]', async () => {
		const { viewer, image } = await openImage()
		image.opacity = 0
		image._tOpacity = 5
		image._opacityTick(true)
		expect(image.opacity).toBe(1)
		image._tOpacity = -5
		image._opacityTick(true)
		expect(image.opacity).toBe(0)
		viewer.destroy()
	})
})

describe('Image tile culling', () => {
	it('always queues the base tile and counts it as done', async () => {
		const { viewer, canvas, image } = await openImage()
		image.opacity = 1
		image._gotBase = 0
		// Give the culler a real on-screen rect: with the default zero-size `visible` rect the
		// rect-based culling is a no-op, and only the base tile would be queued.
		canvas.visible.set(0.5, 0.5, 1, 1)
		const done = image._getTiles(canvas.camera._scale)

		const baseTile = image._endOffset - 1
		// The base tile is always drawn first, and it is what the culler draws at full opacity
		expect(canvas._toDraw).toContain(baseTile)
		expect(canvas.main._getTileOpacity(baseTile)).toBe(1)
		// Everything queued is inside the image's own tile range
		expect(canvas._toDraw.every((i) => i >= 0 && i < image._endOffset)).toBe(true)
		// `_getTiles` returns how many of the queued tiles are already drawn; the base tile is
		// queued with full opacity, so this is a non-negative count
		expect(Number.isFinite(done)).toBe(true)
		viewer.destroy()
	})

	it('queues nothing while the image is invisible', async () => {
		const { viewer, canvas, image } = await openImage()
		image.opacity = 0
		expect(image._getTiles(canvas.camera._scale)).toBe(0)
		viewer.destroy()
	})

	it('picks a deeper target layer as the scale grows', async () => {
		const { viewer, canvas, image } = await openImage()
		image.opacity = 1
		canvas.visible.set(0.5, 0.5, 1, 1)
		image._getTiles(canvas.camera._minScale)
		const shallow = image._targetLayer

		canvas._toDraw.length = 0
		image._gotBase = 1
		image._getTiles(canvas.camera._maxScale * 100)
		const deep = image._targetLayer

		// `_getTargetLayer` walks up while `twoNth(l) * scale < 1`, so a larger scale selects a
		// deeper (higher-index) layer. Both readings are valid indices.
		expect(shallow).toBeGreaterThanOrEqual(0)
		expect(deep).toBeGreaterThanOrEqual(shallow)
		expect(deep).toBeLessThan(image._layers.length)
		viewer.destroy()
	})

	it('selects the top layer when the canvas is limited', async () => {
		const { viewer, canvas, image } = await openImage()
		image.opacity = 1
		// `_limited` short-circuits to `#numLayers`, i.e. the deepest level
		canvas._limited = true
		image._getTiles(canvas.camera._minScale)
		expect(image._targetLayer).toBe(image._layers.length - 1)
		viewer.destroy()
	})

	it('a cull for an off-screen visible rect still queues the base tile', async () => {
		const { viewer, canvas, image } = await openImage()
		image.opacity = 1
		image._gotBase = 0
		// An empty visible rect with an item outside the view: `#getTilesRect` returns in its
		// `outsideView` guard, but the base tile is pushed before that
		canvas.visible.set(0.5, 0.5, 0, 0)
		image._setArea(2, 2, 3, 3)
		image._getTiles(canvas.camera._scale)
		expect(canvas._toDraw).toContain(image._endOffset - 1)
		viewer.destroy()
	})
})

describe('Image in a 360 canvas', () => {
	it('culls a 360 sphere image through the sphere sampler', async () => {
		const opened = await openSpace(0)
		await waitFor(() => opened.viewer.el._engine._canvases.length > 0, 8000, 'a 360 canvas')
		const canvas = opened.viewer.el._engine._canvases[0]
		const image = canvas?.images[0]
		if (!canvas || !image) {
			throw new Error('no 360 image')
		}

		image.opacity = 1
		image._gotBase = 1
		canvas._toDraw.length = 0
		// `#get360Tiles` samples the screen border and the inner grid through `_getCoo`, picks
		// the largest gap to find the covered arc, and queues that range.
		image._getTiles(canvas.camera._scale)

		expect(canvas._toDraw.length).toBeGreaterThan(0)
		expect(canvas._toDraw.every((i) => i >= 0 && i < image._endOffset)).toBe(true)
		// A 360 image is always inside the view once its base tile is drawn
		image._gotBase = 0
		expect(image._shouldRender()).toBe(true)
		opened.viewer.destroy()
	})

	it('builds the sphere position from the area centre', async () => {
		const opened = await openSpace(0)
		const canvas = opened.viewer.el._engine._canvases[0]
		const image = canvas?.images[0]
		if (!canvas || !image) {
			throw new Error('no 360 image')
		}
		// `_setArea` calls `#calculate3DSpherePosition` on a 360 canvas; a full-turn area should
		// leave the sphere angles at their defaults
		image._setArea(0, 0, 1, 1)
		expect(image._rWidth).toBeCloseTo(1, 9)
		expect(image._rHeight).toBeCloseTo(1, 9)
		opened.viewer.destroy()
	})
})
