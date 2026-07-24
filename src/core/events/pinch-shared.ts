import type { EventContext } from './shared';
import type { DragHandler } from './drag';

/**
 * Initialises pinch state: stops panning, sets pinching flag, dispatches `pinchstart` event.
 * @internal
 * @param ctx The shared event context.
 * @param dragHandler The drag handler whose panning is suspended.
 */
export function pinchStart(ctx: EventContext, dragHandler: DragHandler): void {
	ctx._vars._pinch._wasPanning = ctx._panning;
	dragHandler.stop(undefined, false, true);

	ctx._pinching = true;
	ctx._micrio.setAttribute('data-pinching', '');
	ctx._pinchFactor = undefined;

	if (ctx._vars._pinch._image) {
		ctx._vars._pinch._image.canvas?.camera._pinchStart();
	}
	ctx._micrio._engine.render();
	ctx._dispatch('pinchstart');
	if (ctx._twoFingerPan) ctx._dispatch('panstart');
}

/**
 * Calculates the pinch scale factor and applies it to the camera.
 * @internal
 * @param ctx The shared event context.
 * @param coo First touch/pointer coordinates.
 * @param coo2 Second touch/pointer coordinates.
 */
export function pinchMove(ctx: EventContext, coo: { x: number, y: number }, coo2: { x: number, y: number }): void {
	const v = ctx._vars._pinch;
	const i = v._image;
	if (!i) return;

	ctx._pinchFactor = Math.hypot(coo.x - coo2.x, coo.y - coo2.y) / v._sDst;
	i.canvas?.camera._pinch(coo.x, coo.y, coo2.x, coo2.y);
}

/**
 * Ends the pinch gesture: cleans up listeners, updates camera, dispatches `pinchend` event.
 * @internal
 * @param ctx The shared event context.
 * @param _e The originating event (unused).
 * @param moveHandler The move handler to remove from the global listener.
 */
export function pinchStop(ctx: EventContext, _e: Event, moveHandler: (...args: any[]) => void): void {
	if (!ctx._pinching) return;
	ctx._pinching = false;

	self.removeEventListener('touchmove', moveHandler, { passive: true, capture: true } as AddEventListenerOptions);
	self.removeEventListener('pointermove', moveHandler, { passive: true, capture: true } as AddEventListenerOptions);

	ctx._micrio.removeAttribute('data-pinching');

	const i = ctx._vars._pinch._image;
	if (i) {
		i.canvas?.camera._pinchStop();
		ctx._micrio._engine.render();
	}
	ctx._vars._pinch._image = undefined;
	ctx._pinchFactor = undefined;

	ctx._dispatch('pinchend');
	if (ctx._twoFingerPan && !ctx._vars._pinch._wasPanning) {
		ctx._dispatch('panend');
	}
}

/**
 * If only one pointer remains after a pinch ends, synthesises a pointerdown event to resume panning.
 * @internal
 * @param ctx The shared event context.
 * @param dragHandler The drag handler to restart.
 * @param pointers The remaining active pointers.
 */
export function restartPanning(ctx: EventContext, dragHandler: DragHandler, pointers: Map<number, { x: number, y: number }> | TouchList): void {
	if (pointers instanceof TouchList ? pointers.length === 1 : pointers.size === 1) {
		let syntheticEvent: any;
		if (pointers instanceof TouchList) {
			const t = pointers[0];
			syntheticEvent = { button: 0, target: ctx._el, clientX: t.clientX, clientY: t.clientY } as unknown as PointerEvent;
		} else {
			const [pointerId, { x, y }] = pointers.entries().next().value!;
			syntheticEvent = {
				button: 0, pointerType: 'touch', target: ctx._el,
				clientX: x, clientY: y,
				pointerId
			} as unknown as PointerEvent;
		}
		dragHandler.start(syntheticEvent, true, true);
	}
}
