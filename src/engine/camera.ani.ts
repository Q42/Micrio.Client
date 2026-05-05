/**
 * Manages camera and view animations (fly-to, zoom, jump).
 * @author Marcel Duin <marcel@micr.io>
 */

import { easeInOut, easeIn, easeOut, linear, Bicubic, longitudeDistance } from './utils'
import { View } from './shared'
import type { default as Canvas } from './canvas';

/** Manages camera and view animations (fly-to, zoom). */
export default class Ani {
	/** Flag indicating if a view animation (fly-to) is active. */
	private isView: boolean = false;
	/** Starting view state for the animation. */
	private readonly vFrom: View;
	/** Target view state for the animation. */
	private readonly vTo: View;
	/** Stores the final target view requested (might differ from vTo during corrections). */
	readonly lastView: View;

	/** Flag indicating if a zoom animation (perspective change in 360) is active. */
	private isZoom: boolean = false;
	/** Flag indicating if the animation is a "jump" (zooms out then in). */
	private isJump: boolean = false;
	/** Starting perspective value for zoom animation. */
	private zFrom: number = 0;
	/** Target perspective value for zoom animation. */
	private zTo: number = 0;
	/** Flag to disable perspective limits during zoom animation. */
	private zNoLimit: boolean = false;
	/** Easing function used for the current animation. */
	private fn: Bicubic = easeInOut;

	/** Timestamp when the animation started. */
	private started: number = 0;
	/** Total duration of the animation in milliseconds. */
	private duration: number = 0;

	/** Flag indicating if the animation is currently running (not paused). */
	private isRunning: boolean = false;

	/** Flag indicating if the view should be limited during animation (usually false during animation). */
	limit: boolean = true;
	/** Flag indicating if the current animation step resulted in zooming out. */
	zoomingOut: boolean = false;
	/** Flag indicating if the animation is a fly-to type. */
	flying: boolean = false;
	/** Flag indicating if the animation is correcting the view to stay within limits. */
	correcting: boolean = false;

	/** Timestamp when the animation was paused. 0 if not paused. */
	private pausedAt: number = 0;

	// Jump animation edge direction flags: 0=none, 1=expanding, 2=contracting
	private fL: number = 0;
	private fT: number = 0;
	private fR: number = 0;
	private fB: number = 0;
	/** Start point for the ease-in part of the jump animation curve. */
	private mI: number = 0;
	/** Start point for the ease-out part of the jump animation curve. */
	private mO: number = 0;

	/** Starting frame index for omni object rotation animation. */
	private omniStartIdx: number = -1;
	/** Delta (number of frames) to rotate during omni animation. */
	private omniDelta: number = 0;

	constructor(
		private canvas: Canvas
	) {
		this.vFrom = new View(canvas);
		this.vTo = new View(canvas);
		this.lastView = new View(canvas);
	}

	/** Pauses the current animation. */
	pause(time: number): void {
		if (this.pausedAt > 0) return;
		this.isRunning = false;
		this.pausedAt = time;
	}

	/** Resumes a paused animation. */
	resume(time: number): void {
		if (this.pausedAt === 0 || this.started === 0) return;
		this.started += time - this.pausedAt;
		this.pausedAt = 0;
		this.isRunning = true;
	}

	/** Stops the current animation completely and resets state. */
	stop(): void {
		if (this.isRunning) {
			this.canvas.aniAbort();
		}
		this.started = 0;
		this.limit = true;
		this.flying = false;
		this.isRunning = false;
		this.isView = false;
		this.isZoom = false;
		this.correcting = false;
		this.pausedAt = 0;
	}

	/** Checks if a view animation is currently running. */
	isStarted(): boolean {
		return this.isRunning && this.isView;
	}

