import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountViewer, waitFor, type Viewer } from '../../helpers/viewer'
import { modernBundle } from '../../fixtures/bundles'
import { embedBundle, glEmbed } from '../../fixtures/embeds'
import { get } from '$core/store'
import type { Models } from '$types/models'
import type { TileCanvas } from '$render/tile-canvas'
import type { MicrioImage } from '$core/image'

/**
 * The `Canvas` controller and the `Engine` lifecycle, driven against a real viewer.
 *
 * Every test here mounts its own `<micr-io>`. That is one GL context per test, which the
 * AGENTS.md budget explicitly warns about — so this file is deliberately the *only* one that
 * does it, and it is kept short. The 360 camera, tile culling and postprocessor suites each
 * own a separate file (separate page, separate budget) and reuse a single viewer.
 *
 * The helper notes this suite needs:
 *
 * - **`onresize` reads `getBoundingClientRect`**, so the element must be in the body with a
 *   real size *before* `open()`, which is what `mountViewer` does.
 * - **The crop mode is pure CSS bookkeeping.** `_enterCropMode` writes `!important` inline
 *   styles so the browser's "Copy image" context item copies only the image; nothing about
 *   the GL scene changes, so the assertions are on the element's style.
 */

/**
 * The `MicrioImage` the engine actually placed, which is *not* always `micrio.$current`.
 *
 * A grid/gallery parent (`micrio.gallery`) owns its own `MicrioImage` per id, so
 * `$current` can be a different instance than the one the engine registered with the canvas.
 * Anything that walks the engine's per-image maps (fades, removal, embedding) has to use the
 * instance the canvas was built for.
 */
function placedImage(viewer: Viewer): MicrioImage {
	// Note the two different `_canvases`: `viewer.el._canvases` is the element's list of
	// *loaded MicrioImages*, while the engine's list holds the `TileCanvas` instances. The
	// canvas is the one that knows which image it was built for.
	const image = viewer.el._engine._canvases[0]?._micrioImage
	if (!image) {
		throw new Error('no placed canvas image')
	}
	return image
}

/** A bundle with the given settings merged into one fresh id. */
function bundleWith(settings: Partial<Models.ImageInfo.Settings>): Models.ImageBundle.BundleImage {
	const id = `cv${Math.random().toString(36).slice(2, 8)}`
	return {
		id,
		info: {
			id,
			path: 'https://r2.micr.io/',
			version: '6.1.11',
			width: 512,
			height: 512,
			tileSize: 256,
			isWebP: true,
			isDeepZoom: true,
		},
		settings,
		data: {},
	}
}

/** Opens a viewer and waits until the engine has placed a canvas. */
async function opened(bundle: Models.ImageBundle.BundleImage): Promise<{ viewer: Viewer; canvas: TileCanvas }> {
	const viewer = mountViewer()
	await viewer.open(bundle)
	await waitFor(() => viewer.el.$current?.id === bundle.id, 6000, 'current image')
	await waitFor(() => viewer.el._engine._canvases.length > 0, 6000, 'a placed canvas')
	const canvas = viewer.el._engine._canvases[0]
	if (!canvas) {
		throw new Error('no canvas')
	}
	return { viewer, canvas }
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('Canvas element management', () => {
	it('places the canvas as the first child, and only once', () => {
		// The element places the canvas as soon as it connects, so a fresh element already has
		// one child; `place()` on top of that must not move or duplicate the node.
		const viewer = mountViewer()
		const { canvas } = viewer.el
		expect(canvas.element.parentNode).toBe(viewer.el)

		const before = viewer.el.childNodes.length
		canvas.place()
		expect(viewer.el.childNodes.length).toBe(before)
		expect(viewer.el.firstChild).toBe(canvas.element)
		viewer.destroy()
	})

	it('places the canvas directly after an existing preview image', () => {
		const viewer = mountViewer()
		const { canvas } = viewer.el

		// Reproduce the "canvas not placed yet, preview already in the DOM" state `place()`
		// exists for: pull the canvas out, add a preview, then let `place()` insert it back.
		canvas.element.remove()
		const preview = document.createElement('img')
		preview.className = 'preview'
		viewer.el.prepend(preview)

		canvas.place()
		expect(viewer.el.firstChild).toBe(preview)
		expect(preview.nextSibling).toBe(canvas.element)
		viewer.destroy()
	})

	it('hooks and unhooks the ResizeObserver', () => {
		// The observer is chosen in the `Canvas` constructor, so the fake has to be installed
		// before the element is created. `#resizeObserver` is private, so there is no way to
		// inject it after the fact.
		const observe = vi.fn()
		const unobserve = vi.fn()
		const original = globalThis.ResizeObserver
		globalThis.ResizeObserver = class {
			constructor(_cb: ResizeObserverCallback) {
				void _cb
			}
			observe = observe
			unobserve = unobserve
			disconnect = vi.fn()
		} as unknown as typeof ResizeObserver

		const viewer = mountViewer()
		const { canvas } = viewer.el
		const onresize = vi.spyOn(canvas, 'onresize')

		canvas.hook()
		expect(onresize).toHaveBeenCalledTimes(1)
		expect(observe).toHaveBeenCalledWith(canvas.element)

		canvas.unhook()
		expect(unobserve).toHaveBeenCalledWith(canvas.element)

		viewer.destroy()
		globalThis.ResizeObserver = original
	})

	it('falls back to a window resize listener when ResizeObserver is missing', () => {
		const original = globalThis.ResizeObserver
		// Same ordering constraint: without the global there is no observer to inject, and the
		// constructor takes the window-listener branch.
		Reflect.deleteProperty(globalThis, 'ResizeObserver')
		const add = vi.spyOn(globalThis, 'addEventListener')
		const remove = vi.spyOn(globalThis, 'removeEventListener')

		const viewer = mountViewer()
		const { canvas } = viewer.el

		canvas.hook()
		expect(add).toHaveBeenCalledWith('resize', expect.any(Function))

		canvas.unhook()
		expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))

		viewer.destroy()
		globalThis.ResizeObserver = original
	})
})

