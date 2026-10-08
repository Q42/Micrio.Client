import { describe, expect, it, vi } from 'vitest'
import type { MicrioImage } from '$core/image'
import type { TileCanvas } from '$render/tile-canvas'
import { Camera } from '$core/camera'
import { Coordinates } from '$render/shared'
import { writable } from '$core/store'

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
