<script lang="ts">
	/**
	 * Waypoint.svelte - Renders an interactive waypoint marker for 360 image navigation.
	 *
	 * This component displays a clickable marker within a 360 image, representing a link
	 * to another 360 image within the same "space" (defined by spaceData). It calculates
	 * the 3D position and orientation of the waypoint based on the relative positions
	 * of the current and target images.
	 */

	import type { HTMLMicrioElement } from '../../ts/element';
	import type { Models } from '../../types/models';
	import type { MicrioImage } from '../../ts/image';

	import { fade } from 'svelte/transition';
	import { getContext, onMount } from 'svelte';

	// Micrio TS imports
	import { clone, getLocalData, getSpaceVector } from '../../ts/utils';
	import { i18n } from '../../ts/i18n';

	// UI Components
	import Button from '../ui/Button.svelte';

	// --- Props ---
	interface Props {
		/** The ID of the target MicrioImage this waypoint links to. */
		targetId: string;
		/** Waypoint settings (icon, title overrides, custom coordinates). */
		settings?: Models.Spaces.WayPointSettings;
		/** The parent MicrioImage instance (current 360 image). */
		image: MicrioImage;
	}

	let { targetId, settings = $bindable({
		i18n: {} // Initialize i18n object
	}), image = $bindable() }: Props = $props();

	// --- Context & State ---

	/** Get the main Micrio element instance from context. */
	const micrio = <HTMLMicrioElement>getContext('micrio');
	/** Destructure needed stores and properties. */
	const { _lang, spaceData } = micrio;

	/** Get info and settings for the current image. */
	const info = image.$info as Models.ImageInfo.ImageInfo;
	const imgSettings = image.$settings;

	/** Attempt to get preloaded data for the target image (used for title fallback). */
	const targetImage:Models.ImageData.ImageData|undefined = getLocalData(targetId)?.[2];

	// --- 3D Position Calculation ---

	/** Calculate the vector and direction between the current and target images. */
	const vectorData = getSpaceVector(micrio, targetId);
	if (!vectorData) {
		console.error(`[Micrio Waypoint] Could not calculate vector for target ${targetId}`);
		// Handle error state appropriately, maybe hide the waypoint
	}
	const { directionX, v, vN, vector } = vectorData!; // Use non-null assertion after check or handle error

	/** Reference to the waypoint's container element. */
	let _element:HTMLElement|undefined = $state();

	/** Determine if the waypoint is roughly on the "ground" based on vertical vector component. */
	const isOnGround = Math.abs(vN[1]) < .3;
	/** Default vertical position (0.65 for ground, adjusted based on vertical vector otherwise). */
	const defaultY = isOnGround ? .65 : .5 + vN[1]/10;

	/** Automatically calculated coordinates and orientation based on vector. */
	const autoCoords:Models.Spaces.WaypointCoords = {
		x: directionX, // Horizontal position based on direction
		y: defaultY, // Vertical position
		baseScale: info.width / 1024, // Base scale relative to image width (legacy?)
		scale: 1, // Default scale multiplier
		rotX: (1+(isOnGround ? -(1-defaultY) : vN[1])) * Math.PI/2, // Pitch rotation to face camera somewhat
		rotY: 0, // No yaw rotation by default
		rotZ: 0 // No roll rotation by default
	};

	/** Use custom coordinates from settings if provided, otherwise use auto-calculated ones. */
	const customCoords = settings?.coords ?? clone<typeof autoCoords>(autoCoords);
	/** Flag indicating if custom coordinates are being used. */
	let isCustom = customCoords.custom;
	/** The final coordinates object used for positioning. */
	let coords = isCustom ? customCoords : autoCoords;

	// --- Event Handlers & Functions ---

	/** Timeout ID for focus-based camera movement. */
	let fto:any;
	/** Handles focus events (e.g., tabbing). Moves camera if waypoint is off-screen. */
	function focus() : void {
		if(imgSettings._markers?.noMarkerActions) return; // Respect global setting

		// Prevent container scroll jump on focus
		(_element!.parentNode as HTMLElement).scrollTo(0,0);
		clearTimeout(fto); // Clear previous timeout
		// Set timeout to fly camera if waypoint is off-screen after a delay
		fto = setTimeout(() => {
			const px = image.camera.getXY(coords.x, coords.y); // Get screen coordinates
			// Check if off-screen or behind camera
			if(!clicked && (px[0] < 0 || px[0] >= micrio.offsetWidth || px[1] < 0 || px[1] >= micrio.offsetHeight || (image.is360 ? px[3] > 4 : false)))
				image.camera.flyToCoo([coords.x, coords.y], {speed: 2, limit: true}).catch(() => {}); // Fly to waypoint center
		}, 150);
	}

	/** CSS matrix string for 3D positioning. */
	let matrix:string = $state('');
	/** Stores the previous custom icon index to detect changes. */
	let pIconIdx:number|undefined = settings.customIconIdx;

	/** Updates the waypoint's position and checks for settings changes. Called on view updates. */
	const onmove = () : void => {
		// Check if waypoint was deleted externally (e.g., editor)
		if(iface.deleted) {
			hidden = true; // Hide the component
			return;
		}
		// Update custom icon if changed
		if(pIconIdx != iface.settings.customIconIdx) {
			settings.customIconIdx = iface.settings.customIconIdx;
			pIconIdx = settings.customIconIdx;
		}
		// Update coordinate source if custom setting changed
		if(customCoords.custom != isCustom) {
			isCustom = customCoords.custom;
			coords = isCustom ? customCoords : autoCoords;
		}
		// Recalculate the 3D transformation matrix
		matrix = image.camera.getMatrix(
			coords.x,
			coords.y,
			coords.baseScale * coords.scale,
			1, // Radius (seems fixed at 1 here?)
			coords.rotX,
			coords.rotY,
			coords.rotZ
		).join(',');
	}

	/** Flag to track if the waypoint has been clicked (prevents re-triggering focus animation). */
	let clicked = $state(false);
	/** Handles click events on the waypoint button. */
	function click() : void {
		if(imgSettings._markers?.noMarkerActions) return; // Respect global setting

		clicked = true; // Set clicked flag

		// Close any open markers on the current image before navigating
		image.openedView = undefined;
		image.state.marker.set(undefined);

		// Open the target image, passing the calculated vector for smooth transition
		micrio.open(targetId, { vector });
	}

	// --- Visibility & Interface ---

	/** Flag to hide the waypoint (e.g., if replaced by a marker). */
	let hidden:boolean=$state(false);

	/** Public interface object exposed for external interaction (e.g., editor). */
	const iface:Models.Spaces.WaypointInterface = {
		coords: customCoords, // Expose the potentially editable custom coordinates
		settings // Expose settings
	};

	// Initial position calculation
	onmove();

	// --- Lifecycle (onMount) ---
	onMount(() => {
		iface.el = _element; // Store DOM element reference on interface

		/** @ts-ignore Add interface to DOM element for external access */
		_element['_iface'] = iface;

		// Dispatch event indicating the waypoint has been printed
		micrio.dispatchEvent(new CustomEvent<Models.Spaces.WaypointInterface>('wp-print', {detail: iface}));
		// Subscribe to view changes to update position
		const viewUnsub = image.state.view.subscribe(onmove);
		// Cleanup function
		return () => viewUnsub();
	});

	// --- Reactive Declarations (`$:`) ---

	/** Reactive title, preferring settings override, then target image title. */
	const title = $derived(settings.i18n?.[$_lang]?.title || targetImage?.i18n?.[$_lang]?.title);
	/** Reactive icon asset based on customIconIdx setting. */
	const icon = $derived(spaceData?.icons?.[settings.customIconIdx ?? -1]);

