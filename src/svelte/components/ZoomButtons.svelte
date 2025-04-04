<script lang="ts">
	/**
	 * ZoomButtons.svelte - Renders zoom in and zoom out buttons.
	 *
	 * This component displays standard zoom controls. It disables buttons
	 * when the maximum or minimum zoom level is reached for the target image.
	 * It can target a specific MicrioImage (for split-screen) or default to
	 * the currently active image.
	 */

	import type { MicrioImage } from '../../ts/image';
	import type { Unsubscriber } from 'svelte/store';
	import type { HTMLMicrioElement } from '../../ts/element';

	import { getContext, onMount } from 'svelte';

	// Micrio TS imports
	import { once } from '../../ts/utils';
	import { i18n } from '../../ts/i18n'; // For button titles

	// UI Components
	import Button from '../ui/Button.svelte';

	// --- Props ---
	interface Props {
		/**
	 * Optional target MicrioImage instance. If not provided, defaults to the
	 * currently active image from the main Micrio context.
	 */
		image?: MicrioImage|undefined;
	}

	let { image = $bindable(undefined) }: Props = $props();

	// --- Context & State ---

	/** Get the main Micrio element instance from context. */
	const micrio = <HTMLMicrioElement>getContext('micrio');

	/** Local state tracking if the image is fully zoomed in. */
	let isZoomedIn: boolean = $state(false);
	/** Local state tracking if the image is fully zoomed out. */
	let isZoomedOut: boolean = $state(false);
	/** Local state tracking if the target image info is still loading. */
	let loading = $state(false);

	// --- Event Handlers & Functions ---

	/** Sets a flag indicating user interaction to potentially prevent other actions. */
	const gestured = () => {
		micrio.events.clicked = true; // Set global clicked flag
	}
	/** Handles zoom in button click. */
	const zoomIn = () => {
		gestured();
		// Call camera's zoomIn method and clear clicked flag when animation finishes
		image?.camera.zoomIn().then(() => micrio.events.clicked = false);
	}
	/** Handles zoom out button click. */
	const zoomOut = () => {
		gestured();
		// Call camera's zoomOut method and clear clicked flag when animation finishes
		image?.camera.zoomOut().then(() => micrio.events.clicked = false);
	}

	/** Updates the `isZoomedIn` and `isZoomedOut` state based on the target image's camera. */
	function update() {
		isZoomedIn = image?.camera.isZoomedIn() ?? true; // Default to true if no image/camera
		isZoomedOut = image?.camera.isZoomedOut(true) ?? true; // Check against full size, default true
	}

	// --- Lifecycle (onMount) ---

	/** Unsubscriber for the view store subscription. */
	let unsub:Unsubscriber|undefined;
	/** Unsubscriber for the current image store subscription (if image prop is not provided). */
	let currentUnsub:Unsubscriber|undefined;

	onMount(() => {
		if(image) { // If a specific image is provided
			// Subscribe directly to the provided image's view store
			unsub = image.state.view.subscribe(update);
		} else { // If no specific image, use the currently active one
			// Subscribe to the main `current` image store
			currentUnsub = micrio.current.subscribe(c => {
				// Unsubscribe from previous image's view store if necessary
				if(unsub) { unsub(); unsub = undefined; }
				loading = true; // Set loading state
				if(image = c) { // If a new current image is set
					// Wait for its info to load
					once(c.info).then(() => {
						if(image) { // Ensure image hasn't changed again while waiting
							// Subscribe to the new image's view store
							unsub = image.state.view.subscribe(update);
						}
						loading = false; // Clear loading state
					});
				} else {
					loading = false; // No current image, clear loading state
				}
			});
		}

		// Cleanup function
		return () => {
			if(currentUnsub) currentUnsub(); // Unsubscribe from current image store
			if(unsub) unsub(); // Unsubscribe from view store
		}
	});
</script>

<!-- Render buttons only if not fully zoomed in OR not fully zoomed out -->
{#if !isZoomedIn || !isZoomedOut}
	<!-- Zoom In Button -->
	<Button type="zoom-in" title={$i18n.zoomIn} disabled={loading||isZoomedIn} onclick={zoomIn} />
	<!-- Zoom Out Button -->
	<Button type="zoom-out" title={$i18n.zoomOut} disabled={loading||isZoomedOut} onclick={zoomOut} />
{/if}

<!-- No specific styles needed, inherits from ButtonGroup and Button -->
