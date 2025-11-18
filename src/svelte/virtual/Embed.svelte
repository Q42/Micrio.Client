<script lang="ts">
	/**
	 * Embed.svelte - Renders embedded content within a Micrio image.
	 *
	 * This component handles various types of embeds defined in the image data:
	 * - Micrio images (rendered via WebGL)
	 * - Videos (HTML5 <video> or rendered via WebGL using GLEmbedVideo)
	 * - Iframes (standard HTML <iframe>)
	 * - SVGs or other images (standard HTML <img>)
	 *
	 * It calculates the 2D or 3D position and scale based on the embed data and
	 * current camera view. It also handles click actions and video playback logic
	 * (including autoplay restrictions and pause-on-zoom).
	 */

	import type { Models } from '../../types/models';
	import type { HTMLMicrioElement } from '../../ts/element';
	import { writable, type Unsubscriber } from 'svelte/store';

	import { onMount, getContext } from 'svelte';
	import { MicrioImage } from '../../ts/image';
	import { once, createGUID, Browser } from '../../ts/utils';
	import { GLEmbedVideo } from '../../ts/embedvideo'; // Handles WebGL video rendering

	import Media from '../components/Media.svelte'; // Reusable media player component

	// --- Context & Props ---

	/** Get the main Micrio element instance from context. */
	const micrio = <HTMLMicrioElement>getContext('micrio');
	/** Destructure needed stores and properties. */
	const { current, wasm, canvas } = micrio;

	interface Props {
		/** The embed data object from the image configuration. */
		embed: Models.ImageData.Embed;
	}

	let { embed = $bindable() }: Props = $props();

	if(embed.src?.startsWith('/r2')) embed.src = 'http://localhost:6100'+embed.src;

	// --- Initialization & Setup ---

	/** Reference to the main MicrioImage instance this embed belongs to. */
	const mainImage = $current as MicrioImage;
	/** Reference to the main image's info data. */
	const info = mainImage.$info as Models.ImageInfo.ImageInfo;

	// Ensure embed has a unique ID
	if(!embed.uuid) embed.uuid = createGUID();
	const uuid = embed.uuid; // Store UUID for state management

	/** Is the parent image a 360 panorama? */
	const is360 = mainImage.is360;
	/** Should the embed video attempt to autoplay? */
	const autoplay = embed.video?.autoplay ?? true;

	/** Find the corresponding MicrioImage instance if this embed represents another Micrio image. */
	let image:MicrioImage = mainImage.embeds.find(i => i.uuid == uuid || i.$info?.title == uuid) as MicrioImage;

	// --- Rendering Logic ---

	// MacOS/iOS with HDR screens auto-"optimize" non-HDR vids which messes up the colors
	// Always force inside-GL rendering for HDR screens
	// Mac M2 with HDR screens don't support the CSS query -_- so just enable WebGL rendering for all MacOS
	// Determine if WebGL rendering should be forced for videos due to HDR screen issues
	const screenIsHDR = window.matchMedia('(dynamic-range: high)').matches || Browser.OSX;

	/** Embed area coordinates [x0, y0, x1, y1]. */
	const a = embed.area;
	/** Is the embed source an SVG image? */
	const isSVG = embed.src?.toLowerCase().endsWith('.svg');
	/** Is the embed relatively small (potentially suitable for HTML rendering)? */
	const isSmall = embed.width && embed.height ? embed.width * embed.height < Math.pow(1024,2) : false;

	// Workaround for iOS 14 HLS video issues in WebGL
	const isIOS14 = /iPhone OS 14_/i.test(navigator.userAgent);

	// Determine if the embed should be rendered as an HTML element instead of WebGL
	const glAttr = 'data-embeds-inside-gl'; // Attribute to force WebGL rendering
	const glAttrValue = micrio.getAttribute(glAttr);
	const embedImageAsHtml = isSVG || isIOS14 || (!screenIsHDR && !micrio.hasAttribute(glAttr)) || glAttrValue == 'false';

	/** Determine if the embed should be rendered using WebGL. */
	const printGL = !embedImageAsHtml && !!(
		// Render Micrio embeds in GL if large or no separate image src
		(embed.micrioId && (!isSmall || !embed.src))
		// Render non-transparent videos without native controls in GL
		|| (embed.video && !embed.video.controls && !embed.video.transparent)
	);

	// --- Interaction Logic ---

	/** Disable pointer events on the container if no click action or iframe source. */
	const noEvents = !embed.clickAction && !embed.frameSrc;
	/** URL for 'href' click action. */
	const href = embed.clickAction == 'href' ? embed.clickTarget : undefined;
	/** Open link in new tab? */
	const hrefBlankTarget = href && embed.clickTargetBlank;

	// --- Positioning State (updated by `moved`) ---
	let w:number = $state(a[2]); // Relative width
	let h:number = $state(a[3]); // Relative height
	let cX:number = $state(a[0]+a[2]/2); // Center X
	let cY:number = $state(a[1]+a[3]/2); // Center Y
	let s:number = $state(embed.scale || 1); // Embed scale
	let rotX:number = $state(embed.rotX??0); // X Rotation
	let rotY:number = $state(embed.rotY??0); // Y Rotation
	let rotZ:number = $state(embed.rotZ??0); // Z Rotation
	let scaleX:number = $state(embed.scaleX??1); // Non-uniform X scale
	let scaleY:number = $state(embed.scaleY??1); // Non-uniform Y scale

	/** CSS style string for the button/image element (used for SVG/IMG embeds). */
	let buttonStyle:string = $state('');

	let _widthCapped:number = $state(0);

	/** Recalculates positioning variables based on the `embed.area` and other settings. */
	function readPlacement() : void {
		const a = embed.area;
		// Handle 360 wrap-around for area coordinates
		//if(is360 && a[0] > a[2]) a[0]--;
		// Recalculate dimensions and center
		w = a[2];
		h = a[3];
		cX = a[0]+w/2;
		cY = a[1]+h/2;
		// Update scale and rotation values from embed data
		s = embed.scale || 1;
		rotX = embed.rotX??0;
		rotY = embed.rotY??0;
		rotZ = embed.rotZ??0;
		scaleX = embed.scaleX??1;
		scaleY = embed.scaleY??1;

		const isGLEmbeddedMicrio = printGL && embed.micrioId && embed.width;
		const htmlButtonEmbedScale = isGLEmbeddedMicrio ? 10 : 1;

		let scale = w * info.width / (embed.width ?? 100) / (!printGL ? s : embed.width ? w : 1) * (is360 ? Math.PI/2 : 1);

		const buttonStyles:string[] = [];

		// Calculate CSS style string for button/image embeds
		if(isGLEmbeddedMicrio && embed.width) {
			scale = w/(embed.width / info.width) * htmlButtonEmbedScale * (is360 ? Math.PI/2 : 1);
			buttonStyles.push(`width:${embed.width/htmlButtonEmbedScale}px`);
		}

		buttonStyles.push(`--ratio:${w/h * info.width/info.height};--scale:${scale}`);

		if(isSVG) buttonStyle+=`height:${embed.height}px`; // Set height directly for SVG

		buttonStyle = buttonStyles.join(';')

		if(embed.video) {
			if(embed.video.width > embed.video.height) _widthCapped = Math.min(embed.video.width, w*info.width, 2048);
			else _widthCapped = Math.min(embed.video.height, h*info.height, 2048) / (embed.video.height / embed.video.width);
		}
	}

	// Initial calculation
	readPlacement();

	// --- Reactive Calculations for HTML Embeds ---
	const width = $derived(Math.round(w * info.width)); // Calculated pixel width
	const height = $derived(Math.round(h * info.height)); // Calculated pixel height

	// --- Video Playback State ---
	/** Local paused state for videos (can be controlled by zoom level). */
	let paused:boolean = $state(false); // Initial state determined later

	// --- Screen Position State (updated by `moved`) ---
	let x:number = $state(0); // Screen X
	let y:number = $state(0); // Screen Y
	let scale:number; // Screen scale at embed position
	let matrix:string = $state(''); // CSS matrix3d string for 360 positioning

	/** CSS style string for the main container element. */
	let style = $state('');

	// --- Pause-on-Zoom Logic ---

	/** Checks if the video should be paused based on its current screen size. */
	function shouldPause() : boolean {
		// If no size limits are set, rely on autoplay setting
		if((!embed.video?.pauseWhenSmallerThan && !embed.video?.pauseWhenLargerThan)) return !autoplay;
		// Calculate the maximum relative screen size (width or height)
		const screenSize:number = scale ? Math.max(width * scale / canvas.viewport.width, height * scale / canvas.viewport.height) : 0;
		// Check against thresholds
		return !!((embed.video.pauseWhenSmallerThan && (screenSize < embed.video.pauseWhenSmallerThan))
			|| (embed.video.pauseWhenLargerThan && (screenSize > embed.video.pauseWhenLargerThan)));
	}

	// --- Position Update ---

	/** Updates the screen position (x, y, scale, matrix) based on camera view. */
	function moved() : void {
		// Exit if camera is not ready
		if(!mainImage.camera.e) return;
		// Get current screen coordinates [x, y, scale, w(depth)]
		[x, y, scale] = mainImage.camera.getXYDirect(cX, cY);
		// Calculate 3D matrix for 360 embeds
		if(is360) matrix = mainImage.camera.getMatrix(cX, cY, s, 1, rotX, rotY, rotZ, undefined, scaleX, scaleY).join(',');
		// Update CSS style string
		style = (is360 ? `transform:matrix3d(${matrix});` : `--x:${x}px;--y:${y}px;--s:${scale};`) // Use matrix or CSS vars
			+ (embed.opacity !== undefined && embed.opacity !== 1 ? `--opacity:${embed.opacity};` : ''); // Apply opacity if set

		// Handle pause-on-zoom logic for videos
		if((embed.video?.pauseWhenSmallerThan || embed.video?.pauseWhenLargerThan) && width) {
			const wasPaused:boolean = paused;
			paused = shouldPause(); // Check if should be paused now
			if(glVideo?._vid && (paused != wasPaused)) { // If state changed and using WebGL video
				if(paused) glVideo._vid.pause(); // Pause
				else { // Play
					// Optionally restart video when shown again
					if(mainImage?.$settings?.embedRestartWhenShown) glVideo._vid.currentTime = 0;
					glVideo._vid.play();
				}
			}
			// Note: HTML video pause/play based on `paused` prop is handled by Media.svelte
		}
	}

	// --- Click Handler ---

	/** Handles click events on the embed container. */
	function click() : void {
		// If action is to open a marker, set the state
		if($current && embed.clickAction == 'markerId' && embed.clickTarget)
			$current.state.marker.set(embed.clickTarget);
		// 'href' action is handled by the `<a>` tag directly
	}

	// --- Editor Integration ---

	/** Handles external changes to embed data (e.g., from Spaces editor). */
	function change(e:Event) : void {
		if(e && 'detail' in e) {
			const emb = e.detail as Models.ImageData.Embed;
			// Update local embed data - This seems potentially problematic if `embed` prop isn't writable
			/** @ts-ignore */
			for(const x in emb) embed[x] = emb[x];
		}
		readPlacement(); // Recalculate placement variables
		moved(); // Update position
	}

	function listen(node:HTMLElement, callback:(e:Event)=>void) {
		node.addEventListener('change', callback);
		return { destroy: () => node.removeEventListener('change', callback) }
	}

	// --- Media Cleanup ---

	/** Writable store passed to Media component to signal destruction. */
	const destroying = writable<boolean>(false);

	// --- Initial Video State ---

	// Mute video if controls are hidden (common requirement for autoplay)
	if(embed.video) {
		if(!embed.video.controls) embed.video.muted = true;
	}

	// --- WebGL Video Handling ---

	/** Is this embed a video rendered via WebGL? */
	const isRawVideo = printGL && !!embed.video;
	/** Instance of the WebGL video handler. */
	let glVideo:GLEmbedVideo|undefined = $state(undefined);

	/** Initializes the WebGL rendering for the embed (Micrio image or video). */
	function printInsideGL() : void {
		// Determine initial opacity (use 0.01 if hidden when paused to ensure it renders initially)
		const opacity = embed.hideWhenPaused ? 0.01 : embed.opacity ?? 1;
		const area:Models.Camera.ViewRect = [
			embed.area[0],
			embed.area[1],
			embed.area[0]+embed.area[2],
			embed.area[1]+embed.area[3]
		];
		if(image && image.ptr >= 0) { // If MicrioImage instance already exists (e.g., from previous state)
			// Update its placement and fade it in
			image.camera.setArea(area);
			image.camera.setRotation(embed.rotX, embed.rotY, embed.rotZ);
			wasm.fadeImage(image.ptr, opacity);
		}
		else { // If no instance exists, create it
			image = mainImage.addEmbed({ // Call parent image's addEmbed method
				id: embed.video ? embed.id : embed.micrioId, // Use embed ID for video, micrioId otherwise
				title: uuid, // Use generated UUID as title?
				width: embed.width,
				height: embed.height,
				isPng: embed.isPng,
				isWebP: embed.isWebP,
				isDeepZoom: embed.isDeepZoom,
				path: info.tileBasePath ?? info.path, // Inherit path
				isSingle: !!embed.video, // Single texture for video
				isVideo: !!embed.video,
				settings: {
					_360: { rotX, rotY, rotZ } // Pass rotation settings
				},
			}, area, { opacity, asImage: false }); // Pass area, initial opacity
		}

		// If it's a WebGL video, initialize the GLEmbedVideo handler once visible
		if(isRawVideo) {
			once(image.visible, {targetValue: true}).then(() => {
				// This takes care of loading and playing the video texture
				glVideo = new GLEmbedVideo(wasm, image, embed, paused, moved);
			});
		}

		wasm.render(); // Trigger Wasm render loop
	}

	// --- HTML Rendering Logic ---

	/** Should an HTML element be rendered for this embed? (Either for direct display or as a click target). */
	const hasHtml = !printGL || !!embed.clickAction;
	/** Reference to the HTMLMediaElement if rendered via Media component. */
	let _mediaElement:HTMLMediaElement|undefined = $state();

	// Update the shared media element reference when _mediaElement changes
	$effect(() => {
		if(embed.video && embed.id && $current) $current.setEmbedMediaElement(embed.id, _mediaElement??glVideo?._vid);
	});

	// --- Size Calculation for HTML Video ---
	// Cap the rendered size of HTML video elements to their native resolution
	const widthCapped = $derived(embed.video || printGL ? _widthCapped : width);
	const heightCapped = $derived(embed.video ? _widthCapped / (embed.video.width / embed.video.height) : height);
	/** Relative scale factor for HTML video element (used for CSS transform). */
	const relScale = $derived(width / widthCapped);

	// --- Lifecycle (onMount) ---
	let isMounted:boolean = false;
	onMount(() => {
		isMounted = true;
		const us:Unsubscriber[] = []; // Store unsubscribers

		// Initialize WebGL rendering if needed
		if(printGL) printInsideGL();

		// Subscribe to view changes if HTML element needs positioning or pause-on-zoom logic
		if(hasHtml || (embed.video?.pauseWhenSmallerThan || embed.video?.pauseWhenLargerThan)) {
			us.push(mainImage.state.view.subscribe(moved));
		}

		// Cleanup function
		return () => {
			isMounted = false;
			glVideo?.unmount(); // Clean up WebGL video handler
			if(image && image.ptr >= 0) { // If rendered in WebGL
				wasm.fadeImage(image.ptr, 0); // Fade out
				wasm.render();
			}
			// Clear media element reference
			if(embed.video && embed.id && $current) $current.setEmbedMediaElement(embed.id);
			// Unsubscribe from stores
			while(us.length) us.shift()?.();
		}
	});
