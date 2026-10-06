import { describe, expect, it } from 'vitest'
import type { MicrioImage } from '$core/image'
import { Camera } from '$core/camera'

/**
 * The omni angle maths on `Camera`, exercised with a plain stub image (no DOM,
 * no canvas). Everything here is pure arithmetic on the omni settings; the
 * rendering side is covered by the browser omni suites.
 */

interface StubOptions {
	frames?: number
	layers?: number
	/** `image.omni.currentIndex`; `undefined` models an image without its UI yet. */
	index?: number
	hasOmni?: boolean
	/** Bind a (stub) engine canvas, which `getOmniRotation` requires. */
	canvas?: boolean
}

function omniCamera(opts: StubOptions = {}): Camera {
	const image = {
		_is360: false,
		state: { $view: undefined },
		$info: { id: 'stub', width: 512, height: 512 },
		$settings: {
			omni:
				opts.hasOmni === false
					? undefined
					: {
							frames: opts.frames ?? 36,
							layers:
								opts.layers === undefined || opts.layers < 2
									? undefined
									: Array.from({ length: opts.layers }, () => ({})),
						},
		},
		omni: opts.index === undefined ? undefined : { currentIndex: opts.index },
	}
	const camera = new Camera(image as unknown as MicrioImage)
	if (opts.canvas) {
		camera._bindEngineCanvas({} as never)
	}
	return camera
}

describe('Camera._getOmniFrame', () => {
	it('maps a rotation in radians onto a frame', () => {
		const camera = omniCamera({ frames: 36 })
		expect(camera._getOmniFrame(0)).toBe(0)
		// One frame is 10 degrees
		expect(camera._getOmniFrame((Math.PI * 2) / 36)).toBe(1)
		expect(camera._getOmniFrame(Math.PI)).toBe(18)
	})

	it('does not wrap: a full turn is the frame count', () => {
		// The result is not reduced modulo the frame count, so a full turn lands
		// one past the last frame — callers wrap it themselves (`OmniUI.#goto`)
		const camera = omniCamera({ frames: 36 })
		expect(camera._getOmniFrame(Math.PI * 2)).toBe(36)
	})

	it('returns a negative frame for a negative rotation', () => {
		// Same missing wrap, in the other direction: nothing clamps this
		const camera = omniCamera({ frames: 36 })
		expect(camera._getOmniFrame(-0.1)).toBe(-1)
		expect(camera._getOmniFrame(-Math.PI * 2)).toBe(-36)
	})

	it('returns undefined without an omni config or a rotation', () => {
		expect(omniCamera({ hasOmni: false })._getOmniFrame(1)).toBeUndefined()
		expect(omniCamera({ frames: 36 })._getOmniFrame()).toBeUndefined()
	})

	it('maps through the frames-per-layer count', () => {
		// 36 frames over 3 layers is 12 per layer
		const camera = omniCamera({ frames: 36, layers: 3 })
		expect(camera._getOmniFrame(Math.PI)).toBe(6)
		expect(camera._getOmniFrame(Math.PI * 2)).toBe(12)
	})

	it('returns NaN for a NaN rotation rather than undefined', () => {
		// The guard only checks `undefined`, so a NaN rotation produces a NaN frame
		// (which the marker's `!= null` arc check would happily accept)
		expect(Number.isNaN(omniCamera({ frames: 36 })._getOmniFrame(Number.NaN))).toBe(true)
	})
})

describe('Camera.getOmniRotation', () => {
	it('is zero without a bound canvas', () => {
		// The engine canvas is what makes the rotation meaningful
		expect(omniCamera({ frames: 36, index: 9 }).getOmniRotation()).toBe(0)
	})

	it('derives the angle from the active frame', () => {
		const camera = omniCamera({ frames: 36, index: 9, canvas: true })
		expect(camera.getOmniRotation()).toBeCloseTo(Math.PI / 2, 10)
	})

	it('is zero before the omni UI exists and without omni settings', () => {
		expect(omniCamera({ frames: 36, canvas: true }).getOmniRotation()).toBe(0)
		expect(omniCamera({ index: 9, hasOmni: false, canvas: true }).getOmniRotation()).toBe(0)
	})

	it('is a full turn at the frame count', () => {
		const camera = omniCamera({ frames: 36, index: 36, canvas: true })
		expect(camera.getOmniRotation()).toBeCloseTo(Math.PI * 2, 10)
	})

	it('divides the frames over the layers', () => {
		const camera = omniCamera({ frames: 36, layers: 3, index: 6, canvas: true })
		expect(camera.getOmniRotation()).toBeCloseTo(Math.PI, 10)
	})
})
