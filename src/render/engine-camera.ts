/**
 * Abstract base class for camera implementations (2D and 360).
 * Provides shared pinch mechanics and the common camera interface.
 * @internal
 */

import { Coordinates, Viewport } from './shared'
import { Bicubic, easeInOut } from './easing';
import type { default as TileCanvas } from './tile-canvas';

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
	abstract scale: number;
	abstract yaw: number;
	abstract pitch: number;
	abstract minScale: number;
	abstract maxScale: number;
	abstract coverScale: number;
	abstract minSize: number;

	// ─── Shared pinch implementation ───

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
		const delta = this.#prevSize - size;

		c._kinetic.stop();

		if (this.#prevCenterX > 0) {
			const dX = this.#prevCenterX - cX;
			const dY = this.#prevCenterY - cY;
			this.handlePinchMove(delta, dX, dY, cX, cY, el, c);
		} else c._ani.stop();

		this.#prevCenterX = cX;
		this.#prevCenterY = cY;
		this.#prevSize = size;
	}

	pinchStart(): void {}

	pinchStop(): void {
		this.#resetPinchState();
	}

	#resetPinchState(): void {
		this.#prevSize = -1;
		this.#prevCenterX = -1;
		this.#prevCenterY = -1;
	}

	protected abstract handlePinchMove(delta: number, dX: number, dY: number, cX: number, cY: number, el: Viewport, c: TileCanvas): void;

	// ─── Shared flyTo / setCoo ───

	flyTo(centerX: number, centerY: number, width: number, height: number, dur: number, speed: number, perc: number, isJump: boolean, limit: boolean, limitZoom: boolean, toOmniIdx: number, fn: Bicubic): number {
		const c = this.canvas;
		const a = c._ani;
		c._kinetic.stop();
		const adjustedCenterX = this.flyToCenterX(centerX);
		a.limit = false;
		dur = a.toView(adjustedCenterX, centerY, width, height, dur, fn, { speed, perc, isJump, limitViewport: limit, omniIdx: toOmniIdx, correct: limitZoom });
		a.limit = false;
		a.flying = true;
		return dur;
	}

	protected flyToCenterX(centerX: number): number { return centerX; }

	setCoo(x: number, y: number, scale: number, dur: number = 0, speed: number = 0, limit: boolean = false, fn: Bicubic = easeInOut): number {
		if (this.handleSetCooInit(x, y, scale)) return 0;

		const c = this.canvas;
		if (scale === 0) scale = c.getScale();
		scale = this.clampSetCooScale(scale);
		c._kinetic.stop();

		const { w, h } = this.setCooDim(scale);
		this.beforeSetCooAnimate(x, y, w, h, dur);

		dur = c._ani.toView(x, y, w, h, dur, fn, { speed });
		c._ani.limit = dur === 0 || limit;
		c._ani.flying = dur > 0;
		return dur;
	}

	protected handleSetCooInit(_x: number, _y: number, _scale: number): boolean { return false; }
	protected clampSetCooScale(scale: number): number { return scale; }
	protected abstract setCooDim(scale: number): { w: number; h: number };
	protected beforeSetCooAnimate(_x: number, _y: number, _w: number, _h: number, _dur: number): void {}

	// ─── Common interface ───

	abstract pan(xPx: number, yPx: number, duration?: number, noLimit?: boolean, force?: boolean, isKinetic?: boolean): void;
	abstract zoom(delta: number, xPx: number, yPx: number, duration?: number, noLimit?: boolean): number;
	abstract correctMinMax(noLimit?: boolean): void;
	abstract isOutsideLimit(): boolean;
	abstract isUnderZoom(): boolean;
	abstract isZoomedIn(): boolean;
	abstract isZoomedOut(b?: boolean): boolean;
	abstract getCoo(x: number, y: number, abs?: boolean, noLimit?: boolean): Coordinates;
}
