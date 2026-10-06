import { describe, expect, it } from 'vitest'
import { PaperMesh, VERTEX_COUNT } from '$book/geometry/paper-mesh'
import { CoverMesh } from '$book/geometry/cover-mesh'
import { GRID_COLS, GRID_ROWS, buildIndexBuffer, computeVertexNormals } from '$book/geometry/mesh-utils'

const TRIANGLES = (GRID_COLS - 1) * (GRID_ROWS - 1) * 2
const CELLS = (GRID_COLS - 1) * (GRID_ROWS - 1)
/** both diagonals per cell + the horizontal and vertical grid edges */
const EDGES = CELLS * 2 + GRID_COLS * (GRID_ROWS - 1) + GRID_ROWS * (GRID_COLS - 1)
/** the unique boundary edges of the grid (corners shared between two sides) */
const BOUNDARY = 2 * (GRID_COLS - 1) + 2 * (GRID_ROWS - 1)
/** every triangle edge that is shared by two triangles, i.e. one bending constraint each */
const INTERIOR = (TRIANGLES * 3 - BOUNDARY) / 2

describe('PaperMesh — grid', () => {
	const mesh = new PaperMesh(0.25, 2, 0.5)

	it('lays the grid out over the page rectangle at the y offset', () => {
		expect(mesh._paperWidth).toBe(2)
		expect(mesh._paperHeight).toBe(1)
		expect(mesh._yOffset).toBe(0.25)
		expect(mesh._positions).toHaveLength(VERTEX_COUNT * 3)

		const at = (col: number, row: number) => {
			const i = (row * GRID_COLS + col) * 3
			return [mesh._restPositions[i], mesh._restPositions[i + 1], mesh._restPositions[i + 2]]
		}
		expect(at(0, 0)).toEqual([0, 0.25, -0.5])
		expect(at(GRID_COLS - 1, 0)).toEqual([2, 0.25, -0.5])
		expect(at(0, GRID_ROWS - 1)).toEqual([0, 0.25, 0.5])
		expect(at(GRID_COLS - 1, GRID_ROWS - 1)).toEqual([2, 0.25, 0.5])
	})

	it('carries the normalized grid as texture coordinates', () => {
		const at = (col: number, row: number) => {
			const i = (row * GRID_COLS + col) * 2
			return [mesh._texCoords[i], mesh._texCoords[i + 1]]
		}
		expect(at(0, 0)).toEqual([0, 0])
		expect(at(GRID_COLS - 1, 0)).toEqual([1, 0])
		expect(at(0, GRID_ROWS - 1)).toEqual([0, 1])
		expect(at(GRID_COLS - 1, GRID_ROWS - 1)).toEqual([1, 1])
	})

	it('builds two triangles per grid cell and a matching index buffer', () => {
		expect(mesh._triangles).toHaveLength(TRIANGLES)
		expect(mesh._indexBuffer).toHaveLength(TRIANGLES * 3)
		// Wound (tl, bl, tr) then (tr, bl, br) — the winding computeVertexNormals reads
		expect(Array.from(mesh._triangles[0]._indices)).toEqual([0, GRID_COLS, 1])
	})

	it('starts every vertex dynamic and at rest', () => {
		expect(Array.from(mesh._invMasses)).toEqual(Array(VERTEX_COUNT).fill(1))
		expect(Array.from(mesh._positions)).toEqual(Array.from(mesh._restPositions))
		expect(Array.from(mesh._velocities)).toEqual(Array(VERTEX_COUNT * 3).fill(0))
	})
})

describe('PaperMesh — constraints', () => {
	const mesh = new PaperMesh(0, 1, 1)

	it('covers every grid edge exactly once, including both diagonals', () => {
		expect(mesh._distanceConstraints).toHaveLength(EDGES)
		const keys = new Set(mesh._distanceConstraints.map((c) => `${Math.min(c._i, c._j)}-${Math.max(c._i, c._j)}`))
		expect(keys.size).toBe(EDGES)
	})

	it('bends over the two opposite tips of every interior edge', () => {
		// A bending constraint exists only where two triangles share an edge, and
		// the constraint joins the tips opposite that shared edge.
		expect(mesh._bendingConstraints).toHaveLength(INTERIOR)
		for (const c of mesh._bendingConstraints) {
			expect(c._restLength).toBeGreaterThan(0)
			expect(c._i).not.toBe(c._j)
		}
		// The first shared edge is the vertical 1–GRID_COLS between the first cell's
		// two triangles, so the constraint joins the tips opposite it: 0 and
		// GRID_COLS+1.
		const first = mesh._bendingConstraints[0]
		expect(new Set([first._i, first._j])).toEqual(new Set([0, GRID_COLS + 1]))
	})

	it('stores the rest length of each constraint from the rest positions', () => {
		// A horizontal neighbour is one cell wide: paperWidth / (GRID_COLS - 1)
		const horizontal = mesh._distanceConstraints.find((c) => c._j - c._i === 1 && c._restLength < 0.2)
		expect(horizontal?._restLength).toBeCloseTo(1 / (GRID_COLS - 1), 5)
		// A vertical neighbour is one cell tall
		const vertical = mesh._distanceConstraints.find((c) => c._j - c._i === GRID_COLS && c._restLength < 0.2)
		expect(vertical?._restLength).toBeCloseTo(1 / (GRID_ROWS - 1), 5)
		// The diagonals are the longest edges in the grid
		const min = Math.min(...mesh._distanceConstraints.map((c) => c._restLength))
		const max = Math.max(...mesh._distanceConstraints.map((c) => c._restLength))
		expect(min).toBeCloseTo(1 / (GRID_ROWS - 1), 5)
		expect(max).toBeCloseTo(Math.hypot(1 / (GRID_COLS - 1), 1 / (GRID_ROWS - 1)), 5)
	})
})

