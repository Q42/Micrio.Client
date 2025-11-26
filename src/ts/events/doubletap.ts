import { Browser } from '../utils';
import type { EventContext } from './shared';

/**
 * Double-tap/click event handler module.
 * Handles double-tap (touch) and double-click (mouse) events for zooming.
 */
export class DoubleTapHandler {
	constructor(private ctx: EventContext) {
		this.tap = this.tap.bind(this);
		this.click = this.click.bind(this);
	}

	/** Hooks double-tap event listener (mobile). */
	hookTap(): void {
		this.ctx.el.addEventListener('touchstart', this.tap);
	}

	/** Unhooks double-tap event listener. */
	unhookTap(): void {
		this.ctx.el.removeEventListener('touchstart', this.tap);
	}

	/** Hooks double-click event listener (desktop). */
	hookClick(): void {
		this.ctx.el.addEventListener('dblclick', this.click);
	}

	/** Unhooks double-click event listener. */
	unhookClick(): void {
		this.ctx.el.removeEventListener('dblclick', this.click);
	}

	/**
	 * Handles double-tap detection on touch devices.
	 * @param e The TouchEvent.
	 */
	private tap(e: TouchEvent | Event): void {
		if (!Browser.hasTouch || !(e instanceof TouchEvent)) return;
		const now = performance.now();

		// If tap occurs within 250ms of the previous tap, trigger double-click logic
		if (e.touches.length == 1 && now - this.ctx.vars.dbltap.lastTapped < 250) {
			e.stopPropagation();
			e.preventDefault();
			this.click(e);
		}
		this.ctx.vars.dbltap.lastTapped = now;
	}

	/**
	 * Handles double-click (mouse) or double-tap (touch) events for zooming.
	 * Zooms in if zoomed out, zooms out fully otherwise.
	 * @param e The MouseEvent or TouchEvent.
	 */
	private click(e: MouseEvent | TouchEvent): void {
		const t = e instanceof TouchEvent ? e.touches[0] : e;
		const img = this.ctx.getImage({ x: t.clientX, y: t.clientY });
		// Use zoom method with negative delta to zoom in, providing click coordinates
		img?.camera.zoom(-300, 500, t.clientX, t.clientY, 1, !this.ctx.micrio.$current?.album).catch(() => {});
	}
}

