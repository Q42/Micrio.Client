/**
 * Manages camera and view animations (fly-to, zoom, jump).
 * @author Marcel Duin <marcel@micr.io>
 * @internal
 */

import { Bicubic, easeInOut, longitudeDistance } from './easing'
import { View } from './shared'
import type { TileCanvas } from './tile-canvas';

/** Manages camera and view animations (fly-to, zoom). @internal */
export default class Ani {
	/** Flag indicating if a view animation (fly-to) is active. */
	#isView: boolean = false;
	/** Starting view state for the animation. */
	readonly #vFrom: View;
	/** Target view state for the animation. */
	readonly #vTo: View;
	/** Stores the final target view requested (might differ from vTo during corrections). */
	readonly _lastView: View;

	/** Flag indicating if a zoom animation (perspective change in 360) is active. */
	#isZoom: boolean = false;
	/** Flag indicating if the animation is a "jump" (zooms out then in). */
	#isJump: boolean = false;
	/** Starting perspective value for zoom animation. */
	#zFrom: number = 0;
	/** Target perspective value for zoom animation. */
	#zTo: number = 0;
	/** Flag to disable perspective limits during zoom animation. */
	#zNoLimit: boolean = false;
	/** Easing function used for the current animation. */
	#fn: Bicubic = easeInOut;

	/** Timestamp when the animation started. */
	#started: number = 0;
	/** Total duration of the animation in milliseconds. */
	#duration: number = 0;

	/** Flag indicating if the animation is currently running (not paused). */
	#isRunning: boolean = false;

	/** Flag indicating if the view should be limited during animation (usually false during animation). */
	_limit: boolean = true;
	/** Flag indicating if the animation is a fly-to type. */
	_flying: boolean = false;
	/** Flag indicating if the animation is correcting the view to stay within limits. */
	_correcting: boolean = false;

	/** Timestamp when the animation was paused. 0 if not paused. */
	#pausedAt: number = 0;

	// Jump animation edge direction flags: 0=none, 1=expanding, 2=contracting
	#fL: number = 0;
	#fT: number = 0;
	#fR: number = 0;
	#fB: number = 0;
	/** Start point for the ease-in part of the jump animation curve. */
	#mI: number = 0;
	/** Start point for the ease-out part of the jump animation curve. */
	#mO: number = 0;

	/** Starting frame index for omni object rotation animation. */
	#omniStartIdx: number = -1;
	/** Delta (number of frames) to rotate during omni animation. */
	#omniDelta: number = 0;

	#canvas: TileCanvas;

	constructor(
		canvas: TileCanvas
	) {
		this.#canvas = canvas;
		this.#vFrom = new View(canvas);
		this.#vTo = new View(canvas);
		this._lastView = new View(canvas);
	}

