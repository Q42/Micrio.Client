import { describe, expect, it } from 'vitest'
import { PaperMesh } from '$book/geometry/paper-mesh'
import { CoverMesh } from '$book/geometry/cover-mesh'
import { projectWorldToScreen, sampleMeshPosition, uvToWorldPosition, type TexRegion } from '$book/geometry/uv-project'
import { Mat4 } from '$render/mat'
import { Vec3 } from '$book/core/vec3'

const identity = (): Mat4 => {
	const m = new Mat4()
	m._identity()
	return m
}

describe('uvToWorldPosition — a flat paper page', () => {
	// Width 2, height 1, spine along x = 0 and the page spanning x 0..2
	const mesh = new PaperMesh(0.25, 2, 0.5)

	it('maps the image corners onto the page rectangle', () => {
		const tl = uvToWorldPosition(mesh, 0, 0, 0)
		expect(tl?._point._x).toBeCloseTo(0, 6)
		expect(tl?._point._y).toBeCloseTo(0.25, 6)
		expect(tl?._point._z).toBeCloseTo(-0.5, 6)

		const br = uvToWorldPosition(mesh, 1, 1, 0)
		expect(br?._point._x).toBeCloseTo(2, 6)
		expect(br?._point._z).toBeCloseTo(0.5, 6)

		// v increases "down" the page, so v = 0 is the top edge
		expect(uvToWorldPosition(mesh, 0.5, 0.5, 0)?._point._y).toBeCloseTo(0.25, 6)
	})

	it('reports the page extents through the tangents', () => {
		const r = uvToWorldPosition(mesh, 0.5, 0.5, 0)
		expect(r?._tangentU._x).toBeCloseTo(2, 5)
		expect(r?._tangentU._y).toBeCloseTo(0, 6)
		expect(r?._tangentU._z).toBeCloseTo(0, 6)
		expect(r?._tangentV._z).toBeCloseTo(1, 5)
		expect(r?._tangentV._x).toBeCloseTo(0, 6)
	})

	it('returns a unit normal that matches the mesh winding', () => {
		const r = uvToWorldPosition(mesh, 0.3, 0.7, 0)
		expect(r?._normal._y).toBeCloseTo(1, 6)
		expect(Math.hypot(r?._normal._x, r?._normal._y, r?._normal._z)).toBeCloseTo(1, 6)
	})

	it('rejects a coordinate outside [0, 1]', () => {
		expect(uvToWorldPosition(mesh, -1e-9, 0, 0)).toBeNull()
		expect(uvToWorldPosition(mesh, 1.0000001, 0, 0)).toBeNull()
		expect(uvToWorldPosition(mesh, 0, -0.5, 0)).toBeNull()
		expect(uvToWorldPosition(mesh, 0, 1.5, 0)).toBeNull()
		// The boundaries themselves are valid
		expect(uvToWorldPosition(mesh, 0, 0, 0)).not.toBeNull()
		expect(uvToWorldPosition(mesh, 1, 1, 0)).not.toBeNull()
	})

	it('interpolates both triangle halves consistently across a cell diagonal', () => {
		// (0.05, 0.02) and (0.02, 0.05) sit on either side of the cell diagonal
		const a = uvToWorldPosition(mesh, 0.05, 0.02, 0)
		const b = uvToWorldPosition(mesh, 0.02, 0.05, 0)
		const cell = mesh._paperWidth / 9
		expect(a?._point._x).toBeCloseTo(0.05 * 9 * cell, 5)
		expect(b?._point._x).toBeCloseTo(0.02 * 9 * cell, 5)
		expect(a?._point._z).toBeCloseTo(-0.5 + 0.02 * 13 * (mesh._paperHeight / 13), 5)
	})
})

describe('uvToWorldPosition — mirrored back face', () => {
	const mesh = new PaperMesh(0, 2, 0.5)

	it('un-mirrors a single-grid mesh back face, so u = 0 lands on the free edge', () => {
		// The back texture is sampled at (1 - u), so image u = 0 sits at the page's
		// free edge (x = width) and u = 1 on the spine.
		const backStart = uvToWorldPosition(mesh, 0, 0.5, 1)
		const backEnd = uvToWorldPosition(mesh, 1, 0.5, 1)
		expect(backStart?._point._x).toBeCloseTo(2, 5)
		expect(backEnd?._point._x).toBeCloseTo(0, 5)
	})

	it('points the back face u tangent opposite the front face', () => {
		const front = uvToWorldPosition(mesh, 0.5, 0.5, 0)
		const back = uvToWorldPosition(mesh, 0.5, 0.5, 1)
		expect(Math.sign(front?._tangentU._x ?? 0)).toBe(1)
		expect(Math.sign(back?._tangentU._x ?? 0)).toBe(-1)
		expect(back?._tangentV._z).toBeCloseTo(1, 5)
	})

	it('both faces report the same surface normal, so only the caller flips it', () => {
		const front = uvToWorldPosition(mesh, 0.5, 0.5, 0)
		const back = uvToWorldPosition(mesh, 0.5, 0.5, 1)
		expect(back?._normal._y).toBeCloseTo(front?._normal._y ?? 0, 6)
	})
})

