<script lang="ts">
	/**
	 * Main.svelte - Root Svelte UI Component for Micrio
	 *
	 * This component acts as the main container and orchestrator for the entire
	 * Micrio user interface. It receives the core `HTMLMicrioElement` instance
	 * via props and makes it available to child components through Svelte's context API.
	 *
	 * It subscribes to various state stores (current image, settings, data, tours, markers, etc.)
	 * and conditionally renders the appropriate UI sub-components based on the current
	 * application state and configuration settings.
	 */

	import type { HTMLMicrioElement, MicrioUIProps } from '../ts/element';
	import type { Models } from '../types/models';
	import type { Readable, Writable } from 'svelte/store';
	import type { MicrioImage } from '../ts/image';

	// Import base CSS
	import '../css/micrio.base.css';

	// Svelte imports
	import { setContext, tick } from 'svelte';
	import { get, writable } from 'svelte/store';

	// Micrio TS imports
	import { once } from '../ts/utils';

	// UI Sub-component imports
	import Logo from './ui/Logo.svelte';
	import LogoOrg from './ui/LogoOrg.svelte';
	import Toolbar from './components/Toolbar.svelte';
	import Minimap from './components/Minimap.svelte';
	import Controls from './common/Controls.svelte';
	import MarkerPopup from './components/MarkerPopup.svelte';
	import Tour from './virtual/Tour.svelte';
	import Gallery from './common/Gallery.svelte';
	import AudioController from './virtual/AudioController.svelte';
	import Details from './common/Details.svelte';
	import Media from './components/Media.svelte';
	import Error from './common/Error.svelte';
	import Popover from './components/Popover.svelte';
	import MicrioMarkers from './virtual/Markers.svelte';
	import Subtitles from './common/Subtitles.svelte';
	import Embed from './virtual/Embed.svelte';
	import ProgressCircle from './ui/ProgressCircle.svelte';

	let {
		micrio,
		noHTML = $bindable(),
		noLogo = noHTML,
		loadingProgress = 1,
		error = undefined
	}: MicrioUIProps = $props();

	// For updating main props from TypeScript
	export function setProps(p:Partial<MicrioUIProps>) {
		if('error' in p) error = p.error;
		if(p.noHTML !== undefined) noHTML = p.noHTML;
		if(p.noLogo !== undefined) noLogo = p.noLogo;
		if(p.loadingProgress !== undefined) loadingProgress = p.loadingProgress;
	}

	// --- Context Setup ---

	// Provide the main micrio instance to all child components
	setContext('micrio', micrio);

	/**
	 * Map to link marker data objects back to the specific MicrioImage instance
	 * they belong to. This is necessary because marker popups are rendered centrally
	 * but need access to their parent image's state/methods.
	 */
	const markerImages : Map<string,MicrioImage> = new Map();
	setContext('markerImages', markerImages);

	// --- Initial Setup & Attribute Reading ---

	// Handle data-ui="markers" attribute
	const onlyMarkers = micrio.getAttribute('data-ui') == 'markers';
	if(onlyMarkers) noHTML = true;

	// Determine if embeds should be shown based on attribute
	const showEmbeds = micrio.getAttribute('data-embeds') != 'false';

	// --- State Subscriptions ---

	// References to core state stores from the micrio instance
	const { visible, state: micrioState, isMuted } = micrio;
	const { tour, marker, popup: markerPopup, popover } = micrioState; // Destructure state stores

	// Stores for the current image's info, data, and settings
	let info:Readable<Models.ImageInfo.ImageInfo|undefined>|undefined = $state();
	let data:Writable<Models.ImageData.ImageData|undefined>|undefined = $state();
	let settings:Writable<Models.ImageInfo.Settings>|undefined = $state();

	// --- Helper Functions ---

	/** Recursively finds a menu page by its slug within a nested structure. */
	function findPage(id:string, p:Models.ImageData.Menu[]|undefined) : Models.ImageData.Menu|undefined {
		if(p) for(let i=0,t;i<p.length;i++) if(p[i].id==id||(t=findPage(id, p[i].children))) return t??p[i];
		return undefined; // Explicitly return undefined if not found
	}

	// --- Reactive Logic for Current Image ---

	let firstInited:boolean = $state(false); // Flag to track if the first image info has been processed
	let logoOrg:Models.ImageInfo.Organisation|undefined = $state(); // Store org logo data once found
	const didStart:string[] = []; // Track image IDs for which auto-start logic has run

	// Subscribe to changes in the currently active MicrioImage
	micrio.current.subscribe(c => {
		if(!c) return; // Exit if no current image

		// Update local store references
		info = c.info;
		settings = undefined; // Reset settings initially

		// Once image info is loaded
		if(info) once(info).then((i) => {
			if(i) {
				firstInited = true; // Mark that initial info is loaded
				settings = c.settings; // Get settings store
				// Store organisation logo data if available and not already stored
				if(!logoOrg && i.organisation?.logo) logoOrg = i.organisation;
			}
		});

		// Once image data is loaded for the *first time* for this image ID
		if((data = c.data) && didStart.indexOf(c.id) < 0) {
			once(data).then(async d => {
				if(!d) return; // Exit if no data
				didStart.push(c.id); // Mark this image ID as processed for auto-start

				// Wait for router to potentially initialize state based on URL
				await tick().then(tick);

				// If no marker, tour, or popover is already active (e.g., from URL routing)
				if(get(micrio.state.popover) || get(micrio.state.marker) || get(micrio.state.tour)) return;

				// Check for auto-start configuration in settings
				const autoStart = c.$settings.start;
				if(autoStart) {
					switch(autoStart.type) {
						case 'marker':
							c.state.marker.set(autoStart.id); // Open marker by ID
							break;
						case 'markerTour':
							const markerTour = d.markerTours?.find(t => t.id == autoStart.id);
							if(markerTour) micrio.state.tour.set(markerTour); // Start marker tour
							break;
						case 'tour': // Video Tour
							const videoTour = d.tours?.find(t => t.id == autoStart.id);
							if(videoTour) micrio.state.tour.set(videoTour); // Start video tour
							break;
						case 'page':
							const page = findPage(autoStart.id, d.pages); // Find page by ID (slug?)
							if(page) micrio.state.popover.set({contentPage: page, showLangSelect: true}); // Open page in popover
							break;
					}
				}
			});
		}
	});

	// --- Global Audio State ---

	// Global volume store, linked to the `muted` attribute/property
	const volume = writable<number>($isMuted ? 0 : 1);
	setContext('volume', volume); // Provide volume to children
	isMuted.subscribe(b => volume.set(b ? 0 : 1)); // Update volume store when muted state changes

	// Global media paused state (can be controlled by multiple components)
	setContext<Writable<boolean>>('mediaPaused', writable<boolean>(false));

	// --- Subtitles State ---

	let subsRaised:boolean = $state(false); // Flag if subtitles should be raised (e.g., due to tour controls)
	let srts:string[] = $state([]); // Array holding the current subtitle source(s)
	const srt = setContext<Writable<string|undefined>>('srt', writable<string>()); // Store for current subtitle src
	// Update local `srts` array with a delay when `srt` store changes (allows fade transitions)
	srt.subscribe(s => setTimeout(() => { srts = s ? [s] : [] }, 20));

	// --- Reactive Declarations (`$:`) ---

	// Derived state for 360 video
	let video = $derived($settings?._360?.video);
	let videoSrc = $derived(video?.src);

	// Derived state for gallery/omni features
	let omni = $derived($settings?.omni);
	let gallery = $derived($info?.gallery); // Gallery data comes from ImageInfo

	// Derived state for audio presence
	let positionalAudio = $derived($data?.markers?.filter(m => !!m.positionalAudio));
	let hasAudio = $derived(!!$data?.music?.items.length || !!positionalAudio?.length);

	// Flag if a tour or marker is currently active
	let hasTourOrMarker = $derived($tour || $marker);

	// --- Conditional Rendering Logic ---

	// Determine visibility of major UI sections based on props, settings, and state
	let showMarkers = $derived(!noHTML || onlyMarkers);
	let showLogo = $derived(!noLogo && (!$info || !noHTML) && !$settings?.noLogo);
	let showOrgLogo = $derived(!noHTML && showLogo && !$settings?.noOrgLogo ? logoOrg : undefined);
	let showMinimap = $derived(!noHTML && !omni && !micrio.spaceData && !$tour && !$info?.gallery); // Hide minimap for omni, spaces, tours, galleries
	let showGallery = $derived(!!gallery || !!omni); // Show gallery UI if gallery data or omni settings exist
	let showControls = $derived(!noHTML && !!$info); // Show controls if not noHTML and info is loaded
	let showDetails = $derived(!noHTML && !hasTourOrMarker && $settings?.showInfo); // Show details if enabled and no tour/marker active
	let showToolbar = $derived(!noHTML && firstInited && !$settings?.noToolbar); // Show toolbar after init if not disabled

