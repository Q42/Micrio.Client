import { PaperMesh, GRID_COLS, GRID_ROWS, VERTEX_COUNT } from './paper-mesh';
import type { EdgeConstraint, TriangleData } from './paper-mesh';
import { buildIndexBuffer, computeVertexNormals, addEdgeConstraint, addGridConstraints } from './mesh-utils';
import { DEFAULT_ASPECT, COVER_SCALE_X, COVER_SCALE_Y } from '../core/settings';

const FACE_VERTEX_COUNT = VERTEX_COUNT;

const TOP_BOTTOM_SIDE_VERTICES = GRID_COLS * 2;
const LEFT_RIGHT_SIDE_VERTICES = GRID_ROWS * 2;

const SIDE_VERTEX_COUNT = TOP_BOTTOM_SIDE_VERTICES * 2 + LEFT_RIGHT_SIDE_VERTICES * 2;
const TOTAL_VERTEX_COUNT = FACE_VERTEX_COUNT * 2 + SIDE_VERTEX_COUNT;

export class CoverMesh extends PaperMesh {
	readonly _coverThickness: number;
	readonly _coverScale: number;
	readonly _coverScaleY: number;

	constructor(yOffset: number = 0, paperWidth: number = 1.0, aspectRatio: number = DEFAULT_ASPECT, coverThickness: number = 0.01, coverScale: number = COVER_SCALE_X, coverScaleY: number = COVER_SCALE_Y) {
		super(yOffset, paperWidth, aspectRatio);
		this._coverThickness = coverThickness;
		this._coverScale = coverScale;
		this._coverScaleY = coverScaleY;

		this._restPositions = new Float32Array(TOTAL_VERTEX_COUNT * 3);
		this._positions = new Float32Array(TOTAL_VERTEX_COUNT * 3);
		this._velocities = new Float32Array(TOTAL_VERTEX_COUNT * 3);
		this._invMasses = new Float32Array(TOTAL_VERTEX_COUNT);
		this._texCoords = new Float32Array(TOTAL_VERTEX_COUNT * 2);
		this._triangles = [];
		this._distanceConstraints = [];
		this._bendingConstraints = [];
		this._boundLeft = [];

		this._generateGrid();
		this._generateTexCoords();
		this._generateTriangles();
		this._generateDistanceConstraints();
		this._identifyBoundEdges();
	}

	protected _generateGrid(): void {
		const hh = this._paperHeight / 2;
		const halfT = this._coverThickness / 2;

		this.#fillFaceGrid(0, halfT, hh);
		this.#fillFaceGrid(FACE_VERTEX_COUNT, -halfT, hh);

		let vi = FACE_VERTEX_COUNT * 2;

		vi = this.#addSideStrip(vi, this.#getEdgeVertices('bottom'), -hh);
		vi = this.#addSideStrip(vi, this.#getEdgeVertices('top'), hh);
		vi = this.#addSideStrip(vi, this.#getEdgeVertices('freeEdge'), this._paperWidth);
		this.#addSideStrip(vi, this.#getEdgeVertices('boundEdge'), 0);

		this._positions.set(this._restPositions);
		this._invMasses.fill(1.0);
	}