</script>

<!-- Render HTML container only if needed (hasHtml) and position is calculated -->
{#if hasHtml && (matrix || x || y)}
	<!-- Use <a> tag if it's a link, otherwise use <div> -->
	<!-- ARIA role -->
	<!-- Disable pointer events if no action -->
	<!-- Allow keyboard activation -->
	<!-- For editor integration -->
	<svelte:element this={href ? 'a':'div'}
		id={embed.id ? 'e-'+embed.id : undefined} {style}
		role={href ? undefined : 'figure'}
		class:embed-container={!0}
		class:embed3d={is360}
		class:no-events={noEvents}
		onclick={click}
		onkeypress={click}
		use:listen={change}
		{href}
		target={href && hrefBlankTarget?'_blank':null}
	>
		{#if embed.video && !printGL}
			<!-- Render HTML video using Media component -->
			<Media forcePause={paused} src={embed.video.streamId && !embed.video.transparent ? 'cfvid://'+embed.video.streamId : embed.video.src}
				width={widthCapped} height={heightCapped} frameScale={relScale}
				controls={embed.video.controls} {destroying} loop={embed.video.loop} loopDelay={embed.video.loopAfter} muted={embed.video.muted} autoplay={!paused && embed.video.autoplay} hasTransparentH265={embed.video.transparent && embed.video.hasH265}
				bind:_media={_mediaElement} />
		{:else if embed.frameSrc}
			<!-- Render iframe using Media component -->
			<Media src={embed.frameSrc} {width} {height} frameScale={embed.scale} autoplay={embed.autoplayFrame} {destroying} />
		{:else if !printGL && embed.src}
			<!-- Render standard image (or SVG) -->
			<img src={embed.src} style={buttonStyle}
				width={isSVG ? embed.width : undefined} height={isSVG ? embed.height : undefined}
				alt="Embed" data-scroll-through />
		{:else}
			<!-- Render empty button as click target if rendered in WebGL but has click action -->
			<button style={buttonStyle} title={embed.title} data-scroll-through aria-label="embed-button"></button>
		{/if}
	</svelte:element>
{/if}

<style>
	.embed-container {
		position: absolute;
		display: block;
		top: 0;
		left: 0;
		/* Apply 2D transform using CSS variables */
		transform: translate3d(calc(var(--x, 0) - 50%), calc(var(--y, 0) - 50%), 0) scale3d(var(--s),var(--s),1);
		opacity: var(--opacity, 1); /* Apply opacity */
		direction: ltr; /* Ensure LTR for positioning */
		will-change: transform, opacity; /* Optimize animation */
	}
	/* Apply 3D matrix transform for 360 embeds */
	.embed3d {
		top: 50%;
		left: 50%;
	}
	/* Disable pointer events if no action */
	.embed-container.no-events {
		pointer-events: none;
	}
	/* Ensure content within container is clickable */
	.embed-container > * {
		cursor: pointer;
	}
	/* Center content within the transformed container */
	.embed-container > :global(*) {
		position: absolute;
		transform: translate3d(-50%,-50%,0) scale3d(var(--scale, 1), var(--scale, 1), 1);
	}
	/* Ensure non-button content maintains its size */
	.embed-container > :global(*:not(button)) {
		width: auto !important;
	}
	/* Allow pointer events on content if container is interactive */
	.embed-container:not(.no-events) > :global(*) {
		pointer-events: all;
	}
	/* Prevent image dragging */
	.embed-container > img {
		max-width: none; /* Override potential external styles */
	}
	/* Styling for the placeholder button (used when content is in WebGL) */
	.embed-container > :global(button) {
		--scale: 1; /* Reset scale variable */
		--ratio: 1; /* Reset ratio variable */
		padding: 0;
		margin: 0;
		background: transparent;
		border: none;
		width: 100px; /* Default size */
		aspect-ratio: var(--ratio); /* Use calculated aspect ratio */
	}
</style>
