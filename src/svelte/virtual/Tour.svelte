<script lang="ts">
	/**
	 * Tour.svelte - Main component for handling both Video Tours and Marker Tours.
	 *
	 * This component acts as a wrapper and controller for different tour types.
	 * - For Video Tours, it renders the Media component to play the tour video/audio.
	 * - For standard Marker Tours, it manages the tour state (current step) and renders controls.
	 * - For Serial Marker Tours, it renders the SerialTour component which handles the complex logic.
	 * - For Scrollable Marker Tours, it renders marker popups sequentially in a scrollable container.
	 *
	 * It handles tour start/stop, step navigation, UI state (controls visibility, minimization),
	 * and dispatches relevant tour events.
	 */

	import type { Models } from '../../types/models';
	import type { HTMLMicrioElement } from '../../ts/element';
	import type { MicrioImage } from '../../ts/image';
	import { writable, type Unsubscriber } from 'svelte/store';

	import { getContext, onMount, tick, createEventDispatcher } from 'svelte';
	import { fade } from 'svelte/transition';
	import { i18n } from '../../ts/i18n';
	import { loadSerialTour } from '../../ts/utils'; // Utility for loading serial tour step info

	// Component imports
	import Media from '../components/Media.svelte'; // For video/audio playback
	import Button from '../ui/Button.svelte';
	import MarkerPopup from '../components/MarkerPopup.svelte'; // For scrollable tours
	import SerialTour from './SerialTour.svelte'; // Handles serial marker tour logic

	// --- Props ---

	/** The tour data object (can be MarkerTour or VideoTour). */
	export let tour:Models.ImageData.MarkerTour|Models.ImageData.VideoTour;
	/** If true, suppresses rendering of HTML controls (used when UI is handled externally). */
	export let noHTML:boolean = false;

	// --- Setup & State ---

	/** Svelte event dispatcher. */
	const dispatch = createEventDispatcher();

	/** Get Micrio instance and relevant stores/properties from context. */
	const micrio:HTMLMicrioElement = <HTMLMicrioElement>getContext('micrio');
	const { events, state: micrioState, _lang } = micrio;

	/** Reference to the current image instance. */
	const image = micrio.$current as MicrioImage;
	/** Reference to the current image's data. */
	const data = image.$data as Models.ImageData.ImageData;
	/** Reference to the current image's settings. */
	const settings = image.$settings;
	/** Reference to the grid controller, if applicable. */
	const grid = micrio.canvases[0].grid;

	/** Store for the marker currently associated with the image this tour belongs to. */
	const markerCurrentImage = image.state.marker;

	// --- Tour Type Flags ---
	/** Is this a serial marker tour (navigates between markers, potentially across images)? */
	const isSerialTour = 'steps' in tour && tour.isSerialTour;
	/** Is this a video tour (plays a single video/audio file with timed events)? */
	const isVideoTour = !('steps' in tour);
	/** Is this a scrollable marker tour (displays marker popups sequentially)? */
	const isScrollTour = 'scrollable' in tour && tour.scrollable;
	/** Should controls be shown for this tour? */
	const noControls = 'steps' in tour ? 'controls' in tour ? tour.controls !== false : !tour.noControls : false;

	// --- UI State ---
	/** Are the tour controls rendered independently (not inside a marker popup)? */
	const isIndependent = !(!isSerialTour && 'steps' in tour && settings._markers?.tourControlsInPopup);
	/** Should the main Micrio controls be hidden while this tour is active? */
	const hideMainControls = isIndependent && (isVideoTour || isSerialTour);
	/** Should the marker popup remain open during tour transitions? */
	const keepPopup = !!settings._markers?.keepPopupsDuringTourTransitions;

	// --- Navigation Functions (for standard marker tours) ---
	/** Go to the previous step. */
	const prev = () => goto(currentTourStep - 1);
	/** Go to the next step. */
	const next = () => goto(currentTourStep + 1);
	/** Re-enable camera interaction (called when marker popup opens). */
	const hookCam = () => events.enabled.set(true);

	/** Timeout ID for deferring step opening. */
	let _deferTo:any;

	/**
	 * Navigates to a specific step in a marker tour.
	 * Handles closing the current marker, opening the target image (if different),
	 * and opening the target marker.
	 * @param idx The index of the step to navigate to.
	 */
	function goto(idx:number) {
		if(!('steps' in tour) || !tour.stepInfo) return; // Only applicable to marker tours with stepInfo
		const step = tour.stepInfo[idx];

		// If target marker is already open, just ensure the correct image is active
		if(step && step.markerId == micrio.state.$marker?.id)
			return openStepImage(step);

		// Close current marker/popup before transitioning
		const currStepImage = tour.stepInfo[currentTourStep]?.micrioImage?.state;
		if(currStepImage) currStepImage.marker.set(undefined); // Close marker on its specific image instance
		micrio.$current?.state.marker.set(undefined); // Close marker on the currently active image
		if(!keepPopup) micrio.state.popup.set(undefined); // Close global popup if not keeping it
		micrio.removeEventListener('marker-opened', hookCam); // Remove listener waiting for marker open
		markerCurrentImage.set(undefined); // Clear the marker store associated with the original image

		// Defer opening the next step slightly to allow closing animations/state updates
		if(step) _deferTo = setTimeout(openStep, 200, step);
	}

	/**
	 * Opens the image associated with a tour step, handling grid transitions if necessary.
	 * @param step The target tour step info.
	 * @returns Promise resolving to [targetImageInstance, wasAborted].
	 */
	async function openStepImage(step:Models.ImageData.MarkerTourStepInfo) : Promise<[MicrioImage, boolean]> {
		let img:MicrioImage = image; // Start with current image
		let isAborted:boolean = false; // Flag if transition is aborted

		// Handle grid focus transition if applicable
		if(grid && !step.gridView && grid.images.find(i => i.id == step.micrioId)) {
			const isPrevStep = 'steps' in tour && tour.stepInfo && step ? tour.stepInfo?.indexOf(step) < currentTourStep : false;
			// Determine transition type based on marker data and direction
			const trans:Models.Grid.MarkerFocusTransition = step.marker.data?.gridTourTransition ?? step.marker.data?._meta?.gridTourTransition;
			const slswipe = trans?.startsWith('slide') ? 'slide' : 'swipe';
			await tick().then(() => { // Wait for DOM updates
				const promise = grid.focus(img = grid.images.find(i => i.id == step.micrioId) as MicrioImage, { // Focus the target grid image
					view: step.startView, // Use step's start view
					// Determine transition direction
					transition: trans == slswipe || trans == `${slswipe}-horiz` ? isPrevStep ? `${slswipe}-left` : `${slswipe}-right`
						: trans == `${slswipe}-vert` ? isPrevStep ? `${slswipe}-up` : `${slswipe}-down`
						: trans == 'behind' ? isPrevStep ? 'behind-left' : 'behind-right'
						: trans // Use specified transition or calculated directional one
				}).catch(() => isAborted = true); // Catch abortion
				micrio.events.enabled.set(false); // Disable interaction during transition
				return promise;
			});
		}
		// If target image is different from current, open it
		else if(micrio.$current?.id != step.micrioId) {
			// Handle grid actions if staying within grid view
			if(step.gridView && step.marker.data?._meta?.gridAction && grid) {
				if(!step.micrioImage) step.micrioImage = grid.images.find(i => i.id == step.micrioId);
				img = step.micrioImage as MicrioImage;
				const a = step.marker.data._meta.gridAction.split('|');
				grid.action(a.shift() as string,a.join('|')); // Execute grid action
			}
			// Otherwise, open the target image normally
			else {
				// Update current step index *before* opening to handle race conditions
				if('steps' in tour && tour.stepInfo) currentTourStep = tour.stepInfo.indexOf(step);
				img = micrio.open(step.micrioId, { gridView: step.gridView, startView: step.startView });
			}
			await tick(); // Wait for potential state updates
		}
		// If target image is already current
		else img = micrio.$current;

		return [img, isAborted]; // Return target image and abortion status
	}

	/**
	 * Opens the marker associated with a tour step after ensuring the correct image is active.
	 * @param step The target tour step info.
	 */
	async function openStep(step:Models.ImageData.MarkerTourStepInfo) : Promise<void> {
		let img:MicrioImage = image;
		let isAborted:boolean = false;
		// Ensure the correct image is open/focused
		if(step.micrioId) [img, isAborted] = await openStepImage(step);
		if(isAborted) return; // Exit if image transition was aborted
		if(!step.micrioImage) step.micrioImage = img; // Store image instance on step info
		events.enabled.set(false); // Disable interaction
		img.state.marker.set(step.markerId); // Open the target marker on the correct image instance
		// Re-enable interaction once the marker popup is opened
		micrio.addEventListener('marker-opened', hookCam, { once: true });
		await tick(); // Wait for state updates
		events.dispatch('tour-step', tour); // Dispatch step event
	}

	/** Exits the current tour by clearing the global tour state. */
	function exit(){
		micrioState.tour.set(undefined);
	}

	/** Handles the 'ended' event from video tours or SerialTour component. */
	function ended(){
		events.dispatch('tour-ended', tour); // Dispatch global ended event
		if(tour.closeOnFinish) exit(); // Close tour if configured
	}

	// --- Marker Tour Setup ---
	/** Current step index for marker tours. */
	let currentTourStep:number = -1;
	/** Flag indicating if a non-tour marker is currently opened. */
	let isOtherMarkerOpened:boolean = false;
	/** Store the initial view when the tour starts. */
	const startView = image.camera.getView();
	/** Reference to marker settings. */
	const markerSettings = settings._markers;

	// Add navigation methods to the tour object for marker tours
	if('steps' in tour) {
		tour.prev = prev;
		tour.next = next;
		tour.goto = goto;
		// Define reactive getter for currentStep
		Object.defineProperty(tour, 'currentStep', {
			configurable: true,
			get(){return currentTourStep}
		});
	}

	// --- UI Minimization State ---
	/** Writable store for minimized UI state. */
	const minimized = writable<boolean>(false);
	/** Timeout ID for auto-minimizing UI. */
	let _mTo:number;
	// Dispatch event when minimized state changes
	minimized.subscribe(m => events.dispatch('tour-minimize', m));

	/** Resets the auto-minimize timer on user interaction. */
	function pointermove(){
		minimized.set(false); // Show UI
		clearTimeout(_mTo); // Clear existing timeout
		// Set new timeout to minimize after delay
		_mTo = <any>setTimeout(() => minimized.set(true), 5000) as number;
	}

	// --- Scroll Tour State ---
	/** Reference to the scrollable container element. */
	let _scroller:HTMLElement;
	/** IntersectionObserver for scroll tour steps. */
	let observer:IntersectionObserver;

	/** IntersectionObserver callback for scroll tours. */
	function onintersect(e:IntersectionObserverEntry[]){
		if(!('steps' in tour)) return;
		// Find the intersecting element
		const steps = tour.steps;
		const el = e.filter(e => e.isIntersecting).map(e => e.target)[0];
		if(el) { // If an element is intersecting
			// Find its index and corresponding marker
			for(let i=0;i<_scroller.children.length;i++) if(_scroller.children[i] == el) {
				const m = data.markers?.find(m => m.id == steps[i].split(',')[0]);
				// Fly to the marker's view
				if(m) micrio.$current?.camera.flyToView(m.view as Models.Camera.View).catch(() => {});
				return;
			}
		}
	}

	/** Initializes marker tour logic (standard, serial, or scrollable). */
	function startMarkerTour(tour:Models.ImageData.MarkerTour) {
		// If not a scroll tour and no marker is initially open, go to the first/initial step
		if(!isScrollTour && !micrio.$current?.state.$marker) {
			if(tour.initialStep !== undefined) goto(tour.initialStep);
		}
		// Setup IntersectionObserver for scroll tours
		if(isScrollTour && _scroller) {
			observer = new IntersectionObserver(onintersect, { root: _scroller, threshold: 1 });
			for(let i=0;i<_scroller.children.length;i++) observer.observe(_scroller.children[i]);
		}

		// Subscribe to marker changes to track current step and other markers
		unsub.push(micrio.state.marker.subscribe(m => {
			if(!m) { isOtherMarkerOpened = false; return; } // No marker open
			const id = typeof m == 'string' ? m : m.id;
			const idx = tour.steps.findIndex(s => s.startsWith(id)); // Find step index for this marker
			if(idx >= 0 && tour.stepInfo) { // If marker is part of the tour
				const step = tour.stepInfo[currentTourStep = idx]; // Update current step
				// Store image instance on step info if not already set
				if(step && !step.micrioImage) step.micrioImage = micrio.canvases.find(i => i.id == step.micrioId)
					?? grid?.images.find(i => i.id == step.micrioId) ?? micrio.$current;
			}
			isOtherMarkerOpened = idx < 0; // Flag if a non-tour marker was opened
		}));
	}

	// --- Lifecycle (onMount / onDestroy) ---
	/** Array for storing component-level unsubscribers. */
	let unsub:Unsubscriber[] = [];
	onMount(() => {
		// Load serial tour data if necessary, then start the marker tour logic
		if('steps' in tour) loadSerialTour(image, tour, $_lang, image.$data!).then(() => startMarkerTour(tour));

		// Subscribe to minimize state if controls are shown
		if(!noControls) unsub.push(minimized.subscribe(m => dispatch('minimize', m)));

		// Setup auto-minimize listeners if applicable
		if(!noHTML && (!('steps' in tour) || isSerialTour) && tour.minimize !== false) {
			micrio.addEventListener('pointermove', pointermove);
			micrio.addEventListener('touchstart', pointermove);
			pointermove(); // Initial call to start timer
		}

		// Add attribute to hide main controls if needed
		if(hideMainControls) micrio.setAttribute('data-tour-active','');

		// Cleanup function
		return () => {
			clearTimeout(_mTo); // Clear minimize timeout
			clearTimeout(_deferTo); // Clear step defer timeout
			while(unsub.length) unsub.shift()?.(); // Unsubscribe from stores
			// Remove event listeners
			micrio.removeEventListener('pointermove', pointermove);
			micrio.removeEventListener('touchstart', pointermove);
			micrio.removeEventListener('marker-opened', hookCam);
			// Remove attribute
			if(hideMainControls) micrio.removeAttribute('data-tour-active');
			hookCam(); // Ensure interaction is re-enabled
			if(observer) observer.disconnect(); // Disconnect IntersectionObserver

			// Clean up tour state
			const currentMarker = micrio.state.$marker;
			if('steps' in tour && tour.stepInfo && tour.currentStep != undefined) {
				const step = tour.stepInfo[tour.currentStep];
				// Remove navigation methods from tour object
				delete tour.goto;
				delete tour.next;
				delete tour.prev;
				// Close the marker associated with the last step if it's still open
				if(currentMarker && step?.markerId == currentMarker.id) {
					step.micrioImage?.state.marker.set(undefined);
					micrio.state.marker.set(undefined);
				}
			}
			// Abort any running camera animation and potentially fly back
			image.camera.aniDone = undefined; // Clear animation callback
			// If tour changed image and shouldn't keep last step, go back to original image
			if(!grid && !('steps' in tour && tour.keepLastStep) && micrio.$current != image)
				micrio.open(image.id);
			tick().then(() => { // After state updates
				events.dispatch('tour-stop', tour); // Dispatch stop event
				if('steps' in tour) delete tour.currentStep; // Clear current step property
				// If independent video tour ended, zoom out if configured
				if(!('steps' in tour) && markerSettings?.zoomOutAfterClose && !currentMarker && startView)
					image.camera.flyToView(startView, {speed:markerSettings?.zoomOutAfterCloseSpeed, noTrueNorth: true});
			});
		}
	});

	// Dispatch tour start event
	events.dispatch('tour-start', tour);

	// --- Playback State (Redeclaration - seems redundant) ---
	let currentTime:number=0;
	let paused:boolean=false;

	// --- Reactive Declarations (`$:`) ---
	/** Reactive variable for the video tour data (if applicable). */
	$: videoTour = !('steps' in tour) ? tour as Models.ImageData.VideoTour : undefined;
	/** Reactive audio asset for the current step/tour. */
	$: audio = videoTour ? ('audio' in tour ? tour.audio as Models.Assets.Audio : videoTour.i18n?.[$_lang]?.audio) : undefined;
	/** Reactive audio source URL. */
	$: audioSrc = audio ? 'fileUrl' in audio ? audio['fileUrl'] as string : audio.src : undefined;

