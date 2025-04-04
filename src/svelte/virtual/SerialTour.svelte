<script lang="ts">
	/**
	 * SerialTour.svelte - Manages the playback and UI for serial marker tours.
	 *
	 * This component handles the logic for tours that navigate sequentially
	 * through markers, potentially across multiple images. It plays associated
	 * audio/video for each step, manages the overall progress bar, displays
	 * chapter lists (if enabled), and provides playback controls.
	 */

	import type { HTMLMicrioElement } from '../../ts/element';
	import type { Models } from '../../types/models';
	import type { MicrioImage } from '../../ts/image';

	import { onMount, getContext, tick, createEventDispatcher } from 'svelte';
	import { get, writable } from 'svelte/store';
	import { captionsEnabled } from '../common/Subtitles.svelte'; // Global subtitle state
	import { i18n } from '../../ts/i18n'; // For button titles

	// Component imports
	import Media from '../components/Media.svelte'; // Renders the audio/video for the current step
	import Button from '../ui/Button.svelte';
	import Fullscreen from '../ui/Fullscreen.svelte';
	import ProgressBar from '../ui/ProgressBar.svelte'; // Displays overall tour progress

	// --- Props ---
	interface Props {
		/** The marker tour data object. Assumes `stepInfo` has been populated. */
		tour: Models.ImageData.MarkerTour;
	}

	let { tour }: Props = $props();

	// --- Setup & State ---

	/** Assert that stepInfo exists and is populated (done during data enrichment). */
	const stepInfo = tour.stepInfo as Models.ImageData.MarkerTourStepInfo[];

	/** Svelte event dispatcher. */
	const dispatch = createEventDispatcher();

	/** Get Micrio instance and relevant stores/properties from context. */
	const micrio = <HTMLMicrioElement>getContext('micrio');
	const lang = micrio._lang;
	const image = micrio.$current as MicrioImage; // Assumes current image is set
	const marker = micrio.state.marker; // Active marker store
	const settings = image.$settings; // Current image settings

	/** Disable time scrubbing on the progress bar? */
	const noTimeScrub = !!settings?.ui?.controls?.serialTourNoTimeScrub;

	/** Calculate total duration of the tour by summing step durations. */
	const totalDuration:number = stepInfo.reduce((c, s) => c + s.duration, 0) ?? 0;
	/** Show playback controls? Defaults to true unless explicitly disabled in tour data. */
	const controls = 'controls' in tour ? tour.controls !== false : !tour.noControls;

	// --- Playback State ---
	/** Is the tour currently paused? */
	let paused:boolean = $state(false);
	/** Has the tour reached the end? */
	let ended:boolean = $state(false);
	/** Is the main Micrio instance muted? */
	let muted:boolean = $state(get(micrio.isMuted));

	/** Reference to the VideoTour instance within the current step's marker (if any). */
	let current:Models.ImageData.VideoTour|undefined = $state();
	/** Reference to the current step's info object. */
	let currentStepInfo:Models.ImageData.MarkerTourStepInfo|undefined = $state();
	/** Current overall playback time of the tour in seconds. */
	let currentTime:number = $state(0);

	/** Unique ID for the currently playing media (used for state persistence). */
	let currentMediaUUID:string = $state('');

	// --- Playback Control Functions ---

	/** Toggles the play/pause state of the current media/tour step. */
	function playPause() {
		const media = micrio.state.mediaState.get(currentMediaUUID); // Get state for current media
		if(media) paused = media.paused = !media.paused; // Toggle paused state
		if(paused) {
			micrio.events.dispatch('serialtour-pause', tour); // Dispatch pause event
			micrio.events.enabled.set(true); // Re-enable user interaction
		} else {
			micrio.events.dispatch('serialtour-play', tour); // Dispatch play event
			micrio.events.enabled.set(false); // Disable user interaction during playback
		}
	}

	/**
	 * Navigates to a specific step index and optionally seeks within that step.
	 * @param i The target step index.
	 * @param e Optional MouseEvent (if triggered by progress bar click) for seeking.
	 */
	function goto(i:number, e?:MouseEvent) : void {
		if(!tour.goto) return; // Ensure tour object has navigation methods
		const sameStep = i == tour.currentStep;
		// Prevent seeking within the same step if scrubbing is disabled
		if(noTimeScrub && sameStep) return;

		// Navigate to the target step if different
		if(!sameStep) tour.goto(i);

		// Calculate seek percentage if triggered by click event
		const perc = !noTimeScrub && e ? e.offsetX / (e.target as HTMLElement).offsetWidth : 0;

		// Mark previous steps as ended (for progress bar display)
		stepInfo.forEach((s,j) => s.ended = e ? false : j<i); // Reset ended if seeking via click
		reset(); // Reset individual step times

		// Set current time for the target step
		const step = stepInfo[i];
		step.currentTime = perc * step.duration;

		// If seeking within the same step, update the media instance directly
		if(sameStep && current?.instance) current.instance.currentTime = step.currentTime;

		// Update the overall progress bar display
		ontimeupdate(i);
	}

	/** Toggles the main mute state. */
	function toggleMute() : void {
		micrio.isMuted.set(muted=!muted);
	}

	/** Advances to the next step or ends the tour. */
	function next(){
		const curr = currentStepInfo;
		// Mark current step as ended if it exists
		if(curr) curr.ended = true;

		// If not the last step, go to the next one
		if(tour.currentStep != undefined && tour.currentStep < tour.steps.length-1 && tour.next) {
			tour.next();
		}
		// Otherwise, end the tour
		else {
			paused = ended = true;
			dispatch('ended'); // Dispatch local ended event
		}
		// Reset step times after a tick (allows UI to update first)
		tick().then(() => {
			reset();
			// Reset ended flag for the step that just finished, if it exists
			if(curr) curr.ended = false;
		});
	}

	/** Resets the `currentTime` for all steps. */
	function reset(){
		tour.stepInfo?.forEach(s => s.currentTime = 0);
	}

	// --- Progress Bar Update ---

	/** Writable store holding the progress percentage for each step. */
	const times = writable<number[]>([]);
	/** Updates the overall `currentTime` and the `times` store based on individual step progress. */
	function ontimeupdate(stepIdx:number = tour.currentStep ?? 0){
		// Calculate percentage for each step
		const _times = stepInfo.map((step, i) => (i < stepIdx || step.ended || ended) ? 100 // Completed steps are 100%
			: i == stepIdx ? Math.round(((step.currentTime || 0) / step.duration) * 10000)/100 // Current step percentage
			: 0); // Future steps are 0%
		// Calculate overall current time by summing weighted step durations
		currentTime = _times.reduce((v, s, i) => v+(s/100)*stepInfo[i].duration, 0);
		// Update the store for the progress bar UI
		times.set(_times);
	}

	// --- Marker Change Handling ---

	/** Updates the `current` video tour instance when the active marker changes. */
	function onmarkerchange(m?:Models.ImageData.Marker) : void {
		// Check if the new marker is part of the current tour
		const isTourMarker = m && !!tour.steps.find(s => s.startsWith(m.id));
		current = undefined; // Reset current video tour instance
		if(isTourMarker && m.videoTour) {
			// Delay slightly to ensure state updates propagate
			setTimeout(() => {
				const step = stepInfo[tour.currentStep ?? 0];
				// Ensure the marker matches the expected step
				if(step.markerId != m.id) return;
				step.ended = false; // Mark step as not ended
				currentStepInfo = step; // Store current step info
				current = m.videoTour; // Set the active video tour data
				ontimeupdate(); // Update progress bar immediately
			},10);
		}
	}

	// --- Utility ---

	/** Helper to get the language-specific title for a marker. */
	const getTitle = (m:Models.ImageData.Marker) : string|undefined => m.i18n ? m.i18n[$lang]?.title : (m as unknown as Models.ImageData.MarkerCultureData).title;

	// --- Lifecycle (onMount / onDestroy) ---

	onMount(() => {
		// Handler to call ontimeupdate without arguments
		const tu = () => ontimeupdate();
		// Listen for global timeupdate events (dispatched by Media component)
		micrio.addEventListener('timeupdate', tu);
		// Subscribe to active marker changes
		const unsub = marker.subscribe(onmarkerchange);

		// Cleanup function
		return () => {
			unsub(); // Unsubscribe from marker store
			micrio.removeEventListener('timeupdate', tu); // Remove timeupdate listener
			reset(); // Reset step times
		}
	});

	// --- Reactive Declarations (`$:`) ---

	/** Reactive audio source based on the current video tour step. */
	let audio = $derived(current ? 'audio' in current ? current.audio as Models.Assets.Audio : current.i18n?.[$lang]?.audio : undefined);
	/** Reactive audio source URL. */
	let audioSrc = $derived(audio ? 'fileUrl' in audio ? audio['fileUrl'] as string : audio.src : undefined);
	/** Reactive subtitle source based on the current video tour step. */
	let subtitle = $derived(current ? 'subtitle' in current ? current.subtitle as Models.Assets.Subtitle : current.i18n?.[$lang]?.subtitle : undefined);
	/** Reactive subtitle source URL. */
	let subtitleSrc = $derived(subtitle ? 'fileUrl' in subtitle ? subtitle['fileUrl'] as string : subtitle.src : undefined);