</script>

<!-- Render waypoint container only if not hidden -->
{#if !hidden}
	<!-- Apply 3D transform matrix -->
	<!-- Apply class if clicked (for animation) -->
	<!-- Alias for clicked? -->
	<!-- Class based on vertical direction -->
	<div
		transition:fade
		style="--matrix: matrix3d({matrix})"
		id={`w-${targetId}`}
		class:clicked
		class:active={clicked}
		class:direction-up={v[1]<0}
		class:direction-down={v[1]>0}
		bind:this={_element}
	>
		<!-- Waypoint button -->
		<!-- Default icon or custom -->
		<!-- Use title or default text -->
		<Button
			type={icon ? undefined : 'arrow-up'}
			{icon}
			onclick={click}
			onfocus={focus}
			title={title ?? $i18n.waypointFollow}
		/>
	</div>
{/if}

<style>
	div {
		display: block;
		position: absolute;
		transform-style: preserve-3d; /* Enable 3D positioning */
		transform: var(--matrix); /* Apply calculated matrix */
		width: 0; /* Position based on transform origin */
		height: 0;
		top: 50%;
		left: 50%;
		/** temp vars for potential overrides */
		--micrio-bb: var(--micrio-button-background);
		--micrio-bbh: var(--micrio-button-background-hover);
	}

	/* Styling for the waypoint button */
	div > :global(button) {
		/* Use waypoint-specific CSS variables with fallbacks */
		--micrio-button-background: var(--micrio-waypoint-background, var(--micrio-bb));
		--micrio-button-background-hover: var(--micrio-waypoint-background-hover, var(--micrio-bbh));
		--micrio-button-size: var(--micrio-waypoint-size);
		--micrio-border-radius: var(--micrio-waypoint-border-radius, 100%); /* Default to circle */
		--micrio-icon-size: var(--micrio-waypoint-icon-size, calc(var(--micrio-button-size) - 50px)); /* Adjust icon size */
		/* Center the button relative to the transformed div */
		transform: translate3d(-50%,-50%, 0) scale3d(.5,.5,1); /* Start slightly smaller */
		pointer-events: all;
		transition: background-color .25s ease, opacity .25s ease, border-color .25s ease, transform .25s ease; /* Add transform transition */
		border: var(--micrio-waypoint-border-size, var(--micrio-marker-border-size)) solid var(--micrio-waypoint-border-color, var(--micrio-marker-border-color));
		margin: 0;
	}

	/* Center icon within the button */
	div > :global(button>svg) {
		pointer-events: none;
		margin: 0 auto;
	}

	/* Hover/active state: slightly larger scale */
	div:hover > :global(button),
	div.active > :global(button) {
		transition: background-color .25s ease, opacity .25s ease, transform .25s ease; /* Include transform */
		transform: translate3d(-50%,-50%, 0) scale3d(.6,.6,1); /* Scale up slightly */
	}

	/* Pulsing animation when clicked */
	div.clicked > :global(button) {
		animation: pulse .75s ease infinite alternate;
	}

	@keyframes pulse {
		from {
			transform: translate3d(-50%,-50%, 0) scale3d(.5,.5,1);
		}
		to {
			transform: translate3d(-50%,-50%, 0) scale3d(.75,.75,1);
		}
	}
</style>
