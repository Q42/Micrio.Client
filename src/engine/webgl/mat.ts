/**
 * High-performance matrix and vector operations for WebGL.
 * Ported from gl-matrix 3.2.1 (Copyright (c) 2015-2020, Brandon Jones, Colin MacKenzie IV).
 * Originally ported to AssemblyScript/WASM by marcel@micr.io, 2020.
 * Re-ported to TypeScript for the Micrio engine.
 *
 * @license MIT
 * @internal
 */

/** Represents a 4x4 matrix, tailored for WebGL operations. @internal */
export class Mat4 {
	/** Float32Array view for direct use with WebGL uniformMatrix4fv. */
	readonly arr: Float32Array = new Float32Array(16);

	/**
	 * Creates a new identity Mat4.
	 * Matrix layout (column-major):
	 * a0 a4 a8 a12
	 * a1 a5 a9 a13
	 * a2 a6 a10 a14
	 * a3 a7 a11 a15
	 */
	constructor(
		public a0: number = 1, public a1: number = 0, public a2: number = 0, public a3: number = 0,
		public a4: number = 0, public a5: number = 1, public a6: number = 0, public a7: number = 0,
		public a8: number = 0, public a9: number = 0, public a10: number = 1, public a11: number = 0,
		public a12: number = 0, public a13: number = 0, public a14: number = 0, public a15: number = 1
	) {}

	/** Updates the internal Float32Array with the current matrix values. */
	toArray(): Float32Array {
		this.arr[0] = this.a0;
		this.arr[1] = this.a1;
		this.arr[2] = this.a2;
		this.arr[3] = this.a3;
		this.arr[4] = this.a4;
		this.arr[5] = this.a5;
		this.arr[6] = this.a6;
		this.arr[7] = this.a7;
		this.arr[8] = this.a8;
		this.arr[9] = this.a9;
		this.arr[10] = this.a10;
		this.arr[11] = this.a11;
		this.arr[12] = this.a12;
		this.arr[13] = this.a13;
		this.arr[14] = this.a14;
		this.arr[15] = this.a15;
		return this.arr;
	}

	/** Resets the matrix to the identity matrix. */
	identity(): void {
		this.a0 = 1; this.a1 = 0; this.a2 = 0; this.a3 = 0;
		this.a4 = 0; this.a5 = 1; this.a6 = 0; this.a7 = 0;
		this.a8 = 0; this.a9 = 0; this.a10 = 1; this.a11 = 0;
		this.a12 = 0; this.a13 = 0; this.a14 = 0; this.a15 = 1;
	}

	/** Copies the values from another Mat4 into this one. */
	copy(s: Mat4): void {
		this.a0 = s.a0; this.a1 = s.a1; this.a2 = s.a2; this.a3 = s.a3;
		this.a4 = s.a4; this.a5 = s.a5; this.a6 = s.a6; this.a7 = s.a7;
		this.a8 = s.a8; this.a9 = s.a9; this.a10 = s.a10; this.a11 = s.a11;
		this.a12 = s.a12; this.a13 = s.a13; this.a14 = s.a14; this.a15 = s.a15;
	}

	/** Multiplies this matrix by a rotation matrix created from the given angle around the X axis. */
	rotateX(rad: number): void {
		const s = Math.sin(rad);
		const c = Math.cos(rad);
		const a10 = this.a4, a11 = this.a5, a12 = this.a6, a13 = this.a7;
		const a20 = this.a8, a21 = this.a9, a22 = this.a10, a23 = this.a11;

		this.a4 = a10 * c + a20 * s;
		this.a5 = a11 * c + a21 * s;
		this.a6 = a12 * c + a22 * s;
		this.a7 = a13 * c + a23 * s;
		this.a8 = a20 * c - a10 * s;
		this.a9 = a21 * c - a11 * s;
		this.a10 = a22 * c - a12 * s;
		this.a11 = a23 * c - a13 * s;
	}