</script>

{#if !noHTML}

	<!-- Scroll tour layout -->
	{#if isScrollTour && 'steps' in tour}
		<article class="scroll-tour" bind:this={_scroller}>{#each tour.steps.map(step => data.markers && data.markers.find(m => m.id==step.split(',')[0])) as marker}{#if marker}
			<MarkerPopup {marker} /> <!-- Render each marker popup -->
		{/if}{/each}</article>
		{#if !tour.cannotClose}<Button type="close" title={$i18n.tourStop} className="scroll-tour-end" on:click={exit} />{/if}

	<!-- Independent tour controls (Video or Serial) -->
	{:else if isIndependent}
		<div class:left={isSerialTour} class:serial-tour={isSerialTour} class:video-tour={isVideoTour}
			class:no-controls={noControls} class:minimized={!paused&&($minimized||isOtherMarkerOpened)} in:fade={{duration: 200}}>
			{#if 'steps' in tour}
				<!-- Render SerialTour component or standard marker tour controls -->
				{#if isSerialTour}<SerialTour {tour} on:ended={ended} />
				{:else}
					<Button type="arrow-left" title={$i18n.tourStepPrev} disabled={currentTourStep==0} on:click={prev} />
					<Button noClick>{currentTourStep+1} / {tour.steps.length}</Button>
					<Button type="arrow-right" title={$i18n.tourStepNext} disabled={currentTourStep==tour.steps.length-1} on:click={next} />
				{/if}
			{:else}
				<!-- Render Video Tour controls via Media component -->
				<!-- Store media UUID -->
				<!-- Go to next step on end -->
				<!-- Update local paused state -->
				<!-- Handle autoplay block -->
				<!-- Bind muted state -->
				<!-- Bind step's current time -->
				<Media {tour} src={audioSrc}
					fullscreen={micrio} controls autoplay bind:paused={paused}
					bind:currentTime on:ended={ended} />
			{/if}
			<!-- Common Close button -->
			{#if !tour.cannotClose}<Button type="close" title={$i18n.close} on:click={exit} />{/if}
		</div>

	<!-- Video tour embedded within a marker popup -->
	{:else if videoTour}
		<Media tour={videoTour} src={audioSrc} bind:currentTime autoplay on:ended={ended} />
	{/if}
<!-- If noHTML is true, but it's a video tour, still render the Media component for playback logic -->
{:else if videoTour}
	<Media tour={videoTour} src={audioSrc} autoplay bind:currentTime on:ended={ended} />
{/if}

<style>
	div {
		/* Default positioning for independent controls */
		position: absolute;
		bottom: var(--micrio-border-margin);
		left: 50%;
		max-width: calc(100% - var(--micrio-border-margin) * 2);
		transform: translateX(-50%);
		box-sizing: border-box;
		display: flex; /* Arrange controls horizontally */
		border-radius: var(--micrio-border-radius);
		box-shadow: var(--micrio-button-shadow);
		backdrop-filter: var(--micrio-background-filter);
		background-color: var(--micrio-button-background, var(--micrio-background, none));
		padding: 0;
		transition: transform .2s ease; /* Transition for minimize */
	}
	/* Hide when minimized (and not hovered) */
	div:not(:hover).minimized {
		transform: translate3d(-50%, calc(100% + var(--micrio-border-margin)), 0);
		pointer-events: none;
	}
	/* Remove background from children of serial tour container */
	.serial-tour > :global(*) {
		--micrio-background: none;
	}
	/* Different minimize transition for serial tour (positioned left) */
	.serial-tour.minimized {
		transform: translate3d(0, calc(100% + var(--micrio-border-margin)), 0);
	}
	/* Fixed width for serial/video tour controls */
	.serial-tour, .video-tour {
		width: 500px;
	}
	/* Remove background from direct children (buttons, progress bar) */
	div > :global(*) {
		--micrio-button-background: none;
	}
	/* Styling for buttons within the tour controls */
	div :global(button) {
		margin: 0;
		border: none;
		border-radius: 0; /* Remove individual radius */
		white-space: pre; /* Prevent button text wrapping */
		--micrio-background-filter: none; /* Remove individual filter */
		--micrio-button-shadow: none; /* Remove individual shadow */
	}

	/* Scroll tour container styling */
	article.scroll-tour {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		overflow-x: hidden;
		overflow-y: scroll; /* Enable vertical scrolling */
		scroll-snap-type: y mandatory; /* Snap scrolling to elements */
	}
	/* Close button for scroll tour */
	:global(button.micrio-button.scroll-tour-end) {
		position: absolute;
		top: 5px;
		right: 5px;
	}
	/* Styling for marker popups within scroll tour */
	article > :global(div.micrio-marker-popup) {
		margin: 20vh 50px 50vh; /* Vertical margins for spacing */
		margin: 20cqh 50px 50cqh; /* Use container query units */
		scroll-snap-align: center; /* Snap to center */
		position: relative !important;
	}
	/* Alternate justification for odd/even popups */
	article > :global(div.micrio-marker-popup:nth-child(2n)) {
		margin-left: auto;
	}
	/* No close or next tour step buttons */
	article > :global(div.micrio-marker-popup > aside) {
		display: none;
	}
</style>
