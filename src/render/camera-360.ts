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
import type { default as TileCanvas } from './tile-canvas';

/** Handles 360 camera logic, perspective, and related calculations. @internal */
export default class Camera360 extends EngineCamera {
	readonly pMatrix: Mat4 = new Mat4;
	readonly #iMatrix: Mat4 = new Mat4;
	readonly #cachedInverse: Mat4 = new Mat4;
	#inverseDirty: boolean = true;
	readonly #rMatrix: Mat4 = new Mat4;

	readonly #position: Vec4 = new Vec4;

	radius: number = 10;

	scale: number = 0;

	#scaleY: number = 1;
	#offY: number = 0;

	#limitX: number = 0;
	#limitY: number = 0;

	baseYaw: number = 0;
	yaw: number = 0;
	pitch: number = 0;

	defaultPerspective: number = Math.PI / 2;
	perspective: number = Math.PI / 2;
	maxPerspective: number = Math.PI / 2;
	minPerspective: number = Math.PI / 2;

	cameraForwardX: number = 0;
	cameraForwardY: number = 0;
	cameraForwardZ: number = -1;
	fieldOfView: number = 0;

	readonly vec4: Vec4 = new Vec4();
	readonly #coo: Coordinates = new Coordinates;

	offX: number = 0;

	constructor(
		canvas: TileCanvas
	) {
		super(canvas);
		this.baseYaw = -this.canvas.rotationY;
		this.offX = this.baseYaw / (Math.PI * 2);

		this.#scaleY = this.canvas.height / (this.canvas.width / 2);
		this.#offY = (1 - this.#scaleY) / 4;
		this.yaw = this.baseYaw;
		this.update();
	}

	/** Sets the horizontal and vertical movement limits. */
	setLimits(x: number, y: number): void {
		this.#limitX = x;
		this.#limitY = y;
		this.maxPerspective = Math.PI / 2;
		if (y > 0) this.maxPerspective = Math.min(this.maxPerspective, this.maxPerspective * y * 1.5);
		this.setPerspective(this.perspective, true);
	}

