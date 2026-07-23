/**
 * High-performance matrix and vector operations for WebGL.
 * Ported from gl-matrix 3.2.1 (Copyright (c) 2015-2020, Brandon Jones, Colin MacKenzie IV).
 * Originally ported to AssemblyScript/WASM by marcel@micr.io, 2020.
 * Re-ported to TypeScript for the Micrio engine.
 *
 * @license MIT
 * @internal
 */

/**
 * Represents a 4x4 matrix, tailored for WebGL operations.
 *
 * The matrix is stored as a single `Float32Array(16)` in column-major order,
 * directly usable with WebGL `uniformMatrix4fv` (via {@link Mat4.arr}):
 * ```
 * arr[0] arr[4] arr[8]  arr[12]
 * arr[1] arr[5] arr[9]  arr[13]
 * arr[2] arr[6] arr[10] arr[14]
 * arr[3] arr[7] arr[11] arr[15]
 * ```
 * @internal
 */
export class Mat4 {
	/** Float32Array holding the matrix, for direct use with WebGL uniformMatrix4fv. */
	readonly arr: Float32Array;

	/**
	 * Creates a new Mat4 (defaults to the identity matrix).
	 */
	constructor(
		a0: number = 1, a1: number = 0, a2: number = 0, a3: number = 0,
		a4: number = 0, a5: number = 1, a6: number = 0, a7: number = 0,
		a8: number = 0, a9: number = 0, a10: number = 1, a11: number = 0,
		a12: number = 0, a13: number = 0, a14: number = 0, a15: number = 1
	) {
		this.arr = new Float32Array([
			a0, a1, a2, a3,
			a4, a5, a6, a7,
			a8, a9, a10, a11,
			a12, a13, a14, a15
		]);
	}

	/** Resets the matrix to the identity matrix. */
	_identity(): void {
		const a = this.arr;
		a[0] = 1; a[1] = 0; a[2] = 0; a[3] = 0;
		a[4] = 0; a[5] = 1; a[6] = 0; a[7] = 0;
		a[8] = 0; a[9] = 0; a[10] = 1; a[11] = 0;
		a[12] = 0; a[13] = 0; a[14] = 0; a[15] = 1;
	}

	/** Copies the values from another Mat4 into this one. */
	_copy(s: Mat4): void {
		this.arr.set(s.arr);
	}

	/** Multiplies this matrix by a rotation matrix created from the given angle around the X axis. */
	_rotateX(rad: number): void {
		const a = this.arr;
		const s = Math.sin(rad);
		const c = Math.cos(rad);
		const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
		const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];