describe('PaperMesh — binding and reset', () => {
	it('pins the spine column and can be reset back to rest', () => {
		const mesh = new PaperMesh(0, 1, 1)
		expect(mesh._boundLeft).toHaveLength(GRID_ROWS)
		expect(mesh._boundLeft).toContain(0)
		expect(mesh._boundLeft).toContain((GRID_ROWS - 1) * GRID_COLS)

		mesh._setBinding()
		for (const idx of mesh._boundLeft) {
			expect(mesh._invMasses[idx]).toBe(0)
		}
		expect(mesh._invMasses[1]).toBe(1)

		mesh._positions[7] = 99
		mesh._velocities[7] = 5
		mesh._reset()
		expect(mesh._positions[7]).toBe(mesh._restPositions[7])
		expect(mesh._velocities[7]).toBe(0)
	})

	it('computes unit normals with the winding the renderer expects', () => {
		const mesh = new PaperMesh(0, 1, 1)
		const normals = mesh._computeNormals()
		expect(normals).toHaveLength(VERTEX_COUNT * 3)
		// The grid triangles are wound (tl, bl, tr), so the page's front normal
		// points along +y — the same face the front texture is drawn on.
		for (let i = 0; i < VERTEX_COUNT; i++) {
			expect(normals[i * 3]).toBeCloseTo(0, 6)
			expect(normals[i * 3 + 1]).toBeCloseTo(1, 6)
			expect(normals[i * 3 + 2]).toBeCloseTo(0, 6)
		}
	})
})

describe('mesh-utils — buildIndexBuffer', () => {
	it('flattens the triangle list in order', () => {
		const buf = buildIndexBuffer([{ _indices: [0, 1, 2] }, { _indices: [2, 1, 3] }])
		expect(buf).toBeInstanceOf(Uint32Array)
		expect(Array.from(buf)).toEqual([0, 1, 2, 2, 1, 3])
	})

	it('produces an empty buffer for no triangles', () => {
		expect(buildIndexBuffer([])).toHaveLength(0)
	})
})

describe('mesh-utils — computeVertexNormals', () => {
	it('returns the cross product of the first two edges, not normalized away', () => {
		// e1 = (1,0,0), e2 = (0,0,1): e1 × e2 = (0·1-0·0, 0·0-1·1, 0) = (0,-1,0)
		const normals = computeVertexNormals(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), [{ _indices: [0, 1, 2] }], 3)
		for (let i = 0; i < 3; i++) {
			expect(normals[i * 3]).toBeCloseTo(0, 6)
			expect(normals[i * 3 + 1]).toBeCloseTo(-1, 6)
			expect(normals[i * 3 + 2]).toBeCloseTo(0, 6)
		}
	})

	it('averages the adjoining triangles per vertex and renormalizes', () => {
		// A quad from two triangles shares the diagonal vertices, which get the
		// mean of two identical face normals: still unit length.
		const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1])
		const normals = computeVertexNormals(positions, [{ _indices: [0, 1, 2] }, { _indices: [1, 3, 2] }], 4)
		for (let i = 0; i < 4; i++) {
			expect(Math.hypot(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2])).toBeCloseTo(1, 6)
		}
	})

	it('leaves an unreferenced vertex at zero instead of dividing by its empty count', () => {
		const normals = computeVertexNormals(
			new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 5, 5, 5]),
			[{ _indices: [0, 1, 2] }],
			4,
		)
		expect(Array.from(normals.slice(9, 12))).toEqual([0, 0, 0])
	})

	it('is safe for an empty mesh', () => {
		expect(computeVertexNormals(new Float32Array(0), [], 0)).toHaveLength(0)
	})
})

