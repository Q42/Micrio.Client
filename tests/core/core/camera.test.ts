import { describe, expect, it, vi } from 'vitest'
import type { MicrioImage } from '$core/image'
import type { TileCanvas } from '$render/tile-canvas'
import { Camera } from '$core/camera'
import { Coordinates } from '$render/shared'
import { linear } from '$render/easing'
import { get, writable } from '$core/store'

/**
 * The `Camera` facade (`src/core/camera.ts`) in isolation: a hand-built engine canvas
 * stub and a stub image, no DOM and no WebGL.
 *
 * `src/core/camera.ts` was the thinnest file in `src/core` (63.9% in TESTING.md): the
 * browser suites reach it only through a full viewer, so everything behind an
 * `if (!this.#canvas) return` guard, and every argument the facade hands the engine, was
 * unpinned. Most of the class is delegation, and the value of the test is *what* it
 * delegates with — which argument order, which normalisation, which branch — so a stub
 * that records its calls is the right instrument. `camera-2d.test.ts` and
 * `engine-360.test.ts` own the actual camera maths.
 *
 * What stays uncovered are the lines that only an actively animating viewer reaches
 * (the pending-promise tails and the 360 `_getCoo` path); they are the deliberate gap.
 */

/** A plain record cast once into the engine type the facade is written against. */
type Loose = Record<string, unknown>

/** A recording function; each call site gets its own spy. */
const fn = () => vi.fn()

/** A recording function with an implementation. */
const fnOf = <T>(impl: () => T) => vi.fn(impl)

/**
 * The engine's coordinate payload; the facade reads `.arr` off exactly this shape.
 * `_toArray()` is what fills `.arr` — without it the engine hands back five zeros.
 */
const coordinates = (...values: [number, number, number, number, number?]) => {
	const c = new Coordinates(...values)
	c._toArray()
	return c
}

/** Shallow-merges a canvas stub's named sub-objects so an override keeps the defaults. */
function merged(base: Loose, overrides: Loose): Loose {
	const out = { ...base }
	for (const [key, value] of Object.entries(overrides)) {
		const previous = out[key]
		out[key] = isPlainObject(previous) && isPlainObject(value) ? { ...(previous as Loose), ...(value as Loose) } : value
	}
	return out
}

function isPlainObject(v: unknown): boolean {
	return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Float64Array)
}

function canvas(overrides: Loose = {}): TileCanvas {
	// `view` is a plain `{ arr }`: `getView`/`getViewRaw` read exactly that, and a real
	// `View` would drag the whole canvas/engine graph in for one Float64Array.
	const base: Loose = {
		is360: false,
		view: { arr: new Float64Array([0.5, 0.5, 1, 1]), _setLimit: fn() },
		camera: {
			_coverScale: 0.5,
			_minScale: 0.25,
			_minSize: 0.5,
			setCoo: fn(),
			_flyTo: fnOf(() => 0),
			_zoom: fnOf(() => 0),
			_pan: fn(),
			_isZoomedIn: fnOf(() => false),
			_isZoomedOut: fnOf(() => true),
			_getCoo: fnOf(() => coordinates(0.1, 0.2, 0.3, 0.4)),
		},
		_camera2d: {
			_getXY: fnOf(() => coordinates(1, 2, 3, 4)),
			_getXYOmni: fnOf(() => coordinates(5, 6, 7, 8)),
			_getXYOmniCoo: fnOf(() => coordinates(9, 10, 11, 12)),
		},
		_camera360: {
			_yaw: 0,
			_pitch: 0,
			_getCoo: fnOf(() => coordinates(0.1, 0.2, 0.3, 0.4)),
			_getXYZ: fnOf(() => coordinates(2, 3, 4, 5)),
			_setLimits: fn(),
		},
		_setView: fn(),
		_setArea: fn(),
		_coverLimit: false,
		_correctMinMax: fn(),
		_setMinScale: fn(),
		_setDirection: fn(),
		_isZoomedIn: fnOf(() => false),
		_isZoomedOut: fnOf(() => true),
		_ani: { _setStartView: fn() },
		_aniStop: fn(),
		_aniPause: fn(),
		_aniResume: fn(),
	}
	return merged(base, overrides) as unknown as TileCanvas
}

