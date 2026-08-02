import { Vec3 } from '../core/vec3';
import { Mat4 } from '$render/mat';
import type { PaperMesh } from './paper-mesh';
import { CoverMesh } from './cover-mesh';
import { GRID_COLS, GRID_ROWS, VERTEX_COUNT } from './paper-mesh';

export interface UvWorldResult {
	/** Interpolated world-space position on the deformed mesh. */
	_point: Vec3;
	/** Interpolated (normalized) world-space surface normal at that point. */
	_normal: Vec3;
	/** World-space direction of increasing image u (not normalized). */
	_tangentU: Vec3;
	/** World-space direction of increasing image v (not normalized). */
	_tangentV: Vec3;
}

/**
 * The sub-rectangle of a page's UV space in which a texture is displayed with
 * its native aspect ratio. `uMin`/`vMin` are the lower-left corner and
 * `fU`/`fV` the fraction of the page's u/v range the texture occupies. A region
 * of `(0, 0, 1, 1)` stretches the texture over the whole page.
 */
export interface TexRegion {
	uMin: number;
	vMin: number;
	fU: number;
	fV: number;
}

interface MeshSample {
	_wx: number; _wy: number; _wz: number;
	_nx: number; _ny: number; _nz: number;
	_ux: number; _uy: number; _uz: number;
	_vx: number; _vy: number; _vz: number;
}

function interpolateMesh(
	mesh: PaperMesh,
	u: number,
	v: number,
	side: 0 | 1,
	withNormals: boolean,
	region?: TexRegion | null,
): MeshSample | null {
	if (u < 0 || u > 1 || v < 0 || v > 1) return null;

	const isCover = mesh instanceof CoverMesh;
	const vertexBase = isCover && side === 1 ? VERTEX_COUNT : 0;

	// The texture only occupies part of the page UV space (region). Map the image
	// coordinate into that space first; a region of (0, 0, 1, 1) maps identity.
	const r = region ?? { uMin: 0, vMin: 0, fU: 1, fV: 1 };
	const uMapped = r.uMin + u * r.fU;
	const vMapped = r.vMin + v * r.fV;

	// Single-grid meshes sample the back texture at (1 - u, v) (see paper.frag.glsl),
	// so a back-side texture coordinate must be un-mirrored to reach the right vertex.
	const gu = isCover || side === 0 ? uMapped : 1 - uMapped;
	const gv = vMapped;

	const cx = gu * (GRID_COLS - 1);
	const cy = gv * (GRID_ROWS - 1);

	const col0 = Math.max(0, Math.min(GRID_COLS - 2, Math.floor(cx)));
	const row0 = Math.max(0, Math.min(GRID_ROWS - 2, Math.floor(cy)));
	const fx = Math.min(1, Math.max(0, cx - col0));
	const fy = Math.min(1, Math.max(0, cy - row0));

	const pos = mesh._positions;
	const norms = withNormals ? mesh._computeNormals() : null;
	const idx = (row: number, col: number) => (vertexBase + row * GRID_COLS + col) * 3;
	const tl = idx(row0, col0);
	const tr = idx(row0, col0 + 1);
	const bl = idx(row0 + 1, col0);
	const br = idx(row0 + 1, col0 + 1);

	// Derivatives of position w.r.t. the grid cell fraction, scaled to uv units.
	const su = GRID_COLS - 1;
	const sv = GRID_ROWS - 1;

	let wx: number, wy: number, wz: number;
	let nx = 0, ny = 0, nz = 0;
	let ux: number, uy: number, uz: number;
	let vx: number, vy: number, vz: number;
	if (fx + fy <= 1) {
		// Triangle (tl, bl, tr)
		const wTL = 1 - fx - fy;
		const wBL = fy;
		const wTR = fx;
		wx = wTL * pos[tl] + wBL * pos[bl] + wTR * pos[tr];
		wy = wTL * pos[tl + 1] + wBL * pos[bl + 1] + wTR * pos[tr + 1];
		wz = wTL * pos[tl + 2] + wBL * pos[bl + 2] + wTR * pos[tr + 2];
		if (norms) {
			nx = wTL * norms[tl] + wBL * norms[bl] + wTR * norms[tr];
			ny = wTL * norms[tl + 1] + wBL * norms[bl + 1] + wTR * norms[tr + 1];
			nz = wTL * norms[tl + 2] + wBL * norms[bl + 2] + wTR * norms[tr + 2];
		}
		ux = (pos[tr] - pos[tl]) * su;
		uy = (pos[tr + 1] - pos[tl + 1]) * su;
		uz = (pos[tr + 2] - pos[tl + 2]) * su;
		vx = (pos[bl] - pos[tl]) * sv;
		vy = (pos[bl + 1] - pos[tl + 1]) * sv;
		vz = (pos[bl + 2] - pos[tl + 2]) * sv;
	} else {
		// Triangle (tr, bl, br)
		const wTR = 1 - fy;
		const wBL = 1 - fx;
		const wBR = fx + fy - 1;
		wx = wTR * pos[tr] + wBL * pos[bl] + wBR * pos[br];
		wy = wTR * pos[tr + 1] + wBL * pos[bl + 1] + wBR * pos[br + 1];
		wz = wTR * pos[tr + 2] + wBL * pos[bl + 2] + wBR * pos[br + 2];
		if (norms) {
			nx = wTR * norms[tr] + wBL * norms[bl] + wBR * norms[br];
			ny = wTR * norms[tr + 1] + wBL * norms[bl + 1] + wBR * norms[br + 1];
			nz = wTR * norms[tr + 2] + wBL * norms[bl + 2] + wBR * norms[br + 2];
		}
		ux = (pos[br] - pos[bl]) * su;
		uy = (pos[br + 1] - pos[bl + 1]) * su;
		uz = (pos[br + 2] - pos[bl + 2]) * su;
		vx = (pos[br] - pos[tr]) * sv;
		vy = (pos[br + 1] - pos[tr + 1]) * sv;
		vz = (pos[br + 2] - pos[tr + 2]) * sv;
	}

	// The grid spans the full page but the image only spans the region, so the
	// world-space extent per image-u/v unit is the grid tangent scaled by the
	// region's fill fractions.
	ux *= r.fU; uy *= r.fU; uz *= r.fU;
	vx *= r.fV; vy *= r.fV; vz *= r.fV;

	// A back-side texture coordinate on a single-grid mesh is sampled mirrored
	// (gu = 1 - u), so its u-tangent points the opposite way.
	if (!isCover && side === 1) {
		ux = -ux;
		uy = -uy;
		uz = -uz;
	}

	return {
		_wx: wx, _wy: wy, _wz: wz,
		_nx: nx, _ny: ny, _nz: nz,
		_ux: ux, _uy: uy, _uz: uz,
		_vx: vx, _vy: vy, _vz: vz,
	};
}

