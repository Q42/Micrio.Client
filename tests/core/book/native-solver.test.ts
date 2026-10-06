import { describe, expect, it } from 'vitest'
import { buildConstraintSet, runSubstep, type SubstepParams } from '$book/physics/native-solver'
import type { EdgeConstraint } from '$book/geometry/mesh-utils'

/** Two vertices, one distance constraint between them. */
function twoVertexSolve(
	overrides: Partial<SubstepParams> = {},
	options: {
		distance?: EdgeConstraint[]
		distanceLambda?: Float64Array
		firstPos?: [number, number, number]
		secondPos?: [number, number, number]
		firstVel?: [number, number, number]
		secondVel?: [number, number, number]
		invMass?: [number, number]
		floor?: number
	} = {},
): {
	positions: Float32Array
	velocities: Float32Array
	prev: Float32Array
	distanceLambda: Float64Array
} {
	const distance = options.distance ?? [{ _i: 0, _j: 1, _restLength: 1 }]
	const positions = new Float32Array([...(options.firstPos ?? [-0.5, 0, 0]), ...(options.secondPos ?? [0.5, 0, 0])])
	const velocities = new Float32Array([...(options.firstVel ?? [0, 0, 0]), ...(options.secondVel ?? [0, 0, 0])])
	const prev = new Float32Array(6)
	const invMasses = new Float32Array(options.invMass ?? [1, 1])
	const distanceLambda = options.distanceLambda ?? new Float64Array(distance.length)
	const empty = buildConstraintSet([])

	const params: SubstepParams = {
		dt: 1 / 60,
		solverIterations: 64,
		distanceCompliance: 0,
		bendingCompliance: 0,
		damping: 1,
		gravity: 0,
		gravityEnabled: false,
		...overrides,
	}

	runSubstep(
		positions,
		velocities,
		prev,
		invMasses,
		2,
		buildConstraintSet(distance),
		empty,
		distanceLambda,
		new Float64Array(0),
		params,
		options.floor ?? -10,
	)

	return { positions, velocities, prev, distanceLambda }
}

describe('buildConstraintSet', () => {
	it('flattens a constraint list into structure-of-arrays buffers', () => {
		const set = buildConstraintSet([
			{ _i: 3, _j: 7, _restLength: 0.25 },
			{ _i: 1, _j: 2, _restLength: 4 },
		])
		expect(set.count).toBe(2)
		expect(Array.from(set.i)).toEqual([3, 1])
		expect(Array.from(set.j)).toEqual([7, 2])
		expect(set.restLength[0]).toBeCloseTo(0.25, 12)
		expect(set.restLength[1]).toBe(4)
		expect(set.i).toBeInstanceOf(Int32Array)
		expect(set.restLength).toBeInstanceOf(Float32Array)
	})

	it('handles an empty list', () => {
		const set = buildConstraintSet([])
		expect(set.count).toBe(0)
		expect(set.i).toHaveLength(0)
	})
})

