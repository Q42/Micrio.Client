import { describe, expect, it } from 'vitest'
import { openSpace } from '../fixtures/space-fixture'
import type { Models } from '../../src/types/models'
import { getSpaceVector } from '../../src/utils/space'
import { settle } from '../helpers/tour'
import { waitFor } from '../helpers/viewer'

/**
 * Navigating between two waypoints hands a `Camera.Vector` to `micrio.open`, which the
 * engine stores and the arriving 360 canvas turns into a viewing direction. The
 * transition itself is an animation, so these tests assert the state it settles into.
 */
async function openSecond(opts: { vector?: boolean; rotationY?: number } = {}) {
	const { rotationY } = opts
	const { viewer, ids } = await openSpace(0, rotationY !== undefined ? { rotationY: () => rotationY } : {})
	const target = ids[1] ?? ''
	const derived = getSpaceVector(viewer.el, target)?.vector

	if (opts.vector === false) {
		await viewer.open(target, {})
	} else {
		await viewer.open(target, { vector: derived })
	}
	await waitFor(() => viewer.el.$current?.id === target, 8000, 'switched to the target')
	await settle(2)
	return { viewer, target, derived }
}

/**
 * Opens the second waypoint with a forced direction and asserts the arriving camera
 * turned by `expectedTurns` of a full circle.
 *
 * The direction is forced so the expectation does not depend on the fixture geometry,
 * and the source image is re-opened between the two moves to reset the camera.
 */
async function expectTurnFor(direction: number, expectedTurns: number) {
	const { viewer, target } = await openSecond()
	const forced: Models.Camera.Vector = { direction, distanceX: 0.4, distanceY: 0 }
	const back = viewer.el._canvases[0]?.id ?? ''

	await viewer.open(back, { vector: { direction: 0, distanceX: 0, distanceY: 0 } })
	await waitFor(() => viewer.el.$current?.id === back, 8000, 'back to the first image')
	await viewer.open(target, { vector: forced })
	await waitFor(() => viewer.el.$current?.id === target, 8000, 'to the target again')
	await settle(2)

	// The camera yaw is `2π · (1 - direction)`, wrapped into [0, 2π)
	const yaw = viewer.el.$current?.camera.getDirection() ?? 0
	const expected = (expectedTurns * Math.PI * 2) % (Math.PI * 2)
	const diff = Math.abs(((yaw - expected + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
	expect(diff, `direction ${direction}`).toBeLessThan(1e-3)
	expect(viewer.el._engine._direction).toBeCloseTo(direction, 8)
	viewer.destroy()
}

describe('space transitions', () => {
	it('passes the waypoint vector to the engine', async () => {
		const { viewer, derived } = await openSecond()
		expect(derived).toBeDefined()
		expect(viewer.el._engine._direction).toBeCloseTo(derived?.direction ?? -1, 8)
		expect(viewer.el._engine._distanceX).toBeCloseTo(derived?.distanceX ?? -1, 8)
		expect(viewer.el._engine._distanceY).toBeCloseTo(derived?.distanceY ?? -1, 8)
		viewer.destroy()
	})

	it('turns a quarter turn for direction 0.25', async () => {
		await expectTurnFor(0.25, 0.75)
	})

	it('turns half a turn for direction 0', async () => {
		await expectTurnFor(0, 0.5)
	})

	it('does not turn for direction 0.5', async () => {
		await expectTurnFor(0.5, 0)
	})

	it('turns three quarter turns for direction 0.75', async () => {
		await expectTurnFor(0.75, 0.25)
	})

	it('leaves the engine direction untouched without a vector', async () => {
		const { viewer } = await openSecond({ vector: false })
		expect(viewer.el._engine._direction).toBe(0)
		expect(viewer.el._engine._distanceX).toBe(0)
		expect(viewer.el._engine._distanceY).toBe(0)
		// Keeping the orientation is the point of `_preventDirectionSet`
		expect(viewer.el.$current?.camera.getDirection()).toBe(0)
		viewer.destroy()
	})

	it('carries the pitch over to the arriving image', async () => {
		const { viewer, ids } = await openSpace()
		const target = ids[1] ?? ''
		viewer.el.$current?.camera.setDirection(0, 0.4)
		const pitch = viewer.el.$current?.camera.getPitch() ?? 0
		expect(pitch).toBeCloseTo(0.4, 6)

		const derived = getSpaceVector(viewer.el, target)?.vector
		await viewer.open(target, { vector: derived })
		await waitFor(() => viewer.el.$current?.id === target, 8000, 'switched')
		await settle(2)
		// The transition keeps the vertical angle rather than snapping back to level
		expect(viewer.el.$current?.camera.getPitch()).toBeCloseTo(pitch, 2)
		viewer.destroy()
	})

	it('keeps the vector turn independent of the target rotation', async () => {
		const flat = await openSecond({ rotationY: 0 })
		const flatYaw = flat.viewer.el.$current?.camera.getDirection() ?? 0
		flat.viewer.destroy()

		const rotated = await openSecond({ rotationY: Math.PI / 2 })
		const rotatedYaw = rotated.viewer.el.$current?.camera.getDirection() ?? 0
		rotated.viewer.destroy()

		// Same waypoint, different image rotation: the arriving yaw is unchanged
		expect(rotatedYaw).toBeCloseTo(flatYaw, 3)
	})

	it('reports the target image once the transition settles', async () => {
		const { viewer, target } = await openSecond()
		expect(viewer.el.$current?.id).toBe(target)
		expect(viewer.el.$current?._is360).toBe(true)
		// The engine is ready and the target canvas is the active one
		expect(viewer.el._engine.ready).toBe(true)
		viewer.destroy()
	})
})
