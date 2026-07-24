/**
 * Handles 2D camera logic, view calculations, and user interactions like pan, zoom, pinch.
 * @author Marcel Duin <marcel@micr.io>
 * @internal
 */

import { Coordinates, Viewport } from './shared'
import { easeInOut } from './easing';
import { epsEq } from '$utils/math';
import { Mat4 } from './mat'
import EngineCamera from './engine-camera';
import type { TileCanvas } from './tile-canvas';

/** Handles 2D camera logic, view calculations, and user interactions like pan, zoom, pinch. @internal */
export default class Camera2D extends EngineCamera {
	/** @internal */
	_scale: number = 1.0;
	/** @internal */
	_minScale: number = 1.0;
	/** @internal */
	_minSize: number = 1.0;
	/** @internal */
	_maxScale: number = 1.0;
	#fullScale: number = 1.0;
	/** @internal */
	_coverScale: number = 1.0;

	readonly #xy: Coordinates = new Coordinates;
	readonly #coo: Coordinates = new Coordinates;
	readonly #startCoo: Coordinates = new Coordinates;

	#pinching: boolean = false;
	#inited: boolean = false;
	#hasStartCoo: boolean = false;
	readonly #omniMat: Mat4 = new Mat4;
	/** Width ratio (element width / image width). */
	cpw: number = -1;
	/** Height ratio (element height / image height). */
	cph: number = -1;
	#wasCoverLimit: boolean = true;

	constructor(
		canvas: TileCanvas
	) {
		super(canvas);
	}

	/**
	 * Converts screen pixel coordinates to relative image coordinates [0-1].
	 * @internal
	 */
	_getCoo(x: number, y: number, abs: boolean, noLimit: boolean): Coordinates {
		const c = this.canvas;
		if (c._noImage || c._freeMove)
			noLimit = true;

		const el = c.el;
		const r = c._hasParent ? c.parent.el.ratio : el.ratio;
		const v = c.view;
		const coo = this.#coo;

		if (abs) {
			x -= el.left;
			y -= el.top;
		}

		const rX = (x / this._scale * r) / c.width + v.x0;
		const rY = (y / this._scale * r) / c.height + v.y0;

		coo.x = noLimit ? rX : Math.max(v.lX0, Math.min(v.lX1, rX));
		coo.y = noLimit ? rY : Math.max(v.lY0, Math.min(v.lY1, rY));
		coo.scale = this._scale;
		coo._toArray();

		return this.#coo;
	}

	/**
	 * Converts relative image coordinates [0-1] to screen pixel coordinates.
	 * @internal
	 */
	_getXY(x: number, y: number, abs: boolean): Coordinates {
		const c = this.canvas;
		const el = c.el;
		const rat = c._hasParent ? c.parent.el.ratio : el.ratio;
		const xy = this.#xy;
		xy.x = ((x - c.view.x0) * c.width) * this._scale / rat + (abs ? el.left : 0);
		xy.y = ((y - c.view.y0) * c.height) * this._scale / rat + (abs ? el.top : 0);
		xy.scale = this._scale / rat;
		xy._toArray();
		return xy;
	}

	/** @internal */
	_getXYOmni(x: number, y: number, radius: number, rotation: number, abs: boolean): Coordinates {
		return this._getXYOmniCoo(x - .5, y - .5, radius, rotation, abs);
	}

	/**
	 * Converts 3D coordinates relative to an omni object's center to screen pixel coordinates.
	 * @internal
	 */
	_getXYOmniCoo(x: number, y: number, z: number, rotation: number = 0, abs: boolean = false): Coordinates {
		const c = this.canvas;
		const el = c.el;
		const mat = this.#omniMat, vec4 = c._camera360._vec4;
		const rat = c._hasParent ? c.parent.el.ratio : el.ratio;

		vec4.x = x;
		vec4.y = y;
		vec4.z = z;
		vec4.w = 1;

		mat._identity();

		if (!abs && c._omniFieldOfView) mat._perspective(c._omniFieldOfView, c.aspect, 0.0001, 100);
		if (c._omniDistance) mat._translate(0, 0, c._omniDistance);
		if (c._omniOffsetX) mat._translate(c._omniOffsetX, 0, 0);
		if (!abs && c._omniVerticalAngle) mat._rotateX(c._omniVerticalAngle);

		const numPerLayer = c.images.length / c._omniNumLayers;
		const offset = c.layer * numPerLayer;
		const currRot = (c.images.length > 0 ? -(c._activeImageIdx + 1 - offset) / (numPerLayer) * 2 * Math.PI : 0);
		mat._rotateY(rotation + currRot);

		vec4._transformMat4(mat);

		const xy = this.#xy;

		xy.x = ((.5 + vec4.x - c.view.x0) * c.width) * this._scale / rat + (abs ? el.left : 0);
		xy.y = ((.5 + vec4.y - c.view.y0) * c.height) * this._scale / rat + (abs ? el.top : 0);
		xy.w = -vec4.w - c._omniDistance;
		xy._toArray();
		return xy;
	}