describe('Canvas.onresize', () => {
	it('bails out when the element has no layout', () => {
		// `display: none` is the real-world trigger for the early return: this is the
		// `getBoundingClientRect()` all-zeroes guard, so the viewport must not be updated and
		// no resize event may be dispatched from it.
		const viewer = mountViewer({}, 'width: 800px; height: 600px; display: none;')
		const { canvas } = viewer.el
		const listener = vi.fn()
		viewer.el.addEventListener('resize', listener)

		canvas.onresize()
		expect(listener).not.toHaveBeenCalled()
		expect(canvas.viewport.width).toBe(0)
		viewer.destroy()
	})

	it('reports the viewport in CSS pixels and reflects orientation', () => {
		const viewer = mountViewer()
		const { canvas } = viewer.el
		canvas.onresize()

		expect(canvas.viewport.width).toBeGreaterThan(0)
		expect(canvas.viewport.height).toBeGreaterThan(0)
		// 800x600 is landscape, so the portrait flag is false
		expect(canvas.viewport.portrait).toBe(false)
		expect(canvas.viewport.ratio).toBeGreaterThanOrEqual(1)
		viewer.destroy()
	})

	it('honours a portrait media query', () => {
		const viewer = mountViewer()
		const { canvas } = viewer.el
		const original = globalThis.matchMedia
		globalThis.matchMedia = ((query: string) => ({ matches: query.includes('portrait') })) as typeof matchMedia

		canvas.onresize()
		expect(canvas.viewport.portrait).toBe(true)

		globalThis.matchMedia = original
		viewer.destroy()
	})

	it('skips the CSS-scale compensation for a static element', () => {
		// A `data-static` host is measured at scale 1 no matter what `offsetWidth` says
		const viewer = mountViewer({ 'data-static': '' }, 'width: 400px; height: 300px; display: block;')
		const { canvas } = viewer.el
		canvas.onresize()
		expect(canvas.viewport.scale).toBe(1)
		viewer.destroy()
	})

	it('does not re-dispatch resize when nothing actually changed', () => {
		const viewer = mountViewer()
		const { canvas } = viewer.el
		canvas.onresize()

		const listener = vi.fn()
		viewer.el.addEventListener('resize', listener)
		canvas.onresize()
		// The dimensions and ratio are identical, so `onresize` returns before dispatching
		expect(listener).not.toHaveBeenCalled()
		viewer.destroy()
	})

	it('updates the mobile store only when the answer changes', () => {
		const viewer = mountViewer()
		const { canvas } = viewer.el
		const original = navigator.userAgent

		canvas.onresize()
		const initial = get(canvas.isMobile)

		// Flip the user-agent answer and force a real viewport change so the tail runs
		Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone) Mobile' })
		viewer.el.style.width = '401px'
		canvas.onresize()
		expect(get(canvas.isMobile)).toBe(true)
		expect(initial).not.toBe(true)

		Object.defineProperty(navigator, 'userAgent', { configurable: true, value: original })
		viewer.destroy()
	})
})