	/**
	 * Starts or updates a "fly-to" animation to a target view rectangle.
	 * @returns Calculated or provided animation duration in ms.
	 */
	toView(
		toCenterX: number, toCenterY: number, toWidth: number, toHeight: number,
		dur: number, speed: number, perc: number,
		isJump: boolean, limitViewport: boolean, omniIdx: number,
		fn: number, time: number, correct: boolean = false): number {

		if (correct && this.correcting) {
			this.updateTarget(toCenterX, toCenterY, toWidth, toHeight, true);
			return dur;
		}

		this.lastView.set(toCenterX, toCenterY, toWidth, toHeight);
		this.vTo.set(toCenterX, toCenterY, toWidth, toHeight);

		const c = this.canvas;
		const v = c.view;
		const t = this.vTo;
		const f = this.vFrom;

		this.isJump = isJump;

		this.fn = fn === 3 ? linear : fn === 2 ? easeOut : fn === 1 ? easeIn : easeInOut;

		const el = c.main.el;
		if (el.areaHeight !== 0) {
			const margin = toHeight / (1 - (el.areaHeight / el.height));
			if (margin > 0) toHeight += margin; else toHeight -= margin;
			el.areaHeight = 0;
		}
		if (el.areaWidth !== 0) {
			const margin = toWidth * (el.areaWidth / el.width);
			if (margin > 0) toWidth += margin; else toWidth -= margin;
			el.areaWidth = 0;
		}

		const fromCenterX = v.centerX;
		const fromCenterY = v.centerY;
		const fromWidth = v.width;
		const fromHeight = v.height;
		f.set(fromCenterX, fromCenterY, fromWidth, fromHeight);

		if (c.is360) {
			const longitudeDist = longitudeDistance(fromCenterX, toCenterX);
			const optimizedCenterX = fromCenterX + longitudeDist;
			toCenterX = optimizedCenterX;
			t.set(toCenterX, toCenterY, toWidth, toHeight);
		}

		if (limitViewport) {
			t.correctAspectRatio();
			t.limit(false);
		}

		this.fL = 0; this.fR = 0; this.fT = 0; this.fB = 0;
		let durFact: number = 1;

		if (this.isJump) {
			if (!c.is360) {
				const cX = t.centerX, cY = t.centerY;
				if (t.aspect > f.aspect) {
					const nh = t.width / f.aspect;
					t.set(cX, cY, t.width, nh);
				} else {
					const nw = t.height * f.aspect;
					t.set(cX, cY, nw, t.height);
				}
			}
			const fLeft = f.centerX - f.width / 2;
			const fRight = f.centerX + f.width / 2;
			const fTop = f.centerY - f.height / 2;
			const fBottom = f.centerY + f.height / 2;
			const tLeft = t.centerX - t.width / 2;
			const tRight = t.centerX + t.width / 2;
			const tTop = t.centerY - t.height / 2;
			const tBottom = t.centerY + t.height / 2;

			const el = tLeft < fLeft, et = tTop < fTop, er = tRight > fRight, eb = tBottom > fBottom;
			if ((el || et || er || eb) && !(el && et && er && eb)) {
				this.fL = el ? 1 : (tLeft > fLeft ? 2 : 0);
				this.fR = er ? 1 : (tRight < fRight ? 2 : 0);
				this.fT = et ? 1 : (tTop > fTop ? 2 : 0);
				this.fB = eb ? 1 : (tBottom < fBottom ? 2 : 0);
				durFact = 1.5;
			}
			else t.set(toCenterX, toCenterY, toWidth, toHeight);
		}

		if (correct) t.limit(true, !limitViewport);

		const resoFact = Math.max(10000, Math.min(15000, Math.sqrt(c.width * c.width + c.height * c.height) / 2));
		let dCenterX = Math.abs(fromCenterX - toCenterX);
		if (c.is360) dCenterX = Math.min(dCenterX, 1 - dCenterX);
		const dCenterY = Math.abs(fromCenterY - toCenterY);
		const dWidth = Math.abs(fromWidth - toWidth);
		const dHeight = Math.abs(fromHeight - toHeight);

		const isZoomIn = toWidth < fromWidth && toHeight < fromHeight;
		const zoomWeight = isZoomIn ? 0.125 : 0.25;
		const dst = (dCenterX + dCenterY + dWidth * zoomWeight + dHeight * zoomWeight) / 3;
		this.mI = Math.max(.5, .8 - dst * (c.is360 ? 1 : 2));
		this.mO = Math.max(.05, Math.min(.9, dst - (c.is360 ? .2 : .1)));
		this.duration = dur < 0 ? (dst * resoFact / c.camSpeed * durFact) / (speed <= 0 ? 1 : speed) : dur;

		const numPerLayer = this.canvas.images.length / this.canvas.omniNumLayers;
		this.omniStartIdx = this.canvas.activeImageIdx;
		this.omniDelta = 0;
		if (!isNaN(omniIdx) && omniIdx > 0 && omniIdx !== this.omniStartIdx) {
			this.omniDelta = omniIdx - this.omniStartIdx;
			if (this.omniDelta < -numPerLayer / 2) this.omniDelta += numPerLayer;
			if (this.omniDelta > numPerLayer / 2) this.omniDelta -= numPerLayer;
			this.duration += Math.abs(this.omniDelta) / this.canvas.images.length * 6000;
		}

		if (this.duration === 0) {
			c.setView(t.centerX, t.centerY, t.width, t.height, false, true);
			this.canvas.aniDone();
			this.stop();
			return this.duration;
		}

		this.stop();

		this.isView = true;
		this.limit = false;
		this.flying = true;
		this.isZoom = false;
		if (correct) this.correcting = true;

		this.started = time - (perc * this.duration);
		this.isRunning = true;

		return this.duration * (1 - perc);
	}

