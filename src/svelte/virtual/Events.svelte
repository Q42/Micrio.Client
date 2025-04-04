<!-- @migration-task Error while migrating Svelte code: Unexpected token `>`. Did you mean `&gt;` or `{">"}`? -->
<script lang="ts">
	/**
	 * Events.svelte - Manages timed events within a video tour.
	 *
	 * This component takes an array of timed events (start, end, data) and
	 * monitors the `currentTime` prop. When the current time enters or exits
	 * the time range of an event, it dispatches a 'tour-event' on the main
	 * Micrio element, including the event data and an `active` flag.
	 *
	 * It's typically used internally by the Media component when rendering a video tour.
	 */

	import type { Models } from "../../types/models";
	import type { HTMLMicrioElement } from "../../ts/element";

	import { getContext, onDestroy } from 'svelte';

	// --- Props ---

	interface Props {
		/** Array of timed event objects. */
		events: Models.ImageData.Event[];
		/** Current playback time in seconds (bindable). */
		currentTime?: number;
		/** Total duration of the media in seconds (used to clamp event end times). */
		duration: number;
	}

	let { events, currentTime = 0, duration }: Props = $props();

	// --- Context ---

	/** Get the main Micrio element instance from context. */
	const micrio = <HTMLMicrioElement>getContext('micrio');

	// --- Initialization ---

	// Sanitize event start/end times upon initialization.
	// Ensure start/end are numbers and clamp end time to media duration.
	events.forEach(e=>{
		e.start = Number(e.start||0); // Default start to 0 if missing
		e.end = Math.min(Number(e.end||0), duration); // Default end to 0, clamp to duration
	});

	// --- Event Dispatch Logic ---

	/**
	 * Updates the active state of each event based on the current time
	 * and dispatches 'tour-event' when an event becomes active or inactive.
	 * @param time The current playback time in seconds.
	 */
	const update = (time:number):void => events.forEach(e => {
		// Determine if the event should be active at the current time
		const active = e.start <= time && e.end >= time;
		// If the active state changed since the last check
		if(active != !!e.active) { // Use !! to coerce potential undefined to boolean
			e.active = active; // Update the event's active state
			// Dispatch the 'tour-event' with the event data and new active state
			micrio.events.dispatch('tour-event', {...e});
		}
	});

	// --- Reactive Update ---

	/** Reactively call the update function whenever currentTime changes. */
	$effect(() => {
		update(currentTime);
	});

	// --- Lifecycle (onDestroy) ---

	/** When the component is destroyed, call update with Infinity to ensure all events are marked as inactive. */
	onDestroy(() => update(Infinity));

</script>

<!-- This component does not render any visible elements -->