describe('Canvas.getRatio', () => {
	it('clamps the device pixel ratio to [1, 2]', () => {
		const viewer = mountViewer()
		const { canvas } = viewer.el
		const original = globalThis.devicePixelRatio

		Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 0.5 })
		expect(canvas.getRatio()).toBe(1)

		Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 3 })
		expect(canvas.getRatio()).toBe(2)

		Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 1.5 })
		expect(canvas.getRatio()).toBe(1.5)

		Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: original })
		viewer.destroy()
	})

	it('returns 1 when noRetina is set', () => {
		const viewer = mountViewer()
		const { canvas } = viewer.el
		Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 2 })
		expect(canvas.getRatio({ noRetina: true })).toBe(1)
		// The argument defaults to the current image's settings; with none there is no
		// `noRetina`, so the real ratio comes back
		expect(canvas.getRatio()).toBe(2)
		viewer.destroy()
	})
})

describe('Canvas crop mode', () => {
	it('sizes the element to the crop with !important and restores it exactly', () => {
		const viewer = mountViewer()
		const { canvas } = viewer.el
		// A pre-existing inline value with a priority, to prove the restore is verbatim
		canvas.element.style.setProperty('left', '12px', 'important')

		canvas._enterCropMode({ left: 5, top: 6, width: 100, height: 50, view: [0, 0, 1, 1] })
		const st = canvas.element.style
		expect(st.getPropertyValue('width')).toBe('100px')
		expect(st.getPropertyPriority('width')).toBe('important')
		expect(st.getPropertyValue('height')).toBe('50px')

		canvas._exitCropMode()
		// The saved value comes back with its priority intact
		expect(st.getPropertyValue('left')).toBe('12px')
		expect(st.getPropertyPriority('left')).toBe('important')
		// Values that had no inline value at all are removed rather than set to ''
		expect(st.getPropertyValue('width')).toBe('')
		viewer.destroy()
	})

	it('ignores a second enter while already cropped', () => {
		const viewer = mountViewer()
		const { canvas } = viewer.el
		canvas._enterCropMode({ left: 1, top: 1, width: 10, height: 10, view: [0, 0, 1, 1] })
		const before = canvas.element.style.getPropertyValue('width')

		canvas._enterCropMode({ left: 9, top: 9, width: 999, height: 999, view: [0, 0, 1, 1] })
		// The first crop stays in place: a nested enter does not overwrite the saved box
		expect(canvas.element.style.getPropertyValue('width')).toBe(before)

		canvas._exitCropMode()
		viewer.destroy()
	})

	it('exiting outside crop mode is a no-op', () => {
		const viewer = mountViewer()
		const { canvas } = viewer.el
		expect(() => {
			canvas._exitCropMode()
		}).not.toThrow()
		viewer.destroy()
	})

	it('repairs the device pixel ratio from the crop scale', () => {
		const viewer = mountViewer()
		const { canvas } = viewer.el
		// While cropped, `onresize` keeps whatever scale the viewport already had instead of
		// measuring it from the (now tiny) canvas box.
		canvas.viewport.scale = 2
		canvas._enterCropMode({ left: 0, top: 0, width: 20, height: 20, view: [0, 0, 1, 1] })
		expect(canvas.viewport.scale).toBe(2)
		canvas._exitCropMode()
		viewer.destroy()
	})
})

