import { Vec3 } from './vec3';
import { Mat4 } from './mat4';

export class OrbitCamera {
	_theta: number = Math.PI * 0.4;
	_phi: number = Math.PI * 0.25;
	_radius: number = 1.5;
	_target: Vec3 = new Vec3(0, 0, 0);

	#targetTheta: number = this._theta;
	#targetPhi: number = this._phi;
	#targetRadius: number = this._radius;
	#targetTarget: Vec3 = this._target._clone();

	_rotateSpeed: number = 0.005;
	_zoomSpeed: number = 0.003;

	_minRadius: number = 0.6;
	_maxRadius: number = 5.0;

	_panBoundsMin: Vec3 | null = null;
	_panBoundsMax: Vec3 | null = null;

	_freeCamMode: boolean = false;

	_canPanLeft: boolean = true;
	_canPanRight: boolean = true;
	_canPanUp: boolean = true;
	_canPanDown: boolean = true;

	_manualZoomActive: boolean = false;

	_isZoomedIn(): boolean {
		return this._canPanLeft || this._canPanRight || this._canPanUp || this._canPanDown;
	}

	_fov: number = Math.PI * 0.25;

	#canvasW: number = 1;
	#canvasH: number = 1;

	_setCanvasSize(w: number, h: number): void {
		this.#canvasW = 0 | w;
		this.#canvasH = 0 | h;
	}

	_initContainRadius(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, margin: number): void {
		const halfTan = Math.tan(this._fov / 2);
		const vw = this.#canvasW;
		const vh = this.#canvasH;
		const limitW = vw - 2 * margin;
		const limitH = vh - 2 * margin;
		const boxW = bounds.maxX - bounds.minX;
		const boxH = bounds.maxZ - bounds.minZ;
		const rW = (limitW > 0 && boxW > 0) ? boxW * vh / (2 * limitW * halfTan) : this._minRadius;
		const rH = (limitH > 0 && boxH > 0) ? boxH * vh / (2 * limitH * halfTan) : this._minRadius;
		this._maxRadius = Math.max(rW, rH, this._minRadius);
		this._radius = this._maxRadius;
		this.#targetRadius = this._maxRadius;
		this._snap();
	}

	_snap(): void {
		this.#targetTheta = this._theta;
		this.#targetPhi = this._phi;
		this.#targetRadius = this._radius;
		this.#targetTarget._copy(this._target);
	}

