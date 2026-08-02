import { Vec3 } from '../core/vec3';
import type { PaperMesh } from './paper-mesh';

export interface RayHit {
	_t: number;
	_point: Vec3;
	_meshIndex: number;
}

export function rayIntersectMeshes(
	meshes: readonly PaperMesh[],
	origin: Vec3,
	direction: Vec3,
): RayHit | null {
	let closestT = Infinity;
	let bestPoint = new Vec3();
	let bestMeshIndex = -1;

	for (let pi = 0; pi < meshes.length; pi++) {
		const mesh = meshes[pi];
		if (!mesh) continue;
		const pos = mesh._positions;
		const tris = mesh._triangles;

		for (const tri of tris) {
			const [i0, i1, i2] = tri._indices;
			const v0x = pos[i0 * 3], v0y = pos[i0 * 3 + 1], v0z = pos[i0 * 3 + 2];
			const v1x = pos[i1 * 3], v1y = pos[i1 * 3 + 1], v1z = pos[i1 * 3 + 2];
			const v2x = pos[i2 * 3], v2y = pos[i2 * 3 + 1], v2z = pos[i2 * 3 + 2];

			const e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
			const e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;

			const px = direction._y * e2z - direction._z * e2y;
			const py = direction._z * e2x - direction._x * e2z;
			const pz = direction._x * e2y - direction._y * e2x;

			const det = e1x * px + e1y * py + e1z * pz;
			if (Math.abs(det) < 1e-8) continue;

			const invDet = 1 / det;
			const tx = origin._x - v0x;
			const ty = origin._y - v0y;
			const tz = origin._z - v0z;

			const u = (tx * px + ty * py + tz * pz) * invDet;
			if (u < 0 || u > 1) continue;

			const qx = ty * e1z - tz * e1y;
			const qy = tz * e1x - tx * e1z;
			const qz = tx * e1y - ty * e1x;

			const v = (direction._x * qx + direction._y * qy + direction._z * qz) * invDet;
			if (v < 0 || u + v > 1) continue;

			const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
			if (t <= 0 || t >= closestT) continue;

			closestT = t;
			bestPoint = new Vec3(
				origin._x + direction._x * t,
				origin._y + direction._y * t,
				origin._z + direction._z * t,
			);
			bestMeshIndex = pi;
		}
	}

	if (closestT === Infinity || bestMeshIndex < 0) return null;
	return { _t: closestT, _point: bestPoint, _meshIndex: bestMeshIndex };
}