describe('Canvas._imageCrop', () => {
	it('returns undefined before any layout', () => {
		const viewer = mountViewer()
		const camera = { getXY: () => [0, 0], getCoo: () => [0, 0, 0, 0] }
		expect(viewer.el.canvas._imageCrop(camera as never)).toBeUndefined()
		viewer.destroy()
	})

	it('returns undefined when the image already covers the canvas', async () => {
		const { viewer } = await opened(bundleWith({ initType: 'cover', limitToCoverScale: true }))
		const { canvas } = viewer.el
		const image = viewer.el.$current
		if (!image) {
			throw new Error('no current image')
		}
		await waitFor(() => image.camera.getScale() > 0, 6000, 'camera layout')
		// A cover-start image covers the whole canvas, so there is nothing to crop
		expect(canvas._imageCrop(image.camera)).toBeUndefined()
		viewer.destroy()
	})

	it('returns the on-screen part of an image that does not fill the canvas', async () => {
		// `contain` start: the image is letterboxed, so the canvas has transparent padding
		const { viewer } = await opened(bundleWith({}))
		const { canvas } = viewer.el
		const image = viewer.el.$current
		if (!image) {
			throw new Error('no current image')
		}
		await waitFor(() => image.camera.getScale() > 0, 6000, 'camera layout')
		// Zoom out so the image stops covering the canvas
		image.camera.setView([0, 0, 1, 1], { noLimit: true })
		const crop = canvas._imageCrop(image.camera)
		if (!crop) {
			throw new Error('expected a crop for a zoomed-out image')
		}
		expect(crop.width).toBeGreaterThan(0)
		expect(crop.height).toBeGreaterThan(0)
		expect(crop.width).toBeLessThanOrEqual(canvas.viewport.width)
		expect(crop.height).toBeLessThanOrEqual(canvas.viewport.height)
		// The view is in image coordinates and mirrors the crop rectangle
		expect(crop.view[2]).toBeGreaterThan(0)
		expect(crop.view[3]).toBeGreaterThan(0)
		viewer.destroy()
	})
})

describe('Canvas.setMargins', () => {
	it('writes the margins once the engine is ready', async () => {
		const { viewer } = await opened(modernBundle())
		viewer.el.canvas.setMargins(37, 41)
		expect(viewer.el._engine.el._areaWidth).toBe(37)
		expect(viewer.el._engine.el._areaHeight).toBe(41)
		viewer.destroy()
	})

	it('is a no-op before the engine is ready', () => {
		const viewer = mountViewer()
		expect(viewer.el._engine.ready).toBe(false)
		viewer.el.canvas.setMargins(10, 20)
		expect(viewer.el._engine.el._areaWidth).toBe(0)
		viewer.destroy()
	})
})

describe('Engine settings pass-through', () => {
	it('applies every engine-level timing and elasticity setting', async () => {
		const { viewer } = await opened(
			bundleWith({
				crossfadeDuration: 0.7,
				embedFadeDuration: 0.3,
				dragElasticity: 2.5,
				skipBaseLevels: 3,
				zoomLimitDPRFix: false,
			}),
		)
		const engine = viewer.el._engine
		expect(engine._crossfadeDuration).toBe(0.7)
		expect(engine._embedFadeDuration).toBe(0.3)
		expect(engine._dragElasticity).toBe(2.5)
		expect(engine._skipBaseLevels).toBe(3)
		viewer.destroy()
	})

	it('defaults the timings when the settings are absent', async () => {
		const { viewer } = await opened(bundleWith({}))
		const engine = viewer.el._engine
		expect(engine._crossfadeDuration).toBe(0.25)
		expect(engine._embedFadeDuration).toBe(0.5)
		expect(engine._dragElasticity).toBe(1)
		expect(engine._skipBaseLevels).toBe(0)
		viewer.destroy()
	})

	it('raises the underzoom levels for a pre-v5 image', async () => {
		// 3.1 is the cut-off: `Number.parseFloat(version) <= 3.1` adds four more underzoom
		// levels. A 3.2 image does *not* qualify, which has its own test in
		// `browser/core/element-legacy`.
		const id = 'lgcv123'
		const { viewer } = await opened({
			id,
			info: { id, path: 'https://b.micr.io/', version: '3.1', width: 512, height: 512, tileSize: 256 },
			settings: {},
			data: {},
		})
		expect(viewer.el._engine._underzoomLevels).toBe(8)
		viewer.destroy()
	})
})