	/** Multiplies this matrix by a rotation matrix created from the given angle around the Y axis. */
	rotateY(rad: number): void {
		const s = Math.sin(rad);
		const c = Math.cos(rad);
		const a00 = this.a0, a01 = this.a1, a02 = this.a2, a03 = this.a3;
		const a20 = this.a8, a21 = this.a9, a22 = this.a10, a23 = this.a11;

		this.a0 = a00 * c - a20 * s;
		this.a1 = a01 * c - a21 * s;
		this.a2 = a02 * c - a22 * s;
		this.a3 = a03 * c - a23 * s;
		this.a8 = a00 * s + a20 * c;
		this.a9 = a01 * s + a21 * c;
		this.a10 = a02 * s + a22 * c;
		this.a11 = a03 * s + a23 * c;
	}

	/** Multiplies this matrix by a rotation matrix created from the given angle around the Z axis. */
	rotateZ(rad: number): void {
		const s = Math.sin(rad);
		const c = Math.cos(rad);
		const a00 = this.a0, a01 = this.a1, a02 = this.a2, a03 = this.a3;
		const a10 = this.a4, a11 = this.a5, a12 = this.a6, a13 = this.a7;

		this.a0 = a00 * c + a10 * s;
		this.a1 = a01 * c + a11 * s;
		this.a2 = a02 * c + a12 * s;
		this.a3 = a03 * c + a13 * s;
		this.a4 = a10 * c - a00 * s;
		this.a5 = a11 * c - a01 * s;
		this.a6 = a12 * c - a02 * s;
		this.a7 = a13 * c - a03 * s;
	}

	/** Uniform scale applied only to X and Y columns (Z unchanged). */
	scaleFlat(scale: number): void {
		this.a0 *= scale; this.a1 *= scale; this.a2 *= scale; this.a3 *= scale;
		this.a4 *= scale; this.a5 *= scale; this.a6 *= scale; this.a7 *= scale;
	}

	/** Translates the matrix by the given vector [x, y, z]. */
	translate(x: number, y: number, z: number): void {
		this.a12 += this.a0 * x + this.a4 * y + this.a8 * z;
		this.a13 += this.a1 * x + this.a5 * y + this.a9 * z;
		this.a14 += this.a2 * x + this.a6 * y + this.a10 * z;
		this.a15 += this.a3 * x + this.a7 * y + this.a11 * z;
	}

	/** Generates a perspective projection matrix with the given bounds. */
	perspective(fovy: number, aspect: number, near: number, far: number): void {
		this.identity();
		const f = 1.0 / Math.tan(fovy / 2);
		const nf = 1 / (near - far);

		this.a0 = (f / aspect);
		this.a5 = f;
		this.a10 = (far + near) * nf;
		this.a11 = -1;
		this.a14 = 2 * far * near * nf;
		this.a15 = 0;
	}

	/** Generates a simplified perspective matrix suitable for CSS 3D transforms (no near/far clipping). */
	perspectiveCss(fovy: number): void {
		this.identity();
		const f = 1.0 / Math.tan(fovy / 2);
		this.a0 = f;
		this.a5 = f;
	}

	/** Inverts the matrix. */
	invert(): void {
		const a00 = this.a0, a01 = this.a1, a02 = this.a2, a03 = this.a3;
		const a10 = this.a4, a11 = this.a5, a12 = this.a6, a13 = this.a7;
		const a20 = this.a8, a21 = this.a9, a22 = this.a10, a23 = this.a11;
		const a30 = this.a12, a31 = this.a13, a32 = this.a14, a33 = this.a15;

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

		this.a0 = (a11 * b11 - a12 * b10 + a13 * b09) * det;
		this.a1 = (a02 * b10 - a01 * b11 - a03 * b09) * det;
		this.a2 = (a31 * b05 - a32 * b04 + a33 * b03) * det;
		this.a3 = (a22 * b04 - a21 * b05 - a23 * b03) * det;
		this.a4 = (a12 * b08 - a10 * b11 - a13 * b07) * det;
		this.a5 = (a00 * b11 - a02 * b08 + a03 * b07) * det;
		this.a6 = (a32 * b02 - a30 * b05 - a33 * b01) * det;
		this.a7 = (a20 * b05 - a22 * b02 + a23 * b01) * det;
		this.a8 = (a10 * b10 - a11 * b08 + a13 * b06) * det;
		this.a9 = (a01 * b08 - a00 * b10 - a03 * b06) * det;
		this.a10 = (a30 * b04 - a31 * b02 + a33 * b00) * det;
		this.a11 = (a21 * b02 - a20 * b04 - a23 * b00) * det;
		this.a12 = (a11 * b07 - a10 * b09 - a12 * b06) * det;
		this.a13 = (a00 * b09 - a01 * b07 + a02 * b06) * det;
		this.a14 = (a31 * b01 - a30 * b03 - a32 * b00) * det;
		this.a15 = (a20 * b03 - a21 * b01 + a22 * b00) * det;
	}