function image(overrides: Loose = {}): MicrioImage {
	const base: Loose = {
		_is360: false,
		opts: {},
		state: { view: writable() },
		$settings: {},
		$info: { width: 1000, height: 500 },
		engine: {
			ready: true,
			render: fn(),
			micrio: {
				canvas: { viewport: { width: 800, height: 600 } },
				getBoundingClientRect: () => ({ left: 10, top: 20 }),
				state: { _touch: fn() },
			},
			_getEngImage: fn(),
		},
	}
	return merged(base, overrides) as unknown as MicrioImage
}

/** A camera bound to a recording stub canvas; `c`/`i` are the recording halves. */
function bound(canvasOverrides: Loose = {}, imageOverrides: Loose = {}) {
	const c = canvas(canvasOverrides)
	const i = image(imageOverrides)
	const camera = new Camera(i)
	camera._bindEngineCanvas(c)
	return { camera, c, i }
}

/** A camera whose image exists but never had `_bindEngineCanvas` called. */
function unbound(): Camera {
	return new Camera(image())
}

describe('Camera without a bound engine canvas', () => {
	it('reports neutral defaults for every getter', () => {
		const camera = unbound()
		expect(camera.getView()).toEqual([0, 0, 1, 1])
		expect(camera.getScale()).toBe(1)
		expect(camera.getCoverScale()).toBe(1)
		expect(camera.getMinScale()).toBe(0.1)
		expect(camera.getDirection()).toBe(0)
		expect(camera.getPitch()).toBe(0)
		expect(camera.getCoverLimit()).toBe(false)
		expect(camera.isZoomedIn()).toBe(false)
		// Unbound `isZoomedOut` reports false, not true: it negates the (absent) canvas
		// predicate, so "no canvas" reads as "not zoomed out" for both predicates.
		expect(camera.isZoomedOut()).toBe(false)
		expect(camera.getMatrix(0, 0).every((n) => n === 0)).toBe(true)
		expect(camera.getOmniXY(0, 0, 0).every((n) => n === 0)).toBe(true)
	})

	it('hands back a fresh zero buffer from getViewRaw, not a live one', () => {
		// Unbound there is no engine buffer to point at, so each call allocates. Two calls
		// must not share one buffer.
		const camera = unbound()
		const a = camera.getViewRaw()
		const b = camera.getViewRaw()
		expect(a).toBeInstanceOf(Float64Array)
		expect([...a]).toEqual([0, 0, 0, 0])
		expect(a).not.toBe(b)
	})

	it('returns five zeroed coordinates from getCoo and getXY', () => {
		const camera = unbound()
		expect([...camera.getCoo(10, 20)]).toEqual([0, 0, 0, 0, 0])
		expect([...camera.getXY(0.5, 0.5)]).toEqual([0, 0, 0, 0, 0])
	})

	it('silently ignores every mutator', () => {
		const camera = unbound()
		expect(() => {
			camera.setView([0, 0, 1, 1])
			camera.setCoo(0.5, 0.5)
			camera.setScale(2)
			camera.setMinScale(0.5)
			camera.setMinScreenSize(0.5)
			camera.setLimit([0, 0, 1, 1])
			camera.setCoverLimit(true)
			camera.set360RangeLimit(10, 10)
			camera.setDirection(1, 1)
			camera.setArea([0, 0, 1, 1])
			camera.setRotation(1)
			camera.pan(1, 1)
			camera.stop()
			camera.pause()
			camera.resume()
			camera._viewChanged()
		}).not.toThrow()
	})

	it('rejects flyTo* with "engine not ready" but resolves an instant zoom', async () => {
		// The one asymmetry in the file: the flyTo promise family aborts, `zoom` resolves.
		const camera = unbound()
		await expect(camera.flyToView([0, 0, 1, 1])).rejects.toThrow('engine not ready')
		await expect(camera.flyToCoo([0.5, 0.5])).rejects.toThrow('engine not ready')
		await expect(camera.zoom(10, 0)).resolves.toBeUndefined()
	})
})

