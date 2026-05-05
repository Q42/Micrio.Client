/**
 * Handles 2D camera logic, view calculations, and user interactions like pan, zoom, pinch.
 * @author Marcel Duin <marcel@micr.io>
 */

import { Coordinates } from './shared'
import { PI } from './globals'
import { longitudeDistance } from './utils';
import type { default as Canvas } from './canvas';

/** Handles 2D camera logic, view calculations, and user interactions like pan, zoom, pinch. */
export default class Camera {
	scale: number = 1.0;
	minScale: number = 1.0;
	minSize: number = 1.0;
	maxScale: number = 1.0;
	fullScale: number = 1.0;
	coverScale: number = 1.0;

	readonly xy: Coordinates = new Coordinates;
	readonly coo: Coordinates = new Coordinates;
	private readonly startCoo: Coordinates = new Coordinates;

	private pinching: boolean = false;
	private inited: boolean = false;
	private hasStartCoo: boolean = false;
	cpw: number = -1;
	cph: number = -1;
	private wasCoverLimit: boolean = true;

	constructor(
		private canvas: Canvas
	) {
		if (canvas.is360) this.inited = true;
	}

	/**
	 * Converts screen pixel coordinates to relative image coordinates [0-1].
	 */
	getCoo(x: number, y: number, abs: boolean, noLimit: boolean): Coordinates {
		const c = this.canvas;
		if (c.noImage || c.freeMove)
			noLimit = true;

		const el = c.el;
		const r = c.hasParent ? c.parent.el.ratio : el.ratio;

		if (abs) {
			x -= el.left;
			y -= el.top;
		}

		const rX = (x / this.scale * r) / c.width + c.view.x0;
		const rY = (y / this.scale * r) / c.height + c.view.y0;

		this.coo.x = noLimit ? rX : Math.max(c.view.lX0, Math.min(c.view.lX1, rX));
		this.coo.y = noLimit ? rY : Math.max(c.view.lY0, Math.min(c.view.lY1, rY));
		this.coo.scale = this.scale;
		this.coo.toArray();

		return this.coo;
	}

	/**
	 * Converts relative image coordinates [0-1] to screen pixel coordinates.
	 */
	getXY(x: number, y: number, abs: boolean): Coordinates {
		const c = this.canvas;
		const el = c.el;
		const rat = c.hasParent ? c.parent.el.ratio : el.ratio;
		this.xy.x = ((x - c.view.x0) * c.width) * this.scale / rat + (abs ? el.left : 0);
		this.xy.y = ((y - c.view.y0) * c.height) * this.scale / rat + (abs ? el.top : 0);
		this.xy.scale = this.scale / rat;
		this.xy.toArray();
		return this.xy;
	}

	getXYOmni(x: number, y: number, radius: number, rotation: number, abs: boolean): Coordinates {
		return this.getXYOmniCoo(x - .5, y - .5, radius, rotation, abs);
	}

	/**
	 * Converts 3D coordinates relative to an omni object's center to screen pixel coordinates.
	 */
	getXYOmniCoo(x: number, y: number, z: number, rotation: number, abs: boolean): Coordinates {
		const c = this.canvas;
		const el = c.el;
		const mat = c.webgl.pMatrix, vec4 = c.webgl.vec4;
		const rat = c.hasParent ? c.parent.el.ratio : el.ratio;

		vec4.x = x;
		vec4.y = y;
		vec4.z = z;
		vec4.w = 1;

		mat.identity();

		if (!abs && c.omniFieldOfView) mat.perspective(c.omniFieldOfView, c.aspect, 0.0001, 100);
		if (c.omniDistance) mat.translate(0, 0, c.omniDistance);
		if (c.omniOffsetX) mat.translate(c.omniOffsetX, 0, 0);
		if (!abs && c.omniVerticalAngle) mat.rotateX(c.omniVerticalAngle);

		const numPerLayer = c.images.length / c.omniNumLayers;
		const offset = c.layer * numPerLayer;
		const currRot = (c.images.length > 0 ? -(c.activeImageIdx + 1 - offset) / (numPerLayer) * 2 * PI : 0);
		mat.rotateY(rotation + currRot);

		vec4.transformMat4(mat);

		this.xy.x = ((.5 + vec4.x - c.view.x0) * c.width) * this.scale / rat + (abs ? el.left : 0);
		this.xy.y = ((.5 + vec4.y - c.view.y0) * c.height) * this.scale / rat + (abs ? el.top : 0);
		this.xy.w = -vec4.w - c.omniDistance;
		this.xy.toArray();
		return this.xy;
	}

