export class Vec3 {
	constructor(
		public _x: number = 0,
		public _y: number = 0,
		public _z: number = 0
	) {}

	_clone(): Vec3 {
		return new Vec3(this._x, this._y, this._z);
	}

	_set(x: number, y: number, z: number): Vec3 {
		this._x = x;
		this._y = y;
		this._z = z;
		return this;
	}

	_copy(v: Vec3): Vec3 {
		this._x = v._x;
		this._y = v._y;
		this._z = v._z;
		return this;
	}

	_add(v: Vec3): Vec3 {
		this._x += v._x;
		this._y += v._y;
		this._z += v._z;
		return this;
	}

	_sub(v: Vec3): Vec3 {
		this._x -= v._x;
		this._y -= v._y;
		this._z -= v._z;
		return this;
	}

	_length(): number {
		return Math.sqrt(this._x * this._x + this._y * this._y + this._z * this._z);
	}

	_normalize(): Vec3 {
		const len = this._length();
		if (len > 1e-9) this.#div(len);
		return this;
	}

	_dot(v: Vec3): number {
		return this._x * v._x + this._y * v._y + this._z * v._z;
	}

	_cross(v: Vec3): Vec3 {
		const x = this._y * v._z - this._z * v._y;
		const y = this._z * v._x - this._x * v._z;
		const z = this._x * v._y - this._y * v._x;
		this._x = x;
		this._y = y;
		this._z = z;
		return this;
	}

	#div(s: number): Vec3 {
		const inv = 1.0 / s;
		this._x *= inv;
		this._y *= inv;
		this._z *= inv;
		return this;
	}
}
