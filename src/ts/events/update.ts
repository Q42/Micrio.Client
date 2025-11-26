import type { Models } from '../../types/models';
import type { EventContext } from './shared';

/**
 * List of internal Micrio event types that should trigger a debounced 'update' event.
 * The 'update' event signals that the overall state relevant for external integrations might have changed.
 * @readonly
 */
export const UpdateEvents: (keyof Models.MicrioEventMap)[] = [
	'move',
	'marker-open',
	'marker-opened',
	'marker-closed',
	'tour-start',
	'tour-step',
	'tour-stop',
	'tour-event',
	'media-play',
	'media-pause',
	'splitscreen-start',
	'splitscreen-stop',
];

/**
 * Update event handler module.
 * Manages debounced 'update' event dispatching when internal state changes.
 */
export class UpdateHandler {
	constructor(private ctx: EventContext) {
		this.handleEvent = this.handleEvent.bind(this);
		this.dispatch = this.dispatch.bind(this);
	}

	/** Hooks listeners for events that should trigger a debounced 'update' event. */
	hook(): void {
		UpdateEvents.forEach(t => this.ctx.micrio.addEventListener(t, this.handleEvent));
	}

	/** Unhooks listeners for the debounced 'update' event. */
	unhook(): void {
		UpdateEvents.forEach(t => this.ctx.micrio.removeEventListener(t, this.handleEvent));
	}

	/**
	 * Event listener callback that queues the event type and triggers the debounced dispatch.
	 * @param e The Event object.
	 */
	private handleEvent(e: Event): void {
		// Don't fire non-user move events
		if (e.type == 'move' && !this.ctx.isPanning() && !this.ctx.isPinching() && !this.ctx.isWheeling()) return;

		// Add event type to stack if not already present
		const s = this.ctx.vars.updates.stack;
		if (s[s.length - 1] != e.type) s.push(e.type);

		// Clear existing timeout and set a new one
		clearTimeout(this.ctx.vars.updates.to);
		if (this.ctx.vars.updates.to < 0) {
			this.ctx.vars.updates.to = setTimeout(this.dispatch) as unknown as number;
		}
	}

	/**
	 * Dispatches the 'update' event with the accumulated event types and current state.
	 * Clears the event stack.
	 */
	private dispatch(): void {
		const v = this.ctx.vars.updates;
		clearTimeout(v.to);
		v.to = -1;

		if (v.stack.length) {
			this.ctx.dispatch('update', v.stack);
			v.stack.length = 0;
			v.to = setTimeout(this.dispatch, 500) as unknown as number;
		}
	}
}