	/** Updates the 360 projection and rotation matrices. */
	update(noPersp: boolean = false): void {
		const c = this.canvas;
		const el = c.el;

		if (!noPersp) this.pMatrix.perspective(this.perspective, el.aspect, 0.0001, 20);
		this.#inverseDirty = true;

		const pM = this.pMatrix;
		this.pitch = Math.min(Math.PI / 2, Math.max(-Math.PI / 2, this.pitch));
		pM.rotateX(this.pitch);
		pM.rotateY(this.yaw);
		pM.translate(this.#position.x, this.#position.y, this.#position.z);

		const rM = this.#rMatrix;
		rM.perspectiveCss(this.perspective);
		rM.translate(0, 0, el.height / el.ratio / 2);
		rM.rotateX(-this.pitch);
		rM.rotateY(this.yaw);

		this.#coo.direction = (this.yaw / Math.PI * 180) % 360;
	}

	/**
	 * Applies rotation based on pixel delta from mouse/touch drag.
	 */
	rotate(xPx: number, yPx: number, duration: number = 0): void {
		const c = this.canvas;
		const el = c.el;
		this.yaw += xPx * el.ratio / el.width * this.perspective * el.aspect;
		this.pitch += yPx * el.ratio / el.height * this.perspective * this.#scaleY;

		this.yaw = modPI(this.yaw);

		if (c.coverLimit || this.#limitY > 0) this.#limitPitch();
		if (this.#limitX > 0) this.#limitYaw();

		if (duration === 0) c.kinetic.addStep(xPx * 2, yPx * 2);

		this.update();
		this.calculate3DFrustum();
		this.#syncLogicalView();
	}

	/** Clamps the pitch value based on perspective and vertical limits. */
	#limitPitch(): void {
		const halfPerspective = this.perspective / 2;
		const maxPitch = Math.PI * this.#scaleY / 2 * (this.#limitY > 0 ? this.#limitY : 1);

		this.pitch = this.pitch > 0 ? Math.min(maxPitch, this.pitch + halfPerspective) - halfPerspective
			: Math.max(-maxPitch, this.pitch - halfPerspective) + halfPerspective;
	}

	/** Clamps the yaw value based on horizontal limits. */
	#limitYaw(): void {
		const halfHorizontalFov = this.perspective / 2 * this.canvas.el.aspect;
		const maxYaw = Math.PI * (this.#limitX > 0 ? this.#limitX : 1);

		let y = this.yaw; while (y >= Math.PI) y -= Math.PI * 2; while (y < -Math.PI) y += Math.PI * 2;
		this.yaw = modPI(Math.min(Math.max(maxYaw, halfHorizontalFov) - halfHorizontalFov, Math.max(Math.min(-maxYaw, -halfHorizontalFov) + halfHorizontalFov, y)));
	}

	/**
	 * Applies zoom by adjusting the perspective.
	 */
	zoomByFactor(factor: number, dur: number, noLimit: boolean, speed: number = 0, pxX: number = 0, pxY: number = 0): number {
		const c = this.canvas;
		factor /= 2;
		if (dur !== 0) {
			dur = c.ani.zoom(factor, dur, speed, noLimit);
		} else {
			factor /= this.scale * c.diagonal / 20;

			const hasCursor: boolean = pxX > 0 && pxY > 0;
			let beforeX: number = 0, beforeY: number = 0;
			if (hasCursor) {
				const coo = this.getCoo(pxX, pxY);
				beforeX = coo.x;
				beforeY = coo.y;
			}

			this.setPerspective(this.perspective + factor, noLimit);

			if (hasCursor) {
				const after = this.getCoo(pxX, pxY);
				let dx: number = beforeX - after.x;
				if (dx > .5) dx -= 1;
				if (dx < -.5) dx += 1;
				const dy: number = beforeY - after.y;

				this.yaw += dx * Math.PI * 2;
				this.pitch += dy * Math.PI * this.#scaleY;

				this.yaw = modPI(this.yaw);
				if (c.coverLimit || this.#limitY > 0) this.#limitPitch();
				if (this.#limitX > 0) this.#limitYaw();

				this.update();
				this.readScale();
				this.calculate3DFrustum();
				this.#syncLogicalView();
			}
		}
		return dur;
	}

	/** Sets the perspective (FoV) and updates related state. */
	setPerspective(perspective: number, noLimit: boolean): void {
		const c = this.canvas;
		this.perspective = perspective;
		if (!noLimit || c.is360) {
			this.perspective = Math.min(this.maxPerspective, Math.max(this.minPerspective, this.perspective));
		}
		if (c.coverLimit || this.#limitY > 0) this.#limitPitch();
		if (this.#limitX > 0) this.#limitYaw();
		this.pMatrix.perspective(this.perspective, c.el.aspect, 0.0001, 20);
		this.readScale();
		this.update(true);
		this.calculate3DFrustum();
		this.#syncLogicalView();
	}

	/** Recalculates the effective scale based on coordinate conversion. */
	readScale(): void {
		const el = this.canvas.el;
		const cX: number = el.width / 2;
		const cY: number = el.height / 2;

		const center0 = this.getCoo(cX, cY).x;
		const center1 = this.getCoo(cX + 1, cY + 1).x;
		this.scale = 1 / ((center1 + (center1 < center0 ? 1 : 0)) - center0) / this.canvas.width;
	}

	/** Sets the camera orientation directly. */
	setDirection(yaw: number, pitch: number, persp: number = 0): void {
		this.yaw = modPI(yaw - this.baseYaw);
		this.pitch = pitch;
		if (persp !== 0) this.setPerspective(persp, false);
		else this.update();
		this.calculate3DFrustum();
		this.#syncLogicalView();
	}

	/** Sets the camera orientation using viewport format (center + dimensions). */
	setView(centerX?: number, centerY?: number, _width?: number, height?: number, opts?: { noLimit?: boolean; correctNorth?: boolean }): boolean {
		if (centerX == null || centerY == null || height == null) return false;
		const noLimit = opts?.noLimit ?? false;
		const correctNorth = opts?.correctNorth ?? false;
		const adjustedCenterX = correctNorth ? centerX + this.offX : centerX;

		this.yaw = (adjustedCenterX - .5) * Math.PI * 2;
		this.pitch = (centerY - .5) * Math.PI * this.#scaleY;
		this.setPerspective(Math.min(this.maxPerspective, height * Math.PI * this.#scaleY), noLimit);
		this.calculate3DFrustum();
		this.#syncLogicalView();
		return true;
	}

	/** Synchronizes the logical view with the current camera state for 360 images. */
	#syncLogicalView(): void {
		const c = this.canvas;

		const centerX = mod1((this.yaw / (Math.PI * 2) + .5));
		const centerY = (this.pitch / this.#scaleY) / Math.PI + .5;
		const height = this.perspective / Math.PI / this.#scaleY;
		const width = height * (c.el.width === 0 ? 1 : .5 * Math.sqrt(c.el.aspect)) / (c.aspect / 2);

		c.view.set(centerX, centerY, width, height);
		c.view.changed = true;
	}

	/** Calculates 3D camera frustum for accurate 360 embed visibility detection */
	calculate3DFrustum(): void {
		const yaw = this.yaw;
		const pitch = this.pitch;

		this.cameraForwardX = Math.cos(pitch) * Math.sin(yaw);
		this.cameraForwardY = Math.sin(pitch);
		this.cameraForwardZ = Math.cos(pitch) * Math.cos(yaw);

		const verticalFOV = 2 * Math.atan(1 / this.perspective);
		const aspectRatio = this.canvas.el.width / this.canvas.el.height;

		const halfVerticalFOV = verticalFOV / 2;
		const halfHorizontalFOV = Math.atan(Math.tan(halfVerticalFOV) * aspectRatio);
		this.fieldOfView = halfHorizontalFOV * 2;
	}

	/** Applies translation offset for 360 space transitions. */
	moveTo(distance: number, distanceY: number, direction: number, addYaw: number = 0): void {
		const p = this.#position;

		const dir: number = direction * Math.PI * 2 + addYaw;
		p.x = -distance * Math.sin(dir);
		p.y = distanceY;
		p.z = distance * Math.cos(dir);
		this.canvas.view.changed = true;
		this.update();
	}

	/** Handles canvas resize events for 360 mode. */
	resize(): void {
		const c = this.canvas;
		const el = c.el;
		this.minPerspective = Math.min(.5, el.height / c.height) / c.maxScale * this.#scaleY * Math.PI / el.ratio * el.scale;
		this.setPerspective(this.perspective, true);
	}

	/** Ensures the cached inverse projection matrix is up to date. */
	#ensureInverse(): void {
		if (this.#inverseDirty) {
			this.#cachedInverse.copy(this.pMatrix);
			this.#cachedInverse.invert();
			this.#inverseDirty = false;
		}
	}

	/** Converts screen pixel coordinates to 360 image coordinates [0-1]. */
	getCoo(pxX: number, pxY: number): Coordinates {
		const el = this.canvas.el,
			v = this.vec4,
			c = this.#coo;

		v.x = (pxX * el.ratio / el.width) * 2 - 1;
		v.y = -((pxY * el.ratio / el.height) * 2 - 1);
		v.z = 1;
		v.w = 1;

		this.#ensureInverse();
		v.transformMat4(this.#cachedInverse);

		v.normalize();
		c.x = Math.atan2(v.x, -v.z) / Math.PI / 2 + .5;
		c.y = .5 - Math.asin(v.y) / Math.PI / this.#scaleY;
		c.scale = this.scale;
		c.w = this.#position.x + this.#position.z;
		c.direction = this.yaw + this.baseYaw;
		c.toArray();

		return c;
	}

	/** Converts 360 image coordinates [0-1] to screen pixel coordinates. */
	getXYZ(x: number, y: number): Coordinates {
		const el = this.canvas.el,
			v = this.vec4,
			c = this.#coo;

		this.getVec3(x + this.offX, y);

		c.x = ((v.x + 1) / 2) * el.width / el.ratio;
		c.y = ((-v.y + 1) / 2) * el.height / el.ratio;
		c.scale = this.scale;
		c.w = -v.w;
		c.toArray();

		return c;
	}

	/**
	 * Calculates the 3D vector corresponding to a point on the 360 sphere.
	 */
	getVec3(x: number, y: number, abs: boolean = false, rad: number = this.radius): Vec4 {
		const v = this.vec4;

		x *= -Math.PI * 2;
		y -= .5;
		y *= -Math.PI;
		y *= this.#scaleY;

		const cY = Math.cos(y);
		v.x = cY * Math.sin(x) * rad;
		v.y = Math.sin(y) * rad;
		v.z = cY * Math.cos(x) * rad;
		v.w = 1;

		if (!abs) v.transformMat4(this.pMatrix);

		return v;
	}

	/**
	 * Calculates the combined transformation matrix for placing an element
	 * at a specific point on the 360 sphere.
	 */
	getMatrix(x: number, y: number, scale: number, radius: number, rX: number, rY: number, rZ: number, transY: number = 0, sX: number = 1, sY: number = 1, _noCorrectNorth: boolean = false): Mat4 {
		if (isNaN(radius)) radius = this.radius;

		const m = this.#iMatrix,
			v = this.vec4,
			r = this.radius,
			p = this.#position;

		m.identity();

		radius *= this.radius * (100 / (Math.PI * 2));

		x *= -Math.PI * 2;
		y -= .5;
		y *= Math.PI * this.#scaleY;

		const cY = Math.cos(y);
		v.x = cY * Math.sin(x);
		v.y = Math.sin(y);
		v.z = cY * Math.cos(x);

		m.translate(
			p.x * radius / r,
			-p.y * radius / r + transY * r,
			p.z * radius / r
		);

		m.translate(
			v.x * radius,
			v.y * radius,
			v.z * radius
		);

		m.rotateY(Math.atan2(v.x, v.z) + Math.PI + rY);
		m.rotateX(v.y + rX);
		m.rotateZ(rZ);

		m.scale(sX, sY);

		m.scaleFlat(scale / Math.PI / r);

		m.multiply(this.#rMatrix);

		return m;
	}

	/** Generates vertex data for a segment of the 360 sphere geometry. */
	setTile360(x: number, y: number, w: number, h: number): void {
		y *= this.#scaleY; y /= 2; y -= .25; y += this.#offY;
		h *= this.#scaleY; h /= 2;

		const v = this.canvas.main.vertexBuffer360;
		const a = this.radius;
		const sW = w / segsX;
		const sH = h / segsY;
		const pi2 = Math.PI * 2;

		for (let pY = 0; pY < segsY; pY++) {
			for (let pX = 0; pX < segsX; pX++) {
				const i = (pY * segsX + pX) * 6 * 3;
				const l = -(mod1(x + sW * pX + this.offX) * pi2);
				const t = -(y + sH * pY) * pi2;
				const r = -(mod1(x + sW * (pX + 1) + this.offX) * pi2);
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
	minScale: number = 0;
	maxScale: number = 0;
	coverScale: number = 0;
	minSize: number = 1;

	correctMinMax(): void {}

	isOutsideLimit(): boolean { return false; }

	isUnderZoom(): boolean { return false; }

	isZoomedOut(_b: boolean = false): boolean { return this.perspective >= this.maxPerspective; }

	isZoomedIn(): boolean { return this.perspective <= this.minPerspective; }

	pan(xPx: number, yPx: number, duration: number = 0, _noLimit: boolean = false, _force: boolean = false, _isKinetic: boolean = false): void {
		this.rotate(xPx, yPx, duration);
	}

	zoom(delta: number, xPx: number, yPx: number, duration: number = 0, noLimit: boolean): number {
		return this.zoomByFactor(delta, duration, noLimit, 0, xPx, yPx);
	}

	protected handlePinchMove(delta: number, dX: number, dY: number): void {
		this.zoomByFactor(delta * 2, 0, false);
		this.rotate(dX, dY);
	}

	protected flyToCenterX(centerX: number): number {
		const c = this.canvas;
		const currentCenterX = c.view.centerX;
		const longitudeDist = longitudeDistance(currentCenterX, centerX);
		return currentCenterX + longitudeDist;
	}

	protected setCooDim(scale: number): { w: number; h: number } {
		const el = this.canvas.main.el;
		return { w: (1 / scale) * el.width, h: (1 / scale) * el.height };
	}
}
