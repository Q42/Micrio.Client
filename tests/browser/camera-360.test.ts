import { describe, expect, it } from 'vitest'
import { openSpace } from '../fixtures/space-fixture'
import type { MicrioImage } from '../../src/core/image'

/**
 * The 360 camera is asserted through its public `Camera` API — `Camera360` itself is
 * internal, so a rename or refactor inside it must not break these tests.
 *
 * Everything here is synchronous once the image is open: the transforms are pure
 * functions of the camera state, so there are no animation timings to wait for.
 */
async function open360(index = 0) {
	const viewer = await openSpace(index)
	const image = viewer.el.$current
	if (!image) {
		throw new Error('no current image')
	}
	return { viewer, image, camera: image.camera }
}

/** Reads `Camera.getXY` as a plain array. */
const xy = (image: MicrioImage, x: number, y: number, noTrueNorth = false) => [
	...image.camera.getXY(x, y, false, undefined, undefined, noTrueNorth),
]

describe('360 orientation', () => {
	it('round-trips the viewing direction', async () => {
		const { viewer, camera } = await open360()
		expect(camera.getDirection()).toBeCloseTo(0, 6)

		camera.setDirection(Math.PI / 2)
		expect(camera.getDirection()).toBeCloseTo(Math.PI / 2, 6)

		// Negative yaw is reported wrapped into [0, 2π)
		camera.setDirection(-Math.PI / 3)
		expect(camera.getDirection()).toBeCloseTo(Math.PI * 2 - Math.PI / 3, 6)

		camera.setDirection(-Math.PI)
		expect(camera.getDirection()).toBeCloseTo(Math.PI, 6)
		viewer.destroy()
	})

	it('wraps the direction past a full turn', async () => {
		const { viewer, camera } = await open360()
		camera.setDirection(Math.PI / 4)
		const quarter = camera.getDirection()

		camera.setDirection(Math.PI / 4 + Math.PI * 2)
		// A full turn away, but `modPI` keeps it inside [0, 2π)
		expect(camera.getDirection()).toBeCloseTo(quarter, 6)
		viewer.destroy()
	})

	it('sets pitch alongside the direction, defaulting to the current pitch', async () => {
		const { viewer, camera } = await open360()
		camera.setDirection(0, 0.3)
		expect(camera.getPitch()).toBeCloseTo(0.3, 6)

		// Omitting the pitch keeps it
		camera.setDirection(Math.PI / 2)
		expect(camera.getPitch()).toBeCloseTo(0.3, 6)
		expect(camera.getDirection()).toBeCloseTo(Math.PI / 2, 6)
		viewer.destroy()
	})

	it('clamps the pitch to the poles', async () => {
		const { viewer, camera } = await open360()
		camera.setDirection(0, 10)
		expect(camera.getPitch()).toBeLessThanOrEqual(Math.PI / 2 + 1e-9)
		camera.setDirection(0, -10)
		expect(camera.getPitch()).toBeGreaterThanOrEqual(-Math.PI / 2 - 1e-9)
		viewer.destroy()
	})
})