</script>

<!-- Render Audio Controller (manages positional audio and playlists) -->
{#if hasAudio && $data && $info}
	<AudioController volume={$volume} data={$data} is360={!!$info.is360} />
{/if}

<!-- Render full-image 360 video (legacy V4 feature) -->
{#if videoSrc && $info}
	<Media src={videoSrc} volume={$volume} is360
		width={$info.width} height={$info.height} {...video} />
{/if}

<!-- Render all defined embeds -->
{#if showEmbeds && $data && $data.embeds}
	{#each $data.embeds as embed (embed.uuid)}
		<Embed {embed} />
	{/each}
{/if}

<!-- Render standard UI elements conditionally -->
{#if showLogo}<Logo />{/if}
{#if showToolbar}<Toolbar />{/if}

<!-- Render Markers component for each visible image -->
{#if showMarkers}
	{#each $visible as image (image.uuid)}
		<MicrioMarkers {image} />
	{/each}
{/if}

<!-- Render Minimap for each visible image that has it enabled -->
{#if showMinimap}
	{#each $visible.filter(i => i.$settings.minimap) as image (image.uuid)}
		<Minimap {image} />
	{/each}
{/if}

{#if showControls}<Controls hasAudio={hasAudio||!!(videoSrc && video && !video.muted)} />{/if}
{#if showGallery}<Gallery images={gallery} {omni} />{/if}
{#if showOrgLogo}<LogoOrg organisation={showOrgLogo} />{/if}
{#if showDetails && info && data}<Details {info} {data} />{/if}

<!-- Render Marker Popup (managed centrally) -->
{#if $markerPopup}<MarkerPopup marker={$markerPopup} />{/if}

<!-- Render active Tour UI -->
{#if $tour}
	<Tour tour={$tour} {noHTML} onminimize={b => subsRaised=!b} />
{/if}

<!-- Render active Popover (for pages, gallery previews, etc.) -->
{#if $popover}
	<Popover popover={$popover} />
{/if}

<!-- Render Subtitles display -->
{#each srts as src (src)}
	<Subtitles {src} raised={subsRaised} />
{/each}

<!-- Render Error message overlay -->
{#if error}
	<Error message={error} />
{/if}

<!-- Render Loading indicator -->
{#if loadingProgress < 1}
	<ProgressCircle progress={loadingProgress} />
{/if}