/** The spies on a stub's `camera` / `_camera2d` / `_camera360`, readably typed. */
type Spy = ReturnType<typeof vi.fn>
interface CameraSpies {
	_getCoo: Spy
	setCoo: Spy
	_flyTo: Spy
	_zoom: Spy
	_pan: Spy
	_isZoomedIn: Spy
	_isZoomedOut: Spy
	[key: string]: Spy
}
type SubSpies = Record<string, Spy>

/** The writable knobs the facade reads off the stub engine camera. */
interface CameraStub {
	_minSize: number
	_minScale: number
	_coverScale: number
	_coverLimit: boolean
}

/** The writable knobs the facade reads off the stub canvas itself. */
interface CanvasStub {
	_coverLimit: boolean
}

describe('Camera view and coordinate conversion', () => {
	it('turns a centre/size view into an origin/size one', () => {
		const { camera } = bound({ view: { arr: new Float64Array([0.5, 0.4, 0.5, 0.25]) } })
		// `arr` is [centerX, centerY, width, height]; the public view is [x0, y0, w, h].
		expect(camera.getView()).toEqual([0.25, 0.275, 0.5, 0.25])
	})

	it('hands back the live engine buffer from getViewRaw', () => {
		const arr = new Float64Array([0.5, 0.5, 1, 1])
		const { camera } = bound({ view: { arr } })
		const raw = camera.getViewRaw()
		raw[2] = 0.125
		// Same object, so the engine's write is visible without a re-read.
		expect(camera.getViewRaw()[2]).toBe(0.125)
		expect(raw).toBe(arr)
	})

	it('rounds getCoo to six decimals and returns a copy', () => {
		const source = coordinates(0.123456789, 0.987654321, 0.55555555, 0.44444444)
		const { camera, c } = bound({ camera: { _getCoo: fnOf(() => source) } })
		const spy = (c.camera as unknown as CameraSpies)._getCoo
		const coo = camera.getCoo(1, 2)
		expect([...coo]).toHaveLength(5)
		// `toBeCloseTo` per component: the rounded values are not IEEE-754 exact decimals.
		for (const [i, rounded] of [0.123457, 0.987654, 0.555556, 0.444444, 0].entries()) {
			expect(coo[i]).toBeCloseTo(rounded, 7)
		}
		// The engine's reused array must not have been rewritten by the rounding.
		expect(spy.mock.results[0]?.value).toBe(source)
		expect(source.arr[0]).toBe(0.123456789)
		expect(spy).toHaveBeenCalledWith(1, 2, false, false)
	})

	it('copies getXY the same way, through the 2D camera by default', () => {
		const { camera, c } = bound()
		const xy = camera.getXY(0.25, 0.75)
		// Four values plus the 360 direction slot, which stays 0 for a 2D canvas.
		expect([...xy]).toEqual([1, 2, 3, 4, 0])
		expect((c._camera2d as unknown as SubSpies)._getXY).toHaveBeenCalledWith(0.25, 0.75, false)
	})

	it('subtracts the element rect for absolute coordinates', () => {
		const { camera, c } = bound()
		camera.getCoo(110, 220, true)
		// The stub element sits at (10, 20).
		expect((c.camera as unknown as CameraSpies)._getCoo).toHaveBeenCalledWith(100, 200, true, false)
	})

	it('short-circuits on the book3d coordinate override', () => {
		const override = fnOf(() => new Float64Array([7, 8, 9, 10]))
		const { camera, c } = bound()
		camera._getXYDirectOverride = override
		expect([...camera.getXY(0.1, 0.2)]).toEqual([7, 8, 9, 10])
		expect(override).toHaveBeenCalledWith(0.1, 0.2)
		// The engine's own path is not touched.
		expect((c._camera2d as unknown as SubSpies)._getXY).not.toHaveBeenCalled()
	})
})

