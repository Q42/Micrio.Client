import type { EdgeConstraint, BendingConstraint, TriangleData } from './mesh-utils';
import {
	GRID_COLS, GRID_ROWS, VERTEX_COUNT,
	buildIndexBuffer, computeVertexNormals,
	addEdgeConstraint, addGridConstraints,
} from './mesh-utils';

import { DEFAULT_ASPECT } from '../core/settings';
export { GRID_COLS, GRID_ROWS, VERTEX_COUNT } from '../core/settings';
export type { EdgeConstraint, BendingConstraint, TriangleData };

export class PaperMesh {
	_restPositions: Float32Array;
	_positions: Float32Array;
	_velocities: Float32Array;
	_invMasses: Float32Array;

	_texCoords: Float32Array;

	_triangles: TriangleData[];
	_indexBuffer!: Uint32Array;

	_distanceConstraints: EdgeConstraint[];
	_bendingConstraints: BendingConstraint[];

	_boundLeft: number[];

	readonly _yOffset: number;
	readonly _paperWidth: number;
	readonly _paperHeight: number;

	constructor(yOffset: number = 0, paperWidth: number = 1.0, aspectRatio: number = DEFAULT_ASPECT) {
		this._yOffset = yOffset;
		this._paperWidth = paperWidth;
		this._paperHeight = paperWidth * aspectRatio;

		this._restPositions = new Float32Array(VERTEX_COUNT * 3);
		this._positions = new Float32Array(VERTEX_COUNT * 3);
		this._velocities = new Float32Array(VERTEX_COUNT * 3);
		this._invMasses = new Float32Array(VERTEX_COUNT);
		this._texCoords = new Float32Array(VERTEX_COUNT * 2);
		this._triangles = [];
		this._distanceConstraints = [];
		this._bendingConstraints = [];
		this._boundLeft = [];

		this._generateGrid(this._paperHeight);
		this._generateTexCoords();
		this._generateTriangles();
		this._generateDistanceConstraints();
		this._generateBendingConstraints();
		this._identifyBoundEdges();
	}

	protected _generateGrid(paperHeight: number): void {
		const hh = paperHeight / 2;
		for (let row = 0; row < GRID_ROWS; row++) {
			const t = row / (GRID_ROWS - 1);
			const z = -hh + t * paperHeight;
			for (let col = 0; col < GRID_COLS; col++) {
				const s = col / (GRID_COLS - 1);
				const x = s * this._paperWidth;
				const idx = row * GRID_COLS + col;
				const i3 = idx * 3;
				this._restPositions[i3] = x;
				this._restPositions[i3 + 1] = this._yOffset;
				this._restPositions[i3 + 2] = z;
			}
		}
		this._positions.set(this._restPositions);
		this._invMasses.fill(1.0);
	}

	protected _generateTexCoords(): void {
		for (let row = 0; row < GRID_ROWS; row++) {
			const v = row / (GRID_ROWS - 1);
			for (let col = 0; col < GRID_COLS; col++) {
				const u = col / (GRID_COLS - 1);
				const idx = row * GRID_COLS + col;
				this._texCoords[idx * 2] = u;
				this._texCoords[idx * 2 + 1] = v;
			}
		}
	}

	protected _generateTriangles(): void {
		const tris: TriangleData[] = [];
		for (let row = 0; row < GRID_ROWS - 1; row++) {
			for (let col = 0; col < GRID_COLS - 1; col++) {
				const tl = row * GRID_COLS + col;
				const tr = tl + 1;
				const bl = (row + 1) * GRID_COLS + col;
				const br = bl + 1;
				tris.push({ _indices: [tl, bl, tr] });
				tris.push({ _indices: [tr, bl, br] });
			}
		}
		this._triangles = tris;
		this._indexBuffer = buildIndexBuffer(tris);
	}

	protected _generateDistanceConstraints(): void {
		const added = new Set<string>();
		const constrs: EdgeConstraint[] = [];
		const add = (i: number, j: number) => addEdgeConstraint(i, j, this._restPositions, added, constrs);
		addGridConstraints(0, add);
		this._distanceConstraints = constrs;
	}

	protected _generateBendingConstraints(): void {
		const edgeToTri = new Map<string, number[]>();
		const key = (a: number, b: number): string => (a < b ? `${a}-${b}` : `${b}-${a}`);
		for (let ti = 0; ti < this._triangles.length; ti++) {
			const [v0, v1, v2] = this._triangles[ti]._indices;
			for (const e of [key(v0, v1), key(v1, v2), key(v2, v0)]) {
				const list = edgeToTri.get(e);
				if (list) list.push(ti); else edgeToTri.set(e, [ti]);
			}
		}
		const constrs: BendingConstraint[] = [];
		for (const [, triList] of edgeToTri) {
			if (triList.length !== 2) continue;
			const tA = this._triangles[triList[0]];
			const tB = this._triangles[triList[1]];
			const setA = new Set(tA._indices);
			const shared: number[] = [];
			for (const v of tB._indices) if (setA.has(v)) shared.push(v);
			if (shared.length !== 2) continue;
			const [s0, s1] = shared;
			const tipA = tA._indices.find(v => v !== s0 && v !== s1)!;
			const tipB = tB._indices.find(v => v !== s0 && v !== s1)!;
			const i3a = tipA * 3, i3b = tipB * 3;
			const dx = this._restPositions[i3a] - this._restPositions[i3b];
			const dy = this._restPositions[i3a + 1] - this._restPositions[i3b + 1];
			const dz = this._restPositions[i3a + 2] - this._restPositions[i3b + 2];
			const restLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
			constrs.push({ _i: tipA, _j: tipB, _restLength: restLen });
		}
		this._bendingConstraints = constrs;
	}

	protected _identifyBoundEdges(): void {
		this._boundLeft = [];
		for (let r = 0; r < GRID_ROWS; r++) {
			this._boundLeft.push(r * GRID_COLS);
		}
	}

	_reset(): void {
		this._positions.set(this._restPositions);
		this._velocities.fill(0);
	}

	_setBinding(): void {
		for (const idx of this._boundLeft) this._invMasses[idx] = 0.0;
	}

	_computeNormals(): Float32Array {
		return computeVertexNormals(this._positions, this._triangles, VERTEX_COUNT);
	}
}