describe('CoverMesh', () => {
	const mesh = new CoverMesh(0.1, 2, 0.5, 0.02, 1.04, 1.08)
	const faceCount = VERTEX_COUNT
	// Two face grids plus four side strips of two vertices per edge vertex
	const total = faceCount * 2 + (GRID_COLS * 2 + GRID_ROWS * 2) * 2

	it('sizes itself for two faces plus the four side strips', () => {
		expect(total).toBe(376)
		expect(mesh._positions).toHaveLength(total * 3)
		expect(mesh._texCoords).toHaveLength(total * 2)
		expect(mesh._triangles.length).toBe(TRIANGLES * 2 + (GRID_COLS - 1 + GRID_ROWS - 1) * 4)
		expect(mesh._coverThickness).toBe(0.02)
		expect(mesh._coverScale).toBe(1.04)
		expect(mesh._coverScaleY).toBe(1.08)
	})

	it('offsets the two faces by half the cover thickness around the page', () => {
		const front = mesh._restPositions[1] - mesh._yOffset
		const back = mesh._restPositions[faceCount * 3 + 1] - mesh._yOffset
		expect(front).toBeCloseTo(0.01, 6)
		expect(back).toBeCloseTo(-0.01, 6)
	})

	it('scales each face around the page centre, on both axes', () => {
		const left = mesh._restPositions[0]
		const right = mesh._restPositions[(GRID_COLS - 1) * 3]
		// Width 2 centred at 1: 1 ± 1.04
		expect(left).toBeCloseTo(1 - 1.04, 6)
		expect(right).toBeCloseTo(1 + 1.04, 6)
		// The z extremes scale by 1.08 around 0 (paperHeight/2 = 0.5)
		const top = mesh._restPositions[2]
		const bottom = mesh._restPositions[(GRID_ROWS - 1) * GRID_COLS * 3 + 2]
		expect(top).toBeCloseTo(-0.5 * 1.08, 6)
		expect(bottom).toBeCloseTo(0.5 * 1.08, 6)
	})

	it('mirrors the back face texture coordinates so it reads as a left page', () => {
		expect(mesh._texCoords[faceCount * 2]).toBe(1)
		expect(mesh._texCoords[(faceCount + GRID_COLS - 1) * 2]).toBe(0)
		// The front face is not mirrored
		expect(mesh._texCoords[0]).toBe(0)
		expect(mesh._texCoords[(GRID_COLS - 1) * 2]).toBe(1)
	})

	it('puts the side strip vertices on the paper edge, one cover thickness below the front', () => {
		const sideStart = faceCount * 2
		const frontVertex = sideStart * 3
		const backVertex = (sideStart + 1) * 3
		expect(mesh._restPositions[frontVertex]).toBeCloseTo(mesh._restPositions[0], 6)
		expect(mesh._restPositions[frontVertex + 1]).toBeCloseTo(mesh._restPositions[1], 6)
		expect(mesh._restPositions[frontVertex + 2]).toBeCloseTo(mesh._restPositions[2], 6)
		expect(mesh._restPositions[backVertex + 1]).toBeCloseTo(mesh._restPositions[1] - 0.02, 6)
	})

	it('pins both face grids on their spine column', () => {
		mesh._setBinding()
		for (let r = 0; r < GRID_ROWS; r++) {
			expect(mesh._invMasses[r * GRID_COLS]).toBe(0)
			expect(mesh._invMasses[faceCount + r * GRID_COLS]).toBe(0)
		}
		expect(mesh._boundLeft).toHaveLength(GRID_ROWS * 2)
	})

	it('has distance constraints but no bending constraints', () => {
		expect(mesh._distanceConstraints.length).toBeGreaterThan(0)
		expect(mesh._bendingConstraints).toHaveLength(0)
	})

	it('uses an outward normal per face, opposite between front and back', () => {
		const normals = mesh._computeNormals()
		// The front face is wound (tl, bl, tr) and the back face reversed, so the
		// front normal points up (+y) and the back one down (-y).
		expect(normals[1]).toBeCloseTo(1, 6)
		expect(normals[faceCount * 3 + 1]).toBeCloseTo(-1, 6)
	})

	it('derives the front texture coordinate grid the same way as a paper page', () => {
		// Row-major u across, v down: the last column of the first row is u = 1
		expect(mesh._texCoords[1]).toBe(0)
		expect(mesh._texCoords[(GRID_COLS - 1) * 2 + 1]).toBe(0)
		expect(mesh._texCoords[(GRID_ROWS - 1) * GRID_COLS * 2 + 1]).toBe(1)
	})
})