/**
 * A 360 image with a trueNorth sphere rotation. `trueNorth` is stored on the camera as
 * `rotationY` (`(trueNorth - 0.5) * 2π`, set by `MicrioImage`), and the facade *adds*
 * the rotation fraction of a full turn to X before asking the engine — the engine
 * projects the unrotated sphere, so the correction lands in image space.
 */
function north(rotationY: number, canvasOverrides: Loose = {}) {
	const boundCamera = bound(canvasOverrides, { _is360: true })
	boundCamera.camera.rotationY = rotationY
	return boundCamera
}

describe('Camera trueNorth offset and branch selection', () => {
	it('is a no-op for a 2D image even with a rotation set', () => {
		const spun = bound()
		spun.camera.rotationY = Math.PI / 2
		spun.camera.getXY(0.5, 0.5)
		// `_is360` gates the correction, so the rotation is ignored.
		expect((spun.c._camera2d as unknown as SubSpies)._getXY).toHaveBeenCalledWith(0.5, 0.5, false)
	})

	it('adds the rotation fraction of a full turn to X', () => {
		const { camera, c } = north(Math.PI / 2)
		camera.getXY(0.5, 0.5)
		// +rotationY / 2π = +0.25 → X moves right by a quarter of the image.
		expect((c._camera2d as unknown as SubSpies)._getXY).toHaveBeenCalledWith(0.75, 0.5, false)
	})

	it('skips the correction when the caller asks for noTrueNorth', () => {
		const { camera, c } = north(Math.PI / 2)
		camera.getXY(0.5, 0.5, false, undefined, undefined, true)
		expect((c._camera2d as unknown as SubSpies)._getXY).toHaveBeenCalledWith(0.5, 0.5, false)
	})

	it('takes the omni branch only for a real rotation, never for NaN', () => {
		const { camera, c } = north(Math.PI / 2)
		camera.getXY(0.5, 0.5, true, 12, Math.PI)
		// The trueNorth shift applies to the omni branch too.
		expect((c._camera2d as unknown as SubSpies)._getXYOmni).toHaveBeenCalledWith(0.75, 0.5, 12, Math.PI, true)
		const nan = bound({}, { rotationY: 0 })
		nan.camera.getXY(0.5, 0.5, false, 12, Number.NaN)
		// `Number.isNaN` is why a NaN rotation falls through to the plain path.
		expect((nan.c._camera2d as unknown as SubSpies)._getXY).toHaveBeenCalledWith(0.5, 0.5, false)
		expect((nan.c._camera2d as unknown as SubSpies)._getXYOmni).not.toHaveBeenCalled()
	})

	it('defaults the omni radius to zero', () => {
		const { camera, c } = north(0)
		camera.getXY(0.1, 0.2, false, undefined, 1)
		expect((c._camera2d as unknown as SubSpies)._getXYOmni).toHaveBeenCalledWith(0.1, 0.2, 0, 1, false)
	})

	it('reads screen coordinates through the 360 camera instead of the 2D one', () => {
		const three = north(0, { is360: true })
		three.camera.getCoo(5, 6)
		expect((three.c._camera360 as unknown as SubSpies)._getCoo).toHaveBeenCalledWith(5, 6)
		expect((three.c.camera as unknown as CameraSpies)._getCoo).not.toHaveBeenCalled()

		const threeXY = north(Math.PI, { is360: true })
		threeXY.camera.getXY(0.6, 0.7)
		// +rotationY / 2π = +0.5, and the 360 branch takes the shifted point.
		expect((threeXY.c._camera360 as unknown as SubSpies)._getXYZ).toHaveBeenCalledWith(1.1, 0.7)
	})
})

