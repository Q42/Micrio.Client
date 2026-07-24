import { eventPassive, cancelPrevent, type EventContext } from './shared';

/**
 * Drag/pan event handler module.
 * Handles pointer down/move/up events for panning the image.
 * @internal
 */
export class DragHandler {
	#hooked = false;
	#ctx: EventContext;

	/**
	 * @param ctx The shared event context.
	 */
	constructor(ctx: EventContext) {
		this.#ctx = ctx;
	}

	/** Hooks pointer down/move/up listeners for drag panning. */
	hook(): void {
		if (this.#hooked) return;
		this.#hooked = true;

		this.#ctx._micrio.addEventListener('dragstart', cancelPrevent as EventListener);
		this.#ctx._micrio.addEventListener('pointerdown', this.start, eventPassive);
		self.addEventListener('pointercancel', this.#cancel, eventPassive);
		this.#ctx._micrio.setAttribute('data-hooked', '');
	}

	/** Unhooks pointer listeners for drag panning. */
	unhook(): void {
		if (!this.#hooked) return;
		this.#hooked = false;

		this.#ctx._micrio.removeEventListener('pointerdown', this.start, eventPassive);
		this.#ctx._micrio.removeEventListener('dragstart', cancelPrevent as EventListener);
		self.removeEventListener('pointercancel', this.#cancel, eventPassive);
		this.#ctx._micrio.removeAttribute('data-hooked');
	}

	/**
	 * Handles the start of a drag/pan operation (pointerdown).
	 * @param e The PointerEvent.
	 * @param force If true, forces drag start even if target isn't the canvas.
	 */
	start = (e: PointerEvent, force = false, keepAnimations = false): void => {
		// Ignore non-primary buttons or touch events if twoFingerPan is enabled
		if (e.button != 0 || (e.pointerType == 'touch' && this.#ctx._twoFingerPan)) return;

		// Ignore if interaction didn't start on the canvas element (unless forced or target has scroll-through)
		if (!force && e.target != this.#ctx._el && !(e.target instanceof Element && e.target.closest('[data-scroll-through]'))) return;

		// Ignore if Omni object and shift key is pressed
		if (this.#ctx._micrio.$current?._isOmni && e.shiftKey) return;

		// Don't start panning if we're pinching
		if (this.#ctx._pinching) return;

		// Handle potential conflicts with pinching
		if (this.#ctx._panning) {
			// If already panning and a second touch starts, stop panning to allow pinch
			if (e instanceof TouchEvent && e.touches.length > 1) this.stop();
			return;
		}

		// Determine the target image under the pointer
		const img = this.#ctx._getImage({ x: e.clientX, y: e.clientY });
		if (!img) return;

		this.#ctx._panning = true;

		// Store start coordinates and time, and lock to originating image
		this.#ctx._vars._drag._start = [e.clientX, e.clientY, performance.now()];
		this.#ctx._vars._drag._image = img;

		// Add move and up listeners
		this.#ctx._micrio.addEventListener('pointermove', this.#move, eventPassive);
		this.#ctx._micrio.addEventListener('pointerup', this.stop, eventPassive);

		this.#ctx._micrio.setAttribute('data-panning', '');
		img.canvas?._kinetic.stop();
		if (!keepAnimations) img.camera.stop();
		this.#ctx._micrio._engine.render();
		this.#ctx._dispatch('panstart');
	}

	/**
	 * Handles pointer movement during a drag/pan operation.
	 * @param e The PointerEvent.
	 */
	#move = (e: PointerEvent): void => {
		const cX = e.clientX, cY = e.clientY;

		// Capture pointer only after significant movement to allow double-click
		const moved = Math.hypot(this.#ctx._vars._drag._start[0] - e.clientX, this.#ctx._vars._drag._start[1] - e.clientY);
		if (!this.#ctx._capturedPointerId && moved > 10) {
			this.#ctx._capturedPointerId = e.pointerId;
			this.#ctx._micrio.setPointerCapture(e.pointerId);
		}

		// Calculate delta and call camera pan on the originating image (not re-hit-testing)
		if (this.#ctx._vars._drag._prev) {
			this.#ctx._vars._drag._image?.camera.pan(
				this.#ctx._vars._drag._prev[0] - cX,
				this.#ctx._vars._drag._prev[1] - cY
			);
		}

		// Store current coordinates as previous for next move event
		this.#ctx._vars._drag._prev = [cX, cY];
	}

	/**
	 * Handles the end of a drag/pan operation (pointerup).
	 * @param e Optional PointerEvent.
	 * @param noKinetic If true, prevents kinetic coasting animation.
	 * @param noDispatch If true, suppresses the 'panend' event.
	 */
	stop = (e?: PointerEvent, noKinetic = false, noDispatch = false): void => {
		if (!this.#ctx._panning) return;

		this.#ctx._panning = false;
		this.#ctx._vars._drag._prev = undefined;

		// Remove listeners
		this.#ctx._micrio.removeEventListener('pointermove', this.#move, eventPassive);
		this.#ctx._micrio.removeEventListener('pointerup', this.stop, eventPassive);

		// Release pointer capture if active
		if (this.#ctx._capturedPointerId) {
			this.#ctx._micrio.releasePointerCapture(this.#ctx._capturedPointerId);
		}
		this.#ctx._capturedPointerId = undefined;

		this.#ctx._micrio.removeAttribute('data-panning');

		// Notify engine pan stopped (triggers kinetic animation if enabled and not suppressed)
		if (e && noKinetic == false) {
			const img = this.#ctx._vars._drag._image ?? this.#ctx._getImage({ x: e.clientX, y: e.clientY });
			if (img) {
				img.canvas?._kinetic.start();
				this.#ctx._micrio._engine.render();
			}
		}

		// Clear the locked image reference
		this.#ctx._vars._drag._image = undefined;

		// Dispatch 'panend' event unless suppressed
		if (!noDispatch) this.#ctx._dispatch('panend', !e ? undefined : {
			'duration': performance.now() - this.#ctx._vars._drag._start[2],
			'movedX': e.clientX - this.#ctx._vars._drag._start[0],
			'movedY': e.clientY - this.#ctx._vars._drag._start[1]
		});
	}

	/**
	 * Handles `pointercancel` (e.g. when the browser hijacks the touch for
	 * its own scrolling/zooming because the gesture started on an element
	 * without `touch-action: none`). Cleans up panning state without
	 * triggering kinetic motion or a regular `panend`.
	 */
	#cancel = (e: PointerEvent): void => {
		if (!this.#ctx._panning) return;
		// If a different pointer was the captured one, ignore.
		if (this.#ctx._capturedPointerId !== undefined && e.pointerId !== this.#ctx._capturedPointerId) return;
		this.stop(undefined, true, true);
	}
}