	/** Pauses the current animation. */
	pause(): void {
		if (this.#pausedAt > 0) return;
		this.#isRunning = false;
		this.#pausedAt = performance.now();
	}

	/** Resumes a paused animation. */
	resume(): void {
		if (this.#pausedAt === 0 || this.#started === 0) return;
		this.#started += performance.now() - this.#pausedAt;
		this.#pausedAt = 0;
		this.#isRunning = true;
	}

	/** Stops the current animation completely and resets state. */
	stop(): void {
		if (this.#isRunning) {
			this.#canvas._aniAbort();
		}
		this.#started = 0;
		this._limit = true;
		this._flying = false;
		this.#isRunning = false;
		this.#isView = false;
		this.#isZoom = false;
		this._correcting = false;
		this.#pausedAt = 0;
	}

	/** Checks if a view animation is currently running. */
	isStarted(): boolean {
		return this.#isRunning && this.#isView;
	}

	/**
	 * Starts or updates a "fly-to" animation to a target view rectangle.
	 * @returns Calculated or provided animation duration in ms.
	 */
	toView(
		toCenterX: number, toCenterY: number, toWidth: number, toHeight: number,
		dur: number, fn: Bicubic,
		opts: {
			speed?: number;
			perc?: number;
			isJump?: boolean;
			limitViewport?: boolean;
			omniIdx?: number;
			correct?: boolean;
		} = {}): number {

		const { speed = 0, perc = 0, isJump = false, limitViewport = false, omniIdx = -1, correct = false } = opts;

		if (correct && this._correcting) {
			this.updateTarget(toCenterX, toCenterY, toWidth, toHeight, true);
			return dur;
		}

		this._lastView.set(toCenterX, toCenterY, toWidth, toHeight);
		this.#vTo.set(toCenterX, toCenterY, toWidth, toHeight);

		const c = this.#canvas;
		const v = c.view;
		const t = this.#vTo;
		const f = this.#vFrom;

		this.#isJump = isJump;

		this.#fn = fn;

		const el = c.main.el;
		if (el._areaHeight !== 0) {
			const margin = toHeight / (1 - (el._areaHeight / el.height));
			if (margin > 0) toHeight += margin; else toHeight -= margin;
			el._areaHeight = 0;
		}
		if (el._areaWidth !== 0) {
			const margin = toWidth * (el._areaWidth / el.width);
			if (margin > 0) toWidth += margin; else toWidth -= margin;
			el._areaWidth = 0;
		}

		const fromCenterX = v._centerX, fromCenterY = v._centerY, fromWidth = v.width, fromHeight = v.height;
		f.set(fromCenterX, fromCenterY, fromWidth, fromHeight);

		if (c.is360) {
			toCenterX = fromCenterX + longitudeDistance(fromCenterX, toCenterX);
			t.set(toCenterX, toCenterY, toWidth, toHeight);
		}

		if (limitViewport) {
			t._correctAspectRatio();
			t._limit(false);
		}

		this.#fL = 0; this.#fR = 0; this.#fT = 0; this.#fB = 0;
		let durFact: number = 1;

		if (this.#isJump) {
			if (!c.is360) {
				const cX = t._centerX, cY = t._centerY;
				if (t.aspect > f.aspect) {
					const nh = t.width / f.aspect;
					t.set(cX, cY, t.width, nh);
				} else {
					const nw = t.height * f.aspect;
					t.set(cX, cY, nw, t.height);
				}
			}
			const fLeft = f.x0, fRight = f.x1, fTop = f.y0, fBottom = f.y1;
			const tLeft = t.x0, tRight = t.x1, tTop = t.y0, tBottom = t.y1;

			const el = tLeft < fLeft, et = tTop < fTop, er = tRight > fRight, eb = tBottom > fBottom;
			if ((el || et || er || eb) && !(el && et && er && eb)) {
				this.#fL = el ? 1 : (tLeft > fLeft ? 2 : 0);
				this.#fR = er ? 1 : (tRight < fRight ? 2 : 0);
				this.#fT = et ? 1 : (tTop > fTop ? 2 : 0);
				this.#fB = eb ? 1 : (tBottom < fBottom ? 2 : 0);
				durFact = 1.5;
			}
			else t.set(toCenterX, toCenterY, toWidth, toHeight);
		}

		if (correct) t._limit(true, !limitViewport);

		const resoFact = Math.max(10000, Math.min(15000, c._diagonal / 2));
		let dCenterX = Math.abs(fromCenterX - toCenterX);
		if (c.is360) dCenterX = Math.min(dCenterX, 1 - dCenterX);
		const dCenterY = Math.abs(fromCenterY - toCenterY);
		const dWidth = Math.abs(fromWidth - toWidth);
		const dHeight = Math.abs(fromHeight - toHeight);

		const isZoomIn = toWidth < fromWidth && toHeight < fromHeight;
		const zoomWeight = isZoomIn ? 0.125 : 0.25;
		const dst = (dCenterX + dCenterY + dWidth * zoomWeight + dHeight * zoomWeight) / 3;
		this.#mI = Math.max(.5, .8 - dst * (c.is360 ? 1 : 2));
		this.#mO = Math.max(.05, Math.min(.9, dst - (c.is360 ? .2 : .1)));
		this.#duration = dur < 0 ? (dst * resoFact / c._camSpeed * durFact) / (speed <= 0 ? 1 : speed) : dur;

		const numPerLayer = c.images.length / c._omniNumLayers;
		this.#omniStartIdx = c._activeImageIdx;
		this.#omniDelta = 0;
		if (!isNaN(omniIdx) && omniIdx > 0 && omniIdx !== this.#omniStartIdx) {
			this.#omniDelta = omniIdx - this.#omniStartIdx;
			if (this.#omniDelta < -numPerLayer / 2) this.#omniDelta += numPerLayer;
			if (this.#omniDelta > numPerLayer / 2) this.#omniDelta -= numPerLayer;
			this.#duration += Math.abs(this.#omniDelta) / this.#canvas.images.length * 6000;
		}

		this.stop();

		if (this.#duration === 0) {
			c.setView(t._centerX, t._centerY, t.width, t.height, false, true);
			this.#canvas._aniDone();
			return this.#duration;
		}

		this.#isView = true;
		this._limit = false;
		this._flying = true;
		this.#isZoom = false;
		if (correct) this._correcting = true;

		this.#started = performance.now() - (perc * this.#duration);
		this.#isRunning = true;

		return this.#duration * (1 - perc);
	}

	/** Updates the target view of a running animation. Used for corrections. */
	updateTarget(toCenterX: number, toCenterY: number, toWidth: number, toHeight: number, limiting: boolean = false): void {
		this.#vTo.set(toCenterX, toCenterY, toWidth, toHeight);
		if (limiting) this.#vTo._limit(true);
	}

	/**
	 * Starts a zoom animation (perspective change for 360).
	 * @returns Calculated or provided animation duration in ms.
	 */
	zoom(to: number, dur: number, speed: number, noLimit: boolean): number {
		this.stop();
		this.#isView = false;
		this._flying = false;
		this.#isZoom = true;
		this.#zNoLimit = noLimit;

		const c = this.#canvas;
		const webgl = c._camera360;

		this.#zFrom = webgl._perspective;
		this.#zTo = this.#zFrom + (to / (webgl._scale * c._diagonal / 20));
		if (!noLimit) this.#zTo = Math.min(webgl._maxPerspective, Math.max(webgl._minPerspective, this.#zTo));

		this.#started = performance.now();
		this.#isRunning = true;

		this.#duration = dur >= 0 ? dur : Math.abs(this.#zFrom - this.#zTo) * 1000 / speed;
		return dur;
	}

	/** Sets the starting view for progress calculation in flyTo animations. */
	setStartView(centerX: number, centerY: number, width: number, height: number, correctRatio: boolean = false): void {
		this.#vFrom.set(centerX, centerY, width, height, correctRatio);
		this.#vTo.set(centerX, centerY, width, height, correctRatio);
	}

	/**
	 * Calculates and applies the animation step for the current frame.
	 * @returns Current animation progress (0-1).
	 */
	step(): number {
		const p: number = this.#started === 0 ? 1 : Math.min(1, Math.max(0, (this.#canvas.main.now - this.#started) / this.#duration));
		const pE = this.#fn.get(p);

		if (this.#isRunning) {
			if (this.#isView) {
				const f = this.#vFrom, t = this.#vTo;
				const mo = this.#mO, i = this.#fn.get(Math.min(1, p / this.#mI)),
					o = this.#fn.get(Math.max(0, (p - mo) / (1 - mo)));
				let n: number = 0;

				let interpCenterX = f._centerX + (t._centerX - f._centerX) * (!(n = this.#fL || this.#fR) ? pE : n === 1 ? i : o);
				let interpCenterY = f._centerY + (t._centerY - f._centerY) * (!(n = this.#fT || this.#fB) ? pE : n === 1 ? i : o);
				const interpWidth = f.width + (t.width - f.width) * pE;
				const interpHeight = f.height + (t.height - f.height) * pE;

				if (this.#canvas.is360) {
					const deltaX = longitudeDistance(f._centerX, t._centerX);
					interpCenterX = f._centerX + deltaX * pE;
				}

				this.#canvas.setView(interpCenterX, interpCenterY, interpWidth, interpHeight, false, true);

				if (this.#omniDelta) {
					let idx = this.#omniStartIdx + Math.trunc(this.#omniDelta * this.#fn.get(Math.min(1, p * 1.5)));
					const numPerLayer = this.#canvas.images.length / this.#canvas._omniNumLayers;
					if (idx < 0) idx += numPerLayer;
					if (idx >= numPerLayer) idx -= numPerLayer;
					this.#canvas._setActiveImage(idx, 0);
				}
			}

			if (this.#isZoom) {
				this.#canvas._camera360._setPerspective(this.#zFrom * (1 - pE) + this.#zTo * pE, this.#zNoLimit);
			}

			if (p >= 1) {
				this._lastView._copy(this.#canvas.view);
				this.#canvas._aniDone();
				this.stop();
			}
		}

		return p;
	}

}