describe('Camera properties, limits and zoom predicates', () => {
	it('sets image coordinates through the camera, defaulting the scale to the current one', () => {
		const { camera, c } = bound({ camera: { _getCoo: fnOf(() => coordinates(0.1, 0.2, 2.5, 0.4)) } })
		camera.setCoo(0.4, 0.6)
		// No scale given: the facade reads the current scale through `getCoo(0, 0)[2]`.
		expect((c.camera as unknown as CameraSpies).setCoo).toHaveBeenCalledWith(0.4, 0.6, 2.5)
	})

	it('falls back to a scale of 1 when the engine reports zero', () => {
		const { camera } = bound({ camera: { _getCoo: fnOf(() => coordinates(0, 0, 0, 0)) } })
		expect(camera.getScale()).toBe(1)
	})

	it('reads the cover and minimum scale straight off the engine camera', () => {
		const { camera } = bound({ camera: { _coverScale: 0.75, _minScale: 0.2 } })
		expect(camera.getCoverScale()).toBe(0.75)
		expect(camera.getMinScale()).toBe(0.2)
	})

	it('delegates setMinScale to the canvas', () => {
		const { camera, c } = bound()
		camera.setMinScale(0.33)
		expect((c as unknown as SubSpies)._setMinScale).toHaveBeenCalledWith(0.33)
	})

	it('clamps the minimum screen size into [0, 1] when there is no album', () => {
		const { camera, c } = bound()
		camera.setMinScreenSize(2)
		expect((c.camera as unknown as CameraStub)._minSize).toBe(1)
		camera.setMinScreenSize(-1)
		expect((c.camera as unknown as CameraStub)._minSize).toBe(0)
		camera.setMinScreenSize(0.4)
		expect((c.camera as unknown as CameraStub)._minSize).toBe(0.4)
	})

	it('never touches the minimum screen size for an album image', () => {
		// An album member's zoom-out limit is the gallery's to set.
		const { camera, c } = bound({}, { album: { id: 'a' } })
		camera.setMinScreenSize(0.5)
		expect((c.camera as unknown as CameraStub)._minSize).toBe(0.5)
	})

	it('converts the zoom predicate into its override, and out of it', () => {
		const { camera, c } = bound()
		expect(camera.isZoomedIn()).toBe(false)
		expect((c as unknown as SubSpies)._isZoomedIn).toHaveBeenCalled()
		expect(camera.isZoomedOut()).toBe(true)
		// `full` reaches the canvas predicate on the non-override path.
		camera.isZoomedOut(true)
		expect((c as unknown as SubSpies)._isZoomedOut).toHaveBeenCalledWith(true)

		// Book3D installs both: `isZoomedOut` is then the exact negation of the override.
		const overridden = bound()
		overridden.camera._isZoomedInOverride = () => true
		expect(overridden.camera.isZoomedIn()).toBe(true)
		expect(overridden.camera.isZoomedOut()).toBe(false)
	})

	it('reports and sets the 360 direction, defaulting pitch to the live one', () => {
		const { camera, c } = bound({ _camera360: { _yaw: 1, _pitch: 2 } })
		expect(camera.getDirection()).toBe(1)
		expect(camera.getPitch()).toBe(2)
		camera.setDirection(3)
		expect((c as unknown as SubSpies)._setDirection).toHaveBeenCalledWith(3, 2)
		camera.setDirection(3, 4)
		expect((c as unknown as SubSpies)._setDirection).toHaveBeenLastCalledWith(3, 4)
	})

	it('writes a view limit in centre/size form', () => {
		const { camera, c } = bound()
		camera.setLimit([0.25, 0.25, 0.5, 0.5])
		expect((c.view as unknown as SubSpies)._setLimit).toHaveBeenCalledWith(0.5, 0.5, 0.5, 0.5)
	})

	it('flips the cover limit and re-corrects the min/max scale', () => {
		const { camera, c } = bound()
		expect(camera.getCoverLimit()).toBe(false)
		camera.setCoverLimit(true)
		expect((c as unknown as CanvasStub)._coverLimit).toBe(true)
		expect(camera.getCoverLimit()).toBe(true)
		expect((c as unknown as SubSpies)._correctMinMax).toHaveBeenCalled()
	})

	it('forwards the 360 range limits, defaulting both to zero', () => {
		const { camera, c } = bound()
		camera.set360RangeLimit()
		expect((c._camera360 as unknown as SubSpies)._setLimits).toHaveBeenCalledWith(0, 0)
		camera.set360RangeLimit(30, 45)
		expect((c._camera360 as unknown as SubSpies)._setLimits).toHaveBeenLastCalledWith(30, 45)
	})

	it('keeps the current centre when the scale is set directly', () => {
		const { camera, c } = bound({ view: { arr: new Float64Array([0.4, 0.6, 0.5, 0.25]) } })
		camera.setScale(3)
		// `setScale` reuses the raw centre (arr[0], arr[1]) and the given scale.
		expect((c.camera as unknown as CameraSpies).setCoo).toHaveBeenCalledWith(0.4, 0.6, 3)
	})
})

