<script lang="ts">
	/**
	 * MediaControls.svelte - Renders playback controls for the Media component.
	 *
	 * Displays buttons for play/pause, mute/unmute, subtitles toggle, fullscreen,
	 * and a draggable progress bar.
	 */

	// Import the global captionsEnabled store defined in the module script
	import { captionsEnabled } from '../common/Subtitles.svelte';
	import { i18n } from '../../ts/i18n'; // For button titles

	// UI Components
	import Button from '../ui/Button.svelte';
	import Fullscreen from '../ui/Fullscreen.svelte';
	import ProgressBar from '../ui/ProgressBar.svelte';

	// --- Props ---
	interface Props {
		/** Current playback time in seconds (bindable). */
		currentTime?: number;
		/** Total duration of the media in seconds (bindable). */
		duration?: number;
		/** Is the media currently seeking? (bindable). */
		seeking?: boolean;
		/** Is the media currently muted? (bindable). */
		muted?: boolean;
		/** If true, display minimal controls (only play/pause button with progress circle). */
		minimal?: boolean;
		/** Current volume level (0-1) (bindable). */
		volume: number;
		/** Is the media currently paused? (bindable). */
		paused: boolean;
		/** Has the media ended? (bindable). */
		ended: boolean;
		/** Optional target element for fullscreen requests. */
		fullscreen?: HTMLElement|undefined;
		/** Does the media have subtitles available? */
		subtitles?: boolean;
		onplaypause?: Function;
		onmute?: Function;
		onseek?: (n:number) => void;
	}

	let {
		currentTime = $bindable(),
		duration = $bindable(0),
		seeking = $bindable(true),
		muted = $bindable(false),
		minimal = false,
		volume = $bindable(),
		paused = $bindable(),
		ended = $bindable(),
		fullscreen = undefined,
		subtitles = false,
		onplaypause,
		onmute,
		onseek
	}: Props = $props();

	// --- Reactive Declarations ---

	/** Determine if audio controls (mute button) should be shown. */
	let hasAudio = $derived(!isNaN(volume));

	// --- Progress Bar Dragging Logic ---

	/** Flag indicating if the user is currently dragging the progress bar handle. */
	let dragging:boolean = false;
	/** Reference to the progress bar element. */
	let _bar:HTMLElement|undefined = $state();

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
		const rect = _bar!.getClientRects()[0]; // Get progress bar dimensions
		// Calculate percentage based on click position, clamped between 0 and 1
		const perc = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
		// Dispatch 'seek' event with the target time
		onseek?.(perc * duration);
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
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside onclick={e => e.stopPropagation()} onkeydown={e => e.stopPropagation()}>
	<!-- Play/Pause Button -->
	<Button
		type={!paused ? 'pause' : 'play'}
		title={!paused ? $i18n.pause : $i18n.play}
		onclick={onplaypause}
	>
		<!-- Optional circular progress indicator within the play/pause button (for minimal mode) -->
		{#if minimal && currentTime !== undefined && currentTime > 0}
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
				onclick={onmute}
			/>
		{/if}
		<!-- Subtitles Toggle Button -->
		{#if subtitles}
			<Button type={$captionsEnabled ? 'subtitles' : 'subtitles-off'} active={$captionsEnabled}
				title={$i18n.subtitlesToggle}
				onclick={() => captionsEnabled.set(!$captionsEnabled)}
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
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="bar active" bind:this={_bar} onmousedown={dStart}
			style={`--progress:${((currentTime??0)/duration)*100}%;`}></div>
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