describe('360 coordinate transforms', () => {
	it('maps the screen centre to the view centre', async () => {
		const { viewer, image, camera } = await open360()
		camera.setDirection(0, 0)
		const coo = camera.getCoo(image.engine.micrio.offsetWidth / 2, image.engine.micrio.offsetHeight / 2)
		expect(coo[0]).toBeCloseTo(0.5, 3)
		expect(coo[1]).toBeCloseTo(0.5, 3)
		viewer.destroy()
	})

	it('reports the current direction through getCoo', async () => {
		const { viewer, camera } = await open360()
		camera.setDirection(Math.PI / 2, 0)
		const coo = camera.getCoo(100, 100)
		// The logical direction tracks the yaw (base yaw is 0 for this fixture)
		expect(coo[4]).toBeCloseTo(Math.PI / 2 - 0, 3)
		viewer.destroy()
	})

	it('round-trips image coordinates through the sphere', async () => {
		const { viewer, image, camera } = await open360()
		camera.setDirection(0, 0)

		for (const [x, y] of [
			[0.5, 0.45],
			[0.5, 0.55],
			[0.4, 0.5],
			[0.6, 0.5],
		] as [number, number][]) {
			const [px, py] = xy(image, x, y)
			const coo = camera.getCoo(px ?? 0, py ?? 0)
			expect(coo[0], `x for ${x},${y}`).toBeCloseTo(x, 3)
			expect(coo[1], `y for ${x},${y}`).toBeCloseTo(y, 3)
		}
		viewer.destroy()
	})

	it('pans the projection when the direction changes', async () => {
		const { viewer, image, camera } = await open360()
		camera.setDirection(0, 0)
		const horizontal = xy(image, 0.5, 0.4)
		const vertical = xy(image, 0.25, 0.5)

		// Pitch moves the point vertically, yaw moves it horizontally
		camera.setDirection(0, 0.5)
		const afterPitch = xy(image, 0.5, 0.4)
		expect(afterPitch[1]).not.toBeCloseTo(horizontal[1], 1)
		expect(afterPitch[0]).toBeCloseTo(horizontal[0], 1)

		camera.setDirection(Math.PI / 2, 0)
		const afterYaw = xy(image, 0.25, 0.5)
		expect(afterYaw[0]).not.toBeCloseTo(vertical[0], 1)
		viewer.destroy()
	})

	it('reports scale and depth as finite numbers', async () => {
		const { viewer, image } = await open360()
		for (const [x, y] of [
			[0.5, 0.5],
			[0.25, 0.5],
		] as [number, number][]) {
			const point = xy(image, x, y)
			expect(Number.isFinite(point[2]), `scale for ${x},${y}`).toBe(true)
			expect(point[2]).toBeGreaterThan(0)
			expect(Number.isFinite(point[3]), `depth for ${x},${y}`).toBe(true)
		}
		viewer.destroy()
	})
})

describe('360 zoom limits', () => {
	it('reports zoom state from the perspective', async () => {
		const { viewer, camera } = await open360()
		// A 360 camera is always either zoomed in or out, never both
		const zoomedIn = camera.isZoomedIn()
		const zoomedOut = camera.isZoomedOut()
		expect(zoomedIn || zoomedOut).toBe(true)
		viewer.destroy()
	})

	it('accepts range limits without breaking the camera', async () => {
		const { viewer, image, camera } = await open360()
		camera.set360RangeLimit(0.5, 0.5)
		expect(Number.isFinite(camera.getDirection())).toBe(true)
		expect(Number.isFinite(camera.getPitch())).toBe(true)
		// The transform still works under a limit
		expect(xy(image, 0.5, 0.5).every(Number.isFinite)).toBe(true)

		camera.set360RangeLimit(0, 0)
		expect(xy(image, 0.5, 0.5).every(Number.isFinite)).toBe(true)
		viewer.destroy()
	})

	it('clamps the pitch more tightly under a vertical limit', async () => {
		const { viewer, camera } = await open360()
		// Drag far beyond the pole; the limit plus the pitch clamp decide the result
		camera.set360RangeLimit(0, 0.25)
		camera.setDirection(0, 10)
		const limited = camera.getPitch()

		camera.set360RangeLimit(0, 0)
		camera.setDirection(0, 10)
		const open = camera.getPitch()

		expect(Math.abs(limited)).toBeLessThanOrEqual(Math.abs(open) + 1e-6)
		viewer.destroy()
	})
})

describe('360 element matrices', () => {
	it('produces a finite 16-component matrix', async () => {
		const { viewer, camera } = await open360()
		const matrix = camera.getMatrix(0.5, 0.5, 1, 1, 0, 0, 0)
		expect(matrix).toHaveLength(16)
		expect([...matrix].every(Number.isFinite)).toBe(true)
		viewer.destroy()
	})

	it('differs between a point in front of and behind the camera', async () => {
		const { viewer, camera } = await open360()
		camera.setDirection(0, 0)
		const front = [...camera.getMatrix(0.5, 0.5, 1, 1, 0, 0, 0)]

		camera.setDirection(Math.PI, 0)
		const behind = [...camera.getMatrix(0.5, 0.5, 1, 1, 0, 0, 0)]
		expect(behind).not.toEqual(front)
		expect(behind.every(Number.isFinite)).toBe(true)
		viewer.destroy()
	})

	it('falls back for a NaN radius instead of poisoning the matrix', async () => {
		const { viewer, camera } = await open360()
		const matrix = camera.getMatrix(0.5, 0.5, 1, Number.NaN, 0, 0, 0)
		expect([...matrix].every(Number.isFinite)).toBe(true)
		viewer.destroy()
	})
})