	/** Multiplies this matrix by another matrix `a` (this = this * a). */
	multiply(a: Mat4): void {
		let b0 = this.a0, b1 = this.a1, b2 = this.a2, b3 = this.a3;
		this.a0 = b0 * a.a0 + b1 * a.a4 + b2 * a.a8 + b3 * a.a12;
		this.a1 = b0 * a.a1 + b1 * a.a5 + b2 * a.a9 + b3 * a.a13;
		this.a2 = b0 * a.a2 + b1 * a.a6 + b2 * a.a10 + b3 * a.a14;
		this.a3 = b0 * a.a3 + b1 * a.a7 + b2 * a.a11 + b3 * a.a15;

		b0 = this.a4; b1 = this.a5; b2 = this.a6; b3 = this.a7;
		this.a4 = b0 * a.a0 + b1 * a.a4 + b2 * a.a8 + b3 * a.a12;
		this.a5 = b0 * a.a1 + b1 * a.a5 + b2 * a.a9 + b3 * a.a13;
		this.a6 = b0 * a.a2 + b1 * a.a6 + b2 * a.a10 + b3 * a.a14;
		this.a7 = b0 * a.a3 + b1 * a.a7 + b2 * a.a11 + b3 * a.a15;

		b0 = this.a8; b1 = this.a9; b2 = this.a10; b3 = this.a11;
		this.a8 = b0 * a.a0 + b1 * a.a4 + b2 * a.a8 + b3 * a.a12;
		this.a9 = b0 * a.a1 + b1 * a.a5 + b2 * a.a9 + b3 * a.a13;
		this.a10 = b0 * a.a2 + b1 * a.a6 + b2 * a.a10 + b3 * a.a14;
		this.a11 = b0 * a.a3 + b1 * a.a7 + b2 * a.a11 + b3 * a.a15;

		b0 = this.a12; b1 = this.a13; b2 = this.a14; b3 = this.a15;
		this.a12 = b0 * a.a0 + b1 * a.a4 + b2 * a.a8 + b3 * a.a12;
		this.a13 = b0 * a.a1 + b1 * a.a5 + b2 * a.a9 + b3 * a.a13;
		this.a14 = b0 * a.a2 + b1 * a.a6 + b2 * a.a10 + b3 * a.a14;
		this.a15 = b0 * a.a3 + b1 * a.a7 + b2 * a.a11 + b3 * a.a15;
	}

	/** Scales the matrix by the given vector [x, y, z]. */
	scaleXY(x: number, y: number, z: number = 1): void {
		this.a0 *= x; this.a1 *= x; this.a2 *= x; this.a3 *= x;
		this.a4 *= y; this.a5 *= y; this.a6 *= y; this.a7 *= y;
		this.a8 *= z; this.a9 *= z; this.a10 *= z; this.a11 *= z;
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
	copy(v: Vec4): void {
		this.x = v.x;
		this.y = v.y;
		this.z = v.z;
		this.w = v.w;
	}

	/** Transforms the vector by the given Mat4. */
	transformMat4(m: Mat4): void {
		const x = this.x, y = this.y, z = this.z;

		const w = m.a3 * x + m.a7 * y + m.a11 * z + m.a15 || 1.0;

		this.x = (m.a0 * x + m.a4 * y + m.a8 * z + m.a12) / w;
		this.y = (m.a1 * x + m.a5 * y + m.a9 * z + m.a13) / w;
		this.z = (m.a2 * x + m.a6 * y + m.a10 * z + m.a14) / w;
		this.w = w;
	}

	/** Normalizes the vector (scales it to have a length of 1). */
	normalize(): void {
		let len = this.x * this.x + this.y * this.y + this.z * this.z;

		if (len > 0) len = 1.0 / Math.sqrt(len);

		this.x *= len;
		this.y *= len;
		this.z *= len;
	}
}
