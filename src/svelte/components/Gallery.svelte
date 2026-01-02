<!-- @migration-task Error while migrating Svelte code: Unexpected token -->
<script lang="ts">
	/**
	 * Gallery.svelte - Handles different types of image galleries.
	 *
	 * This component manages the display and interaction for various gallery types:
	 * - Swipeable galleries (horizontal strip or full-screen)
	 * - Switch galleries (images layered on top)
	 * - Omni-object viewers (rotatable 3D objects)
	 *
	 * It interacts heavily with the core MicrioImage and Wasm layers for positioning,
	 * transitions, and active image management.
	 */

	import type { HTMLMicrioElement } from '../../ts/element';
	import type { MicrioImage } from '../../ts/image';
	import type { Camera } from '../../ts/camera';
	import type { Models } from '../../types/models';

	import { getContext, onMount } from 'svelte';
	import { writable, type Unsubscriber, type Writable } from 'svelte/store';
	import { faLayerGroup } from '@fortawesome/free-solid-svg-icons'; // Icon for omni layers
	import { GallerySwiper } from '../../ts/swiper'; // Handles swipe gestures for full-screen galleries
	import { i18n } from '../../ts/i18n'; // For UI text translations

	import Button from '../ui/Button.svelte';
	import Dial from '../ui/Dial.svelte'; // Used for omni object rotation control
    import { View } from '../../ts/utils';

	// --- Props ---

	interface Props {
		/**
	 * Array of MicrioImage or OmniFrame objects representing the items in the gallery.
	 * For standard galleries, this comes from `image.$info.gallery`.
	 * For Omni objects, this is generated internally based on `omni` settings.
	 */
		images?: (MicrioImage|Models.Omni.Frame)[];
		/** Omni object settings, if applicable. Passed from Main.svelte. */
		omni?: Models.ImageInfo.OmniSettings|null;
	}

	let { images = [], omni = null }: Props = $props();

	// --- Context & State ---

	/** Get the main Micrio element instance and relevant stores/properties from context. */
	const micrio = <HTMLMicrioElement>getContext('micrio');
	const { wasm, current, events, _lang } = micrio;

	// --- UI Settings ---
	/** Whether the gallery controls should auto-hide after inactivity. */
	const autoHide:boolean = true; // Currently hardcoded, could be a prop/setting

	// --- Component Initialization ---

	// Assume these are defined at this point as this component is rendered by Main.svelte
	const image = $current as MicrioImage; // The main MicrioImage (virtual container for gallery)
	const info = image.$info as Models.ImageInfo.ImageInfo; // Image info
	const layer = image.state.layer; // Omni layer store
	const settings = image.settings; // Image settings store
	const camera = image.camera as Camera; // Camera instance

	// --- Omni Object Setup ---
	// If it's an omni object, generate the frame data internally
	if(omni) {
		for(let j=0;j<omni.frames;j++) {
			images.push({
				id: info.id+'/'+j, // Unique ID for the frame
				image: image, // Reference to the parent image
				visible: writable<boolean>(false), // Visibility store for the frame
				frame: j, // Frame index
				opts: { area: [0,0,1,1] }, // Frame occupies full area
				ptr: -1, // Wasm pointer (not applicable here)
				baseTileIdx: -1, // Base tile index (not applicable here)
				thumbSrc: image.getTileSrc(image.levels, 0, 0, j) // Thumbnail source for the frame
			});
		}
	}

	// --- Gallery Configuration ---

	/** Gallery settings from the main image's settings store. */
	const gallery = $settings.gallery!; // Assumes gallery settings exist

	// Determine gallery type flags
	const isOmni:boolean = gallery.type == 'omni';
	const isFullSwipe:boolean = isOmni || gallery.type == 'swipe-full';
	const isSwitch:boolean = isFullSwipe || gallery.type == 'switch';

	// Other gallery options
	const isContinuous:boolean = isOmni; // Omni objects wrap around
	const isSpread:boolean = !!gallery.isSpreads; // Display pages as spreads
	const coverPages:number = gallery.coverPages ?? 0; // Number of single cover pages in spreads

	// Omni-specific settings
	const omniSettings = $settings.omni;
	const isOmniTwoAxes:boolean = isOmni && !!omniSettings?.twoAxes; // Is it a 2-axis omni object?

	// Determine starting index
	const startId:string|null = gallery.startId || micrio.getAttribute('data-gallery-start-id'); // ID from settings or attribute
	const archiveId:string|undefined = gallery.archive; // Archive ID if used
	const coverLimit:boolean = !!$settings.limitToCoverScale; // Inherit cover limit setting
	const noUI:boolean = !!$settings.noUI; // Inherit noUI setting

	const omniFrontIndex:number = omniSettings?.frontIndex ?? 0; // Which frame index is considered the "front"
	const omniNumLayers:number = omniSettings?.layers?.length ?? 1; // Number of layers in omni object

	// Calculate initial index based on attribute, startId, or omni settings
	const startIdxAttr:number|undefined = micrio.hasAttribute('data-gallery-start') ? Number(micrio.getAttribute('data-gallery-start')) : $settings?.omni?.startIndex;
	let startIdx = startIdxAttr != undefined && !isNaN(startIdxAttr) ? startIdxAttr : startId ? images.findIndex(i => i.id == startId) : 0;
	if(startIdx < 0) startIdx = 0; // Default to 0 if not found or invalid

	// --- Page Layout Calculation ---

	/** Array storing the calculated view rectangle for each page/spread. */
	const pages:Models.Camera.ViewRect[] = [];
	/** Array mapping page index to the original image index(es) it contains. */
	const pageIdxes:number[][] = [];

	// Calculate page layouts, handling spreads
	if(images) {
		for(let i=0; i<images.length; i++) {
			let area = images[i].opts?.area; // Get area defined in MicrioImage options
			if(!area) continue; // Skip if no area defined (shouldn't happen for galleries)
			const v = area.slice(0); // Copy the area view
			pageIdxes.push([i]); // Add current image index to mapping

			// If spreads are enabled, and this is an even page after cover pages, combine with the next page
			if(isSpread && (i-coverPages>=0 && ((i-coverPages)%2==0)) && images[i+1]) {
				area = images[++i].opts?.area; // Get area of the next image
				if(!area) continue; // Skip if next image has no area
				pageIdxes[pageIdxes.length-1].push(i); // Add next image index to the same page mapping
				// Extend the view rectangle to encompass both pages
				v[2] = area[2]; // Use right edge of the second image
				v[3] = area[3];
			}
			pages.push(v); // Add the calculated page/spread view to the list
		}
	}

	// --- Omni Layer Names ---
	const pagesPerLayer = pages.length / omniNumLayers;
	const layerNames = omniSettings?.layers?.map(l => ({i18n: Object.fromEntries(Object.entries(l.i18n).map(([l,t],i)=>[l,{title:t??'Layer '+(i+1)}]))})) ?? [];
	// Ensure layer names exist for all available languages
	Object.keys(info.revision??{[$_lang]:0}).forEach(c => layerNames.forEach((l, i) => {
		if(!l.i18n[c]) l.i18n[c] = {title: 'Layer '+(i+1)};
	}));


	// --- Component State ---

	/** Current page index being displayed or targeted. */
	let currentPage:number = $state(-1);
	/** Flag indicating if the view is fully zoomed out (relevant for swipe gestures). */
	let zoomedOut:boolean = isSwitch; // Assume zoomed out initially for switch/omni
	/** Flag indicating if the user is currently dragging the gallery/dial. */
	let dragging:boolean = $state(true); // Start true to prevent initial unwanted transitions?
	/** Flag indicating if the user is panning within a non-zoomed-out page. */
	let panning:boolean = $state(false);
	/** Flag indicating if the component is still loading/initializing. */
	let loading:boolean = $state(true);
	/** Flag indicating if the component has finished its initial setup. */
	let inited:boolean = false;
	/** Current rotation value for the omni dial display. */
	let currentRotation:number = $state(0);

	// --- Navigation Functions ---

	/**
	 * Navigates to a specific page index.
	 * @param i Target page index.
	 * @param fast If true, use a shorter animation or potentially snap.
	 * @param duration Optional animation duration override (ms).
	 * @param force Force navigation even if index hasn't changed.
	 */
	function goto(i:number, fast:boolean=false, duration:number=150, force:boolean=false) : void {
		// Handle wrapping for continuous galleries (omni)
		if(isContinuous) {
			while(i<0)i+=pagesPerLayer;
			i%=pagesPerLayer;
		}
		// Clamp index to valid range
		const page = i = Math.round(Math.max(0, Math.min(pagesPerLayer-1, i)));
		const changed = force || page != currentPage; // Check if index actually changed
		currentPage = page; // Update current page index
		if(changed) frameChanged(); // Trigger actions needed when the frame changes

		if(!isSwitch) { // For swipe galleries (not switch/omni)
			const cv = camera.getViewLegacy() as Models.Camera.ViewRect; // Current camera view
			const v = pages[i]; // Target page view
			// Determine if animation is needed
			const animate = inited && ((zoomedOut && !panning) || changed || ((cv[0] < v[0]) !== (cv[2] > v[2]))); // Animate if zoomed out, page changed, or crossing page boundary
			panning = false; // Reset panning flag
			if(animate) {
				// Fly camera to the target page view
				camera.flyToView(v, {duration, speed:1, progress:fast ? .5 : 0})
					.then(() => limit(v, true)) // Apply limits after animation
					.catch(() => {}); // Ignore animation errors
			} else {
				// If no animation, set view directly or apply limits
				if(v && duration == 0) camera.setView(v);
				limit(v, true);
			}
		}
		else if(changed) { // For switch/omni galleries
			// Tell Wasm to set the active image(s) for the new page index
			wasm.setActiveImage(image.ptr, pageIdxes[currentPage][0], pageIdxes[currentPage].length-1);
			if(isOmni) {
				wasm.render(); // Trigger render for omni objects
			} else { // For switch galleries, animate camera (though images are layered)
				camera.flyToView(pages[currentPage],{duration, speed: 2})
					.then(() => limit(pages[currentPage], true))
					.catch(() => {});
				activity(); // Trigger activity to show controls
			}
		}
		// Mark album as hooked/inited after first navigation
		image.album!.hooked = inited = true;
	}

	/** Actions to perform when the active frame/page changes. */
	function frameChanged(e?:Event) {
		// If triggered by swiper event, update currentPage from swiper
		if(swiper && e) {
			if(swiper.currentIndex == currentPage) return;
			currentPage = swiper.currentIndex;
		}
		preload(currentPage); // Preload adjacent images/frames
		events.dispatch('gallery-show', currentPage); // Dispatch event
		// Update rotation display for omni objects
		if(isOmni) currentRotation = (currentPage - omniFrontIndex) / pagesPerLayer * 360;
	}

	// --- Preloading Logic ---

	/** Preload distance (number of items before/after current). Adjusted for performance. */
	const d = 'requestIdleCallback' in self ? isOmni ? Math.max(36, Math.floor(images.length/8)*2) : 100 : 50;
	/** Map to track pending preload requests. */
	const preloading:Map<string,any> = new Map();
	/** Use requestIdleCallback if available, otherwise fallback to requestAnimationFrame. */
	const request = self.requestIdleCallback ?? self.requestAnimationFrame;

	/** Preloads thumbnails/base layers for nearby gallery items. */
	function preload(c:number){ // c = current index
		const imgs:number[] = []; // Array to store indices to preload

		// Adjust for current viewed layer
		if(layerNames.length) c += $layer * Math.floor(images.length / layerNames.length);

		// Adjust index for spreads
		if(isSpread && c >= coverPages) c=c*2-coverPages;

		const row = Math.floor(c / numPerRow); // Current row (for 2-axis omni)
		// Add indices before and after current index
		for(let x=-d;x<=d;x++) if(x) { // Iterate +/- d range, skipping 0
			let rX = c + x; // Calculate potential index
			// Handle 2-axis omni wrapping (adjust index based on row difference)
			if(isOmniTwoAxes) {
				const r = Math.floor(rX / numPerRow);
				if(r < row) rX += numPerRow;
				if(r > row) rX -= numPerRow;
			}
			// Handle continuous wrapping (omni)
			if(isContinuous) {
				while(rX < 0) rX += images.length;
				while(rX >= images.length) rX -= images.length;
			}
			imgs.push(rX); // Add index to preload list
		};

		// Add indices above/below current index for 2-axis omni
		if(isOmniTwoAxes) for(let y=-d;y<=d;y++) if(y) imgs.push(c+y*numPerRow);

		// Filter unique, valid indices that are not already preloading
		imgs.filter((n:number,i:number) => n >= 0 && n < images.length && imgs.indexOf(n) == i) // Ensure valid index and unique
			.map(i => images[i]).filter(i => !!i && !preloading.has(i.id)) // Get image object, check if valid and not preloading
			.forEach(i => preloading.set(i.id, request(() => // Schedule preload via requestIdleCallback/rAF
				wasm.getTexture(i.baseTileIdx, i.thumbSrc as string, false, {force: !!archiveId}) // Request texture load
			)));
	}

	// --- Utility Functions ---

	/** Applies view limits, potentially allowing horizontal overflow if zoomed out. */
	function limit(a:Models.Camera.ViewRect, forceArea:boolean) : void {
		zoomedOut = camera.isZoomedOut();
		// If zoomed out and not forcing area, allow horizontal overflow (-1 to 2)
		camera.setLimit(!forceArea && zoomedOut ? [-1, a[1], 2, a[3]] : a);
	}

	/** Calculates the horizontal position for the scrubber handle based on page index. */
	function getX(idx:number) : number {
		const _li = _ul?.childNodes[idx] as HTMLElement;
		// Calculate center position of the list item
		return _li ? -2 + _li.offsetLeft + _li.offsetWidth/2 : 0;
	}

	// --- Scrubber UI State & Handlers (for non-switch/non-omni galleries) ---

	/** Reference to the <ul> element containing scrubber bullets. */
	let _ul:HTMLElement|undefined = $state();
	/** Current horizontal position of the scrubber handle. */
	let _left:number = $state(0);
	/** Cached bounding rect of the scrubber container. */
	let box:DOMRect;

	/** Reactive calculation for the scrubber handle's left position. */
	const left = $derived(!_ul || dragging ? _left : getX(currentPage));

	/** Flag indicating if the current drag interaction is from a pointer event (mouse/pen). */
	let dragIsPointer:boolean=false;

	/** Starts the scrubber drag interaction. */
	function scrubStart(e:PointerEvent|TouchEvent) : void {
		e.preventDefault();
		e.stopPropagation();
		// Ignore if already dragging or not primary button/touch
		if(dragging || (dragIsPointer = 'button' in e) && e.button != 0 || !_ul) return;
		box = _ul.getClientRects()[0]; // Cache container bounds
		micrio.keepRendering = dragging = true; // Set dragging state
		hoverIdx = -1; // Clear hover state
		// Add move/end listeners
		window.addEventListener(dragIsPointer ? 'pointermove' : 'touchmove', scrubMove);
		window.addEventListener(dragIsPointer ? 'pointerup' : 'touchend', scrubStop);
		scrubMove(e); // Process initial position
	}

	/** Calculates the percentage and index based on pointer/touch position within the scrubber. */
	function getScrubXPercIdx(e:PointerEvent|TouchEvent) : [number,number] {
		const _box = box ?? _ul!.getClientRects()[0];
		const clientX = 'button' in e ? e.clientX : e.touches[0].clientX;
		// Calculate percentage, clamped between 0 and 1
		const perc = Math.min(1, Math.max(0, (clientX - _box.left-14) / (_box.width-32))); // Adjust for padding/handle size
		// Calculate corresponding page index
		const idx = Math.max(0, Math.min(pagesPerLayer-1, Math.floor(perc * pagesPerLayer)));
		return [perc, idx];
	}

	/** Handles scrubber movement during drag. */
	function scrubMove(e:PointerEvent|TouchEvent) : void {
		const [perc, idx] = getScrubXPercIdx(e);
		// Update handle position visually
		_left = 16 + perc * (box.width-32);
		// Navigate to the corresponding page if it changed
		if(idx != currentPage) goto(idx, true); // Use fast navigation
	}

	/** Updates the hover index when pointer moves over the scrubber (but not dragging). */
	let hoverIdx:number = $state(-1);
	function scrubPointerMove(e:PointerEvent|TouchEvent) : void {
		if(!dragging) hoverIdx = getScrubXPercIdx(e)[1];
	}

	/** Stops the scrubber drag interaction. */
	function scrubStop() : void {
		// Remove listeners
		window.removeEventListener(dragIsPointer ? 'pointermove' : 'touchmove', scrubMove);
		window.removeEventListener(dragIsPointer ? 'pointerup' : 'touchend', scrubStop);
		dragging = micrio.keepRendering = false; // Reset dragging state
		goto(currentPage); // Snap to the final page index
	}

	// --- Swipe Gesture State & Handlers (for non-switch/non-omni galleries) ---

	/** Stores the page index when a pan starts. */
	let pStartIdx:number;
	/** Handles the start of a pan gesture. */
	function pStart() : void {
		if(!zoomedOut) return; // Only allow swiping if zoomed out
		closestIdx = pStartIdx = currentPage; // Store starting index
		panning = zoomedOut; // Set panning flag
		limit(pages[currentPage], false); // Apply limits, allowing horizontal overflow
	}

	/** Handles the end of a pan gesture (or pinch). */
	function pEnd(e:Models.MicrioEventMap['panend']) : void {
		// If triggered by 'panend' but detail is missing, it means pinch took over, reset panning
		const d = e.detail;
		if(e.type == 'panend' && !d) {
			panning = false;
		}
		// Determine target page: snap to closest if changed, otherwise flick based on velocity/duration
		else goto(closestIdx != currentPage ? closestIdx : currentPage + (pStartIdx != currentPage || !panning || !d ? 0
			: Math.round(Math.min(1, Math.max(-1, -d.movedX / d.duration))))); // Flick calculation
	}

	/** Stores the index of the page closest to the current view center during panning. */
	let closestIdx:number;
	/** Updates the `closestIdx` based on the current view during panning. */
	function moved(_v:Models.Camera.View|undefined) : void {
		if(!_v) return;

		const v = View.toCenterJSON(_v);

		const c = v.centerX; // Current view center X
		// Calculate a score for each page based on distance and visibility
		const distances = pages.map((a, i) => {
			const fromCenter = (1 - Math.min(Math.abs(c - a[0]),Math.abs(c - a[2]))); // Proximity to center
			const inView = Math.max(0, (Math.min(c+v.width/2,a[2])-Math.max(c-v.width/2,a[0])) / (a[2]-a[0])); // Visibility percentage
			return fromCenter * inView * (1-Math.abs(currentPage-i)*.1); // Combine scores, penalize distance from current
		});

		// Find the index with the highest score
		wasm.setFocus(image.ptr, pages[closestIdx = distances.every(n => !n) ? currentPage : distances.indexOf(Math.max(...distances))], panning);
		// Update zoomedOut state
		zoomedOut = camera.isZoomedOut();
	}

	// --- Omni 2-Axis Rotation State & Handlers ---

	/** Current row index for 2-axis omni. */
	let row:number = 0;
	/** Stores [startX, startY, startPage, startRow] on pointer down. */
	let started:number[] = [0,0,0,0];

	/** Starts the 2-axis rotation drag. */
	function rotateStart(e:PointerEvent):void {
		e.stopPropagation();
		e.preventDefault();
		if(e.button != 0) return; // Ignore non-primary buttons
		dragging = true;
		started = [e.clientX, e.clientY, currentPage, row];
		window.addEventListener('pointermove', rotateMove);
		window.addEventListener('pointerup', rotateStop);
	}


	// Angular single button control
	const numPerRow:number = images.length;
	const numRows:number = 1;

	/** Handles movement during 2-axis rotation drag. */
	function rotateMove(e:PointerEvent):void {
		// Calculate new row based on vertical movement
		row = Math.max(0, Math.min(numRows-1, started[3] + Math.round((started[1] - e.clientY) / 360 * numRows))); // 360px vertical drag = full row cycle?
		// Calculate new column index based on horizontal movement, wrapping around
		let newIdx = (started[2] + Math.round((started[0] - e.clientX) / 360 * numPerRow))%numPerRow; // 360px horizontal drag = full rotation?
		while(newIdx<0) newIdx+=numPerRow;
		// Navigate to the new frame index
		goto(row * numPerRow + newIdx);
	}

	/** Stops the 2-axis rotation drag. */
	function rotateStop():void {
		removeEventListener('pointermove', rotateMove);
		removeEventListener('pointerup', rotateStop);
		dragging = false;
	}

	// --- Keyboard Navigation ---

	/** Handles keyboard navigation for galleries. */
	function keydown(e:KeyboardEvent) : void {
		if($settings.omni?.noKeys) return; // Ignore if keys disabled for omni
		switch(e.key) {
			case 'PageUp':
			case 'ArrowLeft':
				goto(currentPage - (isOmni ? -1 : 1), true); // Omni rotates opposite direction?
				break;
			case 'PageDown':
			case 'ArrowRight':
				goto(currentPage + (isOmni ? -1 : 1), true); // Omni rotates opposite direction?
				break;
			case 'ArrowUp':
				if(isOmniTwoAxes) goto(currentPage+numPerRow); // Move up a row
				break;
			case 'ArrowDown':
				if(isOmniTwoAxes) goto(currentPage-numPerRow); // Move down a row
				break;
			case 'Home':
				goto(0); // Go to first page/frame
				break;
			case 'End':
				goto(pagesPerLayer); // Go to last page/frame
				break;
			default: return; // Ignore other keys
		}
		activity(); // Show controls on navigation
	}

	// --- Omni Layer Menu ---

	/** Index of the layer menu in the image data's pages array. */
	let menuIdx:number=-1;
	/** Generates and updates the omni layer switcher menu in the image data. */
	const printLayerMenu = () : void => {
		if(!layerNames.length) return; // No layers defined
		image.data.update(d => {
			if(!d) d = {};
			if(!d.pages) d.pages = [];
			// Define the menu structure
			const menu: Models.ImageData.Menu = {
				id: '_omni-layers', // Special ID
				i18n: layerNames[$layer].i18n, // Get current layer name for button title
				icon: faLayerGroup, // Use layer icon
				children: layerNames.map((title,i) => ({ // Create child items for each layer
					id: 'omni-layer-'+i,
					i18n: title.i18n,
					action: () => {
						layer.set(i) // Action sets the layer store
						preload(currentPage);
					}
				})).filter(p => p.id != 'omni-layer-'+$layer) // Exclude the current layer
			};
			// Replace existing menu or add new one
			if(menuIdx >= 0 && menuIdx < d.pages.length) d.pages.splice(menuIdx, 1, menu);
			else d.pages.push(menu);
			menuIdx = d.pages.length-1; // Update stored index
			return d;
		});
	}

	// --- Auto-Hide Controls ---

	/** Reference to the UI hidden state store. */
	let hidden:Writable<boolean> = micrio.state.ui.hidden;
	/** Timeout ID for auto-hiding controls. */
	let to:number|undefined;
	/** Shows controls and sets a timeout to hide them again. */
	function activity(): void {
		hidden.set(false); // Show controls
		clearTimeout(to); // Clear previous timeout
		to = <any>setTimeout(() => hidden.set(true), 2000) as number; // Set new timeout
	}

	// --- Album Interface Setup ---

	// Expose gallery navigation methods via the image.album property
	image.album = {
		numPages: pages.length,
		get currentIndex() { return currentPage},
		info: image.$settings.album,
		prev: () => goto(currentPage - 1),
		next: () => goto(currentPage + 1),
		goto
	};

	// --- Lifecycle (onMount) ---

	let swiper:GallerySwiper; // Instance for swipe gestures
	onMount(() => {
		// Initialize Wasm representations for all gallery images/frames
		Promise.all(images.map(d => {
			// If it's an OmniFrame, share the main image's camera
			if('state' in d && !('image' in d)) d.camera = image.camera;
			// Add embed to Wasm (either as Image or Canvas depending on type)
			return wasm.addEmbed(d, image, {
				opacity: 0, // Start hidden
				asImage: 'camera' in d // Use parent camera if it's an OmniFrame
			})
		})).then(() => {
				// Once all Wasm objects are created, set the initial active image
				wasm.setActiveImage(image.ptr, startIdx);
				// Navigate to the starting index immediately
				goto(startIdx, false, 0);
				dragging = false; // Allow interactions now
			});

		// If omni with layers, create/update the layer switcher menu
		if(isOmni && omniNumLayers > 1) printLayerMenu();

		loading = false; // Mark loading as complete

		/** @ts-ignore Add goto function directly to micrio element (legacy/internal API?) */
		micrio['goto'] = goto;

		const unsub:Unsubscriber[] = []; // Array for Svelte store unsubscribers
		const unhook:Function[] = []; // Array for event listener removal functions

		// Update layer menu when omni layer changes
		if(isOmni) unsub.push(image.state.layer.subscribe(printLayerMenu));
		// Initialize swiper for full-screen swipe galleries
		if(isFullSwipe) swiper = image.swiper = new GallerySwiper(micrio, pagesPerLayer, goto, {continuous:isContinuous, coverLimit});

		// Setup auto-hide listeners if applicable
		unhook.push(() => {
			micrio.canvas.element.removeEventListener('pointermove', activity);
			micrio.canvas.element.removeEventListener('pointerdown', activity);
		});
		if(autoHide && !isOmni && !isOmniTwoAxes && !isFullSwipe) {
			micrio.canvas.element.addEventListener('pointermove', activity);
			micrio.canvas.element.addEventListener('pointerdown', activity);
			activity(); // Initial call to set timeout
		}

		// Subscribe to view changes for switch galleries to update zoomedOut state
		if(isSwitch) unsub.push(image.state.view.subscribe(() => {
			zoomedOut = camera.isZoomedOut();
		}));

		// Setup pan/swipe listeners for non-switch/non-omni galleries
		if(!(isSwitch || isFullSwipe || images.length <= 1)) {
			if(!isOmniTwoAxes) _left = getX(startIdx); // Initialize scrubber position

			// Subscribe to view changes to update closest page index
			unsub.push(image.state.view.subscribe(moved));
			// Add pan/pinch listeners
			micrio.addEventListener('panstart', pStart);
			micrio.addEventListener('panend', pEnd);
			micrio.addEventListener('pinchend', pEnd);

			// Add cleanup functions for listeners
			unhook.push(() => {
				micrio.removeEventListener('panstart', pStart);
				micrio.removeEventListener('panend', pEnd);
				micrio.removeEventListener('pinchend', pEnd);
			});
		}
		// Update frame display on camera move for omni objects
		if(isOmni) micrio.addEventListener('move', frameChanged);

		// Cleanup function on component destroy
		return () => {
			if(swiper) swiper.destroy(); // Destroy swiper instance
			while(unsub.length) unsub.shift()?.(); // Unsubscribe from stores
			while(unhook.length) unhook.shift()?.(); // Remove event listeners
			if(isOmni) micrio.removeEventListener('move', frameChanged); // Remove omni listener
		}
	});