	#fillFaceGrid(baseIdx: number, y: number, halfHeight: number): void {
		const cx = this._paperWidth / 2;
		for (let row = 0; row < GRID_ROWS; row++) {
			const t = row / (GRID_ROWS - 1);
			const z = -halfHeight + t * this._paperHeight;
			const sz = z * this._coverScaleY;
			for (let col = 0; col < GRID_COLS; col++) {
				const s = col / (GRID_COLS - 1);
				const x = s * this._paperWidth;
				const sx = cx + (x - cx) * this._coverScale;
				const idx = baseIdx + row * GRID_COLS + col;
				const i3 = idx * 3;
				this._restPositions[i3] = sx;
				this._restPositions[i3 + 1] = this._yOffset + y;
				this._restPositions[i3 + 2] = sz;
			}
		}
	}

	#getEdgeVertices(edge: 'bottom' | 'top' | 'freeEdge' | 'boundEdge'): number[] {
		const result: number[] = [];
		switch (edge) {
			case 'bottom':
				for (let c = 0; c < GRID_COLS; c++) result.push(c);
				break;
			case 'top':
				for (let c = 0; c < GRID_COLS; c++) result.push((GRID_ROWS - 1) * GRID_COLS + c);
				break;
			case 'freeEdge':
				for (let r = 0; r < GRID_ROWS; r++) result.push(r * GRID_COLS + (GRID_COLS - 1));
				break;
			case 'boundEdge':
				for (let r = 0; r < GRID_ROWS; r++) result.push(r * GRID_COLS);
				break;
		}
		return result;
	}

	#addSideStrip(
		vi: number,
		frontIndices: number[],
		_fixedCoord: number,
	): number {
		const n = frontIndices.length;

		for (let i = 0; i < n; i++) {
			const frontVi = frontIndices[i];
			const fi3 = frontVi * 3;
			const fx = this._restPositions[fi3];
			const fy = this._restPositions[fi3 + 1];
			const fz = this._restPositions[fi3 + 2];

			const vFront = vi + i * 2;
			const vf3 = vFront * 3;
			this._restPositions[vf3] = fx;
			this._restPositions[vf3 + 1] = fy;
			this._restPositions[vf3 + 2] = fz;

			const vBack = vi + i * 2 + 1;
			const vb3 = vBack * 3;
			this._restPositions[vb3] = fx;
			this._restPositions[vb3 + 1] = fy - this._coverThickness;
			this._restPositions[vb3 + 2] = fz;
		}

		return vi + n * 2;
	}

	protected _generateTexCoords(): void {
		for (let row = 0; row < GRID_ROWS; row++) {
			const v = row / (GRID_ROWS - 1);
			for (let col = 0; col < GRID_COLS; col++) {
				const u = col / (GRID_COLS - 1);
				const idx = row * GRID_COLS + col;
				const uvIdx = idx * 2;
				this._texCoords[uvIdx] = u;
				this._texCoords[uvIdx + 1] = v;
			}
		}

		for (let row = 0; row < GRID_ROWS; row++) {
			const v = row / (GRID_ROWS - 1);
			for (let col = 0; col < GRID_COLS; col++) {
				const u = 1.0 - col / (GRID_COLS - 1);
				const idx = FACE_VERTEX_COUNT + row * GRID_COLS + col;
				const uvIdx = idx * 2;
				this._texCoords[uvIdx] = u;
				this._texCoords[uvIdx + 1] = v;
			}
		}

		let vi = FACE_VERTEX_COUNT * 2;
		vi = this.#addSideTexCoords(vi, 'bottom');
		vi = this.#addSideTexCoords(vi, 'top');
		vi = this.#addSideTexCoords(vi, 'freeEdge');
		this.#addSideTexCoords(vi, 'boundEdge');
	}

	#addSideTexCoords(vi: number, edge: 'bottom' | 'top' | 'freeEdge' | 'boundEdge'): number {
		const indices = this.#getEdgeVertices(edge);
		const n = indices.length;

		for (let i = 0; i < n; i++) {
			const frontFaceIdx = indices[i];
			const col = frontFaceIdx % GRID_COLS;
			const row = Math.floor(frontFaceIdx / GRID_COLS);

			let u: number, v: number;
			switch (edge) {
				case 'bottom': u = col / (GRID_COLS - 1); v = 0.0; break;
				case 'top': u = col / (GRID_COLS - 1); v = 1.0; break;
				case 'freeEdge': u = 1.0; v = row / (GRID_ROWS - 1); break;
				case 'boundEdge': default: u = 0.0; v = row / (GRID_ROWS - 1); break;
			}

			const vFront = vi + i * 2;
			this._texCoords[vFront * 2] = u;
			this._texCoords[vFront * 2 + 1] = v;

			const vBack = vi + i * 2 + 1;
			this._texCoords[vBack * 2] = u;
			this._texCoords[vBack * 2 + 1] = v;
		}

		return vi + n * 2;
	}

	protected _generateTriangles(): void {
		const tris: TriangleData[] = [];

		this.#addFaceTriangles(tris, 0, false);
		this.#addFaceTriangles(tris, FACE_VERTEX_COUNT, true);

		let vi = FACE_VERTEX_COUNT * 2;
		const edges: Array<'bottom' | 'top' | 'freeEdge' | 'boundEdge'> =
			['bottom', 'top', 'freeEdge', 'boundEdge'];

		for (const edge of edges) {
			const indices = this.#getEdgeVertices(edge);
			const n = indices.length;

			for (let i = 0; i < n - 1; i++) {
				const vf0 = vi + i * 2;
				const vb0 = vi + i * 2 + 1;
				const vf1 = vi + (i + 1) * 2;
				const vb1 = vi + (i + 1) * 2 + 1;

				if (edge === 'bottom' || edge === 'freeEdge') {
					tris.push({ _indices: [vf0, vb0, vf1] });
					tris.push({ _indices: [vf1, vb0, vb1] });
				} else {
					tris.push({ _indices: [vf0, vf1, vb0] });
					tris.push({ _indices: [vf1, vb1, vb0] });
				}
			}

			vi += n * 2;
		}

		this._triangles = tris;
		this._indexBuffer = buildIndexBuffer(tris);
	}

	#addFaceTriangles(tris: TriangleData[], baseIdx: number, reverse: boolean): void {
		for (let row = 0; row < GRID_ROWS - 1; row++) {
			for (let col = 0; col < GRID_COLS - 1; col++) {
				const tl = baseIdx + row * GRID_COLS + col;
				const tr = tl + 1;
				const bl = baseIdx + (row + 1) * GRID_COLS + col;
				const br = bl + 1;
				if (reverse) {
					tris.push({ _indices: [tl, tr, bl] });
					tris.push({ _indices: [tr, br, bl] });
				} else {
					tris.push({ _indices: [tl, bl, tr] });
					tris.push({ _indices: [tr, bl, br] });
				}
			}
		}
	}

	protected _generateDistanceConstraints(): void {
		const added = new Set<string>();
		const constrs: EdgeConstraint[] = [];
		const add = (i: number, j: number) => addEdgeConstraint(i, j, this._restPositions, added, constrs);

		addGridConstraints(0, add);
		addGridConstraints(FACE_VERTEX_COUNT, add);

		for (let row = 0; row < GRID_ROWS; row++) {
			for (let col = 0; col < GRID_COLS; col++) {
				const frontIdx = row * GRID_COLS + col;
				const backIdx = FACE_VERTEX_COUNT + row * GRID_COLS + col;
				add(frontIdx, backIdx);
			}
		}

		this._distanceConstraints = constrs;
	}

	protected _generateBendingConstraints(): void {
		this._bendingConstraints = [];
	}

	protected _identifyBoundEdges(): void {
		this._boundLeft = [];
		for (let r = 0; r < GRID_ROWS; r++) this._boundLeft.push(r * GRID_COLS);
		for (let r = 0; r < GRID_ROWS; r++) this._boundLeft.push(FACE_VERTEX_COUNT + r * GRID_COLS);
	}

	_computeNormals(): Float32Array {
		return computeVertexNormals(this._positions, this._triangles, TOTAL_VERTEX_COUNT);
	}
}
