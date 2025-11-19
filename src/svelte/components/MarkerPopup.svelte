<script lang="ts">
	/**
	 * MarkerPopup.svelte - Displays the popup window for an opened marker.
	 *
	 * This component renders the main popup container, including controls for closing,
	 * minimizing (optional), and tour navigation (if applicable). It uses the
	 * MarkerContent component to display the actual marker details.
	 */

	import type { HTMLMicrioElement } from '../../ts/element';
	import type { Models } from '../../types/models';
	import type { MicrioImage } from '../../ts/image';

	import { getContext, onMount } from 'svelte';
	import { fly } from 'svelte/transition'; // Used for popup animation
	import { i18n } from '../../ts/i18n'; // For button titles

	// UI Components
	import Button from '../ui/Button.svelte';
	import ButtonGroup from '../ui/ButtonGroup.svelte';
	// Content Renderer
	import MarkerContent from '../common/MarkerContent.svelte';

	// --- Props ---

	interface Props {
		/** The marker data object for which to display the popup. */
		marker: Models.ImageData.Marker;
	}

	let { marker }: Props = $props();

	// --- Context & State ---

	/** Get the main Micrio element instance from context. */
	const micrio = <HTMLMicrioElement>getContext('micrio');
	/** Destructure needed stores and properties. */
	const { current } = micrio;
	/** Reference to the active tour store. */
	const tour = micrio.state.tour;

	/** Get the WeakMap linking markers to their parent MicrioImage instance. */
	const markerImages : Map<string,MicrioImage> = getContext('markerImages');
	/** Get the parent MicrioImage instance for this marker. */
	const image = markerImages.get(marker.id) as MicrioImage;
	/** Get marker-specific settings from the parent image's settings. */
	const settings = image.$settings._markers ?? {};

	/** Find the image that contains the active tour for tourControlsInPopup setting. */
	const tourSourceImage = $derived($tour && 'steps' in $tour ? micrio.canvases.find(c =>
		c.$data?.markerTours?.find(t => t.id === $tour.id)
	) : undefined);

	/** Marker specific data overrides. */
	const data = marker.data || {};

	/** Check if the popup can be minimized based on settings. */
	const canMinimize = settings.canMinimizePopup;

	/** Reference to the main container div element. */
	let _cont:HTMLElement|undefined = $state();

	// --- Event Handlers & Functions ---

	/** Closes the marker popup or advances the tour. */
	function close(e?:Event){
		// If part of an active marker tour
		if ($tour && isPartOfTour && 'steps' in $tour) {
			// If the close button itself triggered the event AND configured to stop tour OR it's the last step
			if(e instanceof Event && closeButtonStopsTour) {
				tour.set(undefined); // Stop the tour
			}
			// Otherwise, advance to the next step
			else {
				$tour.next?.();
			}
		}
		// If not part of a tour or closing normally
		else {
			// Special case: If this marker opened a linked image, navigate back to the original image first.
			// This implicitly closes the marker on the linked image.
			if($current && !image.opts.secondaryTo && $current.id != image.id && data.micrioLink?.id == $current.id) {
				micrio.open(image.id); // Go back to the image containing this marker
				// Explicitly clear marker state on original image and global popup state
				image.state.marker.set(undefined);
				micrio.state.popup.set(undefined);
			}
			// Standard close: just clear the marker state for its image
			else {
				image.state.marker.set(undefined);
			}
			// Note: Clearing image.state.marker will trigger the subscription in Marker.svelte,
			// which in turn sets micrio.state.popup to undefined if needed.
		}
	}

	// --- Reactive Declarations for Tour Logic ---

	/** Returns either a Marker Tour object or nothing, disregards video tour */
	const markerTour = $derived($tour && 'steps' in $tour ? $tour : undefined);

	/** Check if this marker is part of the currently active marker tour. */
	const isPartOfTour = $derived(markerTour && markerTour?.steps.findIndex(s => s.startsWith(marker.id)) >= 0);
	/** Determine if tour controls should be shown within the popup. */
	const showTourControls = $derived(isPartOfTour && !markerTour?.isSerialTour && (tourSourceImage?.$settings._markers?.tourControlsInPopup ?? settings.tourControlsInPopup));
	/** Get the current step index of the active marker tour. */
	const currentTourStep = $derived(markerTour?.currentStep ?? -1);
	/** Determine if the close button should stop the tour instead of advancing. */
	const closeButtonStopsTour = $derived(showTourControls || (markerTour ? markerTour.currentStep == markerTour.steps.length-1 : undefined));

	/** Flag to disable prev/next buttons briefly after click to prevent double clicks. */
	let clickedPrevNext:boolean = $state(false);

	/** Go to the next or previous tour step. */
	const markerTourStep = (goPrev:boolean = false) => {
		if(!markerTour) return;
		if(goPrev) markerTour.prev?.();
		else markerTour.next?.();
		clickedPrevNext = true;
		setTimeout(() => clickedPrevNext = false, 200);
	}

	// --- Minimization Logic ---

	/** Local state tracking if the popup is minimized. */
	let isMinimized:boolean = $state(false);
	/** Reference to the MarkerContent's main element. */
	let _content:HTMLElement|undefined = $state();
	/** Reference to the MarkerContent's title element. */
	let _title:HTMLElement|undefined = $state();
	/** WeakMap to store original heights of content elements before minimizing. */
	const originalHeights:WeakMap<HTMLElement, number> = new WeakMap();

	/** Toggles the minimized state and animates content height. */
	const toggleMinimize = () => {
		isMinimized = !isMinimized;
		// Iterate through direct children of the MarkerContent main element
		if(_content) for(let i=0; i<_content.children.length; i++) {
			const n = _content.children[i];
			// Animate height for all children except the title (h1)
			if(n instanceof HTMLElement && n != _title) {
				// Store original height if not already stored
				if(!originalHeights.has(n)) {
					originalHeights.set(n, n.offsetHeight);
					n.style.height = n.offsetHeight+'px'; // Set initial height explicitly for transition
				}
				// Animate height to 0px (minimized) or back to original height
				// Use setTimeout to ensure the initial height is set before starting transition
				setTimeout(() => {
					n.style.height = isMinimized ? '0px' : originalHeights.get(n)+'px';
				}, 100); // Small delay might not be strictly necessary but ensures style application
			}
		}
	}

	// --- Media Cleanup ---

	/** Writable store passed to MarkerContent to signal when the popup is closing. */
	let destroying = $state(false);

	// --- Lifecycle (onMount) ---

	onMount(() => {
		// Add marker tags as CSS classes to the container for custom styling
		marker.tags.forEach(c => _cont?.classList.add(c));
		// Attempt to focus the first button inside after a delay
		setTimeout(() => _cont?.querySelector('button')?.focus(), 500);

		// Handle marker-specific embeds (defined via 'embedImages' property)
		const embeds = 'embedImages' in marker ? marker.embedImages as Models.ImageData.Embed[] : undefined;
		if(embeds) {
			// Add these embeds to the *currently displayed* image's data store
			micrio.$current?.data.update(d => {
				if(!d) d = {embeds:[]};
				d.embeds = [...(d.embeds??[]), ...embeds];
				return d;
			});
		}

		const unsub = micrio.state.popup.subscribe(m => destroying = !m || m != marker);

		// Cleanup function on component destroy
		return () => {
			// Update the destroying store when the global popup state no longer matches this marker
			unsub();
			// Remove marker-specific embeds from the image data store
			if(embeds) {
				micrio.$current?.data.update(d => {
					if(!d?.embeds) return d;
					// Filter out embeds that were added by this marker instance
					d.embeds = d.embeds.filter(e => !embeds.find(em => em.id == e.id));
					return d;
				});
			}
		}
	});

