import type { EventContext } from './shared';

/**
 * Keyboard event handler module.
 * Handles keydown events for keyboard navigation (arrows, +/-).
 */
export class KeyboardHandler {
	constructor(private ctx: EventContext) {
		this.handle = this.handle.bind(this);
	}

	/** Hooks keyboard event listeners. */
	hook(): void {
		document.addEventListener('keydown', this.handle);
	}

	/** Unhooks keyboard event listeners. */
	unhook(): void {
		document.removeEventListener('keydown', this.handle);
	}

	/**
	 * Handles keydown events for keyboard navigation.
	 * @param e The KeyboardEvent.
	 */
	private handle(e: KeyboardEvent): void {
		if (this.ctx.isPanning() || this.ctx.isPinching() || !this.ctx.micrio.$current?.camera) return;

		const c = this.ctx.micrio.$current.camera;
		const hWidth = this.ctx.micrio.offsetWidth / 2;
		const hHeight = this.ctx.micrio.offsetHeight / 2;
		const dur = 150;
		let dX = 0;
		let dY = 0;

		switch (e.key) {
			case 'ArrowUp': dY -= hHeight; break;
			case 'ArrowDown': dY += hHeight; break;
			case 'ArrowLeft': dX -= hWidth; break;
			case 'ArrowRight': dX += hWidth; break;
			case '+': case '=': c.zoom(-200, dur); break; // Zoom in
			case '-': case '_': c.zoom(200, dur); break; // Zoom out
			default: return; // Ignore other keys
		}

		e.preventDefault();
		e.stopPropagation();

		if (dX != 0 || dY != 0) c.pan(dX, dY, dur);
	}
}

