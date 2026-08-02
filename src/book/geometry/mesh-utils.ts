import { Vec3 } from '../core/vec3';
import { GRID_COLS, GRID_ROWS } from '../core/settings';
export { GRID_COLS, GRID_ROWS, VERTEX_COUNT } from '../core/settings';

export interface EdgeConstraint {
	_i: number;
	_j: number;
	_restLength: number;
}

export interface BendingConstraint {
	_i: number;
	_j: number;
	_restLength: number;
}

export interface TriangleData {
	_indices: [number, number, number];
}

export function buildIndexBuffer(triangles: TriangleData[]): Uint32Array {
	const buf = new Uint32Array(triangles.length * 3);
	for (let i = 0; i < triangles.length; i++) {
		const t = triangles[i];
		buf[i * 3] = t._indices[0];
		buf[i * 3 + 1] = t._indices[1];
		buf[i * 3 + 2] = t._indices[2];
	}
	return buf;
}

export function computeVertexNormals(
	positions: Float32Array,
	triangles: TriangleData[],
	vertexCount: number,
): Float32Array {
	const normals = new Float32Array(vertexCount * 3);
	const counts = new Float32Array(vertexCount);
	for (const tri of triangles) {
		const [i0, i1, i2] = tri._indices;
		const p0 = new Vec3(positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]);
		const p1 = new Vec3(positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]);
		const p2 = new Vec3(positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]);
		const e1 = new Vec3()._copy(p1)._sub(p0);
		const e2 = new Vec3()._copy(p2)._sub(p0);
		const n = new Vec3()._copy(e1)._cross(e2);
		for (const idx of [i0, i1, i2]) {
			normals[idx * 3] += n._x;
			normals[idx * 3 + 1] += n._y;
			normals[idx * 3 + 2] += n._z;
			counts[idx]++;
		}
	}
	for (let i = 0; i < vertexCount; i++) {
		const cnt = counts[i];
		if (cnt > 0) {
			const inv = 1.0 / cnt;
			let nx = normals[i * 3] * inv;
			let ny = normals[i * 3 + 1] * inv;
			let nz = normals[i * 3 + 2] * inv;
			const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
			if (len > 1e-9) {
				normals[i * 3] = nx / len;
				normals[i * 3 + 1] = ny / len;
				normals[i * 3 + 2] = nz / len;
			}
		}
	}
	return normals;
}

export function addEdgeConstraint(
	i: number,
	j: number,
	restPositions: Float32Array,
	added: Set<string>,
	constrs: EdgeConstraint[],
): void {
	const key = i < j ? `${i}-${j}` : `${j}-${i}`;
	if (added.has(key)) return;
	added.add(key);
	const i3 = i * 3, j3 = j * 3;
	const dx = restPositions[i3] - restPositions[j3];
	const dy = restPositions[i3 + 1] - restPositions[j3 + 1];
	const dz = restPositions[i3 + 2] - restPositions[j3 + 2];
	const restLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
	constrs.push({ _i: i, _j: j, _restLength: restLen });
}

export function addGridConstraints(
	baseIdx: number,
	add: (i: number, j: number) => void,
): void {
	const idx = (c: number, r: number): number => baseIdx + r * GRID_COLS + c;
	for (let r = 0; r < GRID_ROWS; r++) {
		for (let c = 0; c < GRID_COLS; c++) {
			const i = idx(c, r);
			if (c + 1 < GRID_COLS) add(i, idx(c + 1, r));
			if (r + 1 < GRID_ROWS) add(i, idx(c, r + 1));
			if (c + 1 < GRID_COLS && r + 1 < GRID_ROWS) add(i, idx(c + 1, r + 1));
			if (c - 1 >= 0 && r + 1 < GRID_ROWS) add(i, idx(c - 1, r + 1));
		}
	}
}
