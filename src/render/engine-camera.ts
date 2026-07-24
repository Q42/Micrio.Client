/**
 * Abstract base class for camera implementations (2D and 360).
 * Provides shared pinch mechanics and the common camera interface.
 * @internal
 */

import { Coordinates, Viewport } from './shared'
import { Bicubic, easeInOut } from './easing';
import type { TileCanvas } from './tile-canvas';

export default abstract class EngineCamera {
	protected readonly canvas: TileCanvas;

	/** Shared pinch state. */
	#prevSize: number = -1;
	#prevCenterX: number = -1;
	#prevCenterY: number = -1;

	constructor(canvas: TileCanvas) {
		this.canvas = canvas;
	}

	// ─── Properties (declared by subclasses) ───
	abstract _scale: number;
	abstract _yaw: number;
	abstract _pitch: number;
	abstract _minScale: number;
	abstract _maxScale: number;
	abstract _coverScale: number;
	abstract _minSize: number;

	// ─── Shared pinch implementation ───

	_pinch(xPx1: number, yPx1: number, xPx2: number, yPx2: number): void {
		const c = this.canvas;
		const el = c.main.el;

		const left = (Math.min(xPx1, xPx2) - el.left) / el.scale;
		const top = (Math.min(yPx1, yPx2) - el.top) / el.scale;
		const right = (Math.max(xPx1, xPx2) - el.left) / el.scale;
		const bottom = (Math.max(yPx1, yPx2) - el.top) / el.scale;

		const cX = left + (right - left) / 2;
		const cY = top + (bottom - top) / 2;
		const size: number = Math.max(right - left, bottom - top);
		const delta = this.#prevSize - size;

		c._kinetic.stop();

		if (this.#prevCenterX > 0) {
			const dX = this.#prevCenterX - cX;
			const dY = this.#prevCenterY - cY;
			this._handlePinchMove(delta, dX, dY, cX, cY, el, c);
		} else c._ani.stop();

		this.#prevCenterX = cX;
		this.#prevCenterY = cY;
		this.#prevSize = size;
	}

	_pinchStart(): void {}

	_pinchStop(): void {
		this.#resetPinchState();
	}

	#resetPinchState(): void {
		this.#prevSize = -1;
		this.#prevCenterX = -1;
		this.#prevCenterY = -1;
	}

	protected abstract _handlePinchMove(delta: number, dX: number, dY: number, cX: number, cY: number, el: Viewport, c: TileCanvas): void;

	// ─── Shared flyTo / setCoo ───

	_flyTo(centerX: number, centerY: number, width: number, height: number, dur: number, speed: number, perc: number, isJump: boolean, limit: boolean, limitZoom: boolean, toOmniIdx: number, fn: Bicubic): number {
		const c = this.canvas;
		const a = c._ani;
		c._kinetic.stop();
		const adjustedCenterX = this._flyToCenterX(centerX);
		a._limit = false;
		dur = a._toView(adjustedCenterX, centerY, width, height, dur, fn, { speed, perc, isJump, limitViewport: limit, omniIdx: toOmniIdx, correct: limitZoom });
		a._limit = false;
		a._flying = true;
		return dur;
	}

	protected _flyToCenterX(centerX: number): number { return centerX; }

	setCoo(x: number, y: number, scale: number, dur: number = 0, speed: number = 0, limit: boolean = false, fn: Bicubic = easeInOut): number {
		if (this._handleSetCooInit(x, y, scale)) return 0;

		const c = this.canvas;
		if (scale === 0) scale = c._getScale();
		scale = this._clampSetCooScale(scale);
		c._kinetic.stop();

		const { w, h } = this._setCooDim(scale);
		this._beforeSetCooAnimate(x, y, w, h, dur);

		dur = c._ani._toView(x, y, w, h, dur, fn, { speed });
		c._ani._limit = dur === 0 || limit;
		c._ani._flying = dur > 0;
		return dur;
	}

	protected _handleSetCooInit(_x: number, _y: number, _scale: number): boolean { return false; }
	protected _clampSetCooScale(scale: number): number { return scale; }
	protected abstract _setCooDim(scale: number): { w: number; h: number };
	protected _beforeSetCooAnimate(_x: number, _y: number, _w: number, _h: number, _dur: number): void {}

	// ─── Common interface ───

	abstract _pan(xPx: number, yPx: number, duration?: number, noLimit?: boolean, force?: boolean, isKinetic?: boolean): void;
	abstract _zoom(delta: number, xPx: number, yPx: number, duration?: number, noLimit?: boolean): number;
	abstract _correctMinMax(noLimit?: boolean): void;
	abstract _isOutsideLimit(): boolean;
	abstract _isUnderZoom(): boolean;
	abstract _isZoomedIn(): boolean;
	abstract _isZoomedOut(b?: boolean): boolean;
	abstract _getCoo(x: number, y: number, abs?: boolean, noLimit?: boolean): Coordinates;
}
