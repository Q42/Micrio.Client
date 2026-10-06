import { describe, expect, it } from 'vitest'
import type { MicrioImage } from '$core/image'
import { baseInfo } from '../../fixtures/bundles'
import { freshSpace, openSpace } from '../../fixtures/space-fixture'
import { get } from '$core/store'
import { mockJson } from '../../helpers/network'
import { mountViewer, waitFor } from '../../helpers/viewer'

/**
 * `trueNorth` is applied once, when the `MicrioImage` is constructed: the space's
 * per-image `rotationY` wins, otherwise `settings._360.trueNorth` is converted with
 * `(trueNorth - 0.5) * 2π` (so 0.5 is the identity).
 *
 * It rotates the *coordinate space*, not the camera: `getDirection()` keeps reporting
 * whatever was set through `setDirection`, while the same logical image point lands on
 * a different screen position.
 */

/** Opens a single 360 image with the given settings, without any space data. */
async function openSettings(settings: Record<string, unknown>, is360 = true) {
	const id = `north${Math.random().toString(36).slice(2, 8)}`
	mockJson(/bundle\.json/, {
		images: [{ id, info: baseInfo(id, { is360 }), settings, data: {} }],
	})
	const viewer = mountViewer()
	await viewer.open(id)
	await waitFor(() => get(viewer.el._loading) === false, 4000, 'loading to finish')
	const image = viewer.el.$current
	if (!image) {
		throw new Error('no current image')
	}
	return { viewer, image, camera: image.camera }
}

/** The screen position of one logical image point, as a plain array. */
const point = (image: MicrioImage, x: number, y: number) => [...image.camera.getXY(x, y)]

describe('trueNorth from settings', () => {
	it('is the identity at 0.5', async () => {
		const { viewer, camera } = await openSettings({ _360: { trueNorth: 0.5 } })
		expect(camera.rotationY).toBeCloseTo(0, 8)
		viewer.destroy()
	})

	it('maps 0.75 to a quarter turn and 0.25 to a negative quarter turn', async () => {
		const east = await openSettings({ _360: { trueNorth: 0.75 } })
		expect(east.camera.rotationY).toBeCloseTo(Math.PI / 2, 8)
		east.viewer.destroy()

		const west = await openSettings({ _360: { trueNorth: 0.25 } })
		expect(west.camera.rotationY).toBeCloseTo(-Math.PI / 2, 8)
		west.viewer.destroy()
	})

	it('defaults to no rotation when unset', async () => {
		const { viewer, camera } = await openSettings({})
		expect(camera.rotationY).toBe(0)
		viewer.destroy()
	})

	it('ignores trueNorth for a non-360 image', async () => {
		const { viewer, camera } = await openSettings({ _360: { trueNorth: 0.75 } }, false)
		expect(camera.rotationY).toBe(0)
		viewer.destroy()
	})
})

describe('trueNorth shifts the coordinates, not the camera', () => {
	it('offsets getDirection by the true-north rotation', async () => {
		// `setDirection(yaw)` stores `yaw + rotationY` (wrapped), so on a rotated image the
		// getter reports the rotated frame rather than the logical yaw. Consumers pair the
		// two, so the relationship is what matters.
		const { viewer, camera } = await openSettings({ _360: { trueNorth: 0.75 } })
		const rotation = camera.rotationY
		expect(rotation).toBeCloseTo(Math.PI / 2, 8)

		for (const yaw of [0, Math.PI / 4, Math.PI]) {
			camera.setDirection(yaw)
			// Compare modulo 2π: the getter reports a wrapped angle
			const expected = (((yaw + rotation) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
			const diff = Math.abs(((camera.getDirection() - expected + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
			expect(diff, `yaw ${yaw}`).toBeLessThan(1e-6)
		}
		viewer.destroy()
	})

	it('moves the same image point to a different screen position', async () => {
		const straight = await openSettings({ _360: { trueNorth: 0.5 } })
		const rotated = await openSettings({ _360: { trueNorth: 0.75 } })
		straight.camera.setDirection(0, 0)
		rotated.camera.setDirection(0, 0)

		// The sphere centre is always in front of the camera, so this comparison stays
		// finite even when a rotation pushes other points towards the pole.
		const before = point(straight.image, 0.5, 0.5)
		const after = point(rotated.image, 0.5, 0.5)
		expect(before.every(Number.isFinite)).toBe(true)
		expect(after.every(Number.isFinite)).toBe(true)
		// The same logical point lands elsewhere horizontally...
		expect(after[0]).not.toBeCloseTo(before[0], 1)
		// ...while the vertical component is untouched by a horizontal rotation
		expect(after[1]).toBeCloseTo(before[1], 1)

		straight.viewer.destroy()
		rotated.viewer.destroy()
	})

	it('is skipped when getXY is asked to ignore true north', async () => {
		const { viewer, image } = await openSettings({ _360: { trueNorth: 0.75 } })
		image.camera.setDirection(0, 0)

		const withNorth = [...image.camera.getXY(0.5, 0.4)]
		const withoutNorth = [...image.camera.getXY(0.5, 0.4, false, undefined, undefined, true)]
		expect(withoutNorth[0]).not.toBeCloseTo(withNorth[0], 1)
		viewer.destroy()
	})
})

describe('space data overrides trueNorth', () => {
	it('uses the per-image rotationY from the space', async () => {
		const { viewer, ids } = await openSpace(0, { rotationY: () => Math.PI })
		expect(viewer.el.$current?.id).toBe(ids[0])
		expect(viewer.el.$current?.camera.rotationY).toBeCloseTo(Math.PI, 8)
		viewer.destroy()
	})

	it('per-image rotationY wins over the settings value', async () => {
		// The image carries both a space rotation and a _360.trueNorth setting; the
		// space value is applied first and the settings value would overwrite it if
		// the order in image.ts were wrong.
		const { images, spaces } = freshSpace({ rotationY: () => Math.PI / 2 })
		const [first] = images
		if (!first) {
			throw new Error('no image fixture')
		}
		first.settings = { _360: { trueNorth: 0.75 } }
		mockJson(/bundle\.json/, { images, spaces })

		const viewer = mountViewer()
		await viewer.open(first.id)
		await waitFor(() => get(viewer.el._loading) === false, 4000, 'loading to finish')
		expect(viewer.el.$current?.camera.rotationY).toBeCloseTo(Math.PI / 2, 8)
		viewer.destroy()
	})

	it('falls back to trueNorth when the image is not in the space', async () => {
		// A 360 image that declares a spacesId whose space has no entry for it
		const { images, spaces, ids } = freshSpace()
		const [first] = images
		const [space] = spaces
		const [firstId] = ids
		if (!first || !space || !firstId) {
			throw new Error('space fixture missing')
		}
		first.settings = { _360: { trueNorth: 0.75 } }
		space.data.images = space.data.images.filter((w) => w.id !== firstId)
		mockJson(/bundle\.json/, { images, spaces })

		const viewer = mountViewer()
		await viewer.open(firstId)
		await waitFor(() => get(viewer.el._loading) === false, 4000, 'loading to finish')
		expect(viewer.el.$current?.camera.rotationY).toBeCloseTo(Math.PI / 2, 8)
		viewer.destroy()
	})
})
