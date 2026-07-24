import { Browser } from '$utils/browser';
import { noEventPassive, type EventContext } from './shared';

/**
 * Mouse wheel/scroll event handler module.
 * Handles wheel events for zooming and panning.
 * @internal
 */
export class WheelHandler {
	/** Flag indicating if scroll listeners are attached. */
	hooked = false;
	/** Timeout ID for debouncing the 'wheelend' event. */
	#wheelEndTo = -1;
	#ctx: EventContext;

	/**
	 * @param ctx The shared event context.
	 */
	constructor(ctx: EventContext) {
		this.#ctx = ctx;
	}

	/** Hooks mouse wheel/scroll event listeners. */
	hook(): void {
		if (this.hooked) return;
		this.#ctx._micrio.addEventListener('wheel', this.handle, noEventPassive);
		this.hooked = true;
	}

	/** Unhooks mouse wheel/scroll event listeners. */
	unhook(): void {
		this.#ctx._micrio.removeEventListener('wheel', this.handle, noEventPassive);
		this.hooked = false;
	}

	/**
	 * Handles mouse wheel events for zooming.
	 * @param e The WheelEvent.
	 * @param force Force handling even if conditions normally prevent it.
	 * @param offX Optional X offset for zoom focus.
	 */
	handle = (e: WheelEvent | Event, force = false, offX = 0): void => {
		if (!(e instanceof WheelEvent)) return;

		if (this.#ctx._controlZoom && !e.ctrlKey) return;
		if (!force && e.target instanceof Element && e.target != this.#ctx._el &&
			!e.target.classList.contains('marker') && !e.target.closest('[data-scroll-through]')) return;

		let delta = e.deltaY;

		if (e.ctrlKey) this.#ctx._hasUsedCtrl = true;

		const isControlZoomWithMouse = this.#ctx._controlZoom && (delta * 10 % 1 == 0);
		const isTouchPad = this.#ctx._hasUsedCtrl && !isControlZoomWithMouse;
		const isZoom = Browser.firefox || e.ctrlKey || !isTouchPad;

		if (this.#ctx._twoFingerPan && this.#ctx._micrio.$current?.camera.isZoomedOut()) return;

		e.stopPropagation();
		e.preventDefault();

		if ((Browser.OSX || isTouchPad) && e.ctrlKey) delta *= 10;

		const coo = { x: e.clientX, y: e.clientY };
		const image = this.#ctx._getImage(coo);
		if (!image) return;

		if (isZoom) {
			const c = this.#ctx._micrio.canvas.viewport;
			let offY = 0;

			const box = this.#ctx._micrio.getBoundingClientRect();
			image.camera.zoom(delta * 1 / Math.sqrt(c.scale), 0, coo.x - offX - box.left, coo.y - box.top - offY);
		}
		else image.camera.pan(e.deltaX, e.deltaY);

		this.#ctx._wheeling = true;

		clearTimeout(this.#wheelEndTo);
		this.#wheelEndTo = setTimeout(this.#end, 50) as unknown as number;
	}

	/** Clears the wheeling state after a short delay. */
	#end = (): void => {
		this.#ctx._wheeling = false;
	}
}