describe('Camera animation lifecycle', () => {
	it('resolves a zero-duration flyToView without storing promise hooks', async () => {
		const { camera, c } = bound({ camera: { _flyTo: fnOf(() => 0) } })
		await expect(camera.flyToView([0.25, 0.25, 0.5, 0.5])).resolves.toBeUndefined()
		// A duration of 0 means the view already landed, so nothing is left pending.
		expect(camera._aniDone).toBeUndefined()
		expect(camera._aniAbort).toBeUndefined()
		const flyTo = (c.camera as unknown as CameraSpies)._flyTo
		const [, , width, height] = flyTo.mock.calls[0] as number[]
		expect(width).toBe(0.5)
		expect(height).toBe(0.5)
	})

	it('expands the view by the margin before asking the engine', async () => {
		const { camera, c } = bound({ camera: { _flyTo: fnOf(() => 0) } })
		await camera.flyToView([0, 0, 1, 1], { duration: 0, margin: [0.1, 0.2] })
		const call = (c.camera as unknown as CameraSpies)._flyTo.mock.calls[0] as number[]
		// The centre moves with the margin; the size shrinks by twice it.
		expect(call[0]).toBeCloseTo(0.6, 10)
		expect(call[1]).toBeCloseTo(0.7, 10)
		expect(call[2]).toBeCloseTo(0.8, 10)
		expect(call[3]).toBeCloseTo(0.6, 10)
	})

	it('stores the promise hooks for a real animation and settles on them', async () => {
		const { camera } = bound({ camera: { _flyTo: fnOf(() => 250) } })
		const fly = camera.flyToView([0, 0, 1, 1], { duration: 250 })
		expect(camera._aniDone).toBeTypeOf('function')
		expect(camera._aniAbort).toBeTypeOf('function')
		camera._aniDone?.()
		await expect(fly).resolves.toBeUndefined()
	})

	it('rejects the animation when the engine aborts it', async () => {
		const { camera } = bound({ camera: { _flyTo: fnOf(() => 250) } })
		const fly = camera.flyToView([0, 0, 1, 1], { duration: 250 })
		camera._aniAbort?.()
		await expect(fly).rejects.toBeUndefined()
	})

	it('remaps through the parent camera area when the image is an embed', async () => {
		const { camera, c } = bound(
			{ camera: { _flyTo: fnOf(() => 0) } },
			{ opts: { useParentCamera: true, area: [0.1, 0.2, 0.5, 0.4] } },
		)
		await camera.flyToView([0, 0, 1, 1], { duration: 0 })
		const call = (c.camera as unknown as CameraSpies)._flyTo.mock.calls[0] as number[]
		// The sub-image's [0,1] space maps onto its area within the parent canvas.
		expect(call[0]).toBeCloseTo(0.35, 10)
		expect(call[1]).toBeCloseTo(0.4, 10)
		expect(call[2]).toBeCloseTo(0.5, 10)
		expect(call[3]).toBeCloseTo(0.4, 10)
	})

	it('seeds the animation from an explicit previous view', async () => {
		const { camera, c } = bound({ camera: { _flyTo: fnOf(() => 0) } })
		await camera.flyToView([0, 0, 1, 1], { duration: 0, prevView: [0.5, 0.5, 0.25, 0.25] })
		expect((c._ani as unknown as SubSpies)._setStartView).toHaveBeenCalledWith(0.625, 0.625, 0.25, 0.25)
	})

	it('derives the omni frame from the view rotation and wraps it', async () => {
		const { camera, c } = bound(
			{ camera: { _flyTo: fnOf(() => 0) } },
			{ $settings: { omni: { frames: 36, layers: [{}, {}] } } },
		)
		// view[4] is a rotation in radians; 36 frames over 2 layers is 18 per turn.
		const view = [0, 0, 1, 1, Math.PI] as unknown as Models.Camera.View
		await camera.flyToView(view, { duration: 0 })
		const omniIdx = (c.camera as unknown as CameraSpies)._flyTo.mock.calls[0]?.[10]
		// A half turn is 9 frames after the mod.
		expect(omniIdx).toBe(9)
	})

	it('resolves a zero-duration flyToCoo and forwards the easing and flags', async () => {
		const { camera, c } = bound({ camera: { setCoo: fnOf(() => 0) } })
		await expect(
			camera.flyToCoo([0.25, 0.75, 2], { duration: 0, limit: true, timingFunction: 'linear' }),
		).resolves.toBeUndefined()
		const call = (c.camera as unknown as CameraSpies).setCoo.mock.calls[0] as unknown[]
		expect(call.slice(0, 4)).toEqual([0.25, 0.75, 2, 0])
		// The last argument is the timing function, resolved by name.
		expect(call.at(-1)).toBe(linear)
	})

	it('builds the full-view and cover-view targets from the image settings', async () => {
		const full = bound({ camera: { setCoo: fnOf(() => 0), _minScale: 0.25 } })
		await full.camera.flyToFullView({ duration: 0 })
		expect((full.c.camera as unknown as CameraSpies).setCoo.mock.calls[0]?.slice(0, 3)).toEqual([0.5, 0.5, 0.25])

		const cover = bound(
			{ camera: { setCoo: fnOf(() => 0), _coverScale: 0.75 } },
			{ $settings: { focus: [0.25, 0.25] } },
		)
		await cover.camera.flyToCoverView({ duration: 0 })
		expect((cover.c.camera as unknown as CameraSpies).setCoo.mock.calls[0]?.slice(0, 3)).toEqual([0.25, 0.25, 0.75])
	})

	it('routes zoom through the book3d override when one is installed', async () => {
		const overrides: number[] = []
		const { camera, c } = bound({ camera: { _zoom: fnOf(() => 0) } })
		camera._zoomOverride = (n) => overrides.push(n)
		await camera.zoom(42, 0)
		expect(overrides).toEqual([42])
		// The engine camera is not consulted while an override is live.
		expect((c.camera as unknown as CameraSpies)._zoom).not.toHaveBeenCalled()
	})

	it('resolves an instant zoom for an album that is not hooked yet', async () => {
		const { camera, c } = bound({ camera: { _zoom: fnOf(() => 500) } }, { album: {} })
		await expect(camera.zoom(10, 0)).resolves.toBeUndefined()
		// A swipe/switch album owns the transition until it is hooked.
		expect((c.camera as unknown as CameraSpies)._zoom).not.toHaveBeenCalled()
		expect(camera._aniDone).toBeUndefined()
	})

	it('defaults the zoom focal point to the view centre in image space', async () => {
		const { camera, c } = bound({ view: { arr: new Float64Array([0.4, 0.6, 0.2, 0.2]) } })
		await camera.zoom(-20, 0)
		// `getXY` of the raw centre (0.4, 0.6) is the stub's [1, 2, 3, 4, 0].
		expect((c.camera as unknown as CameraSpies)._zoom).toHaveBeenCalledWith(-20, 1, 2, 0, false)
	})

	it('passes an explicit focal point and noLimit straight through', async () => {
		const { camera, c } = bound({ camera: { _zoom: fnOf(() => 0) } })
		await camera.zoom(5, 0, 10, 20, 1, true)
		expect((c.camera as unknown as CameraSpies)._zoom).toHaveBeenCalledWith(5, 10, 20, 0, true)
	})

	it('drives zoomIn and zoomOut through the same delta maths', async () => {
		const { camera, c } = bound({ camera: { _zoom: fnOf(() => 0), _getCoo: fnOf(() => coordinates(0, 0, 1, 0)) } })
		await camera.zoomIn(2, 0)
		expect((c.camera as unknown as CameraSpies)._zoom).toHaveBeenLastCalledWith(-400, 1, 2, 0, false)

		// The viewport is 800x600 (ratio 4/3) and the stub image is 1000x500 (ratio 2), so
		// the aspect term is max(1, (4/3) / 2 / 2) = 1 and the delta stays at the 400 base.
		const out = bound({ camera: { _zoom: fnOf(() => 0) } })
		await out.camera.zoomOut(1, 0)
		expect((out.c.camera as unknown as CameraSpies)._zoom).toHaveBeenLastCalledWith(400, 1, 2, 0, false)
	})

	it('renders a pan only when it animates or is asked to', () => {
		const { camera, c, i } = bound()
		const { render } = i.engine as unknown as { render: Spy }
		camera.pan(10, 10)
		expect((c.camera as unknown as CameraSpies)._pan).toHaveBeenCalledWith(10, 10, 0, false)
		expect(render).not.toHaveBeenCalled()
		camera.pan(10, 10, 0, { render: true })
		expect(render).toHaveBeenCalledTimes(1)
		camera.pan(10, 10, 250)
		expect(render).toHaveBeenCalledTimes(2)
		camera.pan(10, 10, 250, { noLimit: true })
		expect((c.camera as unknown as CameraSpies)._pan).toHaveBeenLastCalledWith(10, 10, 250, true)
	})

	it('forwards pause, stop and resume, and renders on resume', () => {
		const { camera, c, i } = bound()
		const { render } = i.engine as unknown as { render: Spy }
		camera.pause()
		camera.stop()
		camera.resume()
		expect((c as unknown as SubSpies)._aniPause).toHaveBeenCalled()
		expect((c as unknown as SubSpies)._aniStop).toHaveBeenCalled()
		expect((c as unknown as SubSpies)._aniResume).toHaveBeenCalled()
		expect(render).toHaveBeenCalledTimes(1)
	})

	it('pushes the origin-form view into the image state and signals a touch', () => {
		const { camera, i } = bound({ view: { arr: new Float64Array([0.5, 0.5, 0.5, 0.25]) } })
		camera._viewChanged()
		// The public view is [x0, y0, w, h], not the engine's centre form.
		expect(get(i.state.view as never)).toEqual([0.25, 0.375, 0.5, 0.25])
		const { micrio } = i.engine as unknown as { micrio: { state: { _touch: Spy } } }
		expect(micrio.state._touch).toHaveBeenCalledWith('view')
	})
})