	_update(dt: number): void {
		const speed = 24;
		const t = 1 - Math.exp(-speed * dt);
		this._theta += (this.#targetTheta - this._theta) * t;
		this._phi += (this.#targetPhi - this._phi) * t;
		this._radius += (this.#targetRadius - this._radius) * t;
		this._target._x += (this.#targetTarget._x - this._target._x) * t;
		this._target._y += (this.#targetTarget._y - this._target._y) * t;
		this._target._z += (this.#targetTarget._z - this._target._z) * t;
		if (!this._freeCamMode) {
			this.#targetRadius = Math.min(this.#targetRadius, this._maxRadius);
			this._radius = Math.min(this._radius, this._maxRadius);
		}
	}

	_isMoving(): boolean {
		const eps = 1e-6;
		return (
			Math.abs(this.#targetTheta - this._theta) > eps ||
			Math.abs(this.#targetPhi - this._phi) > eps ||
			Math.abs(this.#targetRadius - this._radius) > eps ||
			Math.abs(this.#targetTarget._x - this._target._x) > eps ||
			Math.abs(this.#targetTarget._y - this._target._y) > eps ||
			Math.abs(this.#targetTarget._z - this._target._z) > eps
		);
	}

	#getEffectivePhi(): number {
		if (this._freeCamMode) return this._phi;
		const linearT = (this._radius - this._minRadius) / (this._maxRadius - this._minRadius);
		const zoomT = linearT * linearT;
		const minPhi = (1 - zoomT) * Math.PI / 3;
		return Math.max(minPhi, this._phi);
	}

	_getEye(): Vec3 {
		const phi = this.#getEffectivePhi();
		const cosPhi = Math.cos(phi);
		return new Vec3(
			this._target._x + this._radius * Math.sin(this._theta) * cosPhi,
			this._target._y + this._radius * Math.sin(phi),
			this._target._z + this._radius * Math.cos(this._theta) * cosPhi
		);
	}

	_getViewMatrix(): Mat4 {
		return Mat4._lookAt(this._getEye(), this._target, new Vec3(0, 1, 0));
	}

	_setFreeCamMode(on: boolean): void {
		this._freeCamMode = on;
		if (!on) {
			const linearT = (this._radius - this._minRadius) / (this._maxRadius - this._minRadius);
			const zoomT = linearT * linearT;
			const minPhi = (1 - zoomT) * Math.PI / 3;
			const clampedPhi = Math.max(minPhi, Math.min(Math.PI * 0.49, this._phi));
			this.#targetPhi = clampedPhi;
			this.#targetRadius = Math.max(this._minRadius, Math.min(this._maxRadius, this._radius));
			this._manualZoomActive = true;
		}
	}

	_rotate(deltaTheta: number, deltaPhi: number, clampPhi: boolean = true): void {
		this.#targetTheta += deltaTheta * this._rotateSpeed;
		this.#targetPhi += deltaPhi * this._rotateSpeed;
		if (clampPhi) {
			this.#targetPhi = Math.max(0, Math.min(Math.PI * 0.49, this.#targetPhi));
		}
	}

	_getPickRay(screenX: number, screenY: number): { origin: Vec3; direction: Vec3 } {
		const eye = this._getEye();
		const target = this._target;

		const forward = new Vec3(target._x - eye._x, target._y - eye._y, target._z - eye._z)._normalize();
		const worldUp = new Vec3(0, 1, 0);
		const right = new Vec3()._copy(forward)._cross(worldUp)._normalize();
		const up = new Vec3()._copy(right)._cross(forward)._normalize();

		const aspect = this.#canvasW / Math.max(1, this.#canvasH);
		const halfH = Math.tan(this._fov / 2);
		const halfW = halfH * aspect;
		const haX = (screenX / this.#canvasW * 2 - 1) * halfW;
		const haY = (1 - screenY / this.#canvasH * 2) * halfH;

		const dx = forward._x + right._x * haX + up._x * haY;
		const dy = forward._y + right._y * haX + up._y * haY;
		const dz = forward._z + right._z * haX + up._z * haY;
		const invLen = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);

		return {
			origin: eye,
			direction: new Vec3(dx * invLen, dy * invLen, dz * invLen),
		};
	}

	_zoom(delta: number, hitPoint?: Vec3): void {
		const oldRadius = this.#targetRadius;
		this.#targetRadius += delta * this._zoomSpeed;
		this.#targetRadius = Math.max(this._minRadius, this.#targetRadius);
		if (!this._freeCamMode) {
			this.#targetRadius = Math.min(this._maxRadius, this.#targetRadius);
		}

		if (!this._freeCamMode) {
			if (this.#targetRadius < oldRadius) {
				this._manualZoomActive = true;
				const t = 1 - this.#targetRadius / oldRadius;
				this.#targetPhi += t * (Math.PI * 0.49 - this.#targetPhi);
			} else if (this.#targetRadius >= this._maxRadius) {
				this._manualZoomActive = false;
			}
		}

		if (hitPoint) {
			const newRadius = this.#targetRadius;
			if (oldRadius > 0 && newRadius > 0) {
				const scale = 1 - newRadius / oldRadius;
				this.#targetTarget._x += (hitPoint._x - this.#targetTarget._x) * scale;
				this.#targetTarget._y += (hitPoint._y - this.#targetTarget._y) * scale;
				this.#targetTarget._z += (hitPoint._z - this.#targetTarget._z) * scale;
				this.#clampTargetTarget();
			}
		}
	}

	_pan(deltaX: number, deltaY: number): void {
		if (!this._canPanLeft && !this._canPanRight && !this._canPanUp && !this._canPanDown) return;

		if (deltaX > 0 && !this._canPanRight) deltaX = 0;
		if (deltaX < 0 && !this._canPanLeft)  deltaX = 0;
		if (deltaY > 0 && !this._canPanDown)  deltaY = 0;
		if (deltaY < 0 && !this._canPanUp)    deltaY = 0;

		const eye = this._getEye();
		const forward = new Vec3(
			this._target._x - eye._x,
			this._target._y - eye._y,
			this._target._z - eye._z
		)._normalize();
		const right = new Vec3()._copy(forward)._cross(new Vec3(0, 1, 0))._normalize();
		const up = new Vec3()._copy(right)._cross(forward)._normalize();

		const worldH = 2 * this._radius * Math.tan(this._fov / 2);
		const px = worldH / this.#canvasH;

		const dx = -deltaX * px;
		const dy = deltaY * px;

		const xzUp = new Vec3(up._x, 0, up._z);
		const xzLen = Math.sqrt(xzUp._x * xzUp._x + xzUp._z * xzUp._z);
		if (xzLen > 1e-6) {
			xzUp._x /= xzLen;
			xzUp._z /= xzLen;
		}

		this.#targetTarget._add(new Vec3(right._x * dx, right._y * dx, right._z * dx));
		this.#targetTarget._add(new Vec3(xzUp._x * dy, 0, xzUp._z * dy));

		this.#clampTargetTarget();
	}

	#clampTargetTarget(): void {
		if (!this._panBoundsMin || !this._panBoundsMax) return;
		this.#targetTarget._x = Math.max(this._panBoundsMin._x, Math.min(this._panBoundsMax._x, this.#targetTarget._x));
		this.#targetTarget._y = Math.max(this._panBoundsMin._y, Math.min(this._panBoundsMax._y, this.#targetTarget._y));
		this.#targetTarget._z = Math.max(this._panBoundsMin._z, Math.min(this._panBoundsMax._z, this.#targetTarget._z));
	}

	_clampViewport(
		screenBounds: { minX: number; maxX: number; minY: number; maxY: number },
		viewportW: number,
		viewportH: number,
		margin: number,
	): void {
		const boxW = screenBounds.maxX - screenBounds.minX;
		const boxH = screenBounds.maxY - screenBounds.minY;

		const limitW = viewportW - 2 * margin;
		const limitH = viewportH - 2 * margin;

		if (boxW > limitW) {
			this._canPanRight = screenBounds.minX < margin;
			this._canPanLeft = screenBounds.maxX > viewportW - margin;
		} else {
			this._canPanRight = false;
			this._canPanLeft = false;
		}

		if (boxH > limitH) {
			this._canPanDown = screenBounds.minY < margin;
			this._canPanUp = screenBounds.maxY > viewportH - margin;
		} else {
			this._canPanDown = false;
			this._canPanUp = false;
		}

		const safetyFactor = 0.995;
		const rW = (limitW > 0 && boxW > 0) ? this._radius * boxW / (limitW * safetyFactor) : this._minRadius;
		const rH = (limitH > 0 && boxH > 0) ? this._radius * boxH / (limitH * safetyFactor) : this._minRadius;
		this._maxRadius = Math.max(rW, rH, this._minRadius);

		if (!this._manualZoomActive && !this._freeCamMode) {
			this.#targetRadius = this._maxRadius;
		}

		let rightPx = 0;
		let upPx = 0;

		if (boxW <= limitW) {
			rightPx = (screenBounds.minX + screenBounds.maxX) / 2 - viewportW / 2;
		} else {
			if (screenBounds.minX > margin) {
				rightPx += (screenBounds.minX - margin);
			}
			if (screenBounds.maxX < viewportW - margin) {
				rightPx += (screenBounds.maxX - viewportW + margin);
			}
		}

		if (boxH <= limitH) {
			upPx = viewportH / 2 - (screenBounds.minY + screenBounds.maxY) / 2;
		} else {
			if (screenBounds.minY > margin) {
				upPx += (margin - screenBounds.minY);
			}
			if (screenBounds.maxY < viewportH - margin) {
				upPx += (viewportH - margin - screenBounds.maxY);
			}
		}

		const eye = this._getEye();
		const forward = new Vec3(
			this._target._x - eye._x,
			this._target._y - eye._y,
			this._target._z - eye._z,
		)._normalize();
		const right = new Vec3()._copy(forward)._cross(new Vec3(0, 1, 0))._normalize();
		const up = new Vec3()._copy(right)._cross(forward)._normalize();

		const worldH = 2 * this._radius * Math.tan(this._fov / 2);
		const px = worldH / this.#canvasH;

		const rightWorld = rightPx * px;
		const upWorld = upPx * px;

		const toTT = new Vec3(
			this.#targetTarget._x - this._target._x,
			this.#targetTarget._y - this._target._y,
			this.#targetTarget._z - this._target._z,
		);
		const ttRight = toTT._x * right._x + toTT._y * right._y + toTT._z * right._z;
		const ttUp = toTT._x * up._x + toTT._y * up._y + toTT._z * up._z;

		let dRight = 0;
		let dUp = 0;

		if (boxW <= limitW) {
			dRight = rightWorld - ttRight;
		} else {
			const loRight = (screenBounds.minX - margin) * px;
			const hiRight = (screenBounds.maxX - (viewportW - margin)) * px;
			if (ttRight < loRight) dRight = loRight - ttRight;
			else if (ttRight > hiRight) dRight = hiRight - ttRight;
		}

		if (boxH <= limitH) {
			dUp = upWorld - ttUp;
		} else {
			const loUp = (viewportH - margin - screenBounds.maxY) * px;
			const hiUp = (margin - screenBounds.minY) * px;
			if (ttUp < loUp) dUp = loUp - ttUp;
			else if (ttUp > hiUp) dUp = hiUp - ttUp;
		}

		if (dRight !== 0) this.#targetTarget._add(new Vec3(right._x * dRight, right._y * dRight, right._z * dRight));
		if (dUp !== 0) this.#targetTarget._add(new Vec3(up._x * dUp, up._y * dUp, up._z * dUp));
		this.#clampTargetTarget();
	}
}
