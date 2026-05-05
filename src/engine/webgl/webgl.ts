/**
 * Handles 360 camera logic, perspective, and related SphericalView calculations.
 * @author Marcel Duin <marcel@micr.io>
 */

import { modPI, mod1 } from '../utils/utils'
import { Coordinates } from '../shared/shared'
import { Vec4, Mat4 } from './mat'
import { PI, PI2, PIh } from '../globals'
import { segsX, segsY } from '../globals'
import type { default as TileCanvas } from '../canvas/canvas';

/** Handles 360 camera logic, perspective, and related SphericalView calculations. */
export default class SphericalView {
	readonly pMatrix: Mat4 = new Mat4;
	readonly iMatrix: Mat4 = new Mat4;
	private readonly cachedInverse: Mat4 = new Mat4;
	private inverseDirty: boolean = true;
	private readonly rMatrix: Mat4 = new Mat4;

	readonly position: Vec4 = new Vec4;

	radius: number = 10;

	scale: number = 0;

	scaleY: number = 1;
	offY: number = 0;
	dofY: number = 1;

	limitX: number = 0;
	limitY: number = 0;

	baseYaw: number = 0;
	yaw: number = 0;
	pitch: number = 0;

	defaultPerspective: number = PIh;
	perspective: number = PIh;
	maxPerspective: number = PIh;
	minPerspective: number = PIh;

	public cameraForwardX: number = 0;
	public cameraForwardY: number = 0;
	public cameraForwardZ: number = -1;
	public cameraUpX: number = 0;
	public cameraUpY: number = 1;
	public cameraUpZ: number = 0;
	public cameraRightX: number = 1;
	public cameraRightY: number = 0;
	public cameraRightZ: number = 0;
	public fieldOfView: number = 0;
	public aspectRatio: number = 1;

	readonly vec4: Vec4 = new Vec4();
	readonly coo: Coordinates = new Coordinates;

	offX: number = 0;

	constructor(
		private canvas: TileCanvas
	) {
		this.baseYaw = -this.canvas.rotationY;
		this.offX = this.baseYaw / PI2;

		if (this.canvas.is360) {
			this.scaleY = this.canvas.height / (this.canvas.width / 2);
			this.offY = (1 - this.scaleY) / 4;
		}
		this.yaw = this.baseYaw;
		this.update();
	}

	/** Sets the horizontal and vertical movement limits. */
	setLimits(x: number, y: number): void {
		this.limitX = x;
		this.limitY = y;
		this.maxPerspective = PIh;
		if (y > 0) this.maxPerspective = Math.min(this.maxPerspective, this.maxPerspective * y * 1.5);
		this.setPerspective(this.perspective, true);
	}

	/** Updates the projection and rotation matrices based on current state. */
	update(noPersp: boolean = false): void {
		const c = this.canvas;
		const el = c.el;

		if (!noPersp) this.pMatrix.perspective(this.perspective, el.aspect, 0.0001, c.is360 ? 20 : 100);
		this.inverseDirty = true;

		if (c.is360) {
			const pM = this.pMatrix;
			this.pitch = Math.min(PI / 2, Math.max(-PI / 2, this.pitch));
			pM.rotateX(this.pitch);
			pM.rotateY(this.yaw);
			pM.translate(this.position.x, this.position.y, this.position.z);

			const rM = this.rMatrix;
			rM.perspectiveCss(this.perspective);
			rM.translate(0, 0, el.height / el.ratio / 2);
			rM.rotateX(-this.pitch);
			rM.rotateY(this.yaw);

			this.coo.direction = (this.yaw / PI * 180) % 360;
		} else {
			const v = c.view;
			this.pMatrix.translate(
				-(v.centerX - .5) * c.aspect,
				v.centerY - .5,
				-v.height / 2
			);
		}

		this.pMatrix.toArray();
	}

	/**
	 * Applies rotation based on pixel delta from mouse/touch drag.
	 */
	rotate(xPx: number, yPx: number, duration: number, time: number): void {
		const c = this.canvas;
		const el = c.el;
		this.yaw += xPx * el.ratio / el.width * this.perspective * el.aspect;
		this.pitch += yPx * el.ratio / el.height * this.perspective * this.scaleY;

		this.yaw = modPI(this.yaw);

		if (c.coverLimit || this.limitY > 0) this.limitPitch();
		if (this.limitX > 0) this.limitYaw();

		if (duration === 0) c.kinetic.addStep(xPx * 2, yPx * 2, time);

		this.update();
		this.calculate3DFrustum();
		this.syncLogicalView();
	}

	/** Clamps the pitch value based on perspective and vertical limits. */
	private limitPitch(): void {
		const halfPerspective = this.perspective / 2;
		const maxPitch = PI * this.scaleY / 2 * (this.limitY > 0 ? this.limitY : 1);

		this.pitch = this.pitch > 0 ? Math.min(maxPitch, this.pitch + halfPerspective) - halfPerspective
			: Math.max(-maxPitch, this.pitch - halfPerspective) + halfPerspective;
	}

