<script lang="ts">
	/**
	 * Dial.svelte - A horizontal dial control for rotating Omni objects.
	 *
	 * Displays a visual dial that the user can drag horizontally to rotate
	 * an Omni object. Dispatches 'turn' events with the calculated target frame index.
	 * Can optionally display the current rotation in degrees.
	 */

	import type { HTMLMicrioElement } from '../../ts/element';

	import { createEventDispatcher, getContext } from 'svelte';

	// --- Props ---

	/** Current rotation value (0-360 degrees), provided by the parent Gallery component. */
	export let currentRotation:number;
	/** Total number of frames in the Omni object rotation. */
	export let frames:number;
	/** If true, display the current rotation value in degrees. */
	export let degrees:boolean|undefined;

	// --- Setup ---

	/** Svelte event dispatcher. */
	const dispatch = createEventDispatcher();

	/** Get the main Micrio element instance from context. */
	const micrio = <HTMLMicrioElement>getContext('micrio');
	/** Get the camera instance from the current image. Assumes $current is defined. */
	const camera = micrio.$current!.camera;

	// --- Drag State ---

	/** Reference to the main div element acting as the dial. */
	let _dial:HTMLElement;
	/** ID of the pointer currently dragging the dial. */
	let pointerId:number|undefined;
	/** ClientX position where the drag started. */
	let startX:number = 0;
	/** Rotation value when the drag started. */
	let startRot:number = 0;

	// --- Event Handlers ---

	/** Starts the dial drag interaction. */
	function dStart(e:PointerEvent) {
		if(e.button != 0) return; // Ignore non-primary button clicks
		// Add listeners to the main micrio element to capture movement/release outside the dial
		micrio.addEventListener('pointermove', dMove);
		micrio.addEventListener('pointerup', dStop);
		micrio.setAttribute('data-panning',''); // Indicate panning state visually
		micrio.setPointerCapture(pointerId=e.pointerId); // Capture pointer events
		// Store initial state
		startRot = currentRotation;
		startX = e.clientX;
	}

	/** Handles pointer movement during drag. */
	function dMove(e:PointerEvent) {
		// Calculate effective scale based on current zoom level (makes dragging less sensitive when zoomed in)
		const scale = Math.max(1, (camera.getXY(1, .5)[0] - camera.getXY(0, .5)[0]) / micrio.offsetWidth);
		// Calculate target frame index based on drag distance, dial width, scale, and total frames
		const targetFrame = (startRot / 360 + ((startX - e.clientX) / (_dial.offsetWidth * scale))) * frames;
		// Dispatch 'turn' event with the calculated target frame index
		dispatch('turn', targetFrame);
	}

	/** Stops the dial drag interaction. */
	function dStop() {
		if(pointerId) micrio.releasePointerCapture(pointerId); // Release pointer capture
		micrio.removeAttribute('data-panning'); // Clear panning state
		// Remove window listeners
		micrio.removeEventListener('pointermove', dMove);
		micrio.removeEventListener('pointerup', dStop);
	}

	// --- Reactive Calculations ---

	/** Calculate the background offset based on current rotation and dial width for visual feedback. */
	$: offset = -currentRotation / 360 * (_dial?.offsetWidth ?? 0);

</script>

<!-- Main dial container div -->
<!-- Bind element reference, attach pointerdown listener, apply background offset style -->
<!-- Allow scrolling over element -->
<div
	bind:this={_dial}
	on:pointerdown|stopPropagation|preventDefault|capture={dStart}
	style="--micrio-dial-offset:{offset}px;"
	data-scroll-through
>
	<!-- Optionally display current rotation in degrees -->
	{#if degrees}<span>{Math.round(currentRotation*10)/10}º</span>{/if}
</div>

<style>
	div {
		/* Positioning and basic appearance */
		position: absolute;
		bottom: var(--micrio-border-margin);
		width: 320px; /* Default width */
		/* Limit width based on viewport/container */
		max-width: calc(100vw - calc(2 * (var(--micrio-button-size) + 4 * var(--micrio-border-margin))));
		max-width: calc(100cqw - calc(2 * (var(--micrio-button-size) + 4 * var(--micrio-border-margin))));
		left: 50%;
		transform: translateX(-50%); /* Center horizontally */
		height: calc(var(--micrio-button-size) * 0.6); /* Relative height */
		touch-action: none; /* Prevent default touch actions */
		background-color: transparent; /* No background color */
		cursor: w-resize; /* Horizontal resize cursor */
		overflow: hidden; /* Hide overflowing pseudo-elements */
	}
	/* Pseudo-elements for visual dial lines */
	div::before, div::after {
		content: '';
		display: block;
		width: 100%;
		position: absolute;
		/* Apply calculated background offset */
		background-position: var(--micrio-dial-offset, 0px);
	}
	/* Smaller tick marks */
	div::before {
		height: 50%;
		top: 25%; /* Center vertically */
		/* Repeating gradient for small ticks */
		background-image: repeating-linear-gradient(to right, #8888 0%, #8888 0.5%, transparent 1%, transparent 2.5%);
	}
	/* Larger tick marks */
	div::after {
		height: 100%;
		/* Repeating gradient for large ticks */
		background-image: repeating-linear-gradient(to right, #fff8 0%, #fff8 0.5%, transparent 1%, transparent 20%);
	}
	/* Degree display text */
	span {
		position: absolute;
		display: block;
		bottom: 0;
		line-height: calc(var(--micrio-button-size) * 0.6); /* Match container height */
		left: 50%;
		transform: translateX(calc(-50% + 5px)); /* Center horizontally with slight offset */
		color: var(--micrio-color);
		opacity: .85;
		pointer-events: none; /* Not interactive */
		text-shadow: 1px 1px 3px #000, -1px -1px 3px #000; /* Shadow for readability */
		font-size: smaller; /* Smaller font size */
	}
</style>