describe('uvToWorldPosition — cover back face', () => {
	const mesh = new CoverMesh(0, 2, 0.5, 0.02, 1, 1)

	it('samples the cover back grid directly, without the single-grid mirroring', () => {
		// Both faces map u to the same world x range (the cover's back grid has its
		// own mirrored texture coordinates instead).
		const front = uvToWorldPosition(mesh, 0.25, 0.5, 0)
		const back = uvToWorldPosition(mesh, 0.25, 0.5, 1)
		expect(back?._point._x).toBeCloseTo(front?._point._x ?? 0, 5)
		expect(back?._tangentU._x).toBeCloseTo(front?._tangentU._x ?? 0, 5)
	})

	it('puts the cover back face one thickness below the front', () => {
		const front = uvToWorldPosition(mesh, 0.5, 0.5, 0)
		const back = uvToWorldPosition(mesh, 0.5, 0.5, 1)
		expect((front?._point._y ?? 0) - (back?._point._y ?? 0)).toBeCloseTo(0.02, 5)
	})
})

describe('uvToWorldPosition — texture regions', () => {
	const mesh = new PaperMesh(0, 1, 1)
	const region: TexRegion = { uMin: 0.25, vMin: 0.5, fU: 0.5, fV: 0.5 }

	it('maps the image coordinate into the region of the page', () => {
		const start = uvToWorldPosition(mesh, 0, 0, 0, region)
		const end = uvToWorldPosition(mesh, 1, 1, 0, region)
		// u 0..1 spans the page u 0.25..0.75, v 0..1 spans 0.5..1
		expect(start?._point._x).toBeCloseTo(0.25, 5)
		expect(end?._point._x).toBeCloseTo(0.75, 5)
		expect(start?._point._z).toBeCloseTo(0, 5)
		expect(end?._point._z).toBeCloseTo(0.5, 5)
	})

	it('scales the tangents by the fill fractions', () => {
		const full = uvToWorldPosition(mesh, 0.5, 0.5, 0)
		const partial = uvToWorldPosition(mesh, 0.5, 0.5, 0, region)
		expect(partial?._tangentU._x).toBeCloseTo((full?._tangentU._x ?? 0) * 0.5, 5)
		expect(partial?._tangentV._z).toBeCloseTo((full?._tangentV._z ?? 0) * 0.5, 5)
	})

	it('treats a missing region as the whole page', () => {
		const none = uvToWorldPosition(mesh, 0.4, 0.6, 0)
		const full = uvToWorldPosition(mesh, 0.4, 0.6, 0, { uMin: 0, vMin: 0, fU: 1, fV: 1 })
		expect(none?._point._x).toBeCloseTo(full?._point._x ?? 0, 6)
		expect(none?._point._z).toBeCloseTo(full?._point._z ?? 0, 6)
	})
})

describe('sampleMeshPosition', () => {
	it('returns the same point as the full sample, without normals or tangents', () => {
		const mesh = new PaperMesh(0.1, 1.5, 0.8)
		for (const [u, v] of [
			[0, 0],
			[0.33, 0.66],
			[1, 1],
		]) {
			const full = uvToWorldPosition(mesh, u, v, 0)
			const point = sampleMeshPosition(mesh, u, v, 0)
			expect(point?._x).toBeCloseTo(full?._point._x ?? 0, 6)
			expect(point?._y).toBeCloseTo(full?._point._y ?? 0, 6)
			expect(point?._z).toBeCloseTo(full?._point._z ?? 0, 6)
		}
	})

	it('rejects out-of-range coordinates too', () => {
		const mesh = new PaperMesh()
		expect(sampleMeshPosition(mesh, 2, 0.5, 0)).toBeNull()
		expect(sampleMeshPosition(mesh, 0.5, -0.1, 1)).toBeNull()
	})

	it('follows the deformed positions, not the rest positions', () => {
		const mesh = new PaperMesh(0, 1, 1)
		const before = sampleMeshPosition(mesh, 1, 1, 0)
		mesh._positions[mesh._positions.length - 3] += 5
		const after = sampleMeshPosition(mesh, 1, 1, 0)
		expect((after?._x ?? 0) - (before?._x ?? 0)).toBeCloseTo(5, 5)
	})
})

describe('projectWorldToScreen', () => {
	it('maps an identity NDC cube onto the viewport with y flipped', () => {
		const m = identity()
		expect(projectWorldToScreen(new Vec3(0, 0, 0), m, 800, 600)).toEqual({ x: 400, y: 300 })
		// (-1, -1, 0) is bottom-left in NDC, so it is bottom-left on screen
		expect(projectWorldToScreen(new Vec3(-1, -1, 0), m, 800, 600)).toEqual({ x: 0, y: 600 })
		expect(projectWorldToScreen(new Vec3(1, 1, 0), m, 800, 600)).toEqual({ x: 800, y: 0 })
	})

	it('returns null for a point behind the camera', () => {
		// A last row of (0, 0, -1, 0) makes clip w the negated depth, like a real
		// projection: a point with +z sits behind the eye.
		const viewProj = new Mat4()
		viewProj._identity()
		viewProj.arr[11] = -1
		expect(projectWorldToScreen(new Vec3(0, 0, 1), viewProj, 800, 600)).toBeNull()
		// The same point in front of the camera projects normally
		expect(projectWorldToScreen(new Vec3(0, 0, -1), viewProj, 800, 600)).not.toBeNull()
	})
})
