import { pyth } from '../utils';
import { eventPassive, cancelPrevent, type EventContext } from './shared';

/**
 * Drag/pan event handler module.
 * Handles pointer down/move/up events for panning the image.
 */
export class DragHandler {
	private hooked = false;

	constructor(private ctx: EventContext) {
		this.start = this.start.bind(this);
		this.move = this.move.bind(this);
		this.stop = this.stop.bind(this);
	}

	/** Hooks pointer down/move/up listeners for drag panning. */
	hook(): void {
		if (this.hooked) return;
		this.hooked = true;

		this.ctx.micrio.addEventListener('dragstart', cancelPrevent as EventListener);
		this.ctx.micrio.addEventListener('pointerdown', this.start, eventPassive);
		this.ctx.micrio.setAttribute('data-hooked', '');
	}

	/** Unhooks pointer listeners for drag panning. */
	unhook(): void {
		if (!this.hooked) return;
		this.hooked = false;

		this.ctx.micrio.removeEventListener('pointerdown', this.start, eventPassive);
		this.ctx.micrio.removeEventListener('dragstart', cancelPrevent as EventListener);
		this.ctx.micrio.removeAttribute('data-hooked');
	}

	/**
	 * Handles the start of a drag/pan operation (pointerdown).
	 * @param e The PointerEvent.
	 * @param force If true, forces drag start even if target isn't the canvas.
	 */
	start(e: PointerEvent, force = false): void {
		// Ignore non-primary buttons or touch events if twoFingerPan is enabled
		if (e.button != 0 || (e.pointerType == 'touch' && this.ctx.isTwoFingerPan())) return;

		// Ignore if interaction didn't start on the canvas element (unless forced or target has scroll-through)
		if (!force && e.target != this.ctx.el && !(e.target instanceof Element && e.target.closest('[data-scroll-through]'))) return;

		// Ignore if Omni object and shift key is pressed
		if (this.ctx.micrio.$current?.isOmni && e.shiftKey) return;

		// Don't start panning if we're pinching
		if (this.ctx.isPinching()) return;

		// Handle potential conflicts with pinching
		if (this.ctx.isPanning()) {
			// If already panning and a second touch starts, stop panning to allow pinch
			if (e instanceof TouchEvent && e.touches.length > 1) this.stop();
			return;
		}

		// Determine the target image under the pointer
		const img = this.ctx.getImage({ x: e.clientX, y: e.clientY });
		if (!img) return;

		this.ctx.setPanning(true);

		// Store start coordinates and time
		this.ctx.vars.drag.start = [e.clientX, e.clientY, performance.now()];

		// Add move and up listeners
		this.ctx.micrio.addEventListener('pointermove', this.move, eventPassive);
		this.ctx.micrio.addEventListener('pointerup', this.stop, eventPassive);

		this.ctx.micrio.setAttribute('data-panning', '');
		this.ctx.micrio.wasm.e._panStart(img.ptr);
		this.ctx.micrio.wasm.render();
		this.ctx.dispatch('panstart');
	}

	/**
	 * Handles pointer movement during a drag/pan operation.
	 * @param e The PointerEvent.
	 */
	private move(e: PointerEvent): void {
		const cX = e.clientX, cY = e.clientY;

		// Capture pointer only after significant movement to allow double-click
		const moved = pyth(this.ctx.vars.drag.start[0] - e.clientX, this.ctx.vars.drag.start[1] - e.clientY);
		if (!this.ctx.capturedPointerId && moved > 10) {
			this.ctx.setCapturedPointerId(e.pointerId);
			this.ctx.micrio.setPointerCapture(e.pointerId);
		}

		// Calculate delta and call camera pan if previous coordinates exist
		if (this.ctx.vars.drag.prev) {
			this.ctx.getImage({ x: cX, y: cY })?.camera.pan(
				this.ctx.vars.drag.prev[0] - cX,
				this.ctx.vars.drag.prev[1] - cY
			);
		}

		// Store current coordinates as previous for next move event
		this.ctx.vars.drag.prev = [cX, cY];
	}

	/**
	 * Handles the end of a drag/pan operation (pointerup).
	 * @param e Optional PointerEvent.
	 * @param noKinetic If true, prevents kinetic coasting animation.
	 * @param noDispatch If true, suppresses the 'panend' event.
	 */
	stop(e?: PointerEvent, noKinetic = false, noDispatch = false): void {
		if (!this.ctx.isPanning()) return;

		this.ctx.setPanning(false);
		this.ctx.vars.drag.prev = undefined;

		// Remove listeners
		this.ctx.micrio.removeEventListener('pointermove', this.move, eventPassive);
		this.ctx.micrio.removeEventListener('pointerup', this.stop, eventPassive);

		// Release pointer capture if active
		if (this.ctx.capturedPointerId) {
			this.ctx.micrio.releasePointerCapture(this.ctx.capturedPointerId);
		}
		this.ctx.setCapturedPointerId(undefined);

		this.ctx.micrio.removeAttribute('data-panning');

		// Notify Wasm pan stopped (triggers kinetic animation if enabled and not suppressed)
		if (e && noKinetic == false) {
			const img = this.ctx.getImage({ x: e.clientX, y: e.clientY });
			if (img) {
				this.ctx.micrio.wasm.e._panStop(img.ptr);
				this.ctx.micrio.wasm.render();
			}
		}

		// Dispatch 'panend' event unless suppressed
		if (!noDispatch) this.ctx.dispatch('panend', !e ? undefined : {
			'duration': performance.now() - this.ctx.vars.drag.start[2],
			'movedX': e.clientX - this.ctx.vars.drag.start[0],
			'movedY': e.clientY - this.ctx.vars.drag.start[1]
		});
	}
}

