import { Browser, pyth } from '../utils';
import { eventPassive, eventPassiveCapture, supportsPassive, type EventContext } from './shared';
import type { DragHandler } from './drag';

/**
 * Touch pinch event handler module (iOS).
 * Handles touchstart/touchmove/touchend events for pinch-to-zoom gestures.
 */
export class PinchHandler {
	constructor(
		private ctx: EventContext,
		private dragHandler: DragHandler
	) {
		this.start = this.start.bind(this);
		this.move = this.move.bind(this);
		this.stop = this.stop.bind(this);
	}

	/** Hooks touch pinch event listeners (iOS only). */
	hook(): void {
		if (Browser.iOS && this.ctx.hasTouch) {
			this.ctx.el.addEventListener('touchstart', this.start, eventPassive);
		}
	}

	/** Unhooks touch pinch event listeners. */
	unhook(): void {
		if (Browser.iOS && this.ctx.hasTouch) {
			this.ctx.el.removeEventListener('touchstart', this.start, eventPassive);
		}
		// Clean up in case we're in the middle of a pinch
		self.removeEventListener('touchmove', this.move, eventPassiveCapture);
		self.removeEventListener('touchend', this.stop, eventPassiveCapture);
	}

	/**
	 * Handles the start of a touch pinch gesture (touchstart with two fingers).
	 * @param e The TouchEvent.
	 */
	start(e: TouchEvent | Event): void {
		if (!Browser.hasTouch || !(e instanceof TouchEvent)) return;

		// Ignore if twoFingerPan is enabled and less than two touches
		if (this.ctx.isTwoFingerPan() && e.touches.length < 2) return;

		// If already pinching or not exactly two touches, stop any existing pinch
		if (this.ctx.isPinching() || e.touches.length != 2) {
			this.stop(e as TouchEvent);
			return;
		}

		e.stopPropagation();
		if (!supportsPassive) e.preventDefault();

		// Stop panning if it was active before pinch started
		this.ctx.vars.pinch.wasPanning = this.ctx.isPanning();
		this.dragHandler.stop(undefined, false, true);

		const t = e.touches;

		this.ctx.setPinching(true);

		// Add move/end listeners to the window
		self.addEventListener('touchmove', this.move, eventPassiveCapture);
		self.addEventListener('touchend', this.stop, eventPassiveCapture);

		this.ctx.micrio.setAttribute('data-pinching', '');

		// Store target image and initial pinch distance
		this.ctx.vars.pinch.image = this.ctx.getImage({ x: t[0].clientX, y: t[0].clientY });
		this.ctx.vars.pinch.sDst = pyth(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
		this.ctx.setPinchFactor(undefined);

		// Notify Wasm pinch started
		if (this.ctx.vars.pinch.image) {
			this.ctx.micrio.wasm.e._pinchStart(this.ctx.vars.pinch.image.ptr);
		}
		this.ctx.micrio.wasm.render();

		this.ctx.dispatch('pinchstart');
		if (this.ctx.isTwoFingerPan()) this.ctx.dispatch('panstart');
	}

	/**
	 * Handles touch movement during a pinch gesture.
	 * @param e The TouchEvent.
	 */
	private move(e: TouchEvent | Event): void {
		if (!Browser.hasTouch || !(e instanceof TouchEvent)) return;
		const t = e.touches;
		if (t?.length < 2) return;

		// Get coordinates of the two touch points
		const coo = { x: t[0].clientX, y: t[0].clientY };
		const coo2 = { x: t[1].clientX, y: t[1].clientY };
		const v = this.ctx.vars.pinch;
		const i = v.image;
		if (!i) return;

		// Adjust coordinates if pinching on a passive split-screen image
		if (i?.opts.secondaryTo && i.opts.isPassive && i.opts.area) {
			const dX = i.opts.area[0] * this.ctx.micrio.offsetWidth;
			const dY = i.opts.area[1] * this.ctx.micrio.offsetHeight;
			coo.x -= dX; coo2.x -= dX;
			coo.y -= dY; coo2.y -= dY;
		}

		// Calculate current pinch factor relative to start distance
		this.ctx.setPinchFactor(pyth(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) / v.sDst);

		// Notify Wasm of pinch movement
		this.ctx.micrio.wasm.e._pinch(i.ptr, coo.x, coo.y, coo2.x, coo2.y);
	}

	/**
	 * Handles the end of a touch pinch gesture (touchend).
	 * @param e The TouchEvent or MouseEvent.
	 */
	stop(e: MouseEvent | TouchEvent): void {
		if (!this.ctx.isPinching()) return;
		this.ctx.setPinching(false);

		// Remove listeners
		self.removeEventListener('touchmove', this.move, eventPassiveCapture);
		self.removeEventListener('touchend', this.stop, eventPassiveCapture);

		this.ctx.micrio.removeAttribute('data-pinching');

		// Notify Wasm pinch stopped
		const i = this.ctx.vars.pinch.image;
		if (i) {
			this.ctx.micrio.wasm.e._pinchStop(i.ptr, performance.now());
			this.ctx.micrio.wasm.render();
		}
		this.ctx.vars.pinch.image = undefined;
		this.ctx.setPinchFactor(undefined);

		this.ctx.dispatch('pinchend');
		if (this.ctx.isTwoFingerPan() && !this.ctx.vars.pinch.wasPanning) {
			this.ctx.dispatch('panend');
		}

		// If one finger remains after pinch, potentially restart panning
		if (e instanceof TouchEvent && e.touches.length == 1) {
			this.dragHandler.start(e as unknown as PointerEvent, true);
		}
	}
}

