<script lang="ts">
	/**
	 * Markers.svelte - Renders all markers and waypoints for a given MicrioImage.
	 *
	 * This component iterates through the markers and waypoints defined in the image data
	 * and renders individual Marker or Waypoint components for each. It handles marker
	 * clustering, side labels for Omni objects, and visibility based on tour/marker state.
	 */

	import { get, writable, type Unsubscriber } from 'svelte/store';
	import type { MicrioImage } from '$ts/image';
	import type { Models } from '$types/models';

	import { onMount, setContext, tick } from 'svelte';
	import { clone, limitView, once, calcClusters, type MarkerCoords } from '$ts/utils';

	// Component imports
	import Marker from '../components/Marker.svelte';
	import Waypoint from '../components/Waypoint.svelte';
    import Embed from './Embed.svelte';

	// --- Props ---
	interface Props {
		/** The MicrioImage instance whose markers and waypoints should be rendered. */
		image: MicrioImage;
	}

	let { image = $bindable() }: Props = $props();

	// --- Type Alias ---
	type MarkerData = Models.ImageData.Marker; // Alias for brevity

	// --- Context & State ---

	/** Get relevant stores and properties from the parent Micrio instance. */
	const {data, info, settings} = image; // Image-specific stores
	const currentMarker = image.state.marker; // Image's active marker store
	const micrio = image.engine.micrio; // Main Micrio element instance
	const { switching, _lang, state: micrioState } = micrio; // Global state stores
	const isMobile = micrio.canvas.isMobile; // Mobile device flag
	const grid = micrio.canvases[0]?.grid; // Grid controller (if applicable)
	const focussed = grid?.focussed; // Focussed grid image store
	const gridMarkersShown = grid?.markersShown; // Store for markers shown in grid context
	/** Cluster radius setting from image configuration. */
	const cR = $settings.clusterMarkerRadius ?? 16;

	// --- Side Label State (for Omni objects) ---

	/** Reference to the global marker hover state. */
	const hoveredId = micrioState.markerHoverId;
	/** Writable store tracking markers currently in view [MarkerData, screenX%, screenY%]. */
	const inView = writable<[MarkerData, number, number][]>([]);
	/** Provide the inView store to child Marker components via context. */
	setContext('inView', inView);

	// --- Component State ---


	/** Marker settings from the parent image. */
	const markerSettings:Models.ImageInfo.MarkerSettings = $settings._markers ?? {};
	/** Omni settings from the parent image. */
	const omni = $settings.omni;
	/** Flag indicating if marker titles should be hidden globally. */
	const noTitles:boolean = !!markerSettings.noTitles || !!omni?.sideLabels;
	/** Flag indicating if marker titles should be shown statically.
	 * For old IDs (previous dashboard), marker labels are always shown by default.
	 */
	const showTitles:boolean = !noTitles && (!!markerSettings.showTitles || image.id.length == 5);

	// --- State Management Functions ---

	let wasMarkerVideoTour:boolean = false;

	/**
	 * Stores the view state before opening a marker (if applicable)
	 * and restores it when the marker is closed (unless in a tour).
	 * @param marker The marker being opened or closed (or undefined).
	 */
	function setOpenedView(marker:MarkerData|string|undefined) {
		if(marker) { // Marker is being opened
			// Store current view only if it's a marker object (not ID string),
			// no view is already stored, it's not a hidden marker, and it has a target view.
			if(typeof marker != 'string' && !image.openedView && !marker.noMarker && marker.view) {
				// Don't store view if currently in a tour (handled by tour logic)
				image.openedView = micrio.state.$tour && !('steps' in micrio.state.$tour) ? undefined : clone(image.state.$view);
				wasMarkerVideoTour = !!marker.videoTour;
			}
		} else if(image.openedView && !micrio.state.$tour) { // Marker is being closed, view was stored, and not in a tour
			// After a tick (to allow state updates), fly back to the stored view
			setTimeout(() => {
				// Check again if still inactive and animation isn't running
				if(!inactive && !image.camera.aniDone && image.openedView)
					image.camera.flyToView(limitView(image.openedView), { // Fly back, limiting view
						speed:$settings._markers?.zoomOutAfterCloseSpeed, // Use configured speed
					}).catch(() => {}); // Ignore errors
				image.openedView = undefined; // Clear stored view
				wasMarkerVideoTour = false;
			}, wasMarkerVideoTour ? 250 : 10);
		}
	}

	// Clear stored opened view if a tour starts that keeps the last step active
	let wasMarkerTour:boolean = false;
	micrioState.tour.subscribe(t => {
		if(t && 'steps' in t) {
			wasMarkerTour = true;
			if (t.keepLastStep) image.openedView = undefined;
		} else {
			if(!t && !image.openedView && wasMarkerTour) image.camera.stop();
			wasMarkerTour = false;
		}
	});

	// --- Styling & Positioning ---

	/** Array to store CSS variable definitions for marker styling. */
	const cssVars:string[] = [];
	/** Combined CSS style string applied to the marker container. */
	let markerStyle:string = $state('');
	/** Is the parent image a 360 panorama? */
	let is360:boolean = $state(false);
	/** Are fancy side labels currently active? */
	let fancyLabels:boolean = $state(false);

	/** Recalculates marker container size/position based on viewport changes (for clustering). */
	const resize = (v:Models.Camera.ViewRect) => (v=v?.map(f => Math.round(f*100)/100)) && (markerStyle = [...cssVars,
		v[0] ? `left: ${v[0]}px` : null,
		v[1] ? `top: ${v[1]}px` : null,
		`width: ${v[2]}px`,
		`height: ${v[3]}px`
	].filter(v => !!v).join(';')+';');

	// --- Clustering Logic ---

	let overlapped:number[] = $state([]);
	let r = cR;
	let clusterMarkers:MarkerData[] = $state([]);

	const coords = new Map<string,MarkerCoords>();

	const calcOverlapped = () : void => {
		const result = calcClusters(visibleMarkers, coords, r, image.isOmni);
		overlapped = result.overlapped;
		clusterMarkers = result.clusterMarkers;
	};

	// --- Fancy Side Label Logic (Omni) ---

	/** Array to store fancy label line subscriptions. */
	const flSubs:Unsubscriber[] = [];
	/** Subscribes to stores needed for drawing side label lines. */
	function subscribeFancyLabels() {
		flSubs.push(image.state.view.subscribe(drawLines)); // Redraw on view change
		flSubs.push(hoveredId.subscribe(drawLines)); // Redraw on hover change
		flSubs.push(currentMarker.subscribe(drawLines)); // Redraw on active marker change
	}
	/** Unsubscribes from stores used for side label lines. */
	function unsubscribeFancyLabels() {
		while(flSubs.length) flSubs.shift()?.();
	}

	// --- Lifecycle (onMount) ---

	onMount(() => {
		const unsub:Unsubscriber[] = []; // Store local unsubscribers

		// Once image info is loaded
		once(info).then(i => { if(!i) return;
			is360 = !!i.is360; // Set is360 flag

			const ms = $settings._markers;
			if(!ms) return; // Exit if no marker settings

			// Apply custom marker styles from settings
			const isV4 = parseFloat(i.version) >= 4.2; // Check for legacy version
			if(ms.markerIcon) cssVars.push(`--micrio-marker-icon: url("${ms.markerIcon}")`);
			if(ms.markerColor && ms.markerColor != (isV4 ? '#ffffff' : '#ffbb00')) cssVars.push('--micrio-marker-color: '+ms.markerColor);
			if(ms.markerSize && ms.markerSize != (isV4 ? '16' : '25')) cssVars.push('--micrio-marker-size: '+(r=Number(ms.markerSize))+'px');

			// Subscribe to viewport resize events for clustering
			unsub.push(image.viewport.subscribe(resize));

			// Enable clustering if configured
			if($settings.clusterMarkers) {
				unsub.push(image.state.view.subscribe(calcOverlapped)); // Recalculate on view change
				unsub.push(image.data.subscribe(() => tick().then(calcOverlapped))); // Recalculate on data change
			}

			// Handle storing/restoring view when markers open/close (if not in grid and zoomOutAfterClose enabled)
			if(!image.grid && $settings._markers?.zoomOutAfterClose)
				unsub.push(image.state.marker.subscribe(setOpenedView));

			// Enable/disable fancy side labels based on mobile state
			const tryFancyLabels = !!(image.isOmni && $settings.omni?.sideLabels && !$settings._markers?.noTitles);
			if(tryFancyLabels) {
				unsub.push(isMobile.subscribe(b => {
					if(b && fancyLabels) unsubscribeFancyLabels(); // Disable on mobile
					else if(!b && !fancyLabels) subscribeFancyLabels(); // Enable on desktop
					fancyLabels = !b;
				}));
			}
		});

		// Cleanup function
		return () => {
			while(unsub.length) unsub.shift()?.(); // Unsubscribe from all stores
		}
	});

	// --- Helper Functions & Reactive Declarations ---

	/** Checks if a marker should be visible (not explicitly hidden). */
	const isVisible = (m:Models.ImageData.Marker) => !m.noMarker;

	// --- Fancy Side Label Drawing ---
	/** Reference to the container for side labels. */
	let _labels:HTMLElement|undefined = $state();
	/** Array storing line coordinates [x1, y1, x2, y2, isHovered]. */
	let lines:[number,number,number,number,boolean][] = $state([]);
	/** Redraws the lines connecting markers to side labels. */
	function drawLines(){ tick().then(() => { if(!_labels) return; // Wait for DOM update
		const c = micrio.canvas;
		const w = c.element.offsetWidth; // Get canvas width
		const nl:[number,number,number,number,boolean][] = []; // New lines array
		// Iterate through markers currently in view
		$inView.forEach(([m,x,y]) => { // [MarkerData, screenX%, screenY%]
			// Find the corresponding label element
			const box = _labels!.querySelector('label[for="'+m.id+'"]')?.getBoundingClientRect();
			// If label exists, calculate line coordinates and add to array
			if(box?.width && box.width > 0) {
				nl.push([
					x*w, // Marker X position (pixels)
					y,   // Marker Y position (relative 0-1, used directly by SVG?)
					(x >= .5 ? box.left : box.right) - c.viewport.left, // Label edge X (pixels, relative to canvas)
					box.top + box.height/2 - c.viewport.top, // Label center Y (pixels, relative to canvas)
					$hoveredId==m.id // Is this marker hovered?
				]);
			}
		});
		lines = nl; // Update the lines array
	})}

	/** Helper to get the language-specific title for a marker. */
	const getTitle = (m:Models.ImageData.Marker, lang:string) : string|undefined => m.i18n ? m.i18n[lang]?.title : (m as unknown as Models.ImageData.MarkerCultureData).title;

	// --- Reactive Visibility & Data ---

	/** Reactive flag indicating if the parent image is inactive (e.g., hidden in grid). */
	const inactive = $derived(grid && ($focussed != image && (gridMarkersShown && get(gridMarkersShown).indexOf(image) < 0)));
	/** Reactive list of waypoints associated with the current image. */
	const waypoints = $derived(!$switching && micrio.spaceData ? micrio.spaceData.links.filter(l => l[0] == image.id || l[1] == image.id).map(l => ({targetId: l[0] == image.id ? l[1] : l[0], settings: l[2]?.[image.id]})) : undefined);
	/** Reactive list of markers that should be visible (not hidden and passes `isVisible` check). */
	const visibleMarkers = $derived(inactive ? [] : $data?.markers?.filter(isVisible));
	/** Reactive list of markers that are explicitly hidden (`noMarker: true`). */
	const invisibleMarkers = $derived(inactive ? $data?.markers : $data?.markers?.filter(m => !isVisible(m)));
	/** Marker clickable embed areas */
	const clickableAreas = $derived(inactive ? [] : $data?.markers?.filter(m => m.clickableArea));
	/** Reactive flag indicating if there are any visible markers or waypoints. */
	const hasMarkersOrWaypoints = $derived(!!(visibleMarkers?.length || waypoints?.length));
	/** Reactive sorted list of markers currently in view (for side labels). */
	const inViewSorted = $derived([...$inView].sort(([,,y1],[,,y2]) => y1 > y2 ? 1 : y1 < y2 ? -1 : 0));

