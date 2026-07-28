/**
 * Handles 360 camera logic, perspective, and related calculations.
 * @author Marcel Duin <marcel@micr.io>
 * @internal
 */

import { modPI, mod1 } from '$utils/math'
import { Coordinates } from './shared'
import { Vec4, Mat4 } from './mat'
import { segsX, segsY } from './constants'
import { longitudeDistance } from './easing';
import EngineCamera from './engine-camera';
import type { TileCanvas } from './tile-canvas';

/** Handles 360 camera logic, perspective, and related calculations. @internal */
export default class Camera360 extends EngineCamera {
	/** @internal */
	readonly _pMatrix: Mat4 = new Mat4;
	readonly #iMatrix: Mat4 = new Mat4;
	readonly #cachedInverse: Mat4 = new Mat4;
	#inverseDirty: boolean = true;
	readonly #rMatrix: Mat4 = new Mat4;

	readonly #position: Vec4 = new Vec4;

	/** @internal */
	_radius: number = 10;

	/** @internal */
	_scale: number = 0;

	#scaleY: number = 1;
	#offY: number = 0;
	/** @internal */
	_offX: number = 0;

	#limitX: number = 0;
	#limitY: number = 0;

	/** @internal */
	_baseYaw: number = 0;
	/** @internal */
	_yaw: number = 0;
	/** @internal */
	_pitch: number = 0;

	/** @internal */
	_defaultPerspective: number = Math.PI / 2;
	/** @internal */
	_perspective: number = Math.PI / 2;
	/** @internal */
	_maxPerspective: number = Math.PI / 2;
	/** @internal */
	_minPerspective: number = Math.PI / 2;

	/** @internal */
	_cameraForwardX: number = 0;
	/** @internal */
	_cameraForwardY: number = 0;
	/** @internal */
	_cameraForwardZ: number = -1;
	/** @internal */
	_fieldOfView: number = 0;

	/** @internal */
	readonly _vec4: Vec4 = new Vec4();
	readonly #coo: Coordinates = new Coordinates;

	constructor(
		canvas: TileCanvas
	) {
		super(canvas);
		this._baseYaw = -this.canvas._rotationY;
		this._offX = this._baseYaw / (Math.PI * 2);

		this.#scaleY = this.canvas.height / (this.canvas.width / 2);
		this.#offY = (1 - this.#scaleY) / 4;
		this._yaw = this._baseYaw;
		this._update();
	}

	/** Sets the horizontal and vertical movement limits. @internal */
	_setLimits(x: number, y: number): void {
		this.#limitX = x;
		this.#limitY = y;
		this._maxPerspective = Math.PI / 2;
		if (y > 0) this._maxPerspective = Math.min(this._maxPerspective, this._maxPerspective * y * 1.5);
		this._setPerspective(this._perspective, true);
	}

