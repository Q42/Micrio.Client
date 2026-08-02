import type { EdgeConstraint, BendingConstraint } from '../geometry/mesh-utils';

// ── Native TypeScript XPBD solver ──
// Ported from assembly/solver.ts (AssemblyScript/WASM). Operates directly on
// the mesh Float32Arrays, so no buffer copies or memory pointer juggling.

const EPS = 1e-12;

/** Structure-of-arrays constraint layout for cache-friendly iteration. */
export interface ConstraintSet {
	count: number;
	i: Int32Array;
	j: Int32Array;
	restLength: Float32Array;
}

export interface SubstepParams {
	dt: number;
	solverIterations: number;
	distanceCompliance: number;
	bendingCompliance: number;
	damping: number;
	gravity: number;
	gravityEnabled: boolean;
}

/** Flatten a mesh's {_i, _j, _restLength} constraint list into SoA buffers. */
export function buildConstraintSet(constraints: EdgeConstraint[] | BendingConstraint[]): ConstraintSet {
	const count = constraints.length;
	const i = new Int32Array(count);
	const j = new Int32Array(count);
	const restLength = new Float32Array(count);
	for (let c = 0; c < count; c++) {
		const con = constraints[c];
		i[c] = con._i;
		j[c] = con._j;
		restLength[c] = con._restLength;
	}
	return { count, i, j, restLength };
}

/**
 * Run one XPBD substep over all vertices and constraints.
 * Mutates `positions` / `velocities` in place and writes the start-of-step
 * position backup into `prevPositions`.
 */
export function runSubstep(
	positions: Float32Array,
	velocities: Float32Array,
	prevPositions: Float32Array,
	invMasses: Float32Array,
	N: number,
	distanceConstraints: ConstraintSet,
	bendingConstraints: ConstraintSet,
	distanceLambda: Float64Array,
	bendingLambda: Float64Array,
	params: SubstepParams,
	pageFloor: number,
): void {
	const { dt, solverIterations, damping, gravity, gravityEnabled } = params;

	// ── 0. Backup positions ──
	prevPositions.set(positions);

	// ── 1. Gravity ──
	if (gravityEnabled) {
		const gy = -gravity;
		for (let i = 0; i < N; i++) {
			if (invMasses[i] > 0) {
				velocities[i * 3 + 1] += gy * dt;
			}
		}
	}

	// ── 2. Damping ──
	for (let i = 0; i < N; i++) {
		if (invMasses[i] > 0) {
			const vBase = i * 3;
			velocities[vBase] *= damping;
			velocities[vBase + 1] *= damping;
			velocities[vBase + 2] *= damping;
		}
	}

	// ── 3. Predict positions ──
	for (let i = 0; i < N; i++) {
		if (invMasses[i] > 0) {
			const pBase = i * 3;
			const vBase = pBase;
			positions[pBase] += velocities[vBase] * dt;
			positions[pBase + 1] += velocities[vBase + 1] * dt;
			positions[pBase + 2] += velocities[vBase + 2] * dt;
		}
	}

	// ── 4. Compute compliance alpha values ──
	const alphaD = params.distanceCompliance / (dt * dt);
	const alphaB = params.bendingCompliance / (dt * dt);

	// ── 5. XPBD constraint iterations ──
	for (let it = 0; it < solverIterations; it++) {
		solveDistanceSet(positions, invMasses, distanceConstraints, alphaD, distanceLambda);
		solveDistanceSet(positions, invMasses, bendingConstraints, alphaB, bendingLambda);
	}

	// ── 6. Floor collision ──
	const invDt = 1 / dt;
	const floorBounce = 0.1;
	for (let i = 0; i < N; i++) {
		if (invMasses[i] > 0) {
			const pyPtr = i * 3 + 1;
			const py = positions[pyPtr];
			if (py < pageFloor) {
				const prevPy = prevPositions[pyPtr];
				const vy = (py - prevPy) * invDt;
				positions[pyPtr] = pageFloor;
				if (vy < 0) {
					prevPositions[pyPtr] = pageFloor + vy * floorBounce * dt;
				}
			}
		}
	}

	// ── 7. Update velocities ──
	for (let i = 0; i < N; i++) {
		if (invMasses[i] > 0) {
			const b = i * 3;
			velocities[b] = (positions[b] - prevPositions[b]) * invDt;
			velocities[b + 1] = (positions[b + 1] - prevPositions[b + 1]) * invDt;
			velocities[b + 2] = (positions[b + 2] - prevPositions[b + 2]) * invDt;
		}
	}
}

/** Solve every constraint in a set using XPBD. */
function solveDistanceSet(
	positions: Float32Array,
	invMasses: Float32Array,
	cset: ConstraintSet,
	alpha: number,
	lambda: Float64Array,
): void {
	const ci = cset.i;
	const cj = cset.j;
	const crl = cset.restLength;
	for (let c = 0; c < cset.count; c++) {
		const vi = ci[c];
		const vj = cj[c];
		const i3 = vi * 3;
		const j3 = vj * 3;

		let ix = positions[i3];
		let iy = positions[i3 + 1];
		let iz = positions[i3 + 2];
		let jx = positions[j3];
		let jy = positions[j3 + 1];
		let jz = positions[j3 + 2];

		let dx = ix - jx;
		let dy = iy - jy;
		let dz = iz - jz;
		const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
		if (dist < EPS) continue;

		const invDist = 1 / dist;
		const C = dist - crl[c];

		const w = invMasses[vi] + invMasses[vj];
		if (w < EPS) continue;

		// XPBD: dLambda = -(C + alpha_tilde * lambda) / (w + alpha_tilde)
		const oldLambda = lambda[c];
		const dLambda = -(C + alpha * oldLambda) / (w + alpha);

		const imI = invMasses[vi];
		const imJ = invMasses[vj];

		const scaleI = imI * dLambda * invDist;
		const scaleJ = imJ * dLambda * invDist;

		ix += scaleI * dx;
		iy += scaleI * dy;
		iz += scaleI * dz;
		jx -= scaleJ * dx;
		jy -= scaleJ * dy;
		jz -= scaleJ * dz;

		positions[i3] = ix;
		positions[i3 + 1] = iy;
		positions[i3 + 2] = iz;
		positions[j3] = jx;
		positions[j3 + 1] = jy;
		positions[j3 + 2] = jz;

		lambda[c] = oldLambda + dLambda;
	}
}