</script>

<!-- Add keyboard listener to the window -->
<svelte:window onkeydown={keydown} />

<!-- Render gallery UI elements only if UI is not disabled -->
{#if !noUI}
	{#if isOmniTwoAxes}
		<!-- Simple button for 2-axis omni rotation (could be improved) -->
		<button class="angular" class:dragging={dragging}
			onpointerdowncapture={rotateStart}>&#10021;</button>
	{:else if omniSettings && !omniSettings.noDial && isOmni}
		<!-- Dial control for standard omni objects -->
		<Dial {currentRotation} frames={pagesPerLayer} degrees={$settings.omni?.showDegrees} onturn={n => goto(n)} />
	{:else if !isFullSwipe && images.length > 1}
		<!-- Scrubber UI for swipe galleries -->
		<div class:hidden={loading||($hidden && !dragging && !panning)}>
			<!-- Previous Button -->
			<Button type="arrow-left" title={$i18n.galleryPrev} className="gallery-btn" onpointerdown={() => goto(currentPage - 1)} disabled={currentPage==0}></Button>
			<!-- Scrubber Bar -->
			<ul bind:this={_ul} onpointermove={scrubPointerMove} onpointerleave={() => hoverIdx=-1}>
				<!-- Bullets for each page -->
				{#each pages as page, i}
					<li class:active={i==currentPage} class:hover={i==hoverIdx}>
						<button onclick={() => goto(i, true)} onkeypress={e => { if(e.key === 'Enter') goto(i, true)}} class="bullet">&bull;</button>
					</li>
				{/each}
				<!-- Draggable Handle -->
				<button style={`left: ${left}px`} class:dragging={dragging} aria-label="drag handle"
					onpointerdowncapture={scrubStart}
					ontouchstartcapture={scrubStart}></button>
			</ul>
			<!-- Next Button -->
			<Button type="arrow-right" title={$i18n.galleryNext} className="gallery-btn" onpointerdown={() => goto(currentPage + 1)} disabled={currentPage==images.length-1}></Button>
		</div>
	{/if}
{/if}

<style>
	/* Scrubber bar styling */
	ul {
		position: absolute;
		bottom: var(--micrio-border-margin);
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		list-style-type: none;
		background: var(--micrio-background);
		border-radius: var(--micrio-border-radius);
		padding: 0 16px; /* Padding for handle ends */
		margin: 0;
		color: var(--micrio-color);
		transition: opacity .25s ease;
		max-width: calc(100vw - 50px);
		max-width: calc(100cqw - 50px);
		width: 520px; /* Default max width */
		touch-action: none; /* Prevent browser scrolling */
	}
	/* Responsive scrubber bar */
	@media (max-width: 500px) {
		ul {
			left: 5px;
			right: 52px; /* Space for next button */
			width: auto;
			transform: none;
		}
		/* Delay hiding on mobile */
		div.hidden > ul {
			transition-delay: .25s;
		}
	}

	/* Scrubber list items (bullets) */
	li {
		flex: 1; /* Distribute space evenly */
		transition: none;
		padding: 0;
		line-height: var(--micrio-button-size);
		font-size: 32px;
		text-align: center;
		width: 0; /* Allow flex to control width */
		transition: opacity .25s ease;
		opacity: .25; /* Dim inactive bullets */
		display: block;
		height: 48px; /* Match button height? */
		position: relative;
	}
	li.active {
		transition-duration: 0s;
		opacity: 1; /* Highlight active bullet */
	}
	/* Bullet button styling */
	li > button {
		border: none;
		color: inherit;
		cursor: pointer;
		position: absolute;
		left: 50%;
		transform: translate3d(-50%,0,0); /* Center bullet */
		height: 48px;
		width: 100%;
		min-width: 48px;
		pointer-events: none; /* Only handle clicks via hover state */
		background: none; /* Transparent background */
		padding: 0;
	}
	/* Enable pointer events on hover */
	li.hover > button {
		pointer-events: all;
	}

	/* Highlight bullet on hover */
	@media (hover: hover) {
		li.hover {
			transition-duration: 0s;
			opacity: 1;
		}
	}

	/* Scrubber handle button styling */
	button:not(.bullet) {
		position: absolute;
		width: var(--micrio-button-size);
		height: var(--micrio-button-size);
		box-sizing: border-box;
		background: #eee3; /* Semi-transparent background */
		border: none;
		border-radius: var(--micrio-border-radius);
		touch-action: none; /* Prevent browser gestures */
		transition: left .15s ease, background-color .2s ease; /* Animate left position */
		transform: translateX(-50%); /* Center handle */
	}
	ul > button { /* Scrubber handle specific */
		top: 0;
		left: 0; /* Initial position, updated by `left` style */
		cursor: ew-resize; /* Horizontal resize cursor */
	}
	/* Omni 2-axis control button */
	button.angular {
		bottom: 42px; /* Position above scrubber */
		left: 50%;
		color: #444;
		font-size: 32px;
		line-height: 42px;
		padding: 0;
		cursor: move; /* Move cursor */
	}
	/* Handle hover effect */
	button:not(.bullet):hover {
		background: #eee8;
	}
	/* Disable transition while dragging handle */
	button:not(.bullet).dragging {
		transition: none;
	}

	/* Main container div for controls */
	div {
		display: contents; /* Doesn't affect layout */
		transition: opacity .5s ease;
	}
	/* Hide controls when hidden state is true (and not hovered/dragging) */
	div.hidden:not(:hover) > :global(*),
	/* Hide disabled gallery buttons */
	div > :global(button.gallery-btn:disabled) {
		opacity: 0;
		pointer-events: none;
	}

	/* Gallery prev/next button positioning */
	div > :global(button.gallery-btn) {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
	}
	div > :global(button.gallery-btn.arrow-left) {
		left: var(--micrio-border-margin);
	}
	div > :global(button.gallery-btn.arrow-right) {
		right: var(--micrio-border-margin);
	}
</style>
