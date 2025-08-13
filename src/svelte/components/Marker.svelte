<script lang="ts">
	/**
	 * Marker.svelte - Renders a single interactive marker element on the image.
	 *
	 * This component is responsible for:
	 * - Displaying the marker icon and label at the correct screen position.
	 * - Handling hover and focus states.
	 * - Triggering actions on click (opening popups, linking, etc.).
	 * - Calculating its position in 2D, 3D (for 360), or Omni space.
	 * - Interacting with global state for opened marker, tours, and popups.
	 */

	import { get, type Writable } from 'svelte/store';
	import type { HTMLMicrioElement } from '../../ts/element';
	import type { Models } from '../../types/models';
	import type { MicrioImage } from '../../ts/image';

	import { getContext, onMount, tick } from 'svelte';
	import { ctx } from '../virtual/AudioController.svelte'; // Web Audio context for positional audio

	import { after, getSpaceVector } from '../../ts/utils'; // Utility functions

	import Icon, { type IconName } from '../ui/Icon.svelte'; // Icon component
	import AudioLocation from '../virtual/AudioLocation.svelte'; // Component for positional audio

	// --- Context & Global State ---

	/** Get the main Micrio element instance from context. */
	const micrio = <HTMLMicrioElement>getContext('micrio');
	/** Destructure needed stores and properties. */
	const { current, events, state: micrioState, _lang, spaceData } = micrio;
	/** Check if the device is mobile (affects hover behavior). */
	const isMobile = micrio.canvas.isMobile;
	/** Reference to the global marker hover state. */
	const hovered = micrioState.markerHoverId;
	/** Writable store tracking markers currently in the viewport (for side labels). */
	const inView = getContext<Writable<[Models.ImageData.Marker,number,number][]>>('inView');
	/** WeakMap linking marker data to its parent MicrioImage instance. */
	const markerImages : Map<string,MicrioImage> = getContext('markerImages');
	/** Reference to the global marker popup state. */
	const currentPopup = micrio.state.popup;
	/** Reference to the global active tour state. */
	const tour = micrioState.tour;

	// --- Props ---

	interface Props {
		/** The marker data object. */
		marker: Models.ImageData.Marker;
		/** The parent MicrioImage instance this marker belongs to. Defaults to the current image. */
		image?: MicrioImage;
		/** If true, the marker element is hidden regardless of other conditions. */
		forceHidden?: boolean;
		/** Optional Map to store calculated screen coordinates (used for clustering). */
		coords?: Map<string, [number, number, number?, number?]>|undefined;
		/** If true, this marker is currently overlapped by another marker (used for clustering). */
		overlapped?: boolean;
	}

	let {
		marker = $bindable(),
		image = $bindable($current as MicrioImage),
		forceHidden = false,
		coords = undefined,
		overlapped = false
	}: Props = $props();

	// --- Initialization & Data Sanitization ---

	// Ensure marker tags array exists
	if(!marker.tags) marker.tags = [];

	/** Check if this marker instance was already associated with an image (prevents re-linking). */
	const openedBefore = markerImages.has(marker.id);
	// Associate this marker data with its parent image instance if not already done.
	if(!openedBefore && image) markerImages.set(marker.id, image);

	/** Check if side labels are enabled for Omni objects on mobile. */
	const mobileFancyLabels = !!(image.isOmni && image.$settings.omni?.sideLabels && !image.$settings._markers?.noTitles);

	// --- Marker Configuration & Settings ---

	/** Check if the marker is part of the currently active tour. */
	const inTour = (t:Models.ImageData.MarkerTour) : boolean => t.steps.findIndex(s => s.startsWith(marker.id)) >= 0;

	/** Marker specific data overrides. */
	const data:Models.ImageData.MarkerData = marker.data ?? {};
	/** Custom metadata from the marker editor. */
	const _meta = data._meta || {};
	/** Omni settings from the parent image. */
	const omni = image.$settings.omni;

	// Data Correction: If image was layered but layers were removed, clear marker's layer setting.
	if(marker.imageLayer && marker.imageLayer > (omni?.layers?.length ?? 1) - 1)
		delete marker.imageLayer;

	// Data Correction: If this marker is the target of a split-screen link from the main image, disable its popup.
	if(!!$current?.$data?.markers?.find(m =>
		m.data?._micrioSplitLink?.markerId == marker.id && m.popupType != 'none'
	)) {
		marker.popupType = 'none';
		marker.noMarker = true; // Also hide the marker itself?
	}

	// Data Correction: Handle legacy 'embedInPopover' property.
	if('embedUrl' in marker && marker.embedUrl && 'embedInPopover' in marker && marker['embedInPopover'])
		marker.popupType = 'popover';

	/** Marker settings inherited from the parent image. */
	const markerSettings:Models.ImageInfo.MarkerSettings = image.$settings._markers ?? {};
	/** Flag for tour jump animation preference. */
	const doTourJumps:boolean = !!image.$settings.doTourJumps;

	/** Combined CSS class names from marker tags. */
	const classNames:string = marker.tags.join(' ');
	/** Is this a cluster marker? */
	const cluster:boolean = marker.type == 'cluster';

	// --- Visibility & Style Flags ---

	/** Should titles be completely hidden (overrides showTitle)? */
	const noTitles:boolean = !!markerSettings.noTitles || !!omni?.sideLabels;
	/** Does the marker scale with zoom? */
	const scales:boolean = !!data.scales || !!image.$settings.markersScale;
	/** If marker scales, should the title *not* scale? */
	const titleNoScales:boolean = scales && !!markerSettings.titlesNoScale;
	/** Parsed split-screen link data. */
	const split = data._micrioSplitLink;
	/** Should the popup remain open during marker tour transitions? */
	const keepPopup:boolean = !!markerSettings.keepPopupsDuringTourTransitions;
	/** Disable tooltips on hover? */
	const noToolTips:boolean = /[?&]micrioNoTooltips/.test(location.search) || !!omni?.sideLabels;

	// --- Tour Integration ---

	/** Static grid action associated with this marker. */
	const gridAction:string|undefined = _meta.gridAction;
	/** Find the marker tour associated with this marker, if autoStartTour is enabled. */
	const autoStartMyTour:Models.ImageData.MarkerTour|undefined = image.$settings?._markers?.autoStartTour
		? micrio.wasm.images.map(c => 'camera' in c ? c.$data?.markerTours?.find(inTour) : undefined).filter(t => !!t)[0] ?? spaceData?.markerTours?.find(inTour) : undefined;
	/** Find the step index of this marker within its auto-start tour. */
	const myTourStep:number|undefined = autoStartMyTour?.steps.findIndex(s => s.startsWith(marker.id));
	/** Should the auto-start tour always begin from step 0? */
	const startTourAtBeginning:boolean = !!image.$settings?._markers?.autoStartTourAtBeginning;

	// --- Initial State ---

	/** Should the marker be opened immediately on mount? */
	let openOnInit:boolean = (!openedBefore && (!!data.alwaysOpen || (micrioState.$marker == marker)) // Always open, or currently set as active marker
		|| (micrioState.$tour?.id == autoStartMyTour?.id && autoStartMyTour?.currentStep == (myTourStep??0))); // Or part of active auto-start tour at correct step

	/** Is the marker currently considered "open" (active)? */
	const isOpened = openedBefore && image.state.$marker == marker;
	let opened:boolean = $state(isOpened);
	/** Has the camera finished flying to the marker's view? */
	let flownTo:boolean = $state(isOpened);
	/** Is the marker currently behind the camera in 360/Omni view? */
	let behindCam:boolean = $state(false);
	/** CSS matrix string for 3D positioning (360 embeds). */
	let matrix:string = $state('');

	// --- Screen Position State ---
	let x:number = $state(0); // Screen X
	let y:number = $state(0); // Screen Y
	let scale:number = $state(1); // Current effective scale at marker position
	let w:number; // Depth component (w) from projection

	// --- Split Screen State ---
	let splitImage:MicrioImage|undefined; // Reference to the opened split-screen image
	let splitOpened:boolean = false; // Is the split-screen image currently open?

	// --- Event Handlers ---

	/** Handles click events on the marker button. */
	function click() : void {
		blur(); // Clear focus timeout
		if(marker.onclick) return marker.onclick(marker); // Custom click handler
		if(markerSettings.noMarkerActions) return; // Global setting to disable actions

		if(marker.type == 'cluster') {
			// Zoom into the cluster's bounding box
			if(marker.view && $current?.$info) {
				const currentScale = $current.camera.getScale();
				image.camera.flyToView(marker.view, {
					area: image.opts?.area,
					limitZoom: true,
					// Add margin based on pixel size / image size * scale
					margin: [
						20 / $current.$info.width * currentScale,
						20 / $current.$info.height * currentScale
					]
				});
			}
		}
		// Standard marker: set as the active marker for the image
		else image.state.marker.set(marker);
	}

	/** Handles focus events (e.g., tabbing). */
	let fto:any; // Focus timeout
	function focus() : void {
		if(markerSettings.noMarkerActions) return;

		// Prevent container scroll jump on focus
		(_container?.parentNode as HTMLElement)?.scrollTo(0,0);
		blur(); // Clear previous focus timeout
		// Set timeout to fly to marker if it's off-screen after a short delay
		fto = setTimeout(() => {
			const px = image.camera.getXY(marker.x, marker.y); // Get screen coordinates
			// If marker is off-screen or behind camera (360) and not already opened
			if(!opened && (px[0] < 0 || px[0] >= micrio.offsetWidth || px[1] < 0 || px[1] >= micrio.offsetHeight || (image.is360 ? px[3] > 4 : false)))
				image.camera.flyToCoo([marker.x, marker.y], { speed: 2, limit: true}).catch(() => {}); // Fly to marker center
		}, 150);
	}

	/** Handles blur events (clears focus timeout). */
	function blur() : void {
		clearTimeout(fto);
	}

	/** Handles mouse enter event (sets global hover state). */
	const hoverStart = () : void => hovered.set(marker.id);
	/** Handles mouse leave event (clears global hover state). */
	const hoverEnd = () : void => hovered.set(undefined);

	/** Called when this marker becomes the active marker (`image.state.marker` changes). */
	async function activated() {
		if(opened) return; // Already open
		opened = true;
		blur(); // Clear focus timeout

		if(markerSettings.noMarkerActions) return; // Exit if actions disabled

		// Dispatch 'marker-open' event
		events.dispatch('marker-open', marker);

		// Stop any non-marker tour if active
		if($tour && (!('steps' in $tour) || (!inTour($tour) && !$tour.cannotClose))) {
			tour.set(undefined);
			await tick(); // Wait for tour state to update
		}

		// Close any other currently open popup/popover, unless it's part of the same tour and keepPopup is true
		const currentMarkerTour = $tour && 'steps' in $tour;
		if(!noPopup && (!currentMarkerTour || !keepPopup)) {
			currentPopup.set(undefined);
			micrio.state.popover.set(undefined);
		}

		hoverEnd(); // Clear hover state

		// Handle split-screen link activation
		if(split?.markerId) {
			// Find the target image instance
			if(!splitImage) splitImage = micrio.canvases.find(c => c.id == split.micrioId)
			if(splitImage) {
				splitOpened = get(splitImage.visible); // Check if already visible
				// If visible and a target view is specified, fly the split image's camera
				if(splitOpened && split?.view) splitImage.camera.flyToView(split.view, {isJump:true}).catch(() => {})
			}
		}

		// Handle omni layer switching
		if(marker.imageLayer !== undefined) image.state.layer.set(marker.imageLayer);

		// Handle grid action delay if starting tour from beginning
		const immediatelyStartMyTourAtBeginning = autoStartMyTour && startTourAtBeginning && autoStartMyTour != $tour && (myTourStep != undefined && myTourStep > 0);
		if(immediatelyStartMyTourAtBeginning) delete _meta.gridAction; // Temporarily remove grid action

		// Fly camera to marker view, unless it's a video tour marker or grid view marker
		const hasView = marker.view;
		
		if(!immediatelyStartMyTourAtBeginning && hasView && !data.noAnimate && !marker.videoTour && !_meta.gridView) {
			if(openOnInit) { // If opened on init, set view directly
				image.camera.setView(marker.view!, {area: image.opts?.area});
				open(); // Proceed to open content
			} else { // Otherwise, animate
					const flyPromise = image.camera.flyToView(marker.view!, {
						omniIndex, // Pass omni index if applicable
						noTrueNorth: true, // Don't correct true north during marker fly-to
						area: image.opts?.area,
						isJump: !!data.doJump || (doTourJumps && !!micrioState.$tour) // Use jump animation if specified or in a tour
					});
				
				flyPromise
					.then(open) // Proceed to open content after animation
					.catch(() => { if(!$tour) image.state.marker.set(undefined) }); // If animation fails (e.g., interrupted) and not in a tour, close the marker
			}
		}
		else {
			open(); // Open content immediately if no view animation needed
		}
	}

	/** Timeout for delaying split screen opening. */
	let _splitOpenTo:any;

	/** Final steps after camera animation (if any) to open marker content. */
	async function open() : Promise<void> {
		if(cluster) return; // Don't open content for cluster markers

		// Double-check if this marker is still the active one
		if(image.state.$marker != marker) return image.state.marker.set(marker);

		if(markerSettings.noMarkerActions) return;

		// Auto-start associated marker tour if configured and no other tour is active
		if(autoStartMyTour && autoStartMyTour.id != $tour?.id) {
			// Set initial step based on settings
			autoStartMyTour.initialStep = startTourAtBeginning ? 0 : myTourStep;
			const firstStep = autoStartMyTour.stepInfo?.[0];
			// If starting from beginning and first step is on a different image, switch image first
			if(startTourAtBeginning && firstStep && firstStep.micrioId != image.id) {
				const grid = micrio.canvases[0]?.grid;
				// Check if target image is in the grid
				if(grid?.images.find(i => i.id == firstStep.micrioId)) micrio.current.set(grid.image);
				else micrio.open(firstStep.micrioId); // Open the target image
			}
			tour.set(autoStartMyTour); // Set the tour as active
			// Restore grid action after a delay if it was temporarily removed
			setTimeout(() => _meta.gridAction = gridAction, 100);

			// If starting from beginning but this isn't the first step, close this marker
			if(startTourAtBeginning && (myTourStep != undefined && myTourStep > 0)) {
				image.state.marker.set(undefined);
				// close(); // `close` will be called automatically by the state change
				return;
			}
			await tick(); // Wait for tour state update
		}

		openOnInit = false; // Reset init flag
		flownTo = true; // Mark camera flight as complete
		events.dispatch('marker-opened', marker); // Dispatch event

		// --- Open Popup/Popover/Tour ---

		// Check if this marker starts a video tour within a serial tour chapter context
		const isChapteredSerialTour = $tour && 'steps' in $tour && $tour.isSerialTour && $tour.printChapters && $tour.steps.findIndex(s => s.startsWith(marker.id)) >= 0
			&& marker.videoTour;

		if(!isChapteredSerialTour) { // Don't show standard popup for chaptered serial tour video markers
			if(!noPopup) { // If popupType is 'popup' and content is not empty
				tick().then(() => currentPopup.set(marker)); // Set global popup state
			}
			else if(marker.popupType == 'popover') { // If popupType is 'popover'
				await tick();
				micrio.state.popover.set({ // Set global popover state
					marker, image, markerTour: $tour && 'steps' in $tour ? $tour : undefined
				});
			}
			else if(marker.videoTour && !$tour) { // If marker has a video tour and no global tour is active
				tour.set(marker.videoTour); // Start the marker's video tour
				// Automatically close the marker once the video tour finishes
				after(tour).then(() => image.state.marker.set(undefined));
			}
		}

		// --- Handle Linked Image ---
		const linkId = data.micrioLink?.id;
		if(linkId) {
			tick().then(() => {
				image.camera.stop(); // Stop current image animation
				// Check if moving between images within the same 360 space
				const vector = getSpaceVector(micrio, linkId);
				if(vector) { // If in same space, clear marker state before navigating
					image.openedView = undefined;
					image.state.marker.set(undefined);
				}
				micrio.open(linkId,{vector: vector?.vector}); // Open the linked image
			});
		}

		// --- Handle Split Screen ---
		if(split && !splitOpened && !image.opts.secondaryTo) { // If split link exists, not already open, and not secondary
			// Wait for potential grid animations to finish
			const grid = micrio.canvases[0]?.grid;
			if(grid?.lastPromise) await grid.lastPromise;
			// Open the split screen image after a short delay
			_splitOpenTo = setTimeout(() => {
				if(!split) return;
				splitImage = micrio.open(split.micrioId, {
					splitScreen: true,
					splitTo: image, // Link to this image
					isPassive: !!(split.follows && !micrio.state.$tour), // Follow if specified and not in a tour
					startView: split.view // Optional starting view for split image
				});
				splitOpened = true;
			}, 200);
		}
	}

	/** Called when this marker is deactivated/closed. */
	function close(){
		clearTimeout(_splitOpenTo); // Clear split screen open timeout
		events.dispatch('marker-closed', marker); // Dispatch event

		// Refocus the marker button after closing, potentially after camera animation
		if(marker.videoTour && image.openedView) { // If closed after marker video tour with zoom-out
			setTimeout(() => image.camera.aniDoneAdd.push(() => _button?.focus()), 10); // Focus after animation
		} else {
			_button?.focus(); // Focus immediately
		}

		// Clear global popover/popup state if this marker was showing it
		micrio.state.popover.set(undefined);
		if(!noPopup) {
			const currentMarkerTour = $tour && 'steps' in $tour;
			if($currentPopup == marker && (!currentMarkerTour || !keepPopup)) {
				currentPopup.set(undefined);
			}
			// Check if another image has an open marker popup and restore it
			const extMarker = micrio.canvases.find(c => c != image && c.state.$marker);
			if(extMarker) {
				tick().then(() => {
					const m = extMarker.state.$marker;
					if(m && m.popupType == 'popup') currentPopup.set(m); // Restore other popup
				});
			}
		}

		// Close split screen image if it was opened by this marker
		if(split && splitImage) {
			setTimeout(() => {
				const curr = get(micrio.state.marker);
				// Close only if the currently active marker isn't also linked to the same split image
				if(splitImage && split.micrioId != curr?.data?._micrioSplitLink?.micrioId) {
					micrio.close(splitImage);
				}
			},210); // Delay slightly
		}
	}

	// --- Position Update ---

	/** Flag indicating if the marker is currently within the viewport (for side labels). */
	let isInView:boolean=$state(false);
	/** Cached width of the label element. */
	let prevLabelWidth:number|undefined;
	/** Cached height of the label element. */
	let prevLabelHeight:number|undefined;

	/** Updates the marker's screen position based on camera view changes. */
	function moved(){
		if(image.is360 && scales) { // 360 scaling (using matrix)
			matrix = image.camera.getMatrix(marker.x, marker.y, 1, 1,0,0,0).join(',');
		} else { // 2D or Omni positioning
			let pX=x, pY=y; // Store previous position
			// Get new screen coordinates [x, y, scale, w(depth)]
			[x, y, scale, w] = image.camera.getXYDirect(marker.x, marker.y, {
				radius: marker.radius, // For Omni
				rotation: marker.rotation, // For Omni
			});

			// Update behindCam flag based on depth (w)
			if(image.is360) behindCam = w > 0;
			else if(image.isOmni && omni) {
				// Check visibility arc for Omni markers
				if(omniArc[0] != undefined && omniArc[1] != undefined && marker.rotation != undefined) { // Use != undefined for 0 index check
					const numFrames = omni.frames / (omni.layers?.length ?? 1);
					let delta = (image.swiper?.currentIndex??0) - (omniIndex??0); // Difference from target frame
					// Handle wrapping
					if(delta > numFrames / 2) delta -= numFrames;
					if(delta < -numFrames / 2) delta += numFrames;
					behindCam = delta <= omniArc[0] || delta >= omniArc[1]; // Check if outside visible arc
				}
				// Fallback depth check for Omni
				else if(omni.distance) behindCam = w < 0;

				// Update side label position if enabled and position changed
				if(omni.sideLabels && !markerSettings.noTitles && content?.title && inView && (pX!=x||pY!=y)) {
					setInView(x,y);
				}
			}

			// Update coordinates map used for clustering
			if(image.$settings.clusterMarkers && coords) {
				coords.set(marker.id, [
					x,
					y,
					!overlapped ? (prevLabelWidth = _label?.offsetWidth) : prevLabelWidth, // Cache label width if not overlapped
					!overlapped ? (prevLabelHeight = _label?.offsetHeight) : prevLabelHeight // Cache label height
				]);
			}
		}
	}

	/** Updates the `inView` store for Omni side labels. */
	function setInView(x:number, y:number) {
		const elW = micrio.canvas.element.offsetWidth, elH = micrio.canvas.element.offsetHeight;
		// Check if marker is within screen bounds
		const shown = !(x < 0 || x > elW || y < 0 || y > elH) && !behindCam;
		// Update the shared `inView` store if visibility changed or position changed
		if(shown || isInView) {
			inView.update(a => {
				const existingIndex = a.findIndex(([m]) => m == marker);
				if(!shown) { // If now hidden
					if(existingIndex >= 0) a.splice(existingIndex, 1); // Remove from store
				} else if(existingIndex >= 0) { // If still shown, update position
					a[existingIndex] = [marker, x/elW, y];
				} else { // If newly shown
					a.push([marker,x/elW,y]); // Add to store
				}
				isInView = shown; // Update local flag
				return a;
			});
		}
	}

	/**
	 * Handles external position changes (e.g., from Spaces editor).
	 * TODO: what event should this be in the MicrioEventMap? It's the 'changed' event of a div!
	 */
	function changed(e:Event) {
		const m = (e as Models.MicrioEvent<typeof marker>).detail;
		marker.x = m.x;
		marker.y = m.y;
		moved(); // Recalculate position
	}

	function listen(node:HTMLElement, callback:(e:Event)=>void) {
		node.addEventListener('change', callback);
		return { destroy: () => node.removeEventListener('change', callback) }
	}

	// --- DOM Element References ---
	let _button:HTMLButtonElement|undefined = $state(); // The main button element
	let _container:HTMLElement|undefined = $state(); // The outer div container
	let _label:HTMLElement|undefined = $state(); // The label element

	// --- Tour State ---
	/** Reference to the global tour paused state store. */
	const tourPaused = getContext<Writable<boolean>>('mediaPaused');

	// --- Lifecycle (onMount) ---
	onMount(() => {
		// If marker has a video tour, derive its view from the first timeline step
		if(marker.videoTour) {
			const timeline = 'timeline' in marker.videoTour ? marker.videoTour.timeline as Models.ImageData.VideoTourView[]
				: marker.videoTour.i18n?.[$_lang]?.timeline;
			if(timeline?.length) marker.view = timeline[0].rect;
		}

		// Subscribe to this image's active marker state
		const unsub = [image.state.marker.subscribe(m => {
			if(typeof m == 'string' && m == marker.id) {
				// If set by ID, resolve to the actual marker object
				image.state.marker.set(marker);
			} else if(m == marker) {
				// If this marker became active, call activated()
				activated();
			} else if(!data.alwaysOpen) {
				// If another marker became active (or none), call close() if this one was open
				if(opened) close();
				opened = flownTo = false; // Reset state
			}
		})];

		// Subscribe to view changes if the marker element needs positioning
		if(!noMarker) {
			unsub.push(image.camera.image.state.view.subscribe(moved));
			moved(); // Initial position calculation
		}

		// Handle initial opening logic after a tick (allows other state to settle)
		if(!forceHidden) {
			tick().then(() => {
				// If marker was previously opened but is no longer the active popup/tour, close it
				if(opened && !marker.noMarker && $currentPopup && $currentPopup != marker && !$tour) {
					image.state.marker.set(undefined);
				}
				// Otherwise, if it should open on init or is always open, trigger open()
				else if(openOnInit || data.alwaysOpen) {
					open();
				}
			});
		}

		// Append custom HTML element if provided
		if(marker.htmlElement && _container) _container.appendChild(marker.htmlElement);

		// Cleanup subscriptions on component destroy
		return () => {
			clearTimeout(_splitOpenTo); // Clear split screen timeout
			while(unsub.length) unsub.shift()?.(); // Unsubscribe from stores
		}
	});

	// --- Reactive Content & Style Calculations ---

	/** Reactive language-specific content object. */
	const content = $derived(marker.i18n ? marker.i18n[$_lang] : (marker as unknown as Models.ImageData.MarkerCultureData));

	/** Reactive check if marker has any content for the popup. */
	const noPopupContent = $derived(!content?.title && !content?.body && !content?.bodySecondary && !content?.embedUrl
		&& !(marker.images && marker.images.length));
	/** Reactive check if the marker element itself should be hidden. */
	const noMarker = $derived(forceHidden || marker.noMarker);
	/** Reactive check if the popup should not be shown. */
	const noPopup = $derived(marker.popupType != 'popup' || noPopupContent);

	// --- Reactive Omni Calculations ---

	/** Calculate the target frame index for this marker based on its rotation. */
	const omniIndex = $derived(image.camera.getOmniFrame((marker.rotation??0) + (marker.backside ? Math.PI : 0)));
	/** Calculate the start and end frame indices for the marker's visibility arc. */
	const omniArc = $derived(marker.visibleArc ? [
		image.camera.getOmniFrame(marker.visibleArc[0]),
		image.camera.getOmniFrame(marker.visibleArc[1])
	] : []);

	/** Reactive flag to hide marker during tours based on settings. */
	const hidden = $derived($tour && ((!('steps' in $tour) && !$tour.keepMarkers) || (markerSettings.hideMarkersDuringTour && !$tourPaused)) && !opened);

	// Update inView store when marker becomes hidden
	$effect(() => { if(hidden && isInView) inView.update(v => { // Check isInView flag before updating
		const idx = v.findIndex(iv => iv[0] == marker);
		if(idx >= 0) v.splice(idx, 1);
		return v;
	})});

	// --- Icon Determination ---

	/** Determine the standard icon name based on marker type. */
	const icon = $derived((marker.type == 'default' ? undefined
		: marker.type == 'link' ? 'link'
		: marker.type == 'media' ? 'play'
		: marker.type == 'cluster' ? undefined // Cluster uses text content
		: marker.type ?? undefined) as (IconName|undefined));

	/** Determine the custom icon asset (from marker data or image settings). */
	const customIcon = $derived((marker.data?.customIconIdx != undefined ? image.$settings._markers?.customIcons?.[marker.data?.customIconIdx] : undefined)
		?? marker.data?.icon ?? markerSettings.markerIcon ?? undefined);

	/** Flag indicating if any icon (standard or custom) should be displayed. */
	const hasIcon = $derived(!!icon || !!customIcon);

	/** Flag for applying default marker styling (unless explicitly disabled in V4). */
	const defaultClass = $derived((!('class' in marker) || marker.class !== '') && (!!hasIcon || marker.type == 'default'));

	/** Flag indicating if the label should be shown (based on settings and content). */
	const showLabel = $derived(content && (!noTitles || ($isMobile && mobileFancyLabels)) && (content.label || content.title));