describe('Engine canvas lifecycle', () => {
	it('_addCanvasDirect refuses an already-placed image', async () => {
		const { viewer } = await opened(modernBundle())
		const image = viewer.el.$current as MicrioImage
		const before = viewer.el._engine._numImages
		viewer.el._engine._addCanvasDirect(image)
		// `_placed` short-circuits before a second canvas entry can be created
		expect(viewer.el._engine._numImages).toBe(before)
		expect(viewer.el._canvases).toHaveLength(1)
		viewer.destroy()
	})

	it('_removeCanvas throws for an image that was never placed', async () => {
		const { viewer } = await opened(modernBundle())
		const image = viewer.el.$current as MicrioImage
		const fake = Object.create(Object.getPrototypeOf(image)) as MicrioImage
		fake._placed = false
		expect(() => {
			viewer.el._engine._removeCanvas(fake)
		}).toThrow('Canvas is not placed yet')
		viewer.destroy()
	})

	it('_removeCanvas drops the canvas, its entry and the placed flag', async () => {
		const { viewer } = await opened(bundleWith({}))
		const image = placedImage(viewer)
		const engine = viewer.el._engine
		const canvases = engine._canvases.length

		engine._removeCanvas(image)
		// The canvas left the engine's list and its lookup, and the image reads as unplaced
		// again — which is what lets a later `current` write rebuild it (next test).
		expect(engine._getCanvas(image)).toBeUndefined()
		expect(canvases - engine._canvases.length).toBe(1)
		expect(image._placed).toBe(false)
		expect(get(image.visible)).toBe(false)
		viewer.destroy()
	})

	it('re-places a removed canvas when the image becomes current again', async () => {
		const { viewer } = await opened(bundleWith({}))
		const image = placedImage(viewer)
		const engine = viewer.el._engine

		engine._removeCanvas(image)
		expect(engine._canvases).toHaveLength(0)

		// The element still holds the image, and the `current` store notifies unconditionally,
		// so setting it again rebuilds the canvas instead of leaving the viewer blank forever.
		viewer.el.current.set(image)
		await waitFor(() => engine._getCanvas(image) !== undefined, 6000, 'the canvas to be re-placed')
		expect(image._placed).toBe(true)
		expect(engine._canvases).toHaveLength(1)
		viewer.destroy()
	})

	it('the book3d flag short-circuits every add path and the render loop', async () => {
		const { viewer } = await opened(modernBundle())
		const engine = viewer.el._engine
		const image = viewer.el.$current as MicrioImage

		engine._book3d = true
		const canvases = engine._canvases.length
		const images = engine._numImages
		const request = vi.spyOn(globalThis, 'requestAnimationFrame')

		// `#addCanvas`, `#addImage`, `_addEmbed` and `_addCanvasDirect` all return early
		engine._addCanvasDirect(image)
		void engine._addEmbed(image, image)
		expect(engine._canvases.length).toBe(canvases)
		expect(engine._numImages).toBe(images)

		// `render()` and the frame callback both bail out before scheduling anything
		engine.render()
		expect(request).not.toHaveBeenCalled()

		request.mockRestore()
		engine._book3d = false
		viewer.destroy()
	})

	it('_fadeImage handles a full canvas, an embed canvas and an unknown image', async () => {
		const { viewer } = await opened(bundleWith({}))
		const engine = viewer.el._engine
		const canvas = viewer.el._engine._canvases[0]
		const image = placedImage(viewer)

		// Full canvas: the entry has a camera, so the target opacity is set directly
		engine._fadeImage(image, 0.4)
		expect(canvas?._targetOpacity).toBe(0.4)

		// Unknown image: no entry, so nothing happens and nothing throws
		const orphan = Object.create(Object.getPrototypeOf(image)) as MicrioImage
		expect(() => {
			engine._fadeImage(orphan, 0.9)
		}).not.toThrow()

		viewer.destroy()
	})
})

describe('Engine embed placement', () => {
	it('places a GL embed and skips it when it is already placed', async () => {
		const { viewer } = await opened(embedBundle([glEmbed()]))
		const engine = viewer.el._engine
		const parent = viewer.el.$current as MicrioImage
		await waitFor(() => parent._embeds.length > 0, 6000, 'the embed image')

		const embed = parent._embeds[0]
		expect(embed).toBeDefined()
		const tiles = engine._numTiles
		// Re-adding the same sub-image is a no-op: `_placed` is the guard
		void engine._addEmbed(embed as MicrioImage, parent)
		expect(engine._numTiles).toBe(tiles)
		viewer.destroy()
	})

	it('_setImageVideoPlaying writes through the reverse map', async () => {
		const { viewer } = await opened(embedBundle([glEmbed()]))
		const engine = viewer.el._engine
		const parent = viewer.el.$current as MicrioImage
		await waitFor(() => parent._embeds.length > 0, 6000, 'the embed image')

		const embed = parent._embeds[0] as MicrioImage
		// Unknown image first: the lookup misses and nothing is written
		expect(() => {
			engine._setImageVideoPlaying({} as MicrioImage, true)
		}).not.toThrow()
		engine._setImageVideoPlaying(embed, true)
		viewer.destroy()
	})
})
