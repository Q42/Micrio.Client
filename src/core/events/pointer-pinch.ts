import { eventPassive, eventPassiveCapture, type EventContext } from './shared';
import type { DragHandler } from './drag';
import { pinchStart, pinchMove, pinchStop, restartPanning } from './pinch-shared';

/**
 * Pointer-based pinch event handler module.
 * Handles pointerdown/pointermove/pointerup events for pinch-to-zoom gestures.
 * Works on Windows touchscreens, Android, and other platforms supporting Pointer Events.
 */
export class PointerPinchHandler {
	constructor(
		private ctx: EventContext,
		private dragHandler: DragHandler
	) {}

	/** Hooks pointer pinch event listeners. */
	hook(): void {
		this.ctx.micrio.addEventListener('pointerdown', this.start, eventPassive);
		self.addEventListener('pointerup', this.end, eventPassive);
		self.addEventListener('pointercancel', this.end, eventPassive);
	}

	/** Unhooks pointer pinch event listeners. */
	unhook(): void {
		this.ctx.micrio.removeEventListener('pointerdown', this.start, eventPassive);
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
	start = (e: PointerEvent): void => {
		if (e.pointerType !== 'touch') return;

		this.ctx.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

		if (this.ctx.activePointers.size === 2 && !this.ctx.isPinching()) {
			const pointers = Array.from(this.ctx.activePointers.values());
			const p1 = pointers[0], p2 = pointers[1];

			this.ctx.vars.pinch.image = this.ctx.getImage({ x: p1.x, y: p1.y });
			this.ctx.vars.pinch.sDst = Math.hypot(p1.x - p2.x, p1.y - p2.y);

			self.addEventListener('pointermove', this.move, eventPassiveCapture);
			pinchStart(this.ctx, this.dragHandler);
		}
	}

	/**
	 * Handles pointer move during a multi-touch pinch gesture.
	 * @param e The PointerEvent.
	 */
	private move = (e: PointerEvent): void => {
		if (e.pointerType !== 'touch') return;
		if (!this.ctx.activePointers.has(e.pointerId)) return;
		this.ctx.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

		if (!this.ctx.isPinching() || this.ctx.activePointers.size !== 2) return;

		const pointers = Array.from(this.ctx.activePointers.values());
		const coo = { x: pointers[0].x, y: pointers[0].y };
		const coo2 = { x: pointers[1].x, y: pointers[1].y };

		pinchMove(this.ctx, coo, coo2);
	}

	/**
	 * Handles pointer up/cancel - always called to track active pointers.
	 * Also ends pinch gesture when needed.
	 * @param e The PointerEvent.
	 */
	end = (e: PointerEvent): void => {
		if (e.pointerType !== 'touch') return;

		this.ctx.activePointers.delete(e.pointerId);

		if (this.ctx.isPinching() && this.ctx.activePointers.size < 2) {
			self.removeEventListener('pointermove', this.move, eventPassiveCapture);
			pinchStop(this.ctx, e, this.move);

			restartPanning(this.ctx, this.dragHandler, this.ctx.activePointers);
		}
	}
}