</script>

<!-- Render the marker container div if it's not hidden -->
{#if !noMarker && image && !hidden}
	<div bind:this={_container} id={`m-${marker.id}`}
		use:listen={changed}
		class={classNames}
		class:overlapped={overlapped && !opened}
		class:cluster
		class:behind={behindCam}
		class:hovered={$hovered == marker.id}
		class:default={defaultClass}
		class:mat3d={!!matrix}
		class:opened={opened}
		class:micrio-link={!!data.micrioLink}
		class:has-icon={hasIcon}
		class:has-custom-icon={!!customIcon}
		style={matrix ? `--mat:matrix3d(${matrix})` : x ? `--x:${x}px;--y:${y}px${scales ? `;--scale:${scale}` : ''}` : null}
	>
		<!-- Render button content unless a custom HTML element is provided -->
		{#if !marker.htmlElement}
			<button
				title={noToolTips || cluster ? null : (content ? content.label || content.title : null)}
				id={marker.id}
				bind:this={_button}
				onclick={click}
				onfocus={focus}
				onblur={blur}
				onmouseenter={hoverStart}
				onmouseleave={hoverEnd}
				data-scroll-through
			>
				<!-- Display custom icon or standard icon -->
				{#if customIcon}
					<img src={customIcon.src} alt="" />
				{:else if icon}
					<Icon name={icon} />
				{/if}
				<!-- Display label if needed -->
				{#if showLabel}
					<label bind:this={_label} class:static={titleNoScales} for={marker.id} data-scroll-through>
						{content.label||content.title}
					</label>
				{/if}
			</button>
		{/if}
		<!-- Note: Custom marker.htmlElement is appended in onMount -->
	</div>
{/if}

<!-- Render positional audio component if configured -->
{#if marker.positionalAudio && $ctx && (!marker.positionalAudio.noMobile || $isMobile) && (marker.positionalAudio.alwaysPlay || opened)}
	<AudioLocation {marker} ctx={$ctx} is360={image.is360} />
{/if}

<style>
	div {
		position: absolute;
		display: block;
		/* Apply 2D transform using CSS variables updated in `moved` function */
		transform: translate3d(calc(var(--x, 0) - 50%), calc(var(--y, 0) - 50%), 0) scale3d(var(--scale, 1), var(--scale, 1), 1);
		top: 0;
		left: 0;
		will-change: transform; /* Hint browser for optimization */
	}
	/* Fade-in animation for non-cluster markers */
	div:not(.cluster):not(.no-fade) {
		animation: fadeIn .25s;
		animation-fill-mode: forwards;
	}
	/* Hide overlapped markers (used by clustering) */
	div.overlapped {
		display: none;
	}
	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}
	/* Hide markers that are behind the camera in 360/Omni */
	div.behind {
		pointer-events: none;
		visibility: hidden;
	}
	/* Apply 3D matrix transform for 360 embeds */
	div.mat3d {
		transform: var(--mat);
		top: 50%;
		left: 50%;
		transform-style: preserve-3d;
	}
	div.mat3d > button {
		position: absolute;
		transform: translate3d(-50%,-50%,0); /* Center button within 3D transformed div */
	}

	/* Base button styling */
	button {
		display: block;
		width: var(--micrio-marker-size);
		height: var(--micrio-marker-size);
		color: var(--micrio-marker-text-color);
		position: relative;
		cursor: pointer;
		font: inherit;
		padding: 0;
		margin: 0;
		background: transparent none center center no-repeat;
		background-image: var(--micrio-marker-icon); /* Default icon from CSS variable */
		background-size: contain;
		border: none;
	}

	/* Label styling (shown on hover or statically) */
	div:not(.cluster) label {
		position: absolute;
		top: 50%;
		left: 100%; /* Position to the right of the marker */
		text-align: var(--micrio-text-align);
		cursor: pointer;
		transform: translate(0, -50%); /* Center vertically */
		padding-left: 10px; /* Space from marker */
		max-width: 170px;
		width: max-content; /* Fit content width */
		white-space: pre-wrap; /* Allow wrapping */
		font-size: 90%;
		font-weight: 600;
		line-height: 1em;
		text-shadow: var(--micrio-marker-text-shadow);
		opacity: 0; /* Hidden by default */
		pointer-events: none; /* No interaction by default */
		transition: opacity .1s ease;
	}
	/* Ensure hovered marker is on top */
	div:hover {
		z-index: 2;
	}
	/* Show label on hover or if showTitles is enabled */
	:global(.show-titles) > div label, div:hover label {
		opacity: 1;
	}
	/* Responsive label font size */
	@media (max-width: 640px) {
		div:not(.cluster) label {
			font-size: 12px;
		}
	}
	/* Enable pointer events for statically shown titles */
	:global(.show-titles) > div label {
		pointer-events: all;
	}
	/* Apply inverse scaling to label if marker scales but title shouldn't */
	label.static {
		transform: translate(-50%, 4px) scale3d(calc(1 / var(--scale, 1)), calc(1 / var(--scale, 1)), 1);
	}

	/* Default marker appearance (circle with border) */
	div.default button {
		box-sizing: content-box;
		background-clip: content-box;
		border-radius: var(--micrio-marker-border-radius);
		border: var(--micrio-marker-border-size) solid var(--micrio-marker-border-color);
		transition: var(--micrio-marker-transition);
		background-color: var(--micrio-marker-color);
	}
	/* Ensure hovered/opened markers are on top */
	div.default:hover,
	div.default.hovered,
	div.default.opened {
		z-index: 1;
	}
	/* Hover/opened state: change background, remove border, increase size slightly */
	div.default:hover button,
	div.default.hovered button,
	div.default.opened button {
		background-color: var(--micrio-marker-highlight);
		border-width: 0;
		width: calc(var(--micrio-marker-size) + var(--micrio-marker-border-size) * 2);
		height: calc(var(--micrio-marker-size) + var(--micrio-marker-border-size) * 2);
	}

	/* Styling when a standard icon is used */
	div.has-icon button {
		--micrio-marker-icon: none; /* Hide default background image */
	}
	div.default.has-icon button {
		color: #fff; /* Icon color */
		width: calc(var(--micrio-marker-size) + 24px); /* Slightly larger size for icon */
		height: calc(var(--micrio-marker-size) + 24px);
		background-color: var(--micrio-marker-border-color); /* Use border color as background */
		border: none;
	}
	div.default.has-icon button > :global(svg) {
		margin: 0 auto; /* Center icon */
	}
	/* Change icon color on hover/open */
	div.default.has-icon.opened button > :global(svg),
	div.default.has-icon.hovered button > :global(svg),
	div.default.has-icon:hover button > :global(svg) {
		color: var(--micrio-marker-highlight);
	}

	/* Styling when a custom image icon is used */
	div.default.has-custom-icon button {
		background-color: var(--micrio-marker-color); /* Use marker color as background */
	}
	/* Change background on hover/open */
	div.default.has-custom-icon.opened button,
	div.default.has-custom-icon.hovered button,
	div.default.has-custom-icon:hover button {
		background-color: var(--micrio-marker-highlight, var(--micrio-marker-color));
	}

	/** Cluster marker styling */
	div.cluster button {
		border: 2px solid var(--micrio-marker-color);
		background: var(--micrio-cluster-marker-background, #fff);
		color: var(--micrio-cluster-marker-color, #000);
		width: calc(var(--micrio-marker-size) + 12px); /* Larger size for cluster */
		height: calc(var(--micrio-marker-size) + 12px);
		border-radius: 100%; /* Circular */
		box-sizing: content-box;
	}
	div.cluster:hover button {
		background: var(--micrio-marker-highlight, #fff);
		border-color: var(--micrio-marker-highlight, #fff);
	}
	/* Hide label for cluster markers */
	div.cluster label {
		pointer-events: none;
		display: none;
	}

	/** Custom icon image styling */
	div img {
		max-width: 100%;
		max-height: 100%;
		display: block; /* Remove extra space below image */
		margin: auto; /* Center image if smaller than button */
	}
</style>
