<script lang="ts" context="module">
	/**
	 * Module script for AudioController.svelte
	 *
	 * Manages the global Web Audio API context (`AudioContext`), main gain node,
	 * and listener position/orientation. It also handles audio buffer caching
	 * and user interaction detection needed to initialize the AudioContext.
	 */
	import { writable, type Writable } from 'svelte/store';

	/** The main gain node controlling the overall volume. */
	export let mainGain:GainNode;
	/** Cache for decoded audio buffers, keyed by source URL. */
	export const buffers:{[key:string]: AudioBuffer} = {};
	/** Writable store holding the global AudioContext instance. */
	export const ctx:Writable<AudioContext|undefined> = writable();

	/** Internal reference to the AudioContext. */
	let _ctx:AudioContext|null;
	/** Reference to the AudioListener for positioning. */
	let l:AudioListener;

	/** Writable store tracking if the user has interacted with the page (required to start audio). */
	const interacted = writable<boolean>(false);

	/** Initializes the Web Audio API context and main gain node. */
	function init(volume:number) : void {
		if(mainGain) return; // Already initialized
		// Attempt to create AudioContext (with vendor prefixes)
		if(!_ctx) _ctx = 'micrioAudioContext' in window ? window['micrioAudioContext'] as AudioContext // Check for existing global context
			: 'AudioContext' in window ? new window.AudioContext()
			: 'webkitAudioContext' in window ? (new (<any>window['webkitAudioContext'])) as AudioContext // Legacy webkit prefix
			: null;
		if(!_ctx) return console.warn('[Micrio] Your browser does not support the Web Audio API'); // Log warning if unsupported

		// Create and connect the main gain node
		mainGain = _ctx.createGain();
		mainGain.connect(_ctx.destination);

		// Set initial volume
		mainGain.gain.value = volume;

		// Update the global context store
		ctx.set(_ctx);

		// Get the listener and set default orientation (Y-up)
		l = _ctx.listener;
		if('upX' in l) { // Standard API properties
			l.upX.value = 0;
			l.upY.value = 1;
			l.upZ.value = 0;
		}
		// Note: Older APIs might require setOrientation, handled below
	};

	/** Sets the listener's position in 3D space. Handles standard and older prefixed APIs. */
	function setPosition(x:number, y:number, z:number) : void {
		if(!l) return; // Exit if listener not initialized
		if(l.setPosition) l.setPosition(x,y,z); // Standard API
		else if('positionX' in l) { // Older prefixed API
			l.positionX.value = x;
			l.positionY.value = y;
			l.positionZ.value = z;
		}
	}

	/** Sets the listener's orientation (forward vector). Handles standard and older prefixed APIs. */
	function setOrientation(x:number, y:number, z:number) {
		if(!l) return; // Exit if listener not initialized
		// Standard API (forwardX, forwardY, forwardZ, upX, upY, upZ)
		if(l.setOrientation) l.setOrientation(x, y, z, 0, 1, 0); // Assume Y is up
		else if('forwardX' in l) { // Older prefixed API
			l.forwardX.value = x;
			l.forwardY.value = y;
			l.forwardZ.value = z;
			// up vector is already set in init
		}
	}
</script>

