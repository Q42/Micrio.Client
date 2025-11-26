import { pyth } from '../utils';
import { eventPassive, eventPassiveCapture, type EventContext } from './shared';
import type { DragHandler } from './drag';

/**
 * Pointer-based pinch event handler module.
 * Handles pointerdown/pointermove/pointerup events for pinch-to-zoom gestures.
 * Works on Windows touchscreens, Android, and other platforms supporting Pointer Events.
 */
export class PointerPinchHandler {
	constructor(
		private ctx: EventContext,
		private dragHandler: DragHandler
	) {
		this.start = this.start.bind(this);
		this.move = this.move.bind(this);
		this.end = this.end.bind(this);
	}

	/** Hooks pointer pinch event listeners. */
	hook(): void {
		this.ctx.el.addEventListener('pointerdown', this.start, eventPassive);
		self.addEventListener('pointerup', this.end, eventPassive);
		self.addEventListener('pointercancel', this.end, eventPassive);
	}

	/** Unhooks pointer pinch event listeners. */
	unhook(): void {
		this.ctx.el.removeEventListener('pointerdown', this.start, eventPassive);
		self.removeEventListener('pointerup', this.end, eventPassive);
		self.removeEventListener('pointercancel', this.end, eventPassive);
		// Clean up pinch move listener if it was active
		self.removeEventListener('pointermove', this.move, eventPassiveCapture);
		this.ctx.activePointers.clear();
	}

	/**
	 * Handles pointer down for multi-touch pinch detection.
	 * @param e The PointerEvent.
	 */
	start(e: PointerEvent): void {
		// Only handle touch pointer events (not mouse)
		if (e.pointerType !== 'touch') return;

		// Track this pointer
		this.ctx.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

		// If we now have exactly 2 pointers and not already pinching, start pinching
		if (this.ctx.activePointers.size === 2 && !this.ctx.isPinching()) {
			// Stop any panning that was active
			this.ctx.vars.pinch.wasPanning = this.ctx.isPanning();
			this.dragHandler.stop(undefined, false, true);

			this.ctx.setPinching(true);

			// Add move listener only during pinching (for performance)
			self.addEventListener('pointermove', this.move, eventPassiveCapture);

			this.ctx.micrio.setAttribute('data-pinching', '');

			// Get the two pointer positions
			const pointers = Array.from(this.ctx.activePointers.values());
			const p1 = pointers[0];
			const p2 = pointers[1];

			// Store target image and initial pinch distance
			this.ctx.vars.pinch.image = this.ctx.getImage({ x: p1.x, y: p1.y });
			this.ctx.vars.pinch.sDst = pyth(p1.x - p2.x, p1.y - p2.y);
			this.ctx.setPinchFactor(undefined);

			// Notify Wasm pinch started
			if (this.ctx.vars.pinch.image) {
				this.ctx.micrio.wasm.e._pinchStart(this.ctx.vars.pinch.image.ptr);
			}
			this.ctx.micrio.wasm.render();

			this.ctx.dispatch('pinchstart');
			if (this.ctx.isTwoFingerPan()) this.ctx.dispatch('panstart');
		}
	}

	/**
	 * Handles pointer move during a multi-touch pinch gesture.
	 * @param e The PointerEvent.
	 */
	private move(e: PointerEvent): void {
		// Only handle touch pointer events
		if (e.pointerType !== 'touch') return;

		// Update this pointer's position (only if we're tracking it)
		if (!this.ctx.activePointers.has(e.pointerId)) return;
		this.ctx.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

		// Must be pinching with exactly 2 pointers
		if (!this.ctx.isPinching() || this.ctx.activePointers.size !== 2) return;

		const pointers = Array.from(this.ctx.activePointers.values());
		const p1 = pointers[0];
		const p2 = pointers[1];

		const v = this.ctx.vars.pinch;
		const i = v.image;
		if (!i) return;

		// Prepare coordinates
		const coo = { x: p1.x, y: p1.y };
		const coo2 = { x: p2.x, y: p2.y };

		// Adjust coordinates if pinching on a passive split-screen image
		if (i?.opts.secondaryTo && i.opts.isPassive && i.opts.area) {
			const dX = i.opts.area[0] * this.ctx.micrio.offsetWidth;
			const dY = i.opts.area[1] * this.ctx.micrio.offsetHeight;
			coo.x -= dX; coo2.x -= dX;
			coo.y -= dY; coo2.y -= dY;
		}

		// Calculate current pinch factor relative to start distance
		this.ctx.setPinchFactor(pyth(p1.x - p2.x, p1.y - p2.y) / v.sDst);

		// Notify Wasm of pinch movement
		this.ctx.micrio.wasm.e._pinch(i.ptr, coo.x, coo.y, coo2.x, coo2.y);
	}

	/**
	 * Handles pointer up/cancel - always called to track active pointers.
	 * Also ends pinch gesture when needed.
	 * @param e The PointerEvent.
	 */
	end(e: PointerEvent): void {
		// Only handle touch pointer events
		if (e.pointerType !== 'touch') return;

		// Always remove this pointer from tracking
		this.ctx.activePointers.delete(e.pointerId);

		// If we were pinching and now have less than 2 pointers, end the pinch
		if (this.ctx.isPinching() && this.ctx.activePointers.size < 2) {
			this.ctx.setPinching(false);

			// Remove move listener (we keep up/cancel listeners for tracking)
			self.removeEventListener('pointermove', this.move, eventPassiveCapture);

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

			// If one pointer remains, restart panning with that finger
			if (this.ctx.activePointers.size === 1) {
				const remainingPointer = Array.from(this.ctx.activePointers.entries())[0];
				const syntheticEvent = {
					button: 0,
					pointerType: 'touch',
					target: this.ctx.el,
					clientX: remainingPointer[1].x,
					clientY: remainingPointer[1].y,
					pointerId: remainingPointer[0]
				} as unknown as PointerEvent;
				this.dragHandler.start(syntheticEvent, true);
			}
		}
	}
}

