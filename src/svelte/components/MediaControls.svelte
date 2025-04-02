<script lang="ts">
	/**
	 * MediaControls.svelte - Renders playback controls for the Media component.
	 *
	 * Displays buttons for play/pause, mute/unmute, subtitles toggle, fullscreen,
	 * and a draggable progress bar.
	 */

	import { createEventDispatcher } from 'svelte';
	// Import the global captionsEnabled store defined in the module script
	import { captionsEnabled } from '../common/Subtitles.svelte';
	import { i18n } from '../../ts/i18n'; // For button titles

	// UI Components
	import Button from '../ui/Button.svelte';
	import Fullscreen from '../ui/Fullscreen.svelte';
	import ProgressBar from '../ui/ProgressBar.svelte';

	// --- Props ---

	/** Current playback time in seconds (bindable). */
	export let currentTime:number = 0;
	/** Total duration of the media in seconds (bindable). */
	export let duration:number = 0;
	/** Is the media currently seeking? (bindable). */
	export let seeking:boolean = true;
	/** Is the media currently muted? (bindable). */
	export let muted:boolean = false;
	/** If true, display minimal controls (only play/pause button with progress circle). */
	export let minimal:boolean = false;
	/** Current volume level (0-1) (bindable). */
	export let volume:number;
	/** Is the media currently paused? (bindable). */
	export let paused:boolean;
	/** Has the media ended? (bindable). */
	export let ended:boolean;
	/** Optional target element for fullscreen requests. */
	export let fullscreen:HTMLElement|undefined = undefined;
	/** Does the media have subtitles available? */
	export let subtitles:boolean = false;

	// --- Reactive Declarations ---

	/** Determine if audio controls (mute button) should be shown. */
	$: hasAudio = !isNaN(volume);

	// --- Event Dispatcher ---
	const dispatch = createEventDispatcher();

	// --- Progress Bar Dragging Logic ---

	/** Flag indicating if the user is currently dragging the progress bar handle. */
	let dragging:boolean = false;
	/** Reference to the progress bar element. */
	let _bar:HTMLElement;

	/** Starts the drag seeking operation. */
	function dStart(e:MouseEvent) : void {
		if(e.button != 0) return; // Ignore non-primary button clicks
		// Add listeners to the window to track movement outside the bar
		window.addEventListener('mousemove', dMove);
		window.addEventListener('mouseup', dStop);
		dragging = true;
		dMove(e); // Process initial click position immediately
	}

	/** Handles mouse movement during drag seeking. */
	function dMove(e:MouseEvent) : void {
		const rect = _bar.getClientRects()[0]; // Get progress bar dimensions
		// Calculate percentage based on click position, clamped between 0 and 1
		const perc = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
		// Dispatch 'seek' event with the target time
		dispatch('seek', perc * duration);
	}

	/** Stops the drag seeking operation. */
	function dStop() : void {
		// Remove window listeners
		window.removeEventListener('mousemove', dMove);
		window.removeEventListener('mouseup', dStop);
		dragging = false;
	}

</script>

<!-- Main controls container -->
<!-- Stop propagation of clicks/keydowns to prevent interaction with underlying elements -->
<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<aside on:click|stopPropagation on:keydown|stopPropagation>
	<!-- Play/Pause Button -->
	<Button
		type={!paused ? 'pause' : 'play'}
		title={!paused ? $i18n.pause : $i18n.play}
		on:click={() => dispatch('playpause')}
	>
		<!-- Optional circular progress indicator within the play/pause button (for minimal mode) -->
		{#if minimal && currentTime > 0}
			<svg height="42" width="42">
				<circle r="19" cx="21" cy="21" stroke-dashoffset={(1 - (currentTime / duration)) * 119.4} />
			</svg>
		{/if}
	</Button>
	<!-- Render additional controls only if not in minimal mode -->
	{#if !minimal}
		<!-- Mute/Unmute Button -->
		{#if hasAudio}
			<Button disabled={seeking} type={muted?'volume-off':'volume-up'}
				title={muted?$i18n.audioUnmute:$i18n.audioMute}
				on:click={() => dispatch('mute')}
			/>
		{/if}
		<!-- Subtitles Toggle Button -->
		{#if subtitles}
			<Button type={$captionsEnabled ? 'subtitles' : 'subtitles-off'} active={$captionsEnabled}
				title={$i18n.subtitlesToggle}
				on:click={() => captionsEnabled.set(!$captionsEnabled)}
			/>
		{/if}
		<!-- Fullscreen Button -->
		{#if !!fullscreen}<Fullscreen el={fullscreen} />{/if}
	{/if}
</aside>
<!-- Render progress bar only if not in minimal mode -->
{#if !minimal}
	<ProgressBar {duration} bind:currentTime bind:ended>
		<!-- Draggable area for seeking -->
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<div class="bar active" bind:this={_bar} on:mousedown={dStart}
			style={`--perc:${(currentTime/duration)*100}%;`}></div>
	</ProgressBar>
{/if}

<style>
	aside {
		cursor: default;
		position: relative;
		display: flex;
		align-items: center;
		margin: 0;
		background: var(--micrio-background);
	}
	/* Reset button styles within the controls */
	aside > :global(button) {
		border-radius: 0;
		margin: 0;
		border: none;
	}
	/* Add margin to the right of the last button */
	aside > :global(button:last-child) {
		margin-right: 16px;
	}
	/* Remove extra styling from direct children */
	aside > :global(*) {
		--micrio-button-background: none;
		--micrio-background-filter: none;
		--micrio-button-shadow: none;
	}
	/* Styling for controls when media is fullscreen */
	:global(:fullscreen) > aside {
		position: absolute;
		bottom: 5px;
		left: 50%;
		transform: translateX(-50%);
		width: 430px; /* Fixed width in fullscreen */
		max-width: 90vw; /* Limit width */
		max-width: 90cqw;
		border-radius: var(--micrio-border-radius); /* Add radius in fullscreen */
	}

	/* Styling for the circular progress indicator */
	svg {
		pointer-events: none;
		position: absolute;
		left: -1px;
		top: -1px;
		width: 42px;
		height: 42px;
		transform: rotateZ(-90deg); /* Start circle at the top */
	}

	circle {
		stroke-width: 2;
		stroke: #fff;
		fill: transparent;
		stroke-dasharray: 119.4 119.4; /* Circumference (2*PI*19) */
		transition: stroke-dashoffset .25s linear; /* Smooth progress update */
		transform-origin: center center;
	}
</style>