</script>

<!-- Render side labels and connecting lines if fancyLabels are active -->
{#if fancyLabels && inViewSorted.length && !$currentMarker}
	<svg>{#each lines as l}<line x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} class:hovered={l[4]} />{/each}</svg>
	<aside bind:this={_labels}>
		<section>{#each inViewSorted.filter(([,x,]) => x < .5) as me (me[0].id)} <!-- Left side labels -->
			<article><label for={me[0].id} class:hover={$hoveredId==me[0].id}
				onmouseenter={() => hoveredId.set(me[0].id)} onmouseleave={() => hoveredId.set(undefined)}>{getTitle(me[0],$_lang)}</label></article>
		{/each}</section>
		<section>{#each inViewSorted.filter(([,x,]) => x >= .5) as me (me[0].id)} <!-- Right side labels -->
			<article><label for={me[0].id} class:hover={$hoveredId==me[0].id}
				onmouseenter={() => hoveredId.set(me[0].id)} onmouseleave={() => hoveredId.set(undefined)}>{getTitle(me[0],$_lang)}</label></article>
		{/each}</section>
	</aside>
{/if}

{#if clickableAreas}
	{#each clickableAreas as marker (marker.id)}
		{#if marker.clickableArea}<Embed embed={marker.clickableArea} {marker} />{/if}
	{/each}
{/if}

<!-- Main container for markers and waypoints -->
{#if hasMarkersOrWaypoints}
	<div style={hasMarkersOrWaypoints ? markerStyle : null} class:show-titles={showTitles} class:is360 class:inactive={inactive||(is360 && $switching)}>
		<!-- Render Waypoints -->
		{#if waypoints && waypoints.length}
			{#each waypoints as waypoint (waypoint.targetId)}<Waypoint {image} {...waypoint} />{/each}
		{/if}
		<!-- Render Visible Markers -->
		{#if visibleMarkers}
			{#each visibleMarkers as marker,i (marker.id)}
				<Marker {marker} {image} {coords} overlapped={overlapped.includes(i)} />
			{/each}
			<!-- Render Cluster Markers -->
			{#each clusterMarkers as marker (marker.id)}
				<Marker {marker} {image} />
			{/each}
		{/if}
	</div>
{/if}

<!-- Render hidden markers (with forceHidden=true) - needed for state management? -->
{#if invisibleMarkers}
	{#each invisibleMarkers as marker (marker.id)}
		<Marker {marker} {image} forceHidden />
	{/each}
{/if}

<style>
	div {
		/* Container for all markers/waypoints */
		pointer-events: none; /* Allow interaction with elements underneath */
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		overflow: hidden; /* Prevent markers spilling out */
		will-change: width, height, top, left, opacity; /* Optimize rendering */
		perspective: inherit; /* Inherit perspective from parent */
	}
	div:empty {
		display: none; /* Hide if no markers/waypoints */
	}
	/* Enable pointer events on direct children (Marker/Waypoint components) */
	div > :global(*) {
		pointer-events: all;
	}
	/* Disable pointer events on children when inactive */
	div.inactive > :global(*) {
		pointer-events: none;
	}
	/* Add transition for 360 view changes */
	div.is360 {
		transition: opacity .25s;
	}
	/* Hide when inactive in 360 mode */
	div.is360.inactive {
		opacity: 0;
	}

	/* Styling for side label container */
	aside {
		pointer-events: none; /* Container itself is not interactive */
	}

	/* Styling for left/right side label sections */
	aside section {
		position: absolute; /* Changed from relative to absolute */
		top: 0;
		bottom: 0;
		width: 10vw; /* Use viewport width */
		width: 10cqw; /* Use container query width */
		min-width: 200px; /* Minimum width */
		font-size: 1em;
		font-weight: 500;
		line-height: 1em;
		color: var(--micrio-marker-color);
		display: flex;
		flex-direction: column; /* Stack labels vertically */
	}
	aside section:nth-child(1) { /* Left section */
		left: 10px;
		align-items: flex-end; /* Align labels to the right */
	}
	aside section:nth-child(2) { /* Right section */
		right: 10px;
		align-items: flex-start; /* Align labels to the left */
	}

	/* Styling for individual label containers */
	aside section article {
		flex: 1; /* Distribute space evenly */
		padding: 10px;
		max-height: 30vh; /* Limit height */
		max-height: 30cqh;
		display: flex;
		align-items: center; /* Center label vertically */
	}

	/* Styling for the label text itself */
	aside section label {
		pointer-events: all; /* Allow hover */
		cursor: pointer;
		padding: 10px;
		max-width: 160px;
		opacity: .75;
		transition: opacity .25s ease, color .25s ease;
		text-shadow: var(--micrio-marker-text-shadow); /* Apply shadow */
	}
	/* Hover effect for labels */
	label.hover {
		color: var(--micrio-marker-highlight);
		opacity: 1;
	}
	/* Justify content based on side */
	aside section:nth-child(1) article {
		justify-content: right;
	}
	aside section:nth-child(1) label {
		text-align: right;
	}
	/* SVG container for label lines */
	svg {
		width: 100%;
		height: 100%;
		pointer-events: none;
		position: absolute;
	}
	/* Default line style */
	svg line {
		stroke: var(--micrio-marker-highlight);
		stroke-width: 2;
	}
	/* Style for non-hovered lines */
	svg line:not(.hovered) {
		stroke: var(--micrio-marker-color);
		stroke-dasharray: 10px; /* Dashed line */
		stroke-width: 1;
		opacity: .75;
	}

</style>