<script lang="ts">
	/**
	 * AudioController.svelte - Manages audio playback and positioning within Micrio.
	 *
	 * This component initializes the Web Audio context upon user interaction,
	 * updates the listener position based on camera movement (for positional audio),
	 * and renders the AudioPlaylist component if background music is defined.
	 */

	import type { HTMLMicrioElement } from '../../ts/element';
	import type { Models } from '../../types/models';
	import type { Unsubscriber } from 'svelte/store';
	import type { MicrioImage } from '../../ts/image';

	import { getContext, onMount } from 'svelte';
	import { Browser } from '../../ts/utils'; // Browser detection

	import AudioPlaylist from './AudioPlaylist.svelte'; // Component for background music

	// --- Props ---

	/** Current global volume level (0-1). */
	export let volume:number = 1;
	/** Image data containing music and marker information. */
	export let data:Models.ImageData.ImageData;
	/** Is the current image a 360 panorama? */
	export let is360:boolean;

	// --- Context & State ---

	/** Get the main Micrio element instance from context. */
	const { events, current } = <HTMLMicrioElement>getContext('micrio');

	/** Reference to the current MicrioImage instance. */
	const image = $current as MicrioImage;
	/** Reference to the current image's info data. */
	const info = image.$info as Models.ImageInfo.ImageInfo;
	/** Aspect ratio of the current image. */
	const ar = info.height / info.width;

	/** Check if Web Audio API is supported. */
	const supported = 'AudioContext' in window || 'webkitAudioContext' in window;

	// --- Listener Position Update ---

	/** Updates the Web Audio listener position based on camera view. */
	function moved(x:number, y:number, z:number) : void {
		if(is360) {
			// Convert normalized 2D view center + zoom (z) to 3D coordinates and orientation
			// get virtual microphone pos
			x *= -Math.PI*2; // Longitude
			y -= .5;         // Center latitude
			y *= -Math.PI;   // Latitude

			const r = 10 * (1-z); // Radius based on zoom level (z, 0=zoomed out, 1=zoomed in)

			// coordinate in 3d space, untranslated
			const _x = Math.cos(y) * Math.sin(x) * r;
			const _y = Math.sin(y) * r;
			const _z = Math.cos(y) * Math.cos(x) * r;

			setPosition(_x,_y,_z); // Set listener position

			// normalize vector for direction
			let len = _x * _x + _y * _y + _z * _z;
			if(len > 0) len = (1.0 / Math.sqrt(len));
			setOrientation(_x * len, _y * len, _z * len); // Set listener orientation (forward vector)
		}
		else { // 2D positioning
			// Map view center (x, y) and scale (z) to listener position
			setPosition((x - .5) * 2, (.5 - y) * 2 * ar, z); // Simple mapping, Z represents depth/distance
			// Orientation remains fixed forward for 2D
			setOrientation(0, 0, -1); // Assuming default forward is -Z
		}
	}

	// --- User Interaction Handling ---

	/** Sets the global `interacted` flag to true. */
	const input = ():void => interacted.set(true);

	// Create a dummy Audio element to attempt playback, triggering user interaction prompt if needed.
	// This is required by browsers to allow subsequent audio playback without interaction.
	const audio = new Audio('data:audio/mpeg;base64,/+MYxAAAAANIAUAAAASEEB/jwOFM/0MM/90b/+RhST//w4NFwOjf///PZu////9lns5GFDv//l9GlUIEEIAAAgIg8Ir/JGq3/+MYxDsLIj5QMYcoAP0dv9HIjUcH//yYSg+CIbkGP//8w0bLVjUP///3Z0x5QCAv/yLjwtGKTEFNRTMuOTeqqqqqqqqqqqqq/+MYxEkNmdJkUYc4AKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq');
	// Set volume to 0 on iOS to avoid audible playback of the dummy audio.
	audio.volume = Browser.iOS ? 0 : 0.0001; // Use very low volume instead of 1

	// --- Lifecycle (onMount) ---

	if(supported) onMount(() => {
		let viewUnsub:Unsubscriber|null; // Store view subscription
		let interactedUnsub:Unsubscriber|null; // Store interacted subscription

		// Subscribe to the interacted store
		interactedUnsub = interacted.subscribe(b => {
			if(!b) return; // Exit if no interaction yet

			// Initialize AudioContext if not already done
			if(!_ctx) {
				init(volume); // Initialize with current volume prop
				events.dispatch('audio-init'); // Dispatch event
			}

			// If context initialized and positional audio markers exist, subscribe to view changes
			if(_ctx && data.markers?.filter(m => !!m.positionalAudio).length) {
				viewUnsub = image.state.view.subscribe(
					v => { // View store subscription callback
						if(!v) return;
						const w = v[2]-v[0], h = v[3]-v[1]; // Calculate view width/height
						// Calculate depth factor based on zoom level (closer to 1 when zoomed in)
						const d = Math.max(0, 1.05 - image.camera.getScale());
						// Update listener position based on view center and depth
						moved(v[0]+w/2, v[1]+h/2, d * (is360 ? 1 : 1.5)); // Apply different depth scaling for 2D/360
					}
				);
			}

			// Unsubscribe from interacted store once interaction occurs
			if(interactedUnsub) { interactedUnsub(); interactedUnsub = null; }
		});

		// Attempt to play the dummy audio to trigger interaction prompt if needed
		if(!_ctx) { // Only attempt if context isn't already initialized
			audio.play().then(input) // If playback succeeds, call input()
			.catch(() => { // If playback fails (autoplay blocked)
				events.dispatch('autoplay-blocked'); // Dispatch event
				// Add a one-time listener for user interaction to call input()
				addEventListener('pointerup', input, {once: true});
			});
		}

		// Cleanup function
		return () => {
			if(viewUnsub) viewUnsub(); // Unsubscribe from view store
			if(interactedUnsub) interactedUnsub(); // Unsubscribe from interacted store
			removeEventListener('pointerup', input); // Remove interaction listener
		}
	});

	// --- Reactive Effects ---

	/** Update the main gain node volume when the `volume` prop changes. */
	$: if(mainGain) mainGain.gain.value = volume;

</script>

<!-- Render the AudioPlaylist component if context is initialized and music data exists -->
{#if $interacted && $ctx && data.music?.items.length}
	<AudioPlaylist list={data.music.items} loop={data.music.loop} volume={volume*(data.music.volume ?? 1)} />
{/if}

<!-- This component doesn't render any visible elements itself, only manages audio context and playlist -->
