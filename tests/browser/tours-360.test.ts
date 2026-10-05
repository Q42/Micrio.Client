import { describe, expect, it } from 'vitest'
import { get } from '../../src/core/store'
import { getSpaceVector } from '../../src/utils/space'
import { mountViewer, waitFor } from '../helpers/viewer'
import { spaceBundle } from '../fixtures/bundles'
import { mockJson } from '../helpers/network'

/**
 * The bundle and space caches in `$utils/dataLoader` are module-level and keyed
 * by id, so every test rewrites the fixture to fresh ids. That covers both the
 * image ids (otherwise the second test would hit the cached bundle and never
 * populate the new space) and the space id itself.
 */
let run = 0
function freshSpace() {
	const suffix = (++run).toString().padStart(3, '0')
	const { images, spaces } = spaceBundle()
	const spaceId = `space-${suffix}`
	const idMap = new Map<string, string>()
	for (const [index, image] of images.entries()) {
		const next = `${suffix}img${index}`
		idMap.set(image.id, next)
		image.id = next
		image.info.id = next
	}
	const space = spaces[0]
	if (!space) {
		throw new Error('space fixture missing')
	}
	space.id = spaceId
	for (const image of images) {
		if (image.info.spacesId !== undefined) {
			image.info.spacesId = spaceId
		}
	}
	for (const waypoint of space.data.images) {
		waypoint.id = idMap.get(waypoint.id) ?? waypoint.id
	}
	space.data.links = space.data.links.map(([a, b, c]) => [idMap.get(a) ?? a, idMap.get(b) ?? b, c])
	return { images, spaces }
}

async function openSpace(index = 0) {
	const { images, spaces } = freshSpace()
	mockJson(/bundle\.json/, { images, spaces })
	const viewer = mountViewer('', 'width: 512px; height: 256px; display: block;')
	const id = images[index]?.id ?? ''
	await viewer.open(id)
	await waitFor(() => viewer.el.$current?.id === id, 4000, 'current image')
	await waitFor(() => get(viewer.el._loading) === false, 4000, 'loading to finish')
	return { viewer, images, spaces, ids: images.map((i) => i.id) }
}

describe('360 spaces', () => {
	it('ignores a space that only contains the image itself', async () => {
		const { images, spaces } = freshSpace()
		spaces[0]?.data.images.splice(1) // leave a single waypoint
		mockJson(/bundle\.json/, { images, spaces })
		const viewer = mountViewer('', 'width: 512px; height: 256px; display: block;')
		await viewer.open(images[0]?.id ?? '')
		await waitFor(() => get(viewer.el._loading) === false, 4000, 'loading to finish')
		// A one-image space is not navigable and is discarded
		expect(viewer.el.spaceData).toBeUndefined()
		viewer.destroy()
	})

	it('resolves the space data for a 360 image in a multi-image space', async () => {
		const { viewer } = await openSpace()
		expect(viewer.el.spaceData?.name).toBe('Zone')
		expect(viewer.el.spaceData?.images).toHaveLength(2)
		expect(viewer.el.$current?._is360).toBe(true)
		viewer.destroy()
	})

	it('computes a navigation vector between two waypoints', async () => {
		const { viewer, ids } = await openSpace()
		const vector = getSpaceVector(viewer.el, ids[1] ?? '')
		expect(vector).not.toBeUndefined()
		// The two waypoints differ only along X
		expect(vector?.v[0]).toBe(1)
		expect(vector?.v[1]).toBeCloseTo(0, 12)
		expect(vector?.v[2]).toBeCloseTo(0, 12)
		expect(vector?.vector.distanceX).toBeCloseTo(0.4, 6)
		expect(vector?.vector.distanceY).toBeCloseTo(0, 12)
		viewer.destroy()
	})

	it('applies the waypoint rotation to the camera', async () => {
		const { viewer, spaces } = await openSpace(1)
		expect(viewer.el.spaceData).toEqual(spaces[0]?.data)
		// rotationY was applied at construction from the space's per-image value
		expect(viewer.el.$current?.camera.rotationY).toBeCloseTo(Math.PI / 2, 6)
		viewer.destroy()
	})

	it('returns no vector when the target is not in the space', async () => {
		const { viewer } = await openSpace()
		expect(getSpaceVector(viewer.el, 'not-in-space')).toBeUndefined()
		viewer.destroy()
	})

	it('opens the other waypoint when it is requested', async () => {
		const { viewer, ids } = await openSpace()
		await viewer.open(ids[1] ?? '')
		await waitFor(() => viewer.el.$current?.id === ids[1], 4000, 'switched waypoint')
		expect(viewer.el.$current?.camera.rotationY).toBeCloseTo(Math.PI / 2, 6)
		viewer.destroy()
	})
})
