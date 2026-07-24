import type { EventContext } from './shared';
import { Grid } from '$grid/grid';

/**
 * Keyboard event handler module.
 * Handles keydown events for keyboard navigation (arrows, +/-).
 */
export class KeyboardHandler {
	#ctx: EventContext;

	constructor(ctx: EventContext) {
		this.#ctx = ctx;
	}

	/** Hooks keyboard event listeners. */
	hook(): void {
		document.addEventListener('keydown', this.#handle);
	}

	/** Unhooks keyboard event listeners. */
	unhook(): void {
		document.removeEventListener('keydown', this.#handle);
	}

	/**
	 * Handles keydown events for keyboard navigation.
	 * @param e The KeyboardEvent.
	 */
	#handle = (e: KeyboardEvent): void => {
		if (this.#ctx._panning || this.#ctx._pinching || !this.#ctx._micrio.$current?.camera) return;

		// Bypass arrow handling when a grid is actively handling keys
		if (Grid._handlingKeys && (e.key.startsWith('Arrow') || e.key == 'Enter' || e.key == ' ' || e.key == 'Escape')) return;

		const c = this.#ctx._micrio.$current.camera;
		const hWidth = this.#ctx._micrio.offsetWidth / 2;
		const hHeight = this.#ctx._micrio.offsetHeight / 2;
		const dur = 150;
		let dX = 0;
		let dY = 0;

		switch (e.key) {
			case 'ArrowUp': dY -= hHeight; break;
			case 'ArrowDown': dY += hHeight; break;
			case 'ArrowLeft': dX -= hWidth; break;
			case 'ArrowRight': dX += hWidth; break;
			case '+': case '=': c.zoom(-200, dur).catch(() => {}); break;
			case '-': case '_': c.zoom(200, dur).catch(() => {}); break;
			default: return; // Ignore other keys
		}

		e.preventDefault();
		e.stopPropagation();

		if (dX != 0 || dY != 0) c.pan(dX, dY, dur);
	}
}