	/** Recalculates scale limits (minScale, maxScale, coverScale, fullScale) based on current canvas and image dimensions. */
	setCanvas(): void {
		const c = this.canvas;
		const el = c.el;

		const cpw = el.width / c.width;
		const cph = el.height / c.height;

		if (!c.view.limitChanged && this.cpw === cpw && this.cph === cph) {
			if (c.coverLimit !== this.wasCoverLimit) this.correctMinMax();
			return;
		}

		this.cpw = cpw;
		this.cph = cph;

		this.fullScale = Math.min(cpw, cph);
		this.coverScale = Math.max(cpw, cph);

		const lRat = c.view.lWidth / c.view.lHeight;
		c.view.limitChanged = false;
		if (c.view.lWidth < 1 || c.view.lHeight < 1) {
			const rat = cpw / cph;
			if (lRat < rat) this.coverScale /= c.view.lWidth / rat;
			else this.coverScale /= c.view.lHeight * rat;
		}

		this.correctMinMax();

		if (el.width && el.height && !this.canvas.ani.isStarted()) {
			c.view.copy(c.ani.lastView, true);
			if (!c.is360) {
				const pLimit = c.ani.limit;
				c.ani.limit = false;
				this.setView();
				c.ani.limit = pLimit;
			}
		}
	}

	/** Corrects minScale and maxScale based on coverLimit and focus area. */
	correctMinMax(noLimit: boolean = false): void {
		const c = this.canvas;
		this.minScale = c.coverLimit ? this.coverScale : this.fullScale;

		if (!noLimit && !c.main.isSwipe && (c.activeImageIdx === 0 && !c.coverLimit || c.activeImageIdx > 0)) {
			const aW = c.focus.width * c.width, aH = c.focus.height * c.height;
			const cW = c.el.width, cH = c.el.height;
			this.minScale = cW / cH > aW / aH ? cH / aH : cW / aW;
		}

		this.maxScale = this.minScale > 1 && c.maxScale < this.minScale ? this.minScale : Math.max(this.minScale, (c.maxScale * c.scaleMultiplier) / c.el.scale);
		this.wasCoverLimit = c.coverLimit;
	}

	/** Checks if the current scale is below the minimum allowed scale (considering minSize margin). */
	isUnderZoom(): boolean { return this.minSize < 1 && this.scale < this.minScale };
	/** Checks if the camera is fully zoomed out (at or below minScale, considering minSize margin). */
	isZoomedOut(b: boolean = false): boolean { return Math.trunc((this.scale - this.minScale * (b ? this.minSize : 1)) * 1e6) / 1e6 <= 0; }
	/** Checks if the camera is fully zoomed in (at or above maxScale). */
	isZoomedIn(): boolean { return (this.scale / this.maxScale) >= 1; }

	/**
	 * Calculates and sets the current camera scale and view offsets based on the logical view rectangle.
	 * @returns True if the view was successfully set, false if initialization is pending.
	 */
	setView(): boolean {
		if (this.cpw === -1) return false;
		const c = this.canvas;
		const v = this.canvas.view;

		const limited = !c.freeMove && c.ani.limit;

		if (!c.ani.correcting && (limited || (!c.ani.flying && c.coverLimit))) v.limit(false);

		const vw: number = v.width;
		const vh: number = v.height;
		const cw = this.cpw;
		const ch = this.cph;

		this.scale = Math.min(cw / vw, ch / vh);

		if (limited && !this.pinching && this.isZoomedIn() && c.ani.flying) this.scale = this.maxScale;

		if ((!c.ani.correcting && !this.pinching) || c.coverLimit) this.scale = Math.max(this.minScale * this.minSize, this.scale);

		if (!this.inited && c.coverStart) this.scale = this.coverScale;

		const overflowX: number = (cw / this.scale - vw);
		const overflowY: number = (ch / this.scale - vh);

		v.set(v.centerX, v.centerY, v.width + overflowX, v.height + overflowY);

		if (!this.inited && c.coverStart) this.canvas.ani.lastView.copy(v);

		if (!c.ani.correcting && c.coverLimit) v.limit(false);

		this.inited = this.cpw > 0;

		v.toArray();

		if (this.hasStartCoo) {
			this.hasStartCoo = false;
			this.setCoo(this.startCoo.x, this.startCoo.y, this.startCoo.scale, 0, 0, false, 0, 0);
			return false;
		}
		return true;
	}

	/** Checks if the current view extends beyond the defined limits or max scale. */
	isOutsideLimit(): boolean {
		const v = this.canvas.view;
		return !this.canvas.freeMove && (
			(Math.trunc((v.x0 - v.lX0) * 1e6) / 1e6 < 0) !== (Math.trunc((v.x1 - v.lX1) * 1e6) / 1e6 > 0)
			|| (Math.trunc((v.y0 - v.lY0) * 1e6) / 1e6 < 0) !== (Math.trunc((v.y1 - v.lY1) * 1e6) / 1e6 > 0)
			|| Math.trunc((this.scale - this.maxScale) * 1e6) / 1e6 > 0
		);
	}