	/** Updates the target view of a running animation. Used for corrections. */
	updateTarget(toCenterX: number, toCenterY: number, toWidth: number, toHeight: number, limiting: boolean = false): void {
		this.vTo.set(toCenterX, toCenterY, toWidth, toHeight);
		if (limiting) this.vTo.limit(true);
	}

	/**
	 * Starts a zoom animation (perspective change for 360).
	 * @returns Calculated or provided animation duration in ms.
	 */
	zoom(to: number, dur: number, speed: number, noLimit: boolean, time: number): number {
		this.stop();
		this.isView = false;
		this.flying = false;
		this.isZoom = true;
		this.zNoLimit = noLimit;

		const c = this.canvas;
		const webgl = c.webgl;

		this.zFrom = webgl.perspective;
		this.zTo = this.zFrom + (to / (webgl.scale * Math.sqrt(c.width * c.width + c.height * c.height) / 20));
		if (!noLimit) this.zTo = Math.min(webgl.maxPerspective, Math.max(webgl.minPerspective, this.zTo));

		this.started = time;
		this.isRunning = true;

		this.duration = dur >= 0 ? dur : Math.abs(this.zFrom - this.zTo) * 1000 / speed;
		return dur;
	}

	/** Sets the starting view for progress calculation in flyTo animations. */
	setStartView(centerX: number, centerY: number, width: number, height: number, correctRatio: boolean): void {
		this.vFrom.set(centerX, centerY, width, height, correctRatio);
		this.vTo.set(centerX, centerY, width, height, correctRatio);
	}

	/**
	 * Calculates and applies the animation step for the current frame.
	 * @returns Current animation progress (0-1).
	 */
	step(time: number): number {
		const p: number = this.started === 0 ? 1 : Math.min(1, Math.max(0, (time - this.started) / this.duration));
		const pE = this.fn.get(p);
		const scale = this.canvas.getScale();

		if (this.isRunning) {
			if (this.isView) {
				const f = this.vFrom, t = this.vTo;
				const mo = this.mO, i = this.fn.get(Math.min(1, p / this.mI)),
					o = this.fn.get(Math.max(0, (p - mo) / (1 - mo)));
				let n: number = 0;

				let interpCenterX = f.centerX + (t.centerX - f.centerX) * (!(n = this.fL || this.fR) ? pE : n === 1 ? i : o);
				let interpCenterY = f.centerY + (t.centerY - f.centerY) * (!(n = this.fT || this.fB) ? pE : n === 1 ? i : o);
				const interpWidth = f.width + (t.width - f.width) * pE;
				const interpHeight = f.height + (t.height - f.height) * pE;

				if (this.canvas.is360) {
					const deltaX = longitudeDistance(f.centerX, t.centerX);
					interpCenterX = f.centerX + deltaX * pE;
				}

				this.canvas.setView(interpCenterX, interpCenterY, interpWidth, interpHeight, false, true);

				if (this.omniDelta) {
					let idx = this.omniStartIdx + Math.trunc(this.omniDelta * this.fn.get(Math.min(1, p * 1.5)));
					const numPerLayer = this.canvas.images.length / this.canvas.omniNumLayers;
					if (idx < 0) idx += numPerLayer;
					if (idx >= numPerLayer) idx -= numPerLayer;
					this.canvas.setActiveImage(idx, 0);
				}
			}

			if (this.isZoom) {
				this.canvas.webgl.setPerspective(this.zFrom * (1 - pE) + this.zTo * pE, this.zNoLimit);
			}

			if (p >= 1) {
				this.lastView.copy(this.canvas.view);
				this.canvas.aniDone();
				this.stop();
			}
		}

		this.zoomingOut = this.isRunning && this.canvas.getScale() < scale;

		return p;
	}

}
