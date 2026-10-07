import { describe, expect, it } from 'vitest'
import { PaperMesh } from '$book/geometry/paper-mesh'
import { CoverMesh } from '$book/geometry/cover-mesh'
import { rayIntersectMeshes } from '$book/geometry/raycast'
import { Vec3 } from '$book/core/vec3'

/** A 2×1 page in the xz plane, spine at x = 0. */
const page = (yOffset = 0): PaperMesh => new PaperMesh(yOffset, 2, 0.5)

describe('rayIntersectMeshes', () => {
	it('finds the page from above and reports t and the hit point', () => {
		const mesh = page(0.5)
		const hit = rayIntersectMeshes([mesh], new Vec3(1, 2, 0), new Vec3(0, -1, 0))
		expect(hit).not.toBeNull()
		expect(hit?._t).toBeCloseTo(1.5, 6)
		expect(hit?._point._x).toBeCloseTo(1, 6)
		expect(hit?._point._y).toBeCloseTo(0.5, 6)
		expect(hit?._point._z).toBeCloseTo(0, 6)
		expect(hit?._meshIndex).toBe(0)
	})

	it('finds the page from below as well: there is no backface culling', () => {
		const mesh = page(0)
		const hit = rayIntersectMeshes([mesh], new Vec3(1, -2, 0), new Vec3(0, 1, 0))
		expect(hit?._t).toBeCloseTo(2, 6)
		expect(hit?._point._y).toBeCloseTo(0, 6)
	})

	it('misses when the ray is parallel to the page', () => {
		expect(rayIntersectMeshes([page()], new Vec3(1, 0.01, 0), new Vec3(0, 0, 1))).toBeNull()
		expect(rayIntersectMeshes([page()], new Vec3(1, 2, 0), new Vec3(1, 0, 0))).toBeNull()
	})

	it('misses outside the page rectangle', () => {
		const mesh = page()
		// Past the free edge (x > paperWidth)
		expect(rayIntersectMeshes([mesh], new Vec3(3, 2, 0), new Vec3(0, -1, 0))).toBeNull()
		// Past the spine (x < 0)
		expect(rayIntersectMeshes([mesh], new Vec3(-0.5, 2, 0), new Vec3(0, -1, 0))).toBeNull()
		// Past the page's top edge (|z| > paperHeight/2)
		expect(rayIntersectMeshes([mesh], new Vec3(1, 2, 2), new Vec3(0, -1, 0))).toBeNull()
	})

	it('never reports a hit behind the ray origin', () => {
		// Origin below the page, pointing further down
		expect(rayIntersectMeshes([page(0.5)], new Vec3(1, 0, 0), new Vec3(0, -1, 0))).toBeNull()
	})

	it('returns the closest of several stacked meshes', () => {
		const top = page(1)
		const bottom = page(-1)
		const fromAbove = rayIntersectMeshes([top, bottom], new Vec3(1, 5, 0), new Vec3(0, -1, 0))
		expect(fromAbove?._meshIndex).toBe(0)
		expect(fromAbove?._point._y).toBeCloseTo(1, 6)

		// The same ray against the reordered list resolves by distance, not by order
		const reordered = rayIntersectMeshes([bottom, top], new Vec3(1, 5, 0), new Vec3(0, -1, 0))
		expect(reordered?._meshIndex).toBe(1)
		expect(reordered?._point._y).toBeCloseTo(1, 6)
	})

	it('skips an undefined entry in the mesh list', () => {
		const mesh = page(0)
		const meshes: PaperMesh[] = [undefined as unknown as PaperMesh, mesh]
		const hit = rayIntersectMeshes(meshes, new Vec3(1, 2, 0), new Vec3(0, -1, 0))
		expect(hit?._meshIndex).toBe(1)
	})

	it('is safe with no meshes at all', () => {
		expect(rayIntersectMeshes([], new Vec3(0, 0, 0), new Vec3(0, -1, 0))).toBeNull()
	})

	it('intersects a cover page and its thickness', () => {
		const cover = new CoverMesh(0, 2, 0.5, 0.02, 1, 1)
		// Through the front face (y = +0.01)
		const front = rayIntersectMeshes([cover], new Vec3(1, 2, 0), new Vec3(0, -1, 0))
		expect(front?._point._y).toBeCloseTo(0.01, 5)
		// Through the back face (y = -0.01)
		const back = rayIntersectMeshes([cover], new Vec3(1, -2, 0), new Vec3(0, 1, 0))
		expect(back?._point._y).toBeCloseTo(-0.01, 5)
	})

	it('follows the deformed mesh, so a flipped page is picked where it now is', () => {
		const mesh = page(0)
		// Move the whole page up by 3 world units
		for (let i = 1; i < mesh._positions.length; i += 3) {
			mesh._positions[i] += 3
		}
		const hit = rayIntersectMeshes([mesh], new Vec3(1, 5, 0), new Vec3(0, -1, 0))
		expect(hit?._point._y).toBeCloseTo(3, 5)
	})
})