	/**
	 * Pans the view by a given pixel delta.
	 */
	pan(xPx: number, yPx: number, duration: number, noLimit: boolean, time: number, force: boolean = false, isKinetic: boolean = false): void {
		if ((this.isUnderZoom() || this.pinching) && !force) return;

		if (this.canvas.freeMove) noLimit = true;

		const c = this.canvas;
		const r = c.hasParent ? c.parent.el.ratio : c.el.ratio;
		const v = c.view;

		const dX: number = xPx / c.width / this.scale * r;
		const dY: number = yPx / c.height / this.scale * r;

		const newCenterX = v.centerX + dX;
		const newCenterY = v.centerY + dY;
		const viewWidth = v.width;
		const viewHeight = v.height;

		if (this.pinching) {
			c.view.set(newCenterX, newCenterY, viewWidth, viewHeight);
			c.setView(newCenterX, newCenterY, viewWidth, viewHeight, noLimit, false, false, false);
		} else if (!force && this.isOutsideLimit() && !isKinetic) {
			c.ani.toView(newCenterX, newCenterY, viewWidth, viewHeight, duration || 150, 0, 0, false, false, -1, 0, time, !noLimit);
		} else {
			c.ani.stop();

			if (duration === 0) {
				if (!isKinetic) c.kinetic.addStep(xPx * 4, yPx * 4, time);
				c.view.set(newCenterX, newCenterY, viewWidth, viewHeight);
				if (!noLimit) {
					c.view.limit(false, false, c.freeMove);
				}
				c.setView(newCenterX, newCenterY, viewWidth, viewHeight, noLimit, false, false, isKinetic);
				c.view.changed = true;
			} else {
				c.ani.toView(newCenterX, newCenterY, viewWidth, viewHeight, duration, 0, 0, false, false, -1, 0, time);
			}
		}
	}

	/**
	 * Zooms the view by a given delta, centered on screen coordinates.
	 * @returns The calculated animation duration.
	 */
	zoom(delta: number, xPx: number, yPx: number, duration: number, noLimit: boolean, time: number): number {
		if (!this.pinching && this.isZoomedIn() && delta < 0) return 0;
		const c = this.canvas;

		if (this.canvas.freeMove) noLimit = true;

		if (delta > 0 && this.isZoomedOut() && this.minSize >= 1 && (!this.pinching || c.coverLimit)) return 0;

		const el = c.el;
		const v = c.view;

		const ratio: number = (this.cpw / this.cph);
		let fact: number = delta * (el.width / 512) / c.width / this.scale;
		let factY: number = fact / ratio;

		if (delta < 0 && fact < -1) fact = -.9999;
		if (delta < 0 && factY < -1) factY = -.9999;

		const limit = !noLimit && !c.freeMove && c.ani.limit && duration === 0;
		const r = c.hasParent ? c.parent.el.ratio : el.ratio;

		xPx -= el.left;
		yPx -= el.top;
		const uZ = this.isUnderZoom();
		const pX: number = xPx > 0 && !uZ ? xPx / el.width * r : .5;
		const pY: number = yPx > 0 && !uZ ? yPx / el.height * r : .5;

		const targetCenterX = v.centerX + fact * (0.5 - pX);
		const targetCenterY = v.centerY + factY * (0.5 - pY);
		const targetWidth = v.width + fact;
		const targetHeight = v.height + factY;

		c.ani.limit = limit;
		duration = c.ani.toView(targetCenterX, targetCenterY, targetWidth, targetHeight, duration, 0, 0, false, !noLimit && !this.pinching, -1, 0, time, limit);
		c.ani.lastView.copy(c.view);
		c.ani.limit = !noLimit;

		return duration;
	}

	prevSize: number = -1;
	prevCenterX: number = -1;
	prevCenterY: number = -1;