	/** Recalculates scale limits (minScale, maxScale, coverScale, fullScale) based on current canvas and image dimensions. @internal */
	_setCanvas(): void {
		const c = this.canvas;
		const el = c.el;

		const cpw = el.width / c.width;
		const cph = el.height / c.height;

		if (!c.view._limitChanged && this.cpw === cpw && this.cph === cph) {
			if (c._coverLimit !== this.#wasCoverLimit) this._correctMinMax();
			return;
		}

		this.cpw = cpw;
		this.cph = cph;

		this.#fullScale = Math.min(cpw, cph);
		this._coverScale = Math.max(cpw, cph);

		const lRat = c.view._lWidth / c.view._lHeight;
		c.view._limitChanged = false;
		if (c.view._lWidth < 1 || c.view._lHeight < 1) {
			const rat = cpw / cph;
			if (lRat < rat) this._coverScale /= c.view._lWidth / rat;
			else this._coverScale /= c.view._lHeight * rat;
		}

		this._correctMinMax();

		if (el.width && el.height && !this.canvas._ani._isStarted()) {
			c.view._copy(c._ani._lastView, true);
			if (!c.is360) {
				const pLimit = c._ani._limit;
				c._ani._limit = false;
				this._applyView();
				c._ani._limit = pLimit;
			}
		}
	}

	/** Corrects minScale and maxScale based on coverLimit and focus area. @internal */
	_correctMinMax(noLimit: boolean = false): void {
		const c = this.canvas;
		this._minScale = c._coverLimit ? this._coverScale : this.#fullScale;

		if (!noLimit && !c.main._isSwipe && (c._activeImageIdx === 0 && !c._coverLimit || c._activeImageIdx > 0 && !c._coverLimit)) {
			const aW = c.focus.width * c.width, aH = c.focus.height * c.height;
			const cW = c.el.width, cH = c.el.height;
			this._minScale = cW / cH > aW / aH ? cH / aH : cW / aW;
		}

		this._maxScale = this._minScale > 1 && c.maxScale < this._minScale ? this._minScale : Math.max(this._minScale, (c.maxScale * c._scaleMultiplier) / c.el.scale);
		this.#wasCoverLimit = c._coverLimit;
	}

	/** Checks if the current scale is below the minimum allowed scale (considering minSize margin). @internal */
	_isUnderZoom(): boolean { return this._minSize < 1 && this._scale < this._minScale };
	/** Checks if the camera is fully zoomed out (at or below minScale, considering minSize margin). @internal */
	_isZoomedOut(b: boolean = false): boolean { return epsEq(this._scale, this._minScale * (b ? this._minSize : 1)) || this._scale <= this._minScale * (b ? this._minSize : 1); }
	/** Checks if the camera is zoomed in to the maximum allowed scale or beyond. @internal */
	_isZoomedIn(): boolean { return epsEq(this._scale, this._maxScale) || this._scale >= this._maxScale; }

	/**
	 * Recalculates scale and applies view constraints from the current logical view.
	 * @internal
	 * @returns True if the view was successfully applied, false if initialization is pending.
	 */
	_applyView(): boolean {
		if (this.cpw === -1) return false;
		const c = this.canvas;
		const v = this.canvas.view;

		const limited = !c._freeMove && c._ani._limit;

		if (!c._ani._correcting && (limited || (!c._ani._flying && c._coverLimit))) v._limit(false);

		const vw: number = v.width;
		const vh: number = v.height;
		const cw = this.cpw;
		const ch = this.cph;

		this._scale = Math.min(cw / vw, ch / vh);

		if (limited && !this.#pinching && this._scale >= this._maxScale && c._ani._flying) this._scale = this._maxScale;

		if ((!c._ani._correcting && !this.#pinching) || c._coverLimit) this._scale = Math.max(this._minScale * this._minSize, this._scale);

		if (!this.#inited && c._coverStart) this._scale = this._coverScale;

		const overflowX: number = (cw / this._scale - vw);
		const overflowY: number = (ch / this._scale - vh);

		v.set(v._centerX, v._centerY, v.width + overflowX, v.height + overflowY);

		if (!this.#inited && c._coverStart) this.canvas._ani._lastView._copy(v);

		if (!c._ani._correcting && c._coverLimit) v._limit(false);

		this.#inited = this.cpw > 0;

		if (this.#hasStartCoo) {
			this.#hasStartCoo = false;
			this.setCoo(this.#startCoo.x, this.#startCoo.y, this.#startCoo.scale);
			return false;
		}
		return true;
	}

	/** Checks if the current view extends beyond the defined limits or max scale. @internal */
	_isOutsideLimit(): boolean {
		const v = this.canvas.view;
		return !this.canvas._freeMove && (
			(!epsEq(v.x0, v.lX0) && v.x0 < v.lX0) !== (!epsEq(v.x1, v.lX1) && v.x1 > v.lX1)
			|| (!epsEq(v.y0, v.lY0) && v.y0 < v.lY0) !== (!epsEq(v.y1, v.lY1) && v.y1 > v.lY1)
			|| (!epsEq(this._scale, this._maxScale) && this._scale > this._maxScale)
		);
	}

	/**
	 * Pans the view by a given pixel delta.
	 * @internal
	 */
	_pan(xPx: number, yPx: number, duration: number = 0, noLimit: boolean = false, force: boolean = false, isKinetic: boolean = false): void {
		const c = this.canvas;

		if ((this._isUnderZoom() || this.#pinching) && !force) return;

		if (this.canvas._freeMove) noLimit = true;

		const r = c._hasParent ? c.parent.el.ratio : c.el.ratio;
		const v = c.view;

		const dX: number = xPx / c.width / this._scale * r;
		const dY: number = yPx / c.height / this._scale * r;

		const newCenterX = v._centerX + dX;
		const newCenterY = v._centerY + dY;
		const viewWidth = v.width;
		const viewHeight = v.height;

		if (this.#pinching) {
			c.view.set(newCenterX, newCenterY, viewWidth, viewHeight);
			c._setView(newCenterX, newCenterY, viewWidth, viewHeight, noLimit, false, false, false);
		} else if (!force && this._isOutsideLimit() && !isKinetic) {
			if (c._ani._isStarted()) {
				c._ani._updateTarget(newCenterX, newCenterY, v.width, v.height, true);
			} else {
				c._ani._toView(newCenterX, newCenterY, viewWidth, viewHeight, 150, easeInOut, { limitViewport: !noLimit && !this.#pinching, correct: !noLimit });
			}
		} else {
			c._ani.stop();

			if (duration === 0) {
				if (!isKinetic) c._kinetic.addStep(xPx * 4, yPx * 4);
				c.view.set(newCenterX, newCenterY, viewWidth, viewHeight);
				if (!noLimit) {
					c.view._limit(false, false, c._freeMove);
				}
				c._setView(newCenterX, newCenterY, viewWidth, viewHeight, noLimit, false, false, isKinetic);
				c.view._changed = true;
			} else {
				c._ani._toView(newCenterX, newCenterY, viewWidth, viewHeight, duration, easeInOut);
			}
		}
	}

	/**
	 * Zooms the view by a given delta, centered on screen coordinates.
	 * @internal
	 * @returns The calculated animation duration.
	 */
	_zoom(delta: number, xPx: number, yPx: number, duration: number = 0, noLimit: boolean): number {
		const c = this.canvas;

		c._kinetic.stop();

		if (!this.#pinching && this._isZoomedIn() && delta < 0) return 0;

		if (this.canvas._freeMove) noLimit = true;

		if (delta > 0 && this._isZoomedOut() && this._minSize >= 1 && (!this.#pinching || c._coverLimit)) return 0;

		const el = c.el;
		const v = c.view;

		const ratio: number = (this.cpw / this.cph);
		let fact: number = delta * (el.width / 512) / c.width / this._scale;
		let factY: number = fact / ratio;

		if (delta < 0 && fact < -1) fact = -.9999;
		if (delta < 0 && factY < -1) factY = -.9999;

		const limit = !noLimit && !c._freeMove && c._ani._limit && duration === 0;
		const r = c._hasParent ? c.parent.el.ratio : el.ratio;

		xPx -= el.left;
		yPx -= el.top;
		const uZ = this._isUnderZoom();
		const pX: number = xPx > 0 && !uZ ? xPx / el.width * r : .5;
		const pY: number = yPx > 0 && !uZ ? yPx / el.height * r : .5;

		const targetCenterX = v._centerX + fact * (0.5 - pX);
		const targetCenterY = v._centerY + factY * (0.5 - pY);
		const targetWidth = v.width + fact;
		const targetHeight = v.height + factY;

		c._ani._limit = limit;
		duration = c._ani._toView(targetCenterX, targetCenterY, targetWidth, targetHeight, duration, easeInOut, { limitViewport: !noLimit && !this.#pinching, correct: limit });
		c._ani._lastView._copy(c.view);
		c._ani._limit = !noLimit;

		return duration;
	}

	/** @internal */
	protected _handlePinchMove(delta: number, dX: number, dY: number, cX: number, cY: number, el: Viewport, c: TileCanvas): void {
		if (!this.canvas.main._noPinchPan && this._scale > this._minScale) this._pan(dX, dY, 0, false, true);
		this._zoom(delta * 2 * el.scale, cX, cY, 0, !this.canvas._pinchZoomOutLimit);
		c._ani._limit = !!this.canvas._pinchZoomOutLimit;
	}

	/** Signals the start of a pinch gesture. @internal */
	_pinchStart(): void {
		this.#pinching = true;
	}

	/** Signals the end of a pinch gesture. @internal */
	_pinchStop(): void {
		this.#snapToBounds();
		this.#pinching = false;
		super._pinchStop();
	}

	#snapToBounds(): void {
		if (this.canvas._freeMove) return;

		const v = this.canvas.view;
		const isOverzoomed = this._scale > this._maxScale;

		const targetWidth = isOverzoomed ? this.cpw / this._maxScale : v.width;
		const targetHeight = isOverzoomed ? this.cph / this._maxScale : v.height;

		const halfW = targetWidth / 2;
		const halfH = targetHeight / 2;
		const lHalfW = v._lWidth / 2;
		const lHalfH = v._lHeight / 2;

		const targetCenterX = halfW >= lHalfW
			? v._lCenterX
			: Math.max(v.lX0 + halfW, Math.min(v._centerX, v.lX1 - halfW));
		const targetCenterY = halfH >= lHalfH
			? v._lCenterY
			: Math.max(v.lY0 + halfH, Math.min(v._centerY, v.lY1 - halfH));

		this.canvas._ani._toView(targetCenterX, targetCenterY, targetWidth, targetHeight, 150, easeInOut, { correct: true });
	}

	// ─── SetCoo hooks ──────────────────────────────────────────────

	/** @internal */
	protected _handleSetCooInit(x: number, y: number, scale: number): boolean {
		if (!this.#inited) {
			this.#hasStartCoo = true;
			const coo = this.#startCoo;
			coo.x = x;
			coo.y = y;
			coo.scale = scale;
			this._applyView();
			return true;
		}
		return false;
	}

	/** @internal */
	protected _clampSetCooScale(scale: number): number {
		return Math.max(this._minScale, scale);
	}

	/** @internal */
	protected _setCooDim(scale: number): { w: number; h: number } {
		return { w: (1 / scale) * this.cpw, h: (1 / scale) * this.cph };
	}

	/** @internal */
	protected _beforeSetCooAnimate(x: number, y: number, w: number, h: number, dur: number): void {
		if (dur === 0) {
			if (x + w / 2 > 1) x = 1 - w / 2;
			if (x - w / 2 < 0) x = w / 2;
			if (y + h / 2 > 1) y = 1 - h / 2;
			if (y - h / 2 < 0) y = h / 2;
		}
	}

	// ─── 360 camera compat stubs (for union with Camera360) ─────────
	/** @internal */
	_yaw: number = 0;
	/** @internal */
	_pitch: number = 0;

	/** Updates the projection matrix for 2D rendering (delegates to Camera360.pMatrix). @internal */
	_updateProjection(): void {
		const c = this.canvas;
		const v = c.view;
		const cam = c._camera360;
		const m = cam._pMatrix;
		m._perspective(cam._perspective, c.el._aspect, 0.0001, 100);
		m._translate(
			-(v._centerX - .5) * c.aspect,
			v._centerY - .5,
			-v.height / 2
		);
	}
}
