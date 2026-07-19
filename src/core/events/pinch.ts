import { Browser } from '$utils/browser';
import { eventPassive, eventPassiveCapture, type EventContext } from './shared';
import type { DragHandler } from './drag';
import { pinchStart, pinchMove, pinchStop, restartPanning } from './pinch-shared';

/**
 * Touch pinch event handler module (iOS).
 * Handles touchstart/touchmove/touchend events for pinch-to-zoom gestures.
 */
export class PinchHandler {
	#ctx: EventContext;
	#dragHandler: DragHandler;

	constructor(
		ctx: EventContext,
		dragHandler: DragHandler
	) {
		this.#ctx = ctx;
		this.#dragHandler = dragHandler;
	}

	/** Hooks touch pinch event listeners (iOS only). */
	hook(): void {
		if (Browser.iOS && this.#ctx.hasTouch) {
			this.#ctx.micrio.addEventListener('touchstart', this.start, eventPassive);
		}
	}

	/** Unhooks touch pinch event listeners. */
	unhook(): void {
		if (Browser.iOS && this.#ctx.hasTouch) {
			this.#ctx.micrio.removeEventListener('touchstart', this.start, eventPassive);
		}
		// Clean up in case we're in the middle of a pinch
		self.removeEventListener('touchmove', this.#move, eventPassiveCapture);
		self.removeEventListener('touchend', this.stop, eventPassiveCapture);
	}

	/**
	 * Handles the start of a touch pinch gesture (touchstart with two fingers).
	 * @param e The TouchEvent.
	 */
	start = (e: TouchEvent | Event): void => {
		if (!Browser.hasTouch || !(e instanceof TouchEvent)) return;

		if (this.#ctx.twoFingerPan && e.touches.length < 2) return;

		if (this.#ctx.pinching || e.touches.length != 2) {
			this.stop(e as TouchEvent);
			return;
		}

		e.stopPropagation();

		const t = e.touches;

		this.#ctx.vars.pinch.image = this.#ctx.getImage({ x: t[0].clientX, y: t[0].clientY });
		this.#ctx.vars.pinch.sDst = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

		self.addEventListener('touchmove', this.#move, eventPassiveCapture);
		self.addEventListener('touchend', this.stop, eventPassiveCapture);

		pinchStart(this.#ctx, this.#dragHandler);
	}

	/**
	 * Handles touch movement during a pinch gesture.
	 * @param e The TouchEvent.
	 */
	#move = (e: TouchEvent | Event): void => {
		if (!Browser.hasTouch || !(e instanceof TouchEvent)) return;
		const t = e.touches;
		if (t?.length < 2) return;

		const coo = { x: t[0].clientX, y: t[0].clientY };
		const coo2 = { x: t[1].clientX, y: t[1].clientY };

		pinchMove(this.#ctx, coo, coo2);
	}

	/**
	 * Handles the end of a touch pinch gesture (touchend).
	 * @param e The TouchEvent or MouseEvent.
	 */
	stop = (e: MouseEvent | TouchEvent): void => {
		pinchStop(this.#ctx, e, this.#move);

		if (e instanceof TouchEvent) {
			restartPanning(this.#ctx, this.#dragHandler, e.touches);
		}
	}
}

