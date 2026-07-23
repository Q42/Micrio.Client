import type { EventContext } from './shared';
import type { DragHandler } from './drag';

export function pinchStart(ctx: EventContext, dragHandler: DragHandler): void {
	ctx.vars.pinch.wasPanning = ctx.panning;
	dragHandler.stop(undefined, false, true);

	ctx.pinching = true;
	ctx.micrio.setAttribute('data-pinching', '');
	ctx.pinchFactor = undefined;

	if (ctx.vars.pinch.image) {
		ctx.vars.pinch.image.canvas?.camera._pinchStart();
	}
	ctx.micrio.engine.render();
	ctx.dispatch('pinchstart');
	if (ctx.twoFingerPan) ctx.dispatch('panstart');
}

export function pinchMove(ctx: EventContext, coo: { x: number, y: number }, coo2: { x: number, y: number }): void {
	const v = ctx.vars.pinch;
	const i = v.image;
	if (!i) return;

	ctx.pinchFactor = Math.hypot(coo.x - coo2.x, coo.y - coo2.y) / v.sDst;
	i.canvas?.camera._pinch(coo.x, coo.y, coo2.x, coo2.y);
}

export function pinchStop(ctx: EventContext, _e: Event, moveHandler: (...args: any[]) => void): void {
	if (!ctx.pinching) return;
	ctx.pinching = false;

	self.removeEventListener('touchmove', moveHandler, { passive: true, capture: true } as AddEventListenerOptions);
	self.removeEventListener('pointermove', moveHandler, { passive: true, capture: true } as AddEventListenerOptions);

	ctx.micrio.removeAttribute('data-pinching');

	const i = ctx.vars.pinch.image;
	if (i) {
		i.canvas?.camera._pinchStop();
		ctx.micrio.engine.render();
	}
	ctx.vars.pinch.image = undefined;
	ctx.pinchFactor = undefined;

	ctx.dispatch('pinchend');
	if (ctx.twoFingerPan && !ctx.vars.pinch.wasPanning) {
		ctx.dispatch('panend');
	}
}

export function restartPanning(ctx: EventContext, dragHandler: DragHandler, pointers: Map<number, { x: number, y: number }> | TouchList): void {
	if (pointers instanceof TouchList ? pointers.length === 1 : pointers.size === 1) {
		let syntheticEvent: any;
		if (pointers instanceof TouchList) {
			const t = pointers[0];
			syntheticEvent = { button: 0, target: ctx.el, clientX: t.clientX, clientY: t.clientY } as unknown as PointerEvent;
		} else {
			const [pointerId, { x, y }] = pointers.entries().next().value!;
			syntheticEvent = {
				button: 0, pointerType: 'touch', target: ctx.el,
				clientX: x, clientY: y,
				pointerId
			} as unknown as PointerEvent;
		}
		dragHandler.start(syntheticEvent, true, true);
	}
}
