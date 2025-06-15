<script lang="ts">
	/**
	 * ProgressCircle.svelte - Displays a circular progress indicator.
	 *
	 * Used primarily during initial loading to show download progress.
	 * Renders an SVG circle with a stroke that animates based on the `progress` prop.
	 */

	import { fade } from 'svelte/transition'; // Used for fade in/out animation

	// --- Props ---
	interface Props {
		/** The progress value (0 to 1). */
		progress: number;
	}

	let { progress }: Props = $props();

	// --- SVG Calculations ---

	/** SVG viewbox size. */
	const size:number = 100;
	/** Radius of the progress circle. */
	const radius = 40;
	/** Circumference of the progress circle. */
	const circ = 2 * Math.PI * radius;

	// --- Reactive Declarations (`$:`) ---

	/** Calculate the stroke-dashoffset based on progress to animate the circle fill. */
	const offset = $derived(circ * (1-progress));

</script>

<!-- SVG container -->
<!-- Apply fade transitions with a delay on entry -->
<svg in:fade={{delay: 500}} out:fade width="100" height="100" viewBox="0 0 {size} {size}">
	<!-- Background circle (track) -->
	<circle r={radius} cx={size/2} cy={size/2} fill="transparent" stroke="#e0e0e0" stroke-width="8px"></circle>
	<!-- Progress circle (filled portion) -->
	<!-- stroke-dasharray defines the total length -->
	<!-- stroke-dashoffset moves the start point of the stroke, creating the filling effect -->
	<circle r={radius} cx={size/2} cy={size/2} fill="transparent" stroke="#00d4ee" stroke-width="8px" stroke-dasharray="{circ}px" stroke-dashoffset="{offset}px"></circle>
</svg>

<style>
	svg {
		/* Centering the SVG */
		position: absolute;
		top: 50%;
		left: 50%;
		pointer-events: none; /* Not interactive */
		/* Center and rotate to start progress from the top */
		transform: translate(-50%,-50%) rotateZ(-90deg);
		z-index: 10; /* Ensure visibility */
	}
	circle {
		/* Smooth transition for the stroke offset animation */
		transition: stroke-dashoffset .25s ease;
	}
</style>