	/** Clamps the yaw value based on horizontal limits. */
	private limitYaw(): void {
		const halfHorizontalFov = this.perspective / 2 * this.canvas.el.aspect;
		const maxYaw = PI * (this.limitX > 0 ? this.limitX : 1);

		let y = this.yaw; while (y >= PI) y -= PI * 2; while (y < -PI) y += PI * 2;
		this.yaw = modPI(Math.min(Math.max(maxYaw, halfHorizontalFov) - halfHorizontalFov, Math.max(Math.min(-maxYaw, -halfHorizontalFov) + halfHorizontalFov, y)));
	}

	/**
	 * Applies zoom by adjusting the perspective.
	 */
	zoom(factor: number, dur: number, speed: number, noLimit: boolean, t: number, pxX: number = 0, pxY: number = 0): number {
		const c = this.canvas;
		factor /= 2;
		if (dur !== 0) {
			dur = c.ani.zoom(factor, dur, speed, noLimit, t);
		} else {
			factor /= this.scale * Math.sqrt(c.width * c.width + c.height * c.height) / 20;

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

				this.yaw += dx * PI * 2;
				this.pitch += dy * PI * this.scaleY;

				this.yaw = modPI(this.yaw);
				if (c.coverLimit || this.limitY > 0) this.limitPitch();
				if (this.limitX > 0) this.limitYaw();

				this.update();
				this.readScale();
				this.calculate3DFrustum();
				this.syncLogicalView();
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
		if (c.coverLimit || this.limitY > 0) this.limitPitch();
		if (this.limitX > 0) this.limitYaw();
		this.pMatrix.perspective(this.perspective, c.el.aspect, 0.0001, c.is360 ? 20 : 100);
		this.readScale();
		this.update(true);
		this.calculate3DFrustum();
		this.syncLogicalView();
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
	setDirection(yaw: number, pitch: number, persp: number): void {
		this.yaw = modPI(yaw - this.baseYaw);
		this.pitch = pitch;
		if (persp !== 0) this.setPerspective(persp, false);
		else this.update();
		this.calculate3DFrustum();
		this.syncLogicalView();
	}

	/** Sets the camera orientation using viewport format (center + dimensions). */
	setView(centerX: number, centerY: number, _width: number, height: number, noLimit: boolean = false, correctNorth: boolean = false): void {
		const adjustedCenterX = correctNorth ? centerX + this.offX : centerX;

		this.yaw = (adjustedCenterX - .5) * PI * 2;
		this.pitch = (centerY - .5) * PI * this.scaleY;
		this.setPerspective(Math.min(this.maxPerspective, height * PI * this.scaleY), noLimit);
		this.calculate3DFrustum();
		this.syncLogicalView();
	}

	/** Synchronizes the logical view with the current camera state for 360 images. */
	private syncLogicalView(): void {
		const c = this.canvas;
		if (!c.is360) return;

		const centerX = mod1((this.yaw / (PI * 2) + .5));
		const centerY = (this.pitch / this.scaleY) / PI + .5;
		const height = this.perspective / PI / this.scaleY;
		const width = height * (c.el.width === 0 ? 1 : .5 * Math.sqrt(c.el.aspect)) / (c.aspect / 2);

		c.view.set(centerX, centerY, width, height);
		c.view.changed = true;
	}

	/** Calculates 3D camera frustum for accurate 360 embed visibility detection */
	calculate3DFrustum(): void {
		if (!this.canvas.is360) return;

		const yaw = this.yaw;
		const pitch = this.pitch;

		this.cameraForwardX = Math.cos(pitch) * Math.sin(yaw);
		this.cameraForwardY = Math.sin(pitch);
		this.cameraForwardZ = Math.cos(pitch) * Math.cos(yaw);

		this.cameraUpX = -Math.sin(pitch) * Math.sin(yaw);
		this.cameraUpY = Math.cos(pitch);
		this.cameraUpZ = -Math.sin(pitch) * Math.cos(yaw);

		this.cameraRightX = Math.cos(yaw);
		this.cameraRightY = 0;
		this.cameraRightZ = -Math.sin(yaw);

		const verticalFOV = 2 * Math.atan(1 / this.perspective);
		this.aspectRatio = this.canvas.el.width / this.canvas.el.height;

		const halfVerticalFOV = verticalFOV / 2;
		const halfHorizontalFOV = Math.atan(Math.tan(halfVerticalFOV) * this.aspectRatio);
		this.fieldOfView = halfHorizontalFOV * 2;
	}

	/** Applies translation offset for 360 space transitions. */
	moveTo(distance: number, distanceY: number, direction: number, addYaw: number): void {
		const dir: number = direction * PI * 2 + addYaw;
		this.position.x = -distance * Math.sin(dir);
		this.position.y = distanceY;
		this.position.z = distance * Math.cos(dir);
		this.canvas.view.changed = true;
		this.update();
	}

	/** Handles canvas resize events for 360 mode. */
	resize(): void {
		const c = this.canvas;
		const el = c.el;
		c.camera.setCanvas();
		this.minPerspective = Math.min(.5, el.height / c.height) / c.maxScale * this.scaleY * PI / el.ratio * el.scale;
		this.setPerspective(this.perspective, true);
	}

	/** Ensures the cached inverse projection matrix is up to date. */
	private ensureInverse(): void {
		if (this.inverseDirty) {
			this.cachedInverse.copy(this.pMatrix);
			this.cachedInverse.invert();
			this.inverseDirty = false;
		}
	}

	/** Converts screen pixel coordinates to 360 image coordinates [0-1]. */
	getCoo(pxX: number, pxY: number): Coordinates {
		const el = this.canvas.el;
		this.vec4.x = (pxX * el.ratio / el.width) * 2 - 1;
		this.vec4.y = -((pxY * el.ratio / el.height) * 2 - 1);
		this.vec4.z = 1;
		this.vec4.w = 1;

		this.ensureInverse();
		this.vec4.transformMat4(this.cachedInverse);

		this.vec4.normalize();
		this.coo.x = Math.atan2(this.vec4.x, -this.vec4.z) / PI / 2 + .5;
		this.coo.y = .5 - Math.asin(this.vec4.y) / PI / this.scaleY;
		this.coo.scale = this.scale;
		this.coo.w = this.position.x + this.position.z;
		this.coo.direction = this.yaw + this.baseYaw;
		this.coo.toArray();

		return this.coo;
	}

	/** Converts 360 image coordinates [0-1] to screen pixel coordinates. */
	getXYZ(x: number, y: number): Coordinates {
		const el = this.canvas.el;
		this.getVec3(x + this.offX, y);

		this.coo.x = ((this.vec4.x + 1) / 2) * el.width / el.ratio;
		this.coo.y = ((-this.vec4.y + 1) / 2) * el.height / el.ratio;
		this.coo.scale = this.scale;
		this.coo.w = -this.vec4.w;
		this.coo.toArray();

		return this.coo;
	}

	/**
	 * Calculates the 3D vector corresponding to a point on the 360 sphere.
	 */
	getVec3(x: number, y: number, abs: boolean = false, rad: number = this.radius): Vec4 {
		x *= -PI * 2;
		y -= .5;
		y *= -PI;
		y *= this.scaleY;

		const cY = Math.cos(y);
		this.vec4.x = cY * Math.sin(x) * rad;
		this.vec4.y = Math.sin(y) * rad;
		this.vec4.z = cY * Math.cos(x) * rad;
		this.vec4.w = 1;

		if (!abs) this.vec4.transformMat4(this.pMatrix);

		return this.vec4;
	}

	/**
	 * Calculates the combined transformation matrix for placing an element
	 * at a specific point on the 360 sphere.
	 */
	getMatrix(x: number, y: number, scale: number, radius: number, rX: number, rY: number, rZ: number, transY: number, sX: number = 1, sY: number = 1, _noCorrectNorth: boolean = false): Mat4 {
		if (isNaN(radius)) radius = this.radius;

		this.iMatrix.identity();

		radius *= this.radius * (100 / PI2);

		x *= -PI * 2;
		y -= .5;
		y *= PI * this.scaleY;

		const cY = Math.cos(y);
		this.vec4.x = cY * Math.sin(x);
		this.vec4.y = Math.sin(y);
		this.vec4.z = cY * Math.cos(x);

		this.iMatrix.translate(
			this.position.x * radius / this.radius,
			-this.position.y * radius / this.radius + transY * this.radius,
			this.position.z * radius / this.radius
		);

		this.iMatrix.translate(
			this.vec4.x * radius,
			this.vec4.y * radius,
			this.vec4.z * radius
		);

		this.iMatrix.rotateY(Math.atan2(this.vec4.x, this.vec4.z) + PI + rY);
		this.iMatrix.rotateX(this.vec4.y + rX);
		this.iMatrix.rotateZ(rZ);

		this.iMatrix.scaleXY(sX, sY);

		this.iMatrix.scaleFlat(scale / PI / this.radius);

		this.iMatrix.multiply(this.rMatrix);

		return this.iMatrix;
	}

	/** Generates vertex data for a segment of the 360 sphere geometry. */
	setTile360(x: number, y: number, w: number, h: number): void {
		y *= this.scaleY; y /= 2; y -= .25; y += this.offY;
		h *= this.scaleY; h /= 2;

		const v = this.canvas.main.vertexBuffer360;
		const a = this.radius;
		const sW = w / segsX;
		const sH = h / segsY;
		const pi2 = PI * 2;

		for (let pY = 0; pY < segsY; pY++) {
			for (let pX = 0; pX < segsX; pX++) {
				const i = (pY * segsX + pX) * 6 * 3;
				const l = -(mod1(x + sW * pX + this.offX) * pi2);
				const t = -(y + sH * pY) * pi2;
				const r = -(mod1(x + sW * (pX + 1) + this.offX) * pi2);
				const b = -(y + sH * (pY + 1)) * pi2;
				let cL = Math.cos(l) * a; if (isNaN(cL)) cL = 0;
				let sL = Math.sin(l) * a; if (isNaN(sL)) sL = 0;
				let cR = Math.cos(r) * a; if (isNaN(cR)) cR = 0;
				let sR = Math.sin(r) * a; if (isNaN(sR)) sR = 0;
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
}
