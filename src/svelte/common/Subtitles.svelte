<script lang="ts" context="module">
	/**
	 * Module script for Subtitles.svelte
	 *
	 * This script runs once when the module is first imported.
	 * It sets up a global writable store (`captionsEnabled`) to control subtitle visibility
	 * across the application and persists the user's preference in localStorage.
	 */
	import { writable } from 'svelte/store';

	/** Key used for storing caption preference in localStorage. */
	const k = 'micrio-captions-disable';
	/** Global writable store indicating if captions are enabled. Reads initial value from localStorage. */
	export const captionsEnabled = writable<boolean>(localStorage.getItem(k)!='1');
	// Subscribe to changes in the store to update localStorage.
	captionsEnabled.subscribe(b => {
		if(b) localStorage.removeItem(k); // Remove item if enabled
		else localStorage.setItem(k, '1'); // Set item to '1' if disabled
	});
</script>

<script lang="ts">
	/**
	 * Subtitles.svelte - Displays subtitles fetched from a VTT file.
	 *
	 * This component fetches a VTT file specified by the `src` prop, parses it,
	 * and displays the appropriate subtitle line based on the current media time
	 * provided by the parent context (usually from Media.svelte via Main.svelte).
	 * Visibility is controlled by the global `captionsEnabled` store.
	 */

	import type { HTMLMicrioElement } from '../../ts/element';
	import type { Models } from '../../types/models';

	import { fade } from 'svelte/transition';
	import { getContext, onMount } from 'svelte';

	// --- Props ---

	/** The URL of the VTT subtitle file. */
	export let src:string;
	/** If true, raises the position of the subtitles (e.g., to avoid overlapping controls). */
	export let raised:boolean = false;

	// --- State ---

	/** Array to store parsed subtitle events { start, end, data }. */
	const events:Models.ImageData.Event[] = []; // Re-using Event type, might need specific SubtitleCue type

	// --- Fetch and Parse VTT ---

	// Fetch the VTT file content as text
	fetch(src).then(r => r.text()).then(txt => {
		const s = txt.split('\n'); // Split into lines
		// Iterate through lines to parse cues
		for(let l=0; l<s.length; l++) {
			// Find timestamp lines (containing "-->")
			if(/-->/.test(s[l])) {
				let idx = l+1; // Index for subtitle text lines
				const lines = []; // Array to hold lines for the current cue

				// Skip empty lines after timestamp
				while(!s[idx] && idx < s.length) idx++;

				// Read subsequent lines until an empty line is found
				while(s[idx] && s[idx].trim()) lines.push(s[idx++]);

				// Parse start and end times from the timestamp line
				const [start,end] = s[l].split(' --> ')
					.map(t => t.trim().replace(',','.').split(':').map(Number)) // Split h:m:s.ms, convert parts to numbers
					.map(v => v[0]*3600+v[1]*60+v[2]); // Convert h:m:s.ms to total seconds

				// Push the parsed cue data to the events array
				events.push({start, end, data: lines.join('\n')});

				// Advance the main loop index past the processed lines
				l+=lines.length+1;
			}
		}
	});

	// --- Context & Time Update ---

	/** Get the main Micrio element instance from context. */
	const micrio = getContext<HTMLMicrioElement>('micrio');

	/** Local state variable to store the current media playback time. */
	let currentTime:number = 0;
	/** Event handler to update `currentTime` based on 'timeupdate' events dispatched by Media.svelte. */
	const setTime = (e:Event) => currentTime = (e as CustomEvent).detail;

	// --- Lifecycle ---

	/** Subscribe to 'timeupdate' events on mount, unsubscribe on destroy. */
	onMount(() => {
		micrio.addEventListener('timeupdate', setTime);
		return () => micrio.removeEventListener('timeupdate', setTime);
	});

	// --- Reactive Declarations (`$:`) ---

	/** Filter the parsed events to find the subtitle cue(s) active at the `currentTime`. */
	$: current = events.filter(e => e.start <= currentTime && e.end >= currentTime);

</script>

<!-- Render subtitles only if captions are enabled -->
{#if $captionsEnabled}
	<!-- Iterate through currently active subtitle cues -->
	{#each current as sub (sub)}
		<!-- Apply fade transition and 'raised' class conditionally -->
		<div transition:fade class:raised>
			<!-- Display subtitle text -->
			<p>{sub.data}</p>
		</div>
	{/each}
{/if}

<style>
	div {
		/* Positioning: centered horizontally, near the bottom */
		position: absolute;
		bottom: 50px;
		left: 50vw; /* Use viewport width units for centering */
		left: 50cqw; /* Use container query width units for centering */
		transform: translate3d(-50%, 0, 0); /* Center horizontally */
		text-align: center;
		color: #fff;
		width: 100vw; /* Use full viewport width initially */
		width: 100cqw; /* Use full container width */
		pointer-events: none; /* Allow clicks to pass through */
		transition: transform .2s ease; /* Smooth transition for 'raised' state */
	}
	/* Apply vertical offset when 'raised' class is present */
	div.raised {
		transform: translate3d(-50%, calc(-1 * var(--micrio-button-size)), 0);
	}
	/* Styling for the subtitle text paragraph */
	div p {
		margin: .5em 0;
		background-color: rgba(0, 0, 0, 0.6); /* Semi-transparent background for readability */
		padding: 0 14px; /* Horizontal padding */
		/* Ensure background applies to each line individually */
		-webkit-box-decoration-break: clone;
		box-decoration-break: clone;
		white-space: pre-wrap; /* Respect line breaks in the VTT data */
		display: inline; /* Allow background to fit text width */
		text-shadow: 2px 2px 1px #0005; /* Subtle text shadow */
		font-size: 2.5em; /* Relative font size */
		line-height: inherit; /* Inherit line height */
	}
	/* Responsive font size adjustment */
	@media (max-width: 640px) {
		div {
			width: 95vw; /* Slightly less width on small screens */
			width: 95cqw;
			font-size: 0.7em; /* Smaller base font size */
		}
	}
</style>
