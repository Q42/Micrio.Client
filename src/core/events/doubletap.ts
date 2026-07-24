import { Browser } from '$utils/browser';
import type { EventContext } from './shared';

/**
 * Double-tap/click event handler module.
 * Handles double-tap (touch) and double-click (mouse) events for zooming.
 */
export class DoubleTapHandler {
	#ctx: EventContext;

	constructor(ctx: EventContext) {
		this.#ctx = ctx;
	}

	/** Hooks double-tap event listener (mobile). */
	hookTap(): void {
		this.#ctx._el.addEventListener('touchstart', this.#tap);
	}

	/** Unhooks double-tap event listener. */
	unhookTap(): void {
		this.#ctx._el.removeEventListener('touchstart', this.#tap);
	}

	/** Hooks double-click event listener (desktop). */
	hookClick(): void {
		this.#ctx._el.addEventListener('dblclick', this.#click);
	}

	/** Unhooks double-click event listener. */
	unhookClick(): void {
		this.#ctx._el.removeEventListener('dblclick', this.#click);
	}

	/**
	 * Handles double-tap detection on touch devices.
	 * @param e The TouchEvent.
	 */
	#tap = (e: TouchEvent | Event): void => {
		if (!Browser.hasTouch || !(e instanceof TouchEvent)) return;
		const now = performance.now();

		// If tap occurs within 250ms of the previous tap, trigger double-click logic
		if (e.touches.length == 1 && now - this.#ctx._vars._dbltap._lastTapped < 250) {
			e.stopPropagation();
			e.preventDefault();
			this.#click(e);
		}
		this.#ctx._vars._dbltap._lastTapped = now;
	}

	/**
	 * Handles double-click (mouse) or double-tap (touch) events for zooming.
	 * Zooms in if zoomed out, zooms out fully otherwise.
	 * @param e The MouseEvent or TouchEvent.
	 */
	#click = (e: MouseEvent | TouchEvent): void => {
		const t = e instanceof TouchEvent ? e.touches[0] : e;
		const img = this.#ctx._getImage({ x: t.clientX, y: t.clientY });
		// Use zoom method with negative delta to zoom in, providing click coordinates
		img?.camera.zoom(-300, 500, t.clientX, t.clientY, 1, !this.#ctx._micrio.$current?.album).catch(() => {});
	}
}

