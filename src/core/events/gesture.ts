import { Browser } from '$utils/browser';
import { noEventPassive, type EventContext } from './shared';

/**
 * macOS trackpad gesture event handler module.
 * Handles gesturestart/gesturechange/gestureend events for trackpad pinch-to-zoom.
 * @internal
 */
export class GestureHandler {
	#ctx: EventContext;

	/**
	 * @param ctx The shared event context.
	 */
	constructor(ctx: EventContext) {
		this.#ctx = ctx;
	}

	/** Hooks macOS gesture event listeners. */
	hook(): void {
		if (Browser.OSX) {
			this.#ctx._micrio.addEventListener('gesturestart', this.#handle, noEventPassive);
			this.#ctx._micrio.addEventListener('gesturechange', this.#handle, noEventPassive);
			this.#ctx._micrio.addEventListener('gestureend', this.#handle, noEventPassive);
		}
	}

	/** Unhooks macOS gesture event listeners. */
	unhook(): void {
		if (Browser.OSX) {
			this.#ctx._micrio.removeEventListener('gesturestart', this.#handle, noEventPassive);
			this.#ctx._micrio.removeEventListener('gesturechange', this.#handle, noEventPassive);
			this.#ctx._micrio.removeEventListener('gestureend', this.#handle, noEventPassive);
		}
	}

	/**
	 * GestureEvent interface for macOS trackpad gestures.
	 * @param e The Event object.
	 * @returns Gesture data or null if not a gesture event.
	 */
	#getGestureEvent(e: Event): { scale: number; clientX: number; clientY: number } | null {
		if ('scale' in e && typeof (e as { scale: unknown }).scale === 'number') {
			const ge = e as Event & { scale: number; clientX: number; clientY: number };
			return { scale: ge.scale, clientX: ge.clientX, clientY: ge.clientY };
		}
		return null;
	}

	/**
	 * Handles macOS trackpad gesture events.
	 * Translates gesture scale into zoom actions.
	 * @param e The GestureEvent.
	 */
	#handle = (e: Event): void => {
		const gesture = this.#getGestureEvent(e);
		if (!gesture || gesture.scale === 1) return;
		if (e.target instanceof Element && e.target != this.#ctx._el) return;

		const diff = this.#ctx._pScale - gesture.scale;
		this.#ctx._pScale = gesture.scale;

		e.stopPropagation();
		e.preventDefault();

		if (e.type == 'gesturechange') {
			this.#ctx._getImage({ x: gesture.clientX, y: gesture.clientY })?.camera.zoom(
				diff * this.#ctx._micrio.canvas.viewport.height,
				0,
				gesture.clientX,
				gesture.clientY
			);
		}
	}
}

