import { Vec3 } from './vec3';

export class Mat4 {
	public readonly _data: Float32Array;

	constructor() {
		this._data = new Float32Array(16);
		this._identity();
	}

	_identity(): Mat4 {
		const m = this._data;
		m[0] = 1; m[1] = 0; m[2] = 0; m[3] = 0;
		m[4] = 0; m[5] = 1; m[6] = 0; m[7] = 0;
		m[8] = 0; m[9] = 0; m[10] = 1; m[11] = 0;
		m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
		return this;
	}

	static _perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
		const out = new Mat4();
		const m = out._data;
		const f = 1.0 / Math.tan(fovY * 0.5);
		const nfInv = 1.0 / (near - far);
		m[0] = f / aspect;
		m[1] = 0;
		m[2] = 0;
		m[3] = 0;
		m[4] = 0;
		m[5] = f;
		m[6] = 0;
		m[7] = 0;
		m[8] = 0;
		m[9] = 0;
		m[10] = (far + near) * nfInv;
		m[11] = -1;
		m[12] = 0;
		m[13] = 0;
		m[14] = 2 * far * near * nfInv;
		m[15] = 0;
		return out;
	}

	static _lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
		const out = new Mat4();
		const m = out._data;

		const f = new Vec3(target._x - eye._x, target._y - eye._y, target._z - eye._z)._normalize();
		const s = new Vec3()._copy(f)._cross(up)._normalize();
		const u = new Vec3()._copy(s)._cross(f);

		m[0] = s._x;
		m[1] = u._x;
		m[2] = -f._x;
		m[3] = 0;
		m[4] = s._y;
		m[5] = u._y;
		m[6] = -f._y;
		m[7] = 0;
		m[8] = s._z;
		m[9] = u._z;
		m[10] = -f._z;
		m[11] = 0;
		m[12] = -s._dot(eye);
		m[13] = -u._dot(eye);
		m[14] = f._dot(eye);
		m[15] = 1;
		return out;
	}

	_multiply(b: Mat4): Mat4 {
		const a = this._data.slice();
		const bd = b._data;
		const m = this._data;
		for (let col = 0; col < 4; col++) {
			for (let row = 0; row < 4; row++) {
				let sum = 0;
				for (let k = 0; k < 4; k++) {
					sum += a[k * 4 + row] * bd[col * 4 + k];
				}
				m[col * 4 + row] = sum;
			}
		}
		return this;
	}

	_copy(other: Mat4): Mat4 {
		this._data.set(other._data);
		return this;
	}
}
