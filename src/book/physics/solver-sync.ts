// XPBD solver host.
// Dispatches directly to the native TypeScript solver (native-solver.ts).
// The exported API is unchanged to keep callers (main.ts) untouched.

import { PaperMesh } from '../geometry/paper-mesh';
import { CoverMesh } from '../geometry/cover-mesh';
import { computeWeightFactor, computeAllPageFloors } from '../animation/spine-sync';
import { runSubstep, buildConstraintSet, type ConstraintSet } from './native-solver';
import { VERTEX_COUNT } from '../core/settings';

export interface SolverSettings {
	_solverIterations: number;
	_substeps: number;
	_distanceCompliance: number;
	_bendingCompliance: number;
	_damping: number;
	_gravity: number;
	_gravityEnabled: boolean;
}

let ready = false;

// Constraint layout is identical for every page; build once at init.
let distanceConstraints: ConstraintSet;
let bendingConstraints: ConstraintSet;

// Per-page XPBD scratch, reused across solves.
// Lambdas are reset at the start of every solve; prevPositions is overwritten
// by the solver itself on each substep.
let pageLambdas: { dl: Float64Array; bl: Float64Array }[] = [];
let pagePrevPos: Float32Array[] = [];

function isCover(mesh: PaperMesh): mesh is CoverMesh {
	return mesh instanceof CoverMesh;
}

function findPaperMesh(meshes: PaperMesh[]): PaperMesh | null {
	for (const m of meshes) {
		if (!isCover(m)) return m;
	}
	return null;
}

export function isSolverReady(): boolean {
	return ready;
}

export async function initSolver(meshes: PaperMesh[], pageCount: number): Promise<void> {
	ready = false;

	const paperMesh = findPaperMesh(meshes);
	if (!paperMesh) {
		console.warn('[Solver] No paper meshes found — solver will be idle.');
		return;
	}

	distanceConstraints = buildConstraintSet(paperMesh._distanceConstraints);
	bendingConstraints = buildConstraintSet(paperMesh._bendingConstraints);

	const N3 = VERTEX_COUNT * 3;

	pageLambdas.length = 0;
	pagePrevPos.length = 0;
	for (let pi = 0; pi < pageCount; pi++) {
		pageLambdas.push({
			dl: new Float64Array(distanceConstraints.count),
			bl: new Float64Array(bendingConstraints.count),
		});
		pagePrevPos.push(new Float32Array(N3));
	}

	ready = true;
}

export function dispatchSolve(
	subDt: number,
	activeIndices: number[],
	substeps: number,
	solverSettings: SolverSettings,
	meshes: PaperMesh[],
	progress: Float32Array,
	totalStackHeight: number,
	pageCount: number,
	pageThickness: number,
): void {
	if (!ready) return;

	activeIndices.sort((a, b) => a - b);

	const weightFactor = computeWeightFactor(progress, pageCount);
	const pageFloors = computeAllPageFloors(progress, weightFactor, totalStackHeight, pageCount, pageThickness);

	const animCount = activeIndices.length;
	const dynIters = animCount <= 5
		? solverSettings._solverIterations
		: Math.max(2, Math.round(solverSettings._solverIterations + Math.min(1, (animCount - 5) / 5) * (2 - solverSettings._solverIterations)));

	const dt = subDt;
	const params = {
		dt,
		solverIterations: dynIters,
		distanceCompliance: solverSettings._distanceCompliance / (dt * dt),
		bendingCompliance: solverSettings._bendingCompliance / (dt * dt),
		damping: solverSettings._damping,
		gravity: solverSettings._gravityEnabled ? solverSettings._gravity : 0,
		gravityEnabled: solverSettings._gravityEnabled,
	};

	// XPBD lambdas must start zeroed each solve (they only carry state
	// between iterations *within* a solve).
	for (const pi of activeIndices) {
		const lam = pageLambdas[pi];
		lam.dl.fill(0);
		lam.bl.fill(0);
	}

	for (let s = 0; s < substeps; s++) {
		for (const pi of activeIndices) {
			const m = meshes[pi];
			if (isCover(m)) continue;

			const lam = pageLambdas[pi];
			const pf = pi < pageFloors.length ? pageFloors[pi] : 0;

			runSubstep(
				m._positions,
				m._velocities,
				pagePrevPos[pi],
				m._invMasses,
				VERTEX_COUNT,
				distanceConstraints,
				bendingConstraints,
				lam.dl,
				lam.bl,
				params,
				pf,
			);
		}
	}
}
