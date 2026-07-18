import type { EventContext } from './shared';
import type { DragHandler } from './drag';

export function pinchStart(ctx: EventContext, dragHandler: DragHandler): void {
	ctx.vars.pinch.wasPanning = ctx.isPanning();
	dragHandler.stop(undefined, false, true);

	ctx.setPinching(true);
	ctx.micrio.setAttribute('data-pinching', '');
	ctx.setPinchFactor(undefined);

	if (ctx.vars.pinch.image) {
		ctx.vars.pinch.image.canvas?.camera.pinchStart();
	}
	ctx.micrio.engine.render();
	ctx.dispatch('pinchstart');
	if (ctx.isTwoFingerPan()) ctx.dispatch('panstart');
}

export function adjustSplitScreen(ctx: EventContext, coo: { x: number, y: number }, coo2: { x: number, y: number }): void {
	const i = ctx.vars.pinch.image;
	if (i?.opts.secondaryTo && i.opts.isPassive && i.opts.area) {
		const dX = i.opts.area[0] * ctx.micrio.offsetWidth;
		const dY = i.opts.area[1] * ctx.micrio.offsetHeight;
		coo.x -= dX; coo2.x -= dX;
		coo.y -= dY; coo2.y -= dY;
	}
}

export function pinchMove(ctx: EventContext, coo: { x: number, y: number }, coo2: { x: number, y: number }): void {
	const v = ctx.vars.pinch;
	const i = v.image;
	if (!i) return;

	adjustSplitScreen(ctx, coo, coo2);

	ctx.setPinchFactor(Math.hypot(coo.x - coo2.x, coo.y - coo2.y) / v.sDst);
	i.canvas?.camera.pinch(coo.x, coo.y, coo2.x, coo2.y);
}

export function pinchStop(ctx: EventContext, _e: Event, moveHandler: (...args: any[]) => void): void {
	if (!ctx.isPinching()) return;
	ctx.setPinching(false);

	self.removeEventListener('touchmove', moveHandler, { passive: true, capture: true } as AddEventListenerOptions);
	self.removeEventListener('pointermove', moveHandler, { passive: true, capture: true } as AddEventListenerOptions);

	ctx.micrio.removeAttribute('data-pinching');

	const i = ctx.vars.pinch.image;
	if (i) {
		i.canvas?.camera.pinchStop();
		ctx.micrio.engine.render();
	}
	ctx.vars.pinch.image = undefined;
	ctx.setPinchFactor(undefined);

	ctx.dispatch('pinchend');
	if (ctx.isTwoFingerPan() && !ctx.vars.pinch.wasPanning) {
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
			const remaining = Array.from(pointers.entries())[0];
			syntheticEvent = {
				button: 0, pointerType: 'touch', target: ctx.el,
				clientX: remaining[1].x, clientY: remaining[1].y,
				pointerId: remaining[0]
			} as unknown as PointerEvent;
		}
		dragHandler.start(syntheticEvent, true);
	}
}
