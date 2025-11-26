import { Browser } from '../utils';
import { noEventPassive, type EventContext } from './shared';

/**
 * Mouse wheel/scroll event handler module.
 * Handles wheel events for zooming and panning.
 */
export class WheelHandler {
	/** Flag indicating if scroll listeners are attached. */
	hooked = false;
	/** Timeout ID for debouncing the 'wheelend' event. */
	private wheelEndTo = -1;

	constructor(private ctx: EventContext) {
		this.handle = this.handle.bind(this);
		this.end = this.end.bind(this);
	}

	/** Hooks mouse wheel/scroll event listeners. */
	hook(): void {
		if (this.hooked) return;
		this.ctx.micrio.addEventListener('wheel', this.handle, noEventPassive);
		this.hooked = true;
	}

	/** Unhooks mouse wheel/scroll event listeners. */
	unhook(): void {
		this.ctx.micrio.removeEventListener('wheel', this.handle, noEventPassive);
		this.hooked = false;
	}

	/**
	 * Handles mouse wheel events for zooming.
	 * @param e The WheelEvent.
	 * @param force Force handling even if conditions normally prevent it.
	 * @param offX Optional X offset for zoom focus.
	 */
	handle(e: WheelEvent | Event, force = false, offX = 0): void {
		if (!(e instanceof WheelEvent)) return;

		// Check if zoom is allowed based on settings and modifier keys
		if (this.ctx.isControlZoom() && !e.ctrlKey) return;
		if (!force && e.target instanceof Element && e.target != this.ctx.el &&
			!e.target.classList.contains('marker') && !e.target.closest('[data-scroll-through]')) return;

		let delta = e.deltaY;

		if (e.ctrlKey) this.ctx.setHasUsedCtrl(true);

		const isControlZoomWithMouse = this.ctx.isControlZoom() && (delta * 10 % 1 == 0);
		const isTouchPad = this.ctx.hasUsedCtrl && !isControlZoomWithMouse;
		const isZoom = Browser.firefox || e.ctrlKey || !isTouchPad;

		if (this.ctx.isTwoFingerPan() && this.ctx.micrio.$current?.camera.isZoomedOut()) return;

		// Prevent default scroll page behavior
		e.stopPropagation();
		e.preventDefault();

		// Trackpad pinch zoom amplify
		if ((Browser.OSX || isTouchPad) && e.ctrlKey) delta *= 10;

		const coo = { x: e.clientX, y: e.clientY };
		const image = this.ctx.getImage(coo);
		if (!image) return;

		// Do scroll/pinch zoom
		if (isZoom) {
			const c = this.ctx.micrio.canvas.viewport;
			let offY = 0;

			// TODO FIX ME
			const box = this.ctx.micrio.getBoundingClientRect();
			image.camera.zoom(delta * 1 / Math.sqrt(c.scale), 0, coo.x - offX - box.left, coo.y - box.top - offY);
		}
		// Pan x/y
		else image.camera.pan(e.deltaX, e.deltaY);

		this.ctx.setWheeling(true);

		// Debounce wheel end event
		clearTimeout(this.wheelEndTo);
		this.wheelEndTo = setTimeout(this.end, 50) as unknown as number;
	}

	/** Clears the wheeling state after a short delay. */
	private end(): void {
		this.ctx.setWheeling(false);
	}
}