/**
 * Returns the world-space position, surface normal and UV tangents of a
 * relative texture coordinate (u, v) on a page mesh, using the mesh's *current*
 * (possibly animated/displaced) positions.
 *
 * `side` is the page side the image is displayed on:
 *   0 = front face (sampled at uv directly),
 *   1 = back face (sampled with the U axis mirrored on a single-grid PaperMesh,
 *       or on the separate back-face grid of a CoverMesh).
 *
 * `region` restricts the image to a sub-rectangle of the page (see
 * {@link TexRegion}); the tangents are scaled accordingly. When omitted the
 * image is stretched over the whole page.
 *
 * Returns null when (u, v) falls outside [0, 1].
 */
export function uvToWorldPosition(mesh: PaperMesh, u: number, v: number, side: 0 | 1, region?: TexRegion | null): UvWorldResult | null {
	const s = interpolateMesh(mesh, u, v, side, true, region);
	if (!s) return null;

	const len = Math.sqrt(s._nx * s._nx + s._ny * s._ny + s._nz * s._nz) || 1;
	return {
		_point: new Vec3(s._wx, s._wy, s._wz),
		_normal: new Vec3(s._nx / len, s._ny / len, s._nz / len),
		_tangentU: new Vec3(s._ux, s._uy, s._uz),
		_tangentV: new Vec3(s._vx, s._vy, s._vz),
	};
}

/**
 * Like `uvToWorldPosition` but returns only the interpolated world-space
 * position, skipping the surface normal and tangent computation.
 */
export function sampleMeshPosition(mesh: PaperMesh, u: number, v: number, side: 0 | 1, region?: TexRegion | null): Vec3 | null {
	const s = interpolateMesh(mesh, u, v, side, false, region);
	if (!s) return null;
	return new Vec3(s._wx, s._wy, s._wz);
}

/**
 * Projects a world-space point through the given view-projection matrix to CSS
 * pixel coordinates relative to the canvas top-left. Returns null when the point
 * is behind the camera.
 */
export function projectWorldToScreen(
	point: Vec3,
	viewProj: Mat4,
	clientWidth: number,
	clientHeight: number,
): { x: number; y: number } | null {
	const m = viewProj.arr;
	const clipX = m[0] * point._x + m[4] * point._y + m[8] * point._z + m[12];
	const clipY = m[1] * point._x + m[5] * point._y + m[9] * point._z + m[13];
	const clipW = m[3] * point._x + m[7] * point._y + m[11] * point._z + m[15];
	if (clipW <= 0) return null;

	const ndcX = clipX / clipW;
	const ndcY = clipY / clipW;
	return {
		x: (ndcX * 0.5 + 0.5) * clientWidth,
		y: (0.5 - ndcY * 0.5) * clientHeight,
	};
}