describe('runSubstep — integration', () => {
	it('applies gravity only to vertices with a non-zero inverse mass', () => {
		const { velocities } = twoVertexSolve(
			{ gravity: 10, gravityEnabled: true, damping: 1 },
			{ invMass: [1, 0], distance: [] },
		)
		// v += -g * dt once, and only for vertex 0
		expect(velocities[1]).toBeCloseTo(-10 / 60, 5)
		expect(velocities[4]).toBe(0)
	})

	it('keeps gravity out entirely when it is disabled, ignoring the gravity value', () => {
		const { velocities } = twoVertexSolve({ gravity: 10, gravityEnabled: false }, {})
		expect(Array.from(velocities)).toEqual([0, 0, 0, 0, 0, 0])
	})

	it('damps only the dynamic vertices and predicts with the damped velocity', () => {
		const { positions, velocities } = twoVertexSolve(
			{ damping: 0.5 },
			// No constraint: the constraint solve would overwrite the velocity it pins
			{ firstVel: [6, 0, 0], secondVel: [6, 0, 0], invMass: [1, 0], distance: [] },
		)
		// v *= 0.5 then p += v * dt: the damping is applied before the predictor
		expect(velocities[0]).toBeCloseTo(3, 5)
		expect(positions[0]).toBeCloseTo(-0.5 + 3 / 60, 5)
		expect(positions[3]).toBeCloseTo(0.5, 6)
	})

	it('backs up the start-of-step positions before touching anything', () => {
		const { prev } = twoVertexSolve({ gravity: 10, gravityEnabled: true }, { firstVel: [1, 0, 0] })
		expect(Array.from(prev)).toEqual([-0.5, 0, 0, 0.5, 0, 0])
	})

	it('solves a violated constraint back to its rest length', () => {
		// 3 apart with a rest length of 1: both vertices move toward each other
		const { positions } = twoVertexSolve({}, { firstPos: [-1.5, 0, 0], secondPos: [1.5, 0, 0] })
		const dx = positions[0] - positions[3]
		expect(Math.abs(dx)).toBeCloseTo(1, 6)
		// Symmetric masses: the correction is split evenly
		expect(positions[0]).toBeCloseTo(-0.5, 6)
		expect(positions[3]).toBeCloseTo(0.5, 6)
	})

	it('moves only the dynamic end of a constraint against a pinned vertex', () => {
		const { positions } = twoVertexSolve(
			{},
			{ firstPos: [0, 0, 0], secondPos: [3, 0, 0], invMass: [0, 1], distance: [{ _i: 0, _j: 1, _restLength: 1 }] },
		)
		expect(positions[0]).toBeCloseTo(0, 6)
		expect(positions[3]).toBeCloseTo(1, 6)
	})

	it('skips a coincident vertex pair instead of dividing by a zero distance', () => {
		const { positions } = twoVertexSolve({}, { firstPos: [0, 0, 0], secondPos: [0, 0, 0] })
		expect(Array.from(positions)).toEqual([0, 0, 0, 0, 0, 0])
	})

	it('accumulates the Lagrange multiplier over the iterations', () => {
		const { distanceLambda } = twoVertexSolve({}, { firstPos: [-1.5, 0, 0], secondPos: [1.5, 0, 0] })
		// A violated stiff constraint reports a non-zero multiplier
		expect(distanceLambda[0]).not.toBe(0)
		expect(Number.isFinite(distanceLambda[0])).toBe(true)
	})

	it('clamps a vertex that falls below the page floor and bounces a downward velocity', () => {
		// The vertex starts below the floor moving down; after the floor pass it
		// sits exactly on the floor and its velocity is reversed (× 0.1).
		const dt = 1 / 60
		const { positions, velocities, prev } = twoVertexSolve(
			{},
			{
				firstPos: [-0.5, -0.05, 0],
				firstVel: [0, -3, 0],
				secondPos: [0.5, 5, 0],
				invMass: [1, 1],
				floor: 0,
				// A single iteration keeps the pair from pulling vertex 0 back up
				distance: [],
			},
		)
		expect(positions[1]).toBe(0)
		expect(prev[1]).toBeCloseTo(0 + -3 * 0.1 * dt, 6)
		expect(velocities[1]).toBeCloseTo((0 - (0 - 0.3 * dt)) / dt, 4)
	})

	it('leaves a vertex on or above the floor untouched', () => {
		const { positions } = twoVertexSolve({}, { firstPos: [0, 0, 0], distance: [], floor: 0 })
		expect(positions[1]).toBe(0)
	})

	it('recomputes velocity from the position delta, not the predictor', () => {
		const { positions, velocities } = twoVertexSolve(
			{},
			{ firstPos: [-1, 0, 0], secondPos: [1, 0, 0], invMass: [1, 1], floor: -10 },
		)
		// Pinned by the solver: velocity follows the corrected position
		const expected = (positions[0] - -1) * 60
		expect(velocities[0]).toBeCloseTo(expected, 4)
	})
})