		a[4] = a10 * c + a20 * s;
		a[5] = a11 * c + a21 * s;
		a[6] = a12 * c + a22 * s;
		a[7] = a13 * c + a23 * s;
		a[8] = a20 * c - a10 * s;
		a[9] = a21 * c - a11 * s;
		a[10] = a22 * c - a12 * s;
		a[11] = a23 * c - a13 * s;
	}

	/** Multiplies this matrix by a rotation matrix created from the given angle around the Y axis. */
	_rotateY(rad: number): void {
		const a = this.arr;
		const s = Math.sin(rad);
		const c = Math.cos(rad);
		const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
		const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];

		a[0] = a00 * c - a20 * s;
		a[1] = a01 * c - a21 * s;
		a[2] = a02 * c - a22 * s;
		a[3] = a03 * c - a23 * s;
		a[8] = a00 * s + a20 * c;
		a[9] = a01 * s + a21 * c;
		a[10] = a02 * s + a22 * c;
		a[11] = a03 * s + a23 * c;
	}

	/** Multiplies this matrix by a rotation matrix created from the given angle around the Z axis. */
	_rotateZ(rad: number): void {
		const a = this.arr;
		const s = Math.sin(rad);
		const c = Math.cos(rad);
		const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
		const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];

		a[0] = a00 * c + a10 * s;
		a[1] = a01 * c + a11 * s;
		a[2] = a02 * c + a12 * s;
		a[3] = a03 * c + a13 * s;
		a[4] = a10 * c - a00 * s;
		a[5] = a11 * c - a01 * s;
		a[6] = a12 * c - a02 * s;
		a[7] = a13 * c - a03 * s;
	}

	/** Uniform scale applied only to X and Y columns (Z unchanged). */
	_scaleFlat(scale: number): void {
		const a = this.arr;
		a[0] *= scale; a[1] *= scale; a[2] *= scale; a[3] *= scale;
		a[4] *= scale; a[5] *= scale; a[6] *= scale; a[7] *= scale;
	}

	/** Translates the matrix by the given vector [x, y, z]. */
	_translate(x: number, y: number, z: number): void {
		const a = this.arr;
		a[12] += a[0] * x + a[4] * y + a[8] * z;
		a[13] += a[1] * x + a[5] * y + a[9] * z;
		a[14] += a[2] * x + a[6] * y + a[10] * z;
		a[15] += a[3] * x + a[7] * y + a[11] * z;
	}

	/** Generates a perspective projection matrix with the given bounds. */
	_perspective(fovy: number, aspect: number, near: number, far: number): void {
		this._identity();
		const a = this.arr;
		const f = 1.0 / Math.tan(fovy / 2);
		const nf = 1 / (near - far);

		a[0] = (f / aspect);
		a[5] = f;
		a[10] = (far + near) * nf;
		a[11] = -1;
		a[14] = 2 * far * near * nf;
		a[15] = 0;
	}

	/** Generates a simplified perspective matrix suitable for CSS 3D transforms (no near/far clipping). */
	_perspectiveCss(fovy: number): void {
		this._identity();
		const a = this.arr;
		const f = 1.0 / Math.tan(fovy / 2);
		a[0] = f;
		a[5] = f;
	}

	/** Inverts the matrix. */
	_invert(): void {
		const m = this.arr;
		const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
		const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
		const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
		const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

		const b00 = a00 * a11 - a01 * a10;
		const b01 = a00 * a12 - a02 * a10;
		const b02 = a00 * a13 - a03 * a10;
		const b03 = a01 * a12 - a02 * a11;
		const b04 = a01 * a13 - a03 * a11;
		const b05 = a02 * a13 - a03 * a12;
		const b06 = a20 * a31 - a21 * a30;
		const b07 = a20 * a32 - a22 * a30;
		const b08 = a20 * a33 - a23 * a30;
		const b09 = a21 * a32 - a22 * a31;
		const b10 = a21 * a33 - a23 * a31;
		const b11 = a22 * a33 - a23 * a32;

		let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;

		if (!det) return;

		det = 1.0 / det;

		m[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
		m[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
		m[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
		m[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
		m[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
		m[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
		m[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
		m[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
		m[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
		m[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
		m[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
		m[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
		m[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
		m[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
		m[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
		m[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
	}

	/** Multiplies this matrix by another matrix `a` (this = this * a). */
	_multiply(o: Mat4): void {
		const t = this.arr;
		const a = o.arr;
		let b0 = t[0], b1 = t[1], b2 = t[2], b3 = t[3];
		t[0] = b0 * a[0] + b1 * a[4] + b2 * a[8] + b3 * a[12];
		t[1] = b0 * a[1] + b1 * a[5] + b2 * a[9] + b3 * a[13];
		t[2] = b0 * a[2] + b1 * a[6] + b2 * a[10] + b3 * a[14];
		t[3] = b0 * a[3] + b1 * a[7] + b2 * a[11] + b3 * a[15];

		b0 = t[4]; b1 = t[5]; b2 = t[6]; b3 = t[7];
		t[4] = b0 * a[0] + b1 * a[4] + b2 * a[8] + b3 * a[12];
		t[5] = b0 * a[1] + b1 * a[5] + b2 * a[9] + b3 * a[13];
		t[6] = b0 * a[2] + b1 * a[6] + b2 * a[10] + b3 * a[14];
		t[7] = b0 * a[3] + b1 * a[7] + b2 * a[11] + b3 * a[15];

		b0 = t[8]; b1 = t[9]; b2 = t[10]; b3 = t[11];
		t[8] = b0 * a[0] + b1 * a[4] + b2 * a[8] + b3 * a[12];
		t[9] = b0 * a[1] + b1 * a[5] + b2 * a[9] + b3 * a[13];
		t[10] = b0 * a[2] + b1 * a[6] + b2 * a[10] + b3 * a[14];
		t[11] = b0 * a[3] + b1 * a[7] + b2 * a[11] + b3 * a[15];

		b0 = t[12]; b1 = t[13]; b2 = t[14]; b3 = t[15];
		t[12] = b0 * a[0] + b1 * a[4] + b2 * a[8] + b3 * a[12];
		t[13] = b0 * a[1] + b1 * a[5] + b2 * a[9] + b3 * a[13];
		t[14] = b0 * a[2] + b1 * a[6] + b2 * a[10] + b3 * a[14];
		t[15] = b0 * a[3] + b1 * a[7] + b2 * a[11] + b3 * a[15];
	}

	/** Scales the matrix by the given vector [x, y, z] (z defaults to 1). */
	_scale(x: number, y: number, z: number = 1): void {
		const a = this.arr;
		a[0] *= x; a[1] *= x; a[2] *= x; a[3] *= x;
		a[4] *= y; a[5] *= y; a[6] *= y; a[7] *= y;
		a[8] *= z; a[9] *= z; a[10] *= z; a[11] *= z;
	}
}

/** Represents a 4D vector (x, y, z, w). @internal */
export class Vec4 {
	constructor(
		public x: number = 0,
		public y: number = 0,
		public z: number = 0,
		public w: number = 1
	) {}

	/** Copies the values from another Vec4 into this one. */
	_copy(v: Vec4): void {
		this.x = v.x;
		this.y = v.y;
		this.z = v.z;
		this.w = v.w;
	}

	/** Transforms the vector by the given Mat4. */
	_transformMat4(m: Mat4): void {
		const a = m.arr;
		const x = this.x, y = this.y, z = this.z;

		const w = a[3] * x + a[7] * y + a[11] * z + a[15] || 1.0;

		this.x = (a[0] * x + a[4] * y + a[8] * z + a[12]) / w;
		this.y = (a[1] * x + a[5] * y + a[9] * z + a[13]) / w;
		this.z = (a[2] * x + a[6] * y + a[10] * z + a[14]) / w;
		this.w = w;
	}

	/** Normalizes the vector (scales it to have a length of 1). */
	_normalize(): void {
		let len = this.x * this.x + this.y * this.y + this.z * this.z;

		if (len > 0) len = 1.0 / Math.sqrt(len);

		this.x *= len;
		this.y *= len;
		this.z *= len;
	}
}