	/** Updates the 360 projection and rotation matrices. @internal */
	_update(noPersp: boolean = false): void {
		const c = this.canvas;
		const el = c.el;

		if (!noPersp) this._pMatrix._perspective(this._perspective, el._aspect, 0.0001, 20);
		this.#inverseDirty = true;

		const pM = this._pMatrix;
		this._pitch = Math.min(Math.PI / 2, Math.max(-Math.PI / 2, this._pitch));
		pM._rotateX(this._pitch);
		pM._rotateY(this._yaw);
		pM._translate(this.#position.x, this.#position.y, this.#position.z);

		const rM = this.#rMatrix;
		rM._perspectiveCss(this._perspective);
		rM._translate(0, 0, el.height / el.ratio / 2);
		rM._rotateX(-this._pitch);
		rM._rotateY(this._yaw);

		this.#coo.direction = (this._yaw / Math.PI * 180) % 360;
	}

	/**
	 * Applies rotation based on pixel delta from mouse/touch drag.
	 * @internal
	 */
	_rotate(xPx: number, yPx: number, duration: number = 0): void {
		const c = this.canvas;
		const el = c.el;
		this._yaw += xPx * el.ratio / el.width * this._perspective * el._aspect;
		this._pitch += yPx * el.ratio / el.height * this._perspective * this.#scaleY;

		this._yaw = modPI(this._yaw);

		if (c._coverLimit || this.#limitY > 0) this.#limitPitch();
		if (this.#limitX > 0) this.#limitYaw();

		if (duration === 0) c._kinetic.addStep(xPx * 2, yPx * 2);

		this._update();
		this._calculate3DFrustum();
		this.#syncLogicalView();
	}

	/** Clamps the pitch value based on perspective and vertical limits. */
	#limitPitch(): void {
		const halfPerspective = this._perspective / 2;
		const maxPitch = Math.PI * this.#scaleY / 2 * (this.#limitY > 0 ? this.#limitY : 1);

		this._pitch = this._pitch > 0 ? Math.min(maxPitch, this._pitch + halfPerspective) - halfPerspective
			: Math.max(-maxPitch, this._pitch - halfPerspective) + halfPerspective;
	}

	/** Clamps the yaw value based on horizontal limits. */
	#limitYaw(): void {
		const halfHorizontalFov = this._perspective / 2 * this.canvas.el._aspect;
		const maxYaw = Math.PI * (this.#limitX > 0 ? this.#limitX : 1);

		let y = this._yaw; while (y >= Math.PI) y -= Math.PI * 2; while (y < -Math.PI) y += Math.PI * 2;
		this._yaw = modPI(Math.min(Math.max(maxYaw, halfHorizontalFov) - halfHorizontalFov, Math.max(Math.min(-maxYaw, -halfHorizontalFov) + halfHorizontalFov, y)));
	}

	/**
	 * Applies zoom by adjusting the perspective.
	 */
	#zoomByFactor(factor: number, dur: number, noLimit: boolean, speed: number = 0, pxX: number = 0, pxY: number = 0): number {
		const c = this.canvas;
		factor /= 2;
		if (dur !== 0) {
			dur = c._ani.zoom(factor, dur, speed, noLimit);
		} else {
			factor /= this._scale * c._diagonal / 20;

			const hasCursor: boolean = pxX > 0 && pxY > 0;
			let beforeX: number = 0, beforeY: number = 0;
			if (hasCursor) {
				const coo = this._getCoo(pxX, pxY);
				beforeX = coo.x;
				beforeY = coo.y;
			}

			this._setPerspective(this._perspective + factor, noLimit);

			if (hasCursor) {
				const after = this._getCoo(pxX, pxY);
				let dx: number = beforeX - after.x;
				if (dx > .5) dx -= 1;
				if (dx < -.5) dx += 1;
				const dy: number = beforeY - after.y;

				this._yaw += dx * Math.PI * 2;
				this._pitch += dy * Math.PI * this.#scaleY;

				this._yaw = modPI(this._yaw);
				if (c._coverLimit || this.#limitY > 0) this.#limitPitch();
				if (this.#limitX > 0) this.#limitYaw();

				this._update();
				this.#readScale();
				this._calculate3DFrustum();
				this.#syncLogicalView();
			}
		}
		return dur;
	}

	/** Sets the perspective (FoV) and updates related state. @internal */
	_setPerspective(perspective: number, noLimit: boolean): void {
		const c = this.canvas;
		this._perspective = perspective;
		if (!noLimit || c.is360) {
			this._perspective = Math.min(this._maxPerspective, Math.max(this._minPerspective, this._perspective));
		}
		if (c._coverLimit || this.#limitY > 0) this.#limitPitch();
		if (this.#limitX > 0) this.#limitYaw();
		this._pMatrix._perspective(this._perspective, c.el._aspect, 0.0001, 20);
		this.#readScale();
		this._update(true);
		this._calculate3DFrustum();
		this.#syncLogicalView();
	}

	/** Recalculates the effective scale based on coordinate conversion. */
	#readScale(): void {
		const el = this.canvas.el;
		const cX: number = el.width / 2;
		const cY: number = el.height / 2;

		const center0 = this._getCoo(cX, cY).x;
		const center1 = this._getCoo(cX + 1, cY + 1).x;
		this._scale = 1 / ((center1 + (center1 < center0 ? 1 : 0)) - center0) / this.canvas.width;
	}

	/** Sets the camera orientation directly. @internal */
	_setDirection(yaw: number, pitch: number, persp: number = 0): void {
		this._yaw = modPI(yaw - this._baseYaw);
		this._pitch = pitch;
		if (persp !== 0) this._setPerspective(persp, false);
		else this._update();
		this._calculate3DFrustum();
		this.#syncLogicalView();
	}

	/** Sets the camera orientation using viewport format (center + dimensions). @internal */
	_setView(centerX?: number, centerY?: number, _width?: number, height?: number, opts?: { noLimit?: boolean; correctNorth?: boolean }): boolean {
		if (centerX == null || centerY == null || height == null) return false;
		const noLimit = opts?.noLimit ?? false;
		const correctNorth = opts?.correctNorth ?? false;
		const adjustedCenterX = correctNorth ? centerX + this._offX : centerX;

		this._yaw = (adjustedCenterX - .5) * Math.PI * 2;
		this._pitch = (centerY - .5) * Math.PI * this.#scaleY;
		this._setPerspective(Math.min(this._maxPerspective, height * Math.PI * this.#scaleY), noLimit);
		this._calculate3DFrustum();
		this.#syncLogicalView();
		return true;
	}

	/** Synchronizes the logical view with the current camera state for 360 images. */
	#syncLogicalView(): void {
		const c = this.canvas;

		const centerX = mod1((this._yaw / (Math.PI * 2) + .5));
		const centerY = (this._pitch / this.#scaleY) / Math.PI + .5;
		const height = this._perspective / Math.PI / this.#scaleY;
		const width = height * (c.el.width === 0 ? 1 : .5 * Math.sqrt(c.el._aspect)) / (c.aspect / 2);

		c.view.set(centerX, centerY, width, height);
		c.view._changed = true;
	}

	/** Calculates 3D camera frustum for accurate 360 embed visibility detection @internal */
	_calculate3DFrustum(): void {
		const yaw = this._yaw;
		const pitch = this._pitch;

		this._cameraForwardX = Math.cos(pitch) * Math.sin(yaw);
		this._cameraForwardY = Math.sin(pitch);
		this._cameraForwardZ = Math.cos(pitch) * Math.cos(yaw);

		const verticalFOV = 2 * Math.atan(1 / this._perspective);
		const aspectRatio = this.canvas.el.width / this.canvas.el.height;

		const halfVerticalFOV = verticalFOV / 2;
		const halfHorizontalFOV = Math.atan(Math.tan(halfVerticalFOV) * aspectRatio);
		this._fieldOfView = halfHorizontalFOV * 2;
	}

	/** Applies translation offset for 360 space transitions. @internal */
	_moveTo(distance: number, distanceY: number, direction: number, addYaw: number = 0): void {
		const p = this.#position;

		const dir: number = direction * Math.PI * 2 + addYaw;
		p.x = -distance * Math.sin(dir);
		p.y = distanceY;
		p.z = distance * Math.cos(dir);
		this.canvas.view._changed = true;
		this._update();
	}

	/** Handles canvas resize events for 360 mode. @internal */
	_resize(): void {
		const c = this.canvas;
		const el = c.el;
		this._minPerspective = Math.min(.5, el.height / c.height) / c.maxScale * this.#scaleY * Math.PI / el.ratio * el.scale;
		this._setPerspective(this._perspective, true);
	}

	/** Ensures the cached inverse projection matrix is up to date. */
	#ensureInverse(): void {
		if (this.#inverseDirty) {
			this.#cachedInverse._copy(this._pMatrix);
			this.#cachedInverse._invert();
			this.#inverseDirty = false;
		}
	}

	/** Converts screen pixel coordinates to 360 image coordinates [0-1]. @internal */
	_getCoo(pxX: number, pxY: number): Coordinates {
		const el = this.canvas.el,
			v = this._vec4,
			c = this.#coo;

		v.x = (pxX * el.ratio / el.width) * 2 - 1;
		v.y = -((pxY * el.ratio / el.height) * 2 - 1);
		v.z = 1;
		v.w = 1;

		this.#ensureInverse();
		v._transformMat4(this.#cachedInverse);

		v._normalize();
		c.x = Math.atan2(v.x, -v.z) / Math.PI / 2 + .5;
		c.y = .5 - Math.asin(v.y) / Math.PI / this.#scaleY;
		c.scale = this._scale;
		c.w = this.#position.x + this.#position.z;
		c.direction = this._yaw + this._baseYaw;
		c._toArray();

		return c;
	}

	/** Converts 360 image coordinates [0-1] to screen pixel coordinates. @internal */
	_getXYZ(x: number, y: number): Coordinates {
		const el = this.canvas.el,
			v = this._vec4,
			c = this.#coo;

		this._getVec3(x + this._offX, y);

		c.x = ((v.x + 1) / 2) * el.width / el.ratio;
		c.y = ((-v.y + 1) / 2) * el.height / el.ratio;
		c.scale = this._scale;
		c.w = -v.w;
		c._toArray();

		return c;
	}

	/**
	 * Calculates the 3D vector corresponding to a point on the 360 sphere.
	 * @internal
	 */
	_getVec3(x: number, y: number, abs: boolean = false, rad: number = this._radius): Vec4 {
		const v = this._vec4;

		x *= -Math.PI * 2;
		y -= .5;
		y *= -Math.PI;
		y *= this.#scaleY;

		const cY = Math.cos(y);
		v.x = cY * Math.sin(x) * rad;
		v.y = Math.sin(y) * rad;
		v.z = cY * Math.cos(x) * rad;
		v.w = 1;

		if (!abs) v._transformMat4(this._pMatrix);

		return v;
	}

	/**
	 * Calculates the combined transformation matrix for placing an element
	 * at a specific point on the 360 sphere.
	 * @internal
	 */
	_getMatrix(x: number, y: number, scale: number, radius: number, rX: number, rY: number, rZ: number, transY: number = 0, sX: number = 1, sY: number = 1, _noCorrectNorth: boolean = false): Mat4 {
		if (isNaN(radius)) radius = this._radius;

		const m = this.#iMatrix,
			v = this._vec4,
			r = this._radius,
			p = this.#position;

		m._identity();

		radius *= this._radius * (100 / (Math.PI * 2));

		x *= -Math.PI * 2;
		y -= .5;
		y *= Math.PI * this.#scaleY;

		const cY = Math.cos(y);
		v.x = cY * Math.sin(x);
		v.y = Math.sin(y);
		v.z = cY * Math.cos(x);

		m._translate(
			p.x * radius / r,
			-p.y * radius / r + transY * r,
			p.z * radius / r
		);

		m._translate(
			v.x * radius,
			v.y * radius,
			v.z * radius
		);

		m._rotateY(Math.atan2(v.x, v.z) + Math.PI + rY);
		m._rotateX(v.y + rX);
		m._rotateZ(rZ);

		m._scale(sX, sY);

		m._scaleFlat(scale / Math.PI / r);

		m._multiply(this.#rMatrix);

		return m;
	}

	/** Generates vertex data for a segment of the 360 sphere geometry. @internal */
	_setTile360(x: number, y: number, w: number, h: number): void {
		y *= this.#scaleY; y /= 2; y -= .25; y += this.#offY;
		h *= this.#scaleY; h /= 2;

		const v = this.canvas.main._vertexBuffer360;
		const a = this._radius;
		const sW = w / segsX;
		const sH = h / segsY;
		const pi2 = Math.PI * 2;

		for (let pY = 0; pY < segsY; pY++) {
			for (let pX = 0; pX < segsX; pX++) {
				const i = (pY * segsX + pX) * 6 * 3;
				const l = -(mod1(x + sW * pX + this._offX) * pi2);
				const t = -(y + sH * pY) * pi2;
				const r = -(mod1(x + sW * (pX + 1) + this._offX) * pi2);
				const b = -(y + sH * (pY + 1)) * pi2;
				const cL = Math.cos(l) * a || 0;
				const sL = Math.sin(l) * a || 0;
				const cR = Math.cos(r) * a || 0;
				const sR = Math.sin(r) * a || 0;
				const cT = Math.cos(t), cB = Math.cos(b);
				const sT = Math.sin(t) * a, sB = Math.sin(b) * a;

				v[i + 0] = (cT * sL);
				v[i + 1] = sT;
				v[i + 2] = (cT * cL);

				v[i + 3] = v[i + 9] = (cB * sL);
				v[i + 4] = v[i + 10] = sB;
				v[i + 5] = v[i + 11] = (cB * cL);

				v[i + 6] = v[i + 15] = (cT * sR);
				v[i + 7] = v[i + 16] = sT;
				v[i + 8] = v[i + 17] = (cT * cR);

				v[i + 12] = (cB * sR);
				v[i + 13] = sB;
				v[i + 14] = (cB * cR);
			}
		}
	}

	// ─── 2D camera compat methods (for union with Camera2D) ─────────

	// 2D-specific properties, unused for 360
	/** @internal */
	_minScale: number = 0;
	/** @internal */
	_maxScale: number = 0;
	/** @internal */
	_coverScale: number = 0;
	/** @internal */
	_minSize: number = 1;

	/** @internal */
	_correctMinMax(): void {}

	/** @internal */
	_isOutsideLimit(): boolean { return false; }

	/** @internal */
	_isUnderZoom(): boolean { return false; }

	/** @internal */
	_isZoomedOut(_b: boolean = false): boolean { return this._perspective >= this._maxPerspective; }

	/** @internal */
	_isZoomedIn(): boolean { return this._perspective <= this._minPerspective; }

	/** @internal */
	_pan(xPx: number, yPx: number, duration: number = 0, _noLimit: boolean = false, _force: boolean = false, _isKinetic: boolean = false): void {
		this._rotate(xPx, yPx, duration);
	}

	/** @internal */
	_zoom(delta: number, xPx: number, yPx: number, duration: number = 0, noLimit: boolean): number {
		return this.#zoomByFactor(delta, duration, noLimit, 0, xPx, yPx);
	}

	/** @internal */
	protected _handlePinchMove(delta: number, dX: number, dY: number): void {
		this.#zoomByFactor(delta * 2, 0, false);
		this._rotate(dX, dY);
	}

	/** @internal */
	protected _flyToCenterX(centerX: number): number {
		const c = this.canvas;
		const currentCenterX = c.view._centerX;
		const longitudeDist = longitudeDistance(currentCenterX, centerX);
		return currentCenterX + longitudeDist;
	}

	/** @internal */
	protected _setCooDim(scale: number): { w: number; h: number } {
		const el = this.canvas.main.el;
		return { w: (1 / scale) * el.width, h: (1 / scale) * el.height };
	}
}
