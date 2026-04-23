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

	import type { HTMLMicrioElement } from '$ts/element';
	import type { MicrioImage } from '$ts/image';
	import type { Camera } from '$ts/camera';
	import type { Models } from '$types/models';

	import { getContext, onMount, untrack } from 'svelte';
	import { writable, type Unsubscriber, type Writable } from 'svelte/store';
	import { icons } from '$ts/icons';
	import { GallerySwiper } from '$ts/nav/swiper';
	import { i18n } from '$ts/i18n'; // For UI text translations
	import { horizontalSlot } from '$ts/nav/transitions';
	import { Enums } from '$ts/enums';

	import Button from '../ui/Button.svelte';
	import Dial from '../ui/Dial.svelte'; // Used for omni object rotation control
    import { View } from '$ts/utils';

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

	// Capture initial prop values; these are stable for this component's lifetime.
	const _images = untrack(() => images);
	const _omni = untrack(() => omni);

	// --- Context & State ---

	/** Get the main Micrio element instance and relevant stores/properties from context. */
	const micrio = <HTMLMicrioElement>getContext('micrio');
	const { wasm, current, events, _lang } = micrio;

	// --- UI Settings ---
	/** Whether the gallery controls should auto-hide after inactivity. */
	const autoHide:boolean = true;

	// --- Component Initialization ---

	// Assume these are defined at this point as this component is rendered by Main.svelte
	const image = $current as MicrioImage; // The main MicrioImage (virtual container for gallery)
	const info = image.$info as Models.ImageInfo.ImageInfo; // Image info
	const layer = image.state.layer; // Omni layer store
	const settings = image.settings; // Image settings store
	const camera = image.camera as Camera; // Camera instance

	// --- Omni Object Setup ---
	// If it's an omni object, generate the frame data internally
	if(_omni) {
		for(let j=0;j<_omni.frames;j++) {
			_images.push({
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
	/** Strip-swipe: independent child canvases sliding via Camera.setArea. */
	const isStripSwipe:boolean = !isSwitch && _images.length > 1 && !('frame' in (_images[0] ?? {}));

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
	let startIdx = startIdxAttr != undefined && !isNaN(startIdxAttr) ? startIdxAttr : startId ? _images.findIndex(i => i.id == startId) : 0;
	if(startIdx < 0) startIdx = 0; // Default to 0 if not found or invalid

	// --- Page Layout Calculation ---

	/** Array storing the calculated view rectangle for each page/spread. */
	const pages:Models.Camera.ViewRect[] = [];
	/** Array mapping page index to the original image index(es) it contains. */
	const pageIdxes:number[][] = [];

	if(isStripSwipe) {
		// Strip swipe: each image is its own canvas, full-screen when active.
		// pages[] is just a per-image placeholder; the actual transition uses Camera.setArea.
		for(let i=0; i<_images.length; i++) {
			pages.push([0, 0, 1, 1]);
			pageIdxes.push([i]);
		}
	}
	else if(_images) {
		// Calculate page layouts within the shared parent canvas, handling spreads
		for(let i=0; i<_images.length; i++) {
			let area = _images[i].opts?.area;
			if(!area) continue;
			const v = area.slice(0);
			pageIdxes.push([i]);

			if(isSpread && (i-coverPages>=0 && ((i-coverPages)%2==0)) && _images[i+1]) {
				area = _images[++i].opts?.area;
				if(!area) continue;
				pageIdxes[pageIdxes.length-1].push(i);
				v[2] = area[2];
				v[3] = area[3];
			}
			pages.push(v);
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
		if(isContinuous) {
			while(i<0)i+=pagesPerLayer;
			i%=pagesPerLayer;
		}
		const page = i = Math.round(Math.max(0, Math.min(pagesPerLayer-1, i)));
		const changed = force || page != currentPage;
		currentPage = page;
		if(changed) frameChanged();

		if(isStripSwipe) {
			stripGoto(currentPage, fast, duration, changed);
		}
		else if(!isSwitch) {
			// (Legacy non-strip swipe path, unused for `swipe` type after refactor.)
			const cv = camera.getViewLegacy() as Models.Camera.ViewRect;
			const target = pages[i];
			const v = View.fromLegacy(target)! as Models.Camera.View;
			const animate = inited && ((zoomedOut && !panning) || changed || ((cv[0] < target[0]) !== (cv[2] > target[2])));
			panning = false;
			if(animate) {
				camera.flyToView(v, {duration, speed:1, progress:fast ? .5 : 0})
					.then(() => limit(target, true))
					.catch(() => {});
			} else {
				if(v && duration == 0) camera.setView(v);
				limit(target, true);
			}
		}
		else if(changed) { // switch / swipe-full / omni
			wasm.setActiveImage(image.ptr, pageIdxes[currentPage][0], pageIdxes[currentPage].length-1);
			if(isOmni) {
				wasm.render();
			} else {
				const p = pages[currentPage];
				camera.flyToView([p[0], p[1], p[2]-p[0], p[3]-p[1]],{duration, speed: 2})
					.then(() => limit(pages[currentPage], true))
					.catch(() => {});
				activity();
			}
		}
		image.album!.hooked = inited = true;
	}

	// --- Strip-swipe navigation (independent child canvases) ---

	/** Snap animation duration in seconds. */
	const stripSnapDuration:number = 0.35;

	/** Programmatically navigate between children with a sliding area animation.
	 * Parent stays micrio.$current (so this component, mounted off
	 * Main's gallery=$derived($info?.gallery), stays alive); pointer routing reaches the
	 * active child via events/facade.getImage() picking the visible image at screen coords. */
	function stripGoto(nextIdx:number, fast:boolean, duration:number, changed:boolean) : void {
		if(!_images[nextIdx]) return;

		const snapDur = duration === 0 ? 0 : (fast ? stripSnapDuration / 2 : stripSnapDuration);

		// If the leaving image is zoomed in, fly it back to its cover view first so the
		// slide carries an entire image, not a tiny zoomed detail.
		const leaving = _images[currentPage > -1 && currentPage != nextIdx ? currentPage : -1] as MicrioImage|undefined;
		const needsZoomOut = changed && snapDur > 0 && leaving?.camera && !leaving.camera.isZoomedOut();
		const startSlide = () : void => {
			wasm.setGridTransitionDuration(snapDur);
			for(let i=0; i<_images.length; i++) {
				const child = _images[i] as MicrioImage|undefined;
				if(!child?.camera) continue;
				const cur = child.opts.area ?? [0, 0, 1, 1];
				// `cur` is the last-requested target (possibly still mid-animation in wasm).
				// A child counts as "near visible" if that slot sits within the neighbour
				// range, so interrupting a transition still animates the children currently
				// sliding across screen instead of direct-snapping them.
				const prevSlotLeft = cur[0];
				const wasNearVisible = prevSlotLeft >= -1 && prevSlotLeft <= 1;
				const targetSlot = i - nextIdx;
				const target = horizontalSlot(targetSlot);
				const willBeVisible = Math.abs(targetSlot) <= 1;
				const needsMove = Math.abs(cur[0] - target[0]) > 1e-4 || Math.abs(cur[2] - target[2]) > 1e-4;
				const animate = snapDur > 0 && needsMove && (wasNearVisible || willBeVisible);
				child.camera.setArea(target, {direct: !animate, noDispatch: true});
			}
			wasm.render();
		};

		if(needsZoomOut) leaving!.camera!.flyToCoverView({duration: snapDur * 1000 * 0.6, speed: 2})
			.then(startSlide).catch(startSlide);
		else startSlide();
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
		// Strip-swipe: publish the active child so consumers (zoom buttons, etc.) rebind
		if(isStripSwipe) image.album?.currentImage?.set(_images[currentPage] as MicrioImage);
	}

	// --- Preloading Logic ---

	/** Preload distance (number of items before/after current). Adjusted for performance. */
	const d = 'requestIdleCallback' in self ? isOmni ? Math.max(36, Math.floor(_images.length/8)*2) : 100 : 50;
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

	/** Horizontal padding (px) between the scrubber bar edges and the usable track. */
	const scrubPad = 16;

	/** Calculates the horizontal position (px from <ul> left) for a given page index. */
	function getX(idx:number) : number {
		if(!_ul) return 0;
		const w = _ul.clientWidth;
		const max = Math.max(1, pagesPerLayer - 1);
		return scrubPad + (idx / max) * (w - scrubPad * 2);
	}

	/** Formats a scrubber position as the underlying book page number(s). For
	 * spread galleries each position can map to 1 or 2 image indexes; show the
	 * range "n–m" when it's a real spread. */
	function pageLabel(idx:number) : string {
		const ids = pageIdxes[idx];
		if(!ids?.length) return String(idx + 1);
		if(ids.length === 1) return String(ids[0] + 1);
		return `${ids[0] + 1}\u2013${ids[ids.length - 1] + 1}`;
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
		const perc = Math.min(1, Math.max(0, (clientX - _box.left - scrubPad) / (_box.width - scrubPad * 2)));
		// Snap to the nearest evenly-spaced page index
		const idx = Math.max(0, Math.min(pagesPerLayer-1, Math.round(perc * Math.max(1, pagesPerLayer-1))));
		return [perc, idx];
	}

	/** Handles scrubber movement during drag. */
	function scrubMove(e:PointerEvent|TouchEvent) : void {
		const [perc, idx] = getScrubXPercIdx(e);
		_left = scrubPad + perc * (box.width - scrubPad * 2);
		if(idx != currentPage) goto(idx, true);
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

	// --- Strip-swipe Live Drag (independent child canvases) ---

	let stripDragId:number|undefined;
	let stripDragStartX:number = 0;
	let stripDragLastX:number = 0;
	let stripDragLastT:number = 0;
	let stripDragVelocity:number = 0;
	let stripDragActive:boolean = false;
	let stripDragHorizontal:boolean = false;
	let stripDragStartY:number = 0;

	/** Returns true if strip-swipe should intercept: only when the active child is at its base scale. */
	function stripCanSwipe() : boolean {
		const active = _images[currentPage] as MicrioImage|undefined;
		return !!active?.camera?.isZoomedOut();
	}

	function stripPointerDown(e:PointerEvent) : void {
		if(!stripCanSwipe() || e.button != 0 || stripDragId !== undefined) return;
		stripDragId = e.pointerId;
		stripDragStartX = stripDragLastX = e.clientX;
		stripDragStartY = e.clientY;
		stripDragLastT = e.timeStamp;
		stripDragVelocity = 0;
		stripDragActive = false;
		stripDragHorizontal = false;
		window.addEventListener('pointermove', stripPointerMove);
		window.addEventListener('pointerup', stripPointerUp);
		window.addEventListener('pointercancel', stripPointerUp);
	}

	function stripPointerMove(e:PointerEvent) : void {
		if(e.pointerId !== stripDragId) return;
		const dx = e.clientX - stripDragStartX;
		const dy = e.clientY - stripDragStartY;
		// Once movement direction is established, only react to predominantly-horizontal drags.
		if(!stripDragActive) {
			if(Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
			stripDragHorizontal = Math.abs(dx) > Math.abs(dy);
			if(!stripDragHorizontal) { stripPointerUp(e); return; }
			stripDragActive = true;
			micrio.setAttribute('data-panning','');
			micrio.keepRendering = true;
			micrio.canvas.element.setPointerCapture(e.pointerId);
		}
		// Track velocity (px/ms, signed) using the most recent move delta.
		const dt = Math.max(1, e.timeStamp - stripDragLastT);
		stripDragVelocity = (e.clientX - stripDragLastX) / dt;
		stripDragLastX = e.clientX;
		stripDragLastT = e.timeStamp;

		const w = micrio.offsetWidth || 1;
		const progress = dx / w; // -1..1, positive = drag right (reveals previous)
		applyDragProgress(progress);
	}

	function stripPointerUp(e:PointerEvent) : void {
		if(e.pointerId !== stripDragId) return;
		window.removeEventListener('pointermove', stripPointerMove);
		window.removeEventListener('pointerup', stripPointerUp);
		window.removeEventListener('pointercancel', stripPointerUp);
		const wasActive = stripDragActive;
		stripDragId = undefined;
		stripDragActive = false;
		micrio.removeAttribute('data-panning');
		micrio.keepRendering = false;
		if(!wasActive) return;
		try { micrio.canvas.element.releasePointerCapture(e.pointerId); } catch(_) {}

		const w = micrio.offsetWidth || 1;
		const progress = (e.clientX - stripDragStartX) / w;
		// Snap by progress (>30%) or velocity (>0.5 px/ms in either direction).
		let target = currentPage;
		if(progress < -0.3 || stripDragVelocity < -0.5) target = Math.min(_images.length-1, currentPage + 1);
		else if(progress > 0.3 || stripDragVelocity > 0.5) target = Math.max(0, currentPage - 1);
		goto(target);
	}

	/** Applies a live drag progress (-1..1) to the active and adjacent child areas. */
	function applyDragProgress(progress:number) : void {
		// Clamp at edges with rubber-banding.
		const atLeftEdge = currentPage == 0 && progress > 0;
		const atRightEdge = currentPage == _images.length - 1 && progress < 0;
		const eased = (atLeftEdge || atRightEdge) ? Math.sign(progress) * Math.sqrt(Math.abs(progress)) * 0.3 : progress;

		const active = _images[currentPage] as MicrioImage|undefined;
		active?.camera?.setArea(horizontalSlot(eased), {direct: true, noDispatch: true});

		// Reveal the appropriate neighbour (only one side moves at a time).
		if(eased < 0 && currentPage < _images.length - 1) {
			const next = _images[currentPage + 1] as MicrioImage|undefined;
			next?.camera?.setArea(horizontalSlot(1 + eased), {direct: true, noDispatch: true});
		}
		else if(eased > 0 && currentPage > 0) {
			const prev = _images[currentPage - 1] as MicrioImage|undefined;
			prev?.camera?.setArea(horizontalSlot(-1 + eased), {direct: true, noDispatch: true});
		}
		wasm.render();
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
	const numPerRow:number = _images.length;
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
				icon: icons.layerGroup,
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
	/** Shared hover/focus state so Controls follows gallery visibility. */
	let hover:Writable<boolean> = micrio.state.ui.hover;
	/** Timeout ID for auto-hiding controls. */
	let to:number|undefined;
	/** Shows controls and (if auto-hide is enabled) sets a timeout to hide them again. */
	function activity(): void {
		hidden.set(false); // Show controls
		clearTimeout(to); // Clear previous timeout
		if(autoHide) to = <any>setTimeout(() => hidden.set(true), 2000) as number;
	}

	// --- Album Interface Setup ---

	// Expose gallery navigation methods via the image.album property
	image.album = {
		numPages: pages.length,
		get currentIndex() { return currentPage},
		info: image.$settings.album,
		prev: () => goto(currentPage - 1),
		next: () => goto(currentPage + 1),
		goto,
		// Strip-swipe routes controls (zoom buttons, etc.) to the active child
		...(isStripSwipe ? { currentImage: writable(_images[startIdx] as MicrioImage) } : {})
	};

	// --- Lifecycle (onMount) ---

	let swiper:GallerySwiper; // Instance for swipe gestures
	onMount(() => {
		// Initialize Wasm representations for all gallery images/frames.
		// Strip-swipe uses independent child canvases (addChild); switch/swipe-full/omni
		// share the parent camera and are added as embeds.
		const added = isStripSwipe
			? Promise.all(_images.map(d => wasm.addChild(d as MicrioImage, image)))
			: Promise.all(images.map(d => {
				if('state' in d && !('image' in d)) d.camera = image.camera;
				return wasm.addEmbed(d, image, {
					opacity: 0,
					asImage: 'camera' in d
				});
			}));

		added.then(() => {
			if(isStripSwipe) {
				wasm.setGridTransitionTimingFunction(Enums.Camera.TimingFunction['ease-out']);
				// Position every child relative to startIdx in one frame. Parent stays
				// micrio.$current; input is routed to the active child by getImage().
				// Children come out of addChild with coverLimit=true (the grid default,
				// which crops to fill the viewport). For a swipe gallery each image
				// should fit (letterboxed if needed) and remain freely zoomable.
				for(let i=0; i<_images.length; i++) {
					const child = _images[i] as MicrioImage;
					if(!child.camera) continue;
					child.camera.setCoverLimit(false);
					child.camera.setArea(horizontalSlot(i - startIdx), {direct: true, noDispatch: true});
					child.camera.setView([0, 0, 1, 1], {noRender: true});
				}
				currentPage = startIdx;
				frameChanged();
				image.album!.hooked = inited = true;
				wasm.render();
			} else {
				wasm.setActiveImage(image.ptr, startIdx);
				goto(startIdx, false, 0);
			}
			dragging = false;
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
			if(!isOmniTwoAxes) _left = getX(startIdx);

			if(isStripSwipe) {
				// Strip-swipe: independent child canvases, area-based slide gestures.
				const onDown = stripPointerDown;
				micrio.canvas.element.addEventListener('pointerdown', onDown);
				unhook.push(() => micrio.canvas.element.removeEventListener('pointerdown', onDown));
			}
			else {
				// Legacy non-strip swipe path, kept for completeness.
				unsub.push(image.state.view.subscribe(moved));
				micrio.addEventListener('panstart', pStart);
				micrio.addEventListener('panend', pEnd);
				micrio.addEventListener('pinchend', pEnd);
				unhook.push(() => {
					micrio.removeEventListener('panstart', pStart);
					micrio.removeEventListener('panend', pEnd);
					micrio.removeEventListener('pinchend', pEnd);
				});
			}
		}
		// Update frame display on camera move for omni objects
		if(isOmni) micrio.addEventListener('move', frameChanged);

		// Cleanup function on component destroy
		return () => {
			if(swiper) swiper.destroy();
			while(unsub.length) unsub.shift()?.();
			while(unhook.length) unhook.shift()?.();
			if(isOmni) micrio.removeEventListener('move', frameChanged);
			hover.set(false);
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
		{@const total = pagesPerLayer}
		{@const totalPages = _images.length}
		{@const dense = total > 24}
		{@const tickStep = dense ? Math.max(1, Math.ceil(total / 24)) : 1}
		{@const fillPct = total > 1 ? (currentPage / (total - 1)) * 100 : 0}
		<!-- Scrubber UI for swipe galleries -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class:hidden={loading||($hidden && !$hover && !dragging && !panning)}
			onpointerover={() => hover.set(true)}
			onpointerout={(e) => { if(!e.currentTarget.contains(e.relatedTarget as Node)) hover.set(false); }}
			onfocusin={() => hover.set(true)}
			onfocusout={(e) => { if(!e.currentTarget.contains(e.relatedTarget as Node)) hover.set(false); }}>
			<!-- Previous Button -->
			<Button type="arrow-left" title={$i18n.galleryPrev} className="gallery-btn" onpointerdown={(e: PointerEvent) => e.button === 0 && goto(currentPage - 1)} disabled={currentPage==0}></Button>
			<!-- Scrubber Bar: click anywhere to jump, drag to scrub -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<ul bind:this={_ul} class:dense
				onpointerdowncapture={scrubStart}
				ontouchstartcapture={scrubStart}
				onpointermove={scrubPointerMove}
				onpointerleave={() => hoverIdx=-1}>
				<!-- Background track with progress fill -->
				<span class="track">
					<span class="track-fill" style={`width:${fillPct}%`}></span>
				</span>
				<!-- Tick marks for each page (or every Nth in dense mode) -->
				<span class="ticks">
					{#each pages as _page, i}
						{#if !dense || i % tickStep === 0 || i === total - 1 || i === currentPage}
							<span class="tick"
								class:major={dense && i % (tickStep * 5) === 0}
								class:active={i === currentPage}
								class:hover={i === hoverIdx}
								style={`left:${total > 1 ? (i / (total - 1)) * 100 : 50}%`}></span>
						{/if}
					{/each}
				</span>
				<!-- Hover preview label (only when hovering a different page than current) -->
				{#if hoverIdx >= 0 && hoverIdx !== currentPage && !dragging}
					<span class="hover-label" style={`left:${total > 1 ? (hoverIdx / (total - 1)) * 100 : 50}%`}>{pageLabel(hoverIdx)}</span>
				{/if}
				<!-- Draggable Handle (clean dot) -->
				<button class="handle" style={`left: ${left}px`} class:dragging={dragging}
					aria-label="Gallery position"
					aria-valuemin={1} aria-valuemax={totalPages} aria-valuenow={(pageIdxes[currentPage]?.[0] ?? currentPage) + 1}
					role="slider"
					tabindex="0"></button>
				<!-- Floating page-number label that tracks the handle -->
				<span class="handle-label" style={`left: ${left}px`} class:dragging>{pageLabel(currentPage)}{dense ? ` / ${totalPages}` : ''}</span>
			</ul>
			<!-- Next Button -->
			<Button type="arrow-right" title={$i18n.galleryNext} className="gallery-btn" onpointerdown={(e: PointerEvent) => e.button === 0 && goto(currentPage + 1)} disabled={currentPage==images.length-1}></Button>
		</div>
	{/if}
{/if}

<style>
	/* Scrubber bar — glassy pill matching the right-side Controls panel */
	ul {
		position: absolute;
		bottom: var(--micrio-border-margin);
		left: 50%;
		transform: translateX(-50%);
		display: block;
		list-style-type: none;
		background: var(--micrio-button-background, var(--micrio-background, none));
		box-shadow: var(--micrio-button-shadow);
		backdrop-filter: var(--micrio-background-filter);
		border-radius: var(--micrio-border-radius);
		padding: 0 16px;
		margin: 0;
		height: var(--micrio-button-size);
		color: var(--micrio-color);
		transition: transform .25s ease, opacity .25s ease;
		max-width: calc(100vw - 50px);
		max-width: calc(100cqw - 50px);
		width: 520px;
		touch-action: none;
		cursor: pointer;
	}
	/* Responsive scrubber bar — leave clearance for the right-side Controls column */
	@media (max-width: 500px) {
		ul {
			left: var(--micrio-border-margin);
			right: calc(var(--micrio-button-size) + var(--micrio-border-margin) * 2);
			width: auto;
			transform: none;
		}
	}

	/* Background track */
	.track {
		position: absolute;
		top: 50%;
		left: 16px;
		right: 16px;
		height: 2px;
		background: var(--micrio-scrubber-background);
		border-radius: 2px;
		transform: translateY(-50%);
		pointer-events: none;
		overflow: hidden;
	}
	/* Filled portion of the track up to the current page */
	.track-fill {
		display: block;
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		background: var(--micrio-color);
		border-radius: 2px;
		opacity: .85;
		transition: width .15s ease;
	}

	/* Tick layer (sits over the track) */
	.ticks {
		position: absolute;
		top: 0;
		left: 16px;
		right: 16px;
		bottom: 0;
		pointer-events: none;
	}
	.tick {
		position: absolute;
		top: 50%;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--micrio-color);
		opacity: .55;
		transform: translate(-50%, -50%);
		transition: opacity .2s ease, transform .2s ease, background-color .2s ease;
	}
	.tick.active {
		opacity: 1;
		transform: translate(-50%, -50%) scale(1.6);
		background: var(--micrio-color-hover, var(--micrio-color));
	}
	@media (hover: hover) {
		.tick.hover {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1.4);
		}
	}
	/* Dense mode: switch dots to subtle ticks */
	ul.dense .tick {
		width: 1.5px;
		height: 8px;
		border-radius: 1px;
		opacity: .35;
		transform: translate(-50%, -50%);
	}
	ul.dense .tick.major {
		height: 12px;
		opacity: .6;
	}
	ul.dense .tick.active {
		width: 2px;
		height: 14px;
		opacity: 1;
		background: var(--micrio-color-hover, var(--micrio-color));
		transform: translate(-50%, -50%);
	}
	@media (hover: hover) {
		ul.dense .tick.hover {
			opacity: .9;
			transform: translate(-50%, -50%);
		}
	}

	/* Hover preview label */
	.hover-label {
		position: absolute;
		bottom: calc(100% + 6px);
		transform: translateX(-50%);
		padding: 2px 8px;
		font-size: 11px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		line-height: 1.4;
		color: var(--micrio-color);
		background: var(--micrio-popover-background);
		backdrop-filter: var(--micrio-background-filter);
		border-radius: 999px;
		box-shadow: var(--micrio-button-shadow);
		pointer-events: none;
		white-space: nowrap;
	}

	/* Pill-shaped draggable handle */
	.handle {
		position: absolute;
		top: 50%;
		left: 0;
		height: 28px;
		min-width: 28px;
		padding: 0;
		box-sizing: border-box;
		background: var(--micrio-color);
		border: 2px solid var(--micrio-color);
		border-radius: 999px;
		cursor: ew-resize;
		touch-action: none;
		transform: translate(-50%, -50%);
		transition: left .15s ease, height .15s ease, min-width .15s ease, background-color .2s ease, box-shadow .2s ease;
		box-shadow: 0 2px 8px rgba(0,0,0,.35), 0 0 0 0 var(--micrio-color-hover);
	}
	.handle:hover {
		box-shadow: 0 2px 8px rgba(0,0,0,.4), 0 0 0 4px rgba(255,255,255,.12);
	}
	.handle.dragging {
		transition: none;
		box-shadow: 0 2px 12px rgba(0,0,0,.5), 0 0 0 6px rgba(255,255,255,.15);
		cursor: grabbing;
	}

	/* Page-number label that floats above the handle, matching hover-label styling */
	.handle-label {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 0;
		transform: translateX(-50%);
		padding: 3px 9px;
		font-size: 12px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		line-height: 1.4;
		color: var(--micrio-color);
		background: var(--micrio-popover-background);
		backdrop-filter: var(--micrio-background-filter);
		border-radius: 999px;
		box-shadow: var(--micrio-button-shadow);
		pointer-events: none;
		white-space: nowrap;
		transition: left .15s ease, transform .15s ease;
	}
	.handle-label.dragging {
		transition: none;
		transform: translateX(-50%) scale(1.05);
	}

	/* Omni 2-axis control button */
	button.angular {
		position: absolute;
		bottom: 42px;
		left: 50%;
		width: var(--micrio-button-size);
		height: var(--micrio-button-size);
		background: var(--micrio-scrubber-background);
		border: none;
		border-radius: var(--micrio-border-radius);
		color: #444;
		font-size: 32px;
		line-height: 42px;
		padding: 0;
		cursor: move;
		transform: translateX(-50%);
		transition: background-color .2s ease;
	}
	button.angular:hover {
		background: #eee8;
	}
	button.angular.dragging {
		transition: none;
	}

	/* Main container div for controls — full-size overlay so hover/focus
	   events propagate for the shared ui.hover store. */
	div {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	div > :global(*) {
		pointer-events: auto;
	}

	/* Gallery prev/next button positioning */
	div > :global(button.gallery-btn) {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		transition: transform .25s ease, opacity .25s ease;
	}
	div > :global(button.gallery-btn.arrow-left) {
		left: var(--micrio-border-margin);
	}
	div > :global(button.gallery-btn.arrow-right) {
		right: var(--micrio-border-margin);
	}

	/* Slide controls off-screen when hidden by inactivity timer */
	div.hidden:not(:hover) > :global(ul) {
		transform: translate(-50%, calc(100% + var(--micrio-border-margin)));
		opacity: 0;
		pointer-events: none;
	}
	@media (max-width: 500px) {
		div.hidden:not(:hover) > :global(ul) {
			transform: translateY(calc(100% + var(--micrio-border-margin)));
		}
	}
	div.hidden:not(:hover) > :global(button.gallery-btn.arrow-left) {
		transform: translate(calc(-100% - var(--micrio-border-margin)), -50%);
		opacity: 0;
		pointer-events: none;
	}
	div.hidden:not(:hover) > :global(button.gallery-btn.arrow-right) {
		transform: translate(calc(100% + var(--micrio-border-margin)), -50%);
		opacity: 0;
		pointer-events: none;
	}

	/* Disabled prev/next buttons just fade away in place */
	div > :global(button.gallery-btn:disabled) {
		opacity: 0;
		pointer-events: none;
	}
</style>
