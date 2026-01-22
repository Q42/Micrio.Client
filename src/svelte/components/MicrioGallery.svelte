<script lang="ts">
	/**
	 * MicrioGallery.svelte - Renders a gallery popover using a nested <micr-io> element.
	 *
	 * This component is typically used when clicking on an image within a marker popup.
	 * It takes an array of image assets, constructs the `data-gallery` attribute string,
	 * and initializes a new, embedded <micr-io> instance configured as a gallery.
	 * It also displays the caption of the currently viewed gallery image.
	 */

	import type { HTMLMicrioElement } from '../../ts/element';
	import type { Models } from '../../types/models';

	import { getContext, onDestroy } from 'svelte';

	// --- Props ---
	interface Props {
		/** Array of image assets (usually from `marker.images`). */
		gallery: Models.Assets.Image[];
		/** Optional ID of the image to display initially within the gallery. */
		startId?: string|undefined;
	}

	let { gallery, startId = undefined }: Props = $props();

	// --- Context & State ---

	/** Get the main Micrio element instance from context. */
	const micrio = <HTMLMicrioElement>getContext('micrio');
	/** Get language and current image stores from the main instance. */
	const { _lang, current } = micrio;

	/** Bound <micr-io> gallery instance */
	let galleryMicrio:HTMLMicrioElement|undefined = $state(undefined);

	/** Index of the currently displayed image within the gallery. */
	let galleryIdx:number = $state(0); // Initialize to 0
	/** Event handler for the 'gallery-show' event dispatched by the nested <micr-io> element. */
	const gallerySwitch = (e:CustomEvent) : void => { galleryIdx = e.detail as number; }

	// --- Reactive Declarations (`$:`) ---

	/** Reactive reference to the data of the currently displayed gallery image. */
	const gallCurr = $derived(gallery[galleryIdx]);
	/** Reactive caption text for the current gallery image, based on language. */
	const galleryCaption = $derived(gallCurr?.i18n?.[$_lang]?.description ?? undefined);

	/** No reason to keep the gallery <micr-io> alive when closing -- also ditch WebGL context */
	onDestroy(() => galleryMicrio?.destroy());

</script>

<!-- Main container for the gallery popover -->
<figure>
	<!-- Nested <micr-io> element configured as a gallery -->
	<!-- Construct the data-gallery attribute string -->
	<!-- Pass the starting image ID -->
	<!-- Inherit data path -->
	<!-- Hide logo in gallery popover -->
	<!-- Listen for page changes within the gallery -->
	<micr-io bind:this={galleryMicrio}
		data-gallery={gallery.map(i =>
			`${i.micrioId},${i.width},${i.height},${i.isDeepZoom?'d':''}${i.isWebP?',w':i.isPng||(!$current?.isV5&&i.src?.endsWith('.png'))?',p' : ''}`
		).join(';')}
		data-start={startId}
		data-path={$current && $current.$info && $current.$info.path}
		data-logo="false"
		ongallery-show={gallerySwitch}
	></micr-io>
	<!-- Display caption for the current gallery image -->
	{#if galleryCaption}<figcaption>{@html galleryCaption}</figcaption>{/if}
</figure>

<style>
	/** Gallery styling */
	micr-io {
		/* Darker background for the gallery popover */
		background: transparent;
		display: block; /* Ensure it takes block layout */
		width: 100%;
		height: 100%;
	}
	/* Adjust margin for controls within the nested gallery */
	micr-io :global(ul.micrio-gallery) {
		--micrio-border-margin: 16px;
	}

	/* Ensure controls stay fixed within the popover on desktop */
	@media (min-width: 501px) {
		micr-io:not(:fullscreen) > :global(aside) { /* Target controls container */
			position: fixed; /* Keep controls fixed relative to the popover */
		}
	}
</style>