</script>

<!-- Main popup container div -->
<!-- Apply fly transition based on marker settings -->
<!-- Add 'destroying' and 'minimized' classes for styling -->
<div transition:fly={settings.popupAnimation} bind:this={_cont} class:destroying class:minimized={isMinimized}>
	<!-- Sidebar for controls -->
	<aside>
		<!-- Close/Next Button -->
		{#if !data.alwaysOpen}
			<Button
				type={(!isPartOfTour || closeButtonStopsTour) ? 'close' : 'arrow-right'}
				title={(!isPartOfTour || closeButtonStopsTour) ? $i18n.closeMarker : $i18n.tourStepNext}
				disabled={clickedPrevNext}
				onclick={close}
			/>
		{/if}
		<!-- Minimize Button -->
		{#if canMinimize}
			<Button type={isMinimized ? 'arrow-up' : 'arrow-down'} title={$i18n.minimize} onclick={toggleMinimize} />
		{/if}
		<!-- Tour Controls -->
		{#if showTourControls && $tour && 'steps' in $tour}
			<!-- Optional progress bar (currently hidden by CSS) -->
			<progress aria-hidden={true} value={(currentTourStep+1)/$tour.steps.length} class="progress"></progress>
			<ButtonGroup className="micrio-tour-controls">
				<!-- Previous Step Button -->
				<Button type="arrow-left" disabled={clickedPrevNext || currentTourStep==0} title={$i18n.tourStepPrev} onclick={() => markerTourStep(true)} />
				<!-- Step Counter (if enabled in settings) -->
				{#if settings.tourStepCounterInPopup}<button class="micrio-button tour-step" disabled>{currentTourStep+1} / {$tour.steps.length}</button>{/if}
				<!-- Next Step Button -->
				<Button type="arrow-right" disabled={clickedPrevNext || (currentTourStep+1==$tour.steps.length)} title={$i18n.tourStepNext} onclick={() => markerTourStep()} />
			</ButtonGroup>
		{/if}
	</aside>
	<!-- Render the actual marker content -->
	<MarkerContent {marker} bind:_content bind:_title onclose={close} />
</div>

<style>
	div {
		/* Basic popup styling */
		display: block;
		cursor: auto;
		pointer-events: all;
		position: absolute;
		top: var(--micrio-border-margin);
		left: var(--micrio-border-margin);
	}

	/* Disable pointer events when destroying (fading out) */
	div.destroying {
		pointer-events: none;
	}

	/* Limit content height */
	div > :global(main) {
		max-height: 80vh; /* Use viewport height */
		max-height: 80cqh; /* Use container query height */
	}

	/* Sidebar controls positioning */
	aside {
		padding: var(--micrio-border-margin);
	}

	/* Hide progress bar by default */
	aside progress {
		display: none;
	}

	/* Desktop layout for controls (right side) */
	@media (min-width: 501px) {
		div {
			width: 440px; /* Default width */
			min-width: 20%;
		}
		aside {
			position: absolute;
			left: 100%; /* Position to the right of the content */
			top: 0;
			padding-top: 0;
		}

		aside > :global(.micrio-button) {
			padding: 0;
			margin: 0 0 8px 0; /* Vertical spacing */
			display: block;
		}
	}

	/* Mobile layout for controls (top) */
	@media (max-width: 500px) {
		aside {
			position: relative; /* Position within the flow */
			padding: 0;
			display: flex;
			flex-direction: row-reverse; /* Align buttons to the right */
			margin-bottom: var(--micrio-border-margin);
			align-items: center; /* Vertically align items */
		}
		/* Show progress bar on mobile (if needed) */
		aside progress {
			display: block;
			flex: 1; /* Take remaining space */
			opacity: 0; /* Hidden visually, but takes space */
			pointer-events: none;
		}
		aside :global(.micrio-tour-controls) {
			margin-bottom: 0 !important;
			display: flex; /* Ensure button group displays correctly */
		}
		aside :global(.micrio-button) {
			display: block !important;
			height: var(--micrio-button-size);
			padding: 0 !important;
			margin: 0 0 0 8px; /* Add left margin for spacing */
		}
		/* Popup takes full width on mobile */
		div {
			top: var(--micrio-border-margin);
			right: var(--micrio-border-margin);
			left: var(--micrio-border-margin);
			width: auto; /* Allow it to fill width */
		}
		/* Adjust max height for mobile */
		div > :global(main) {
			max-height: calc(100vh - var(--micrio-button-size) - 3 * var(--micrio-border-margin));
			max-height: calc(100cqh - var(--micrio-button-size) - 3 * var(--micrio-border-margin));
			box-sizing: border-box;
		}
	}

	/* Styling for content elements during minimize/maximize transition */
	div > :global(main > *:not(h3)) { /* Target all direct children except h3 */
		transition-property: margin-top, margin-bottom, height, opacity;
		transition-duration: .5s;
		transition-timing-function: ease;
		overflow: hidden; /* Hide content smoothly */
	}

	/* Styles for minimized state */
	div.minimized > :global(main > *:not(h3)) {
		margin-top: 0;
		margin-bottom: 0;
		opacity: 0;
		/* Height is set dynamically in toggleMinimize function */
	}

	/* Styling for tour step counter button */
	button.tour-step {
		height: auto; /* Allow height to adjust to content */
		line-height: normal;
		vertical-align: middle;
		cursor: default; /* Not clickable */
	}
</style>