	/** Handles pinch gesture updates. */
	pinch(xPx1: number, yPx1: number, xPx2: number, yPx2: number): void {
		const c = this.canvas;
		const el = c.main.el;

		const left = (Math.min(xPx1, xPx2) - el.left) / el.scale;
		const top = (Math.min(yPx1, yPx2) - el.top) / el.scale;
		const right = (Math.max(xPx1, xPx2) - el.left) / el.scale;
		const bottom = (Math.max(yPx1, yPx2) - el.top) / el.scale;

		const cX = left + (right - left) / 2;
		const cY = top + (bottom - top) / 2;
		const size: number = Math.max(right - left, bottom - top);

		const delta = this.prevSize - size;

		c.kinetic.stop();

		if (this.prevCenterX > 0) {
			const dX = this.prevCenterX - cX;
			const dY = this.prevCenterY - cY;

			if (c.is360) {
				c.webgl.zoom(delta * 2, 0, 0, false, 1);
				c.webgl.rotate(dX, dY, 0, 0);
			}
			else {
				if (!this.canvas.main.noPinchPan && this.scale > this.minScale) this.pan(dX, dY, 0, false, 0, true);
				this.zoom(delta * 2 * el.scale, cX, cY, 0, !this.canvas.pinchZoomOutLimit, 0);
				c.ani.limit = !!this.canvas.pinchZoomOutLimit;
			}
		}
		else c.ani.stop();

		this.prevCenterX = cX;
		this.prevCenterY = cY;
		this.prevSize = size;
	}

	/** Signals the start of a pinch gesture. */
	pinchStart(): void {
		this.pinching = true;
	}

	/** Signals the end of a pinch gesture. */
	pinchStop(time: number): void {
		if (!this.canvas.is360) this.snapToBounds(time);

		this.prevSize = -1;
		this.prevCenterX = -1;
		this.prevCenterY = -1;
		this.pinching = false;
	}

	private snapToBounds(time: number): void {
		if (this.canvas.freeMove) return;

		const v = this.canvas.view;
		const isOverzoomed = this.scale > this.maxScale;

		const targetWidth = isOverzoomed ? this.cpw / this.maxScale : v.width;
		const targetHeight = isOverzoomed ? this.cph / this.maxScale : v.height;

		const halfW = targetWidth / 2;
		const halfH = targetHeight / 2;
		const lHalfW = v.lWidth / 2;
		const lHalfH = v.lHeight / 2;

		const targetCenterX = halfW >= lHalfW
			? v.lCenterX
			: Math.max(v.lX0 + halfW, Math.min(v.centerX, v.lX1 - halfW));
		const targetCenterY = halfH >= lHalfH
			? v.lCenterY
			: Math.max(v.lY0 + halfH, Math.min(v.centerY, v.lY1 - halfH));

		this.canvas.ani.toView(targetCenterX, targetCenterY, targetWidth, targetHeight, 150, 0, 0, false, false, -1, 0, time, true);
	}

	/**
	 * Initiates a fly-to animation to a target view rectangle.
	 * @returns The calculated animation duration.
	 */
	flyTo(centerX: number, centerY: number, width: number, height: number, dur: number, speed: number, perc: number, isJump: boolean, limit: boolean, limitZoom: boolean, toOmniIdx: number, fn: number, time: number): number {
		const c = this.canvas;
		const a = c.ani;
		c.kinetic.stop();

		let adjustedCenterX = centerX;
		if (c.is360) {
			const currentCenterX = c.view.centerX;
			const longitudeDist = longitudeDistance(currentCenterX, centerX);
			adjustedCenterX = currentCenterX + longitudeDist;
		}

		a.limit = false;
		dur = a.toView(adjustedCenterX, centerY, width, height, dur, speed, perc, isJump, limit, toOmniIdx, fn, time, limitZoom);
		a.limit = false;
		a.flying = true;
		return dur;
	}

	/**
	 * Sets the view center and scale, optionally animating.
	 * @returns The calculated animation duration.
	 */
	setCoo(x: number, y: number, scale: number, dur: number, speed: number, limit: boolean, fn: number, time: number): number {
		if (!this.inited) {
			this.hasStartCoo = true;
			this.startCoo.x = x;
			this.startCoo.y = y;
			this.startCoo.scale = scale;
			this.setView();
			return 0;
		}

		const c = this.canvas;
		const is360 = c.is360;

		if (scale === 0 || (!is360 && isNaN(scale))) scale = c.getScale();

		if (!is360) scale = Math.max(this.minScale, scale);

		c.kinetic.stop();

		const w: number = isNaN(scale) && is360 ? c.view.width : (1 / scale) * this.cpw;
		const h: number = isNaN(scale) && is360 ? c.view.height : (1 / scale) * this.cph;

		if (dur === 0 && !is360) {
			if (x + w / 2 > 1) x = 1 - w / 2;
			if (x - w / 2 < 0) x = w / 2;
			if (y + h / 2 > 1) y = 1 - h / 2;
			if (y - h / 2 < 0) y = h / 2;
		}

		dur = c.ani.toView(x, y, w, h, dur, speed, 0, false, false, -1, fn, time);

		c.ani.limit = dur === 0 || limit;
		c.ani.flying = dur > 0;

		return dur;
	}
}