</script>

<!-- Render chapter list if enabled -->
{#if tour.printChapters}
	<ol>{#each stepInfo as c,i}
		{#if getTitle(c.marker)}
			<li class:active={currentStepInfo && currentStepInfo.chapter == i} class:enriched={c.imageHasOtherMarkers}>
				<button onclick={() => goto(i)}>{getTitle(c.marker)}</button>
			</li>
		{/if}
	{/each}</ol>
{/if}

<!-- Main controls container -->
<aside class="micrio-media-controls">
	<!-- Render Media component for the current step's audio/video tour -->
	{#if current && currentStepInfo}
		<!-- Store media UUID -->
		<!-- Go to next step on end -->
		<!-- Update local paused state -->
		<!-- Handle autoplay block -->
		<!-- Bind muted state -->
		<!-- Bind step's current time -->
		<Media
			tour={current}
			src={audioSrc}
			autoplay={!paused}
			on:id={(e) => currentMediaUUID = e.detail}
			on:ended={next}
			on:play={() => paused=false}
			on:blocked={() => paused=true}
			bind:muted
			bind:currentTime={currentStepInfo.currentTime}
		/>
	{/if}
	<!-- Render standard playback controls if enabled -->
	{#if controls}
		<Button type={!paused ? 'pause' : 'play'} title={paused ? $i18n.play : $i18n.pause} on:click={playPause} />
		<Button type={muted ? 'volume-off' : 'volume-up'} title={muted ? $i18n.audioUnmute : $i18n.audioMute} on:click={toggleMute} />
		{#if subtitleSrc}<Button
			type={$captionsEnabled ? 'subtitles' : 'subtitles-off'} active={$captionsEnabled} title={$i18n.subtitlesToggle}
			on:click={() => captionsEnabled.set(!$captionsEnabled)} />{/if}
		<Fullscreen el={micrio} />
	{/if}
</aside>

<!-- Render progress bar if controls are enabled -->
{#if controls}
	<ProgressBar duration={totalDuration} bind:currentTime bind:ended>
		<!-- Render individual progress segments for each step -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		{#each stepInfo as step, i}
			{#if step.duration > 0}
				<!-- Allow seeking within step -->
				<!-- Allow keyboard navigation -->
				<!-- Highlight active step -->
				<!-- Set width and progress -->
				<div
					class="bar"
					title={getTitle(step.marker)}
					role="progressbar"
					onclick={(e) => goto(i,e)}
					onkeypress={e => { if(e.key === 'Enter') goto(i) }}
					class:active={i == tour.currentStep}
					style={`width:${(step.duration/totalDuration)*100}%; --perc: ${$times[i]||0}%`}
				></div>
			{/if}
		{/each}
	</ProgressBar>
{/if}

<style>
	/* Chapter list styling */
	ol {
		position: absolute;
		left: 0px;
		bottom: 75px; /* Position above controls */
		color: var(--micrio-color);
		text-shadow: var(--micrio-marker-text-shadow);
		list-style-type: decimal-leading-zero; /* Numbered list with leading zeros */
		margin: 0;
	}
	ol > li {
		height: 1.5em;
		white-space: pre; /* Prevent wrapping */
		transition: height .25s ease, opacity .25s .25s ease; /* Transitions for minimize */
	}
	ol li.active {
		font-weight: bold; /* Highlight active chapter */
	}
	/* Hide non-active chapters when minimized */
	:global(.minimized) > ol > li:not(.active) {
		height: 0em;
		opacity: 0;
		transition: height .25s .25s ease, opacity .25s ease;
	}
	/* Chapter button styling */
	ol li button {
		font: inherit;
		background: none;
		border: none;
		display: inline;
		color: inherit;
		text-shadow: inherit;
		cursor: pointer;
	}
	ol li button:hover {
		text-decoration: underline;
	}

	/* Hide the Media component visually (it only handles playback logic) */
	aside.micrio-media-controls > :global(figure.micrio-media) {
		display: none;
	}

</style>
