<script lang="ts">
	/**
	 * ProgressBar.svelte - A reusable progress bar component, typically for media playback.
	 *
	 * Displays a visual progress bar with a draggable handle (via slotted content)
	 * and shows the current time and remaining/total duration.
	 */

	import { parseTime } from '../../ts/utils'; // Utility to format time strings

	// --- Props ---

	/** Current playback time in seconds (bindable). */
	export let currentTime:number = 0;
	/** Total duration of the media in seconds. */
	export let duration:number;
	/** Has the media ended? (bindable). Used for displaying duration vs. remaining time. */
	export let ended:boolean = false;

</script>

<!-- Main container -->
<!-- Stop propagation of clicks/keydowns to prevent interference -->
<!-- Set CSS variables for progress percentage and current time display -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
	class="container"
	on:click|stopPropagation
	on:keydown|stopPropagation
	style={`--progress: ${Math.round(((currentTime||0) / duration) * 10000) / 100}%;--time: '${parseTime(currentTime||0)}';`}
>
	<!-- Container for the visual bar elements -->
	<div class="bars">
		<!-- Slot for the draggable handle/clickable area -->
		<slot />
	</div>
	<!-- Time display: shows remaining time (negative) or total duration if ended/at start -->
	<div class="time">{parseTime(ended || currentTime <= 0 ? duration : (currentTime||0) - duration)}</div>
</div>

<style>
	div.container {
		/* Flex layout to align bar and time display */
		display: flex;
		width: auto; /* Allow container to size naturally */
		color: var(--micrio-color);
		background: var(--micrio-background);
		line-height: 8px; /* Base line height */
		flex: 1; /* Allow container to take available space */
		align-items: center; /* Center items vertically */
		cursor: default; /* Default cursor for the container */
	}
	div.bars {
		flex: 1; /* Bar takes remaining horizontal space */
		display: flex; /* Needed for potential slotted elements? */
		height: var(--micrio-progress-bar-height); /* Use CSS variable for height */
		background: var(--micrio-progress-bar-background); /* Background of the track */
		position: relative; /* For positioning pseudo-elements */
	}
	/* Styling for the slotted element (the clickable/draggable bar) */
	div.bars > :global(*) {
		height: 100%;
		width: 100%;
		display: block;
		box-sizing: border-box;
		position: relative; /* For pseudo-element positioning */
		cursor: pointer; /* Indicate interactivity */
		overflow: hidden; /* Hide pseudo-element overflow */
	}
	/* Progress indicator using a pseudo-element */
	div.bars > :global(*::before) {
		display: block;
		position: absolute;
		content: ' ';
		background: var(--micrio-color); /* Use theme color for progress */
		height: 100%;
		pointer-events: none; /* Not interactive */
		width: var(--progress, 0%); /* Width controlled by --progress CSS variable */
		will-change: width; /* Hint browser for optimization */
	}
	/* Scrubber handle using a pseudo-element */
	div.bars::after {
		content: '';
		position: absolute;
		display: block;
		width: 16px; /* Handle size */
		height: 16px;
		left: var(--progress); /* Position based on --progress variable */
		top: 50%;
		transform: translate3d(-50%,-50%,0); /* Center the handle */
		background-color: var(--micrio-color); /* Use theme color */
		pointer-events: none; /* Not interactive */
		border-radius: 8px; /* Circular handle */
	}
	/* Time display styling */
	div.time {
		display: block;
		font-size: 90%;
		min-width: 50px; /* Ensure space for time display */
		text-align: center;
		padding: 0 10px; /* Padding around time text */
		font-variant-numeric: tabular-nums; /* Use tabular figures for consistent spacing */
	}
</style>
