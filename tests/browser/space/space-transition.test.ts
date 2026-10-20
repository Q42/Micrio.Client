import { describe, expect, it } from 'vitest'
import { openSpace } from '../../fixtures/space-fixture'
import type { Models } from '$types/models'
import { getSpaceVector } from '$utils/space'
import { settle } from '../../helpers/tour'
import { waitFor } from '../../helpers/viewer'

/**
 * Navigating between two waypoints hands a `Camera.Vector` to `micrio.open`. The vector is
 * the *walk*: the engine turns its direction into the parallax offset of the transition.
 *
 * The arriving heading is the viewer's own. The engine carries the source camera's yaw and
 * pitch over, so the direction the viewer was facing in the space is preserved; each image's
 * `rotationY` is what places its own content under that direction. Only an explicit
 * `startView` — which is what `_preventDirectionSet` marks — wins over the carried heading.
 */

/** Opens the pair on the first image and moves to the second, reporting both headings. */
async function openSecond(opts: { vector?: boolean; rotationY?: number; heading?: number; pitch?: number } = {}) {
	const { rotationY, heading, pitch } = opts
	const { viewer, ids } = await openSpace(0, rotationY !== undefined ? { rotationY: () => rotationY } : {})
	const target = ids[1] ?? ''
	const source = viewer.el.$current
	if (!source) {
		throw new Error('no source image')
	}
	if (heading !== undefined) {
		source.camera.setDirection(heading, pitch ?? 0)
	}
	const from = { yaw: source.camera.getDirection(), pitch: source.camera.getPitch() }
	const derived = getSpaceVector(viewer.el, target)?.vector

	if (opts.vector === false) {
		await viewer.open(target, {})
	} else {
		await viewer.open(target, { vector: derived })
	}
	await waitFor(() => viewer.el.$current?.id === target, 8000, 'switched to the target')
	await settle(2)

	const camera = viewer.el.$current?.camera
	return { viewer, target, derived, from, to: { yaw: camera?.getDirection() ?? 0, pitch: camera?.getPitch() ?? 0 } }
}

/** The difference between two wrapped angles, in radians. */
const angleDiff = (a: number, b: number): number => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI)

/** Opens the pair with both images rotated by `rotationY` and asserts the heading travelled. */
async function expectCarryOver(rotationY: number): Promise<void> {
	const { viewer, from, to } = await openSecond({ rotationY, heading: 0.9 })
	expect(angleDiff(to.yaw, from.yaw), `rotationY ${rotationY}`).toBeLessThan(1e-3)
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

	it('carries the source heading and pitch over to the arriving image', async () => {
		const { viewer, from, to } = await openSecond({ heading: 1.1, pitch: 0.4 })
		// The walk vector no longer decides where the viewer ends up looking: their own
		// heading travels with them, which is the direction the arrival is derived from.
		expect(angleDiff(to.yaw, from.yaw)).toBeLessThan(1e-3)
		expect(to.pitch).toBeCloseTo(from.pitch, 2)
		viewer.destroy()
	})

	it('carries the heading over whatever the target rotation is', async () => {
		// Same heading set on differently rotated images: what is carried is the space-frame
		// yaw (`getDirection`), which both images express through their own `rotationY`.
		await expectCarryOver(0)
		await expectCarryOver(Math.PI / 2)
		await expectCarryOver(Math.PI)
	})

	it('carries the heading over when there is no vector', async () => {
		const { viewer, from, to } = await openSecond({ vector: false, heading: 0.8, pitch: 0.2 })

		// Without a vector there is no walk, but the arrival still keeps the viewer's heading
		// instead of snapping to the target image's own view
		expect(viewer.el._engine._direction).toBe(0)
		expect(viewer.el._engine._distanceX).toBe(0)
		expect(viewer.el._engine._distanceY).toBe(0)
		expect(angleDiff(to.yaw, from.yaw)).toBeLessThan(1e-3)
		viewer.destroy()
	})

	it('lets an explicit startView win over the carried heading', async () => {
		const { viewer, ids } = await openSpace()
		const target = ids[1] ?? ''
		viewer.el.$current?.camera.setDirection(1.2, 0.3)

		const startView: Models.Camera.View = [0.2, 0.45, 0.1, 0.1]
		await viewer.open(target, { startView })
		await waitFor(() => viewer.el.$current?.id === target, 8000, 'switched to the target')
		await settle(2)

		expect(viewer.el.$current?.camera.getView()[0]).toBeCloseTo(startView[0], 2)
		viewer.destroy()
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
