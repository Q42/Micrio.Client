<script lang="ts">
	/**
	 * MarkerContent.svelte - Renders the actual content within a marker popup.
	 *
	 * This component takes a marker data object and displays its title, body text,
	 * associated images, audio, video embeds, or video tour based on the marker's configuration.
	 * It utilizes the Media and Article sub-components.
	 */

	import type { HTMLMicrioElement } from '../../ts/element';
	import type { Models } from '../../types/models';
	import type { MicrioImage } from '../../ts/image';
	import type { Writable } from 'svelte/store';

	import { getContext } from 'svelte';

	// Component imports
	import Media from '../components/Media.svelte'; // Handles media playback (audio, video, embeds)
	import Article from './Article.svelte'; // Renders HTML content

	// --- Props ---

	interface Props {
		/** The marker data object containing content and configuration. */
		marker: Models.ImageData.Marker;
		/** Writable store indicating if the parent popup is being destroyed (for media cleanup). */
		destroying: Writable<boolean>;
		/** If true, disable rendering of iframe/video embeds. */
		noEmbed?: boolean;
		/** If true, disable rendering of associated images. */
		noImages?: boolean;
		/** If true, disable opening the image gallery popover when clicking images. */
		noGallery?: boolean;
		/** Allows binding to the main content container element. */
		_content?: HTMLElement;
		/** Allows binding to the title (h1) element. */
		_title?: HTMLElement;
		onclose?: Function;
	}

	let {
		marker,
		destroying,
		noEmbed = false,
		noImages = false,
		noGallery = false,
		_content = $bindable(),
		_title = $bindable(),
		onclose
	}: Props = $props();

	// --- Setup ---

	/** Get Micrio instance and relevant stores/properties from context. */
	const micrio = <HTMLMicrioElement>getContext('micrio');
	const lang = micrio._lang; // Current language store
	const tour = micrio.state.tour; // Active tour store

	/** Check if the current tour is a serial tour. */
	const isSerialTour = $tour && 'steps' in $tour && $tour.isSerialTour;

	/** Get the WeakMap linking markers to their parent MicrioImage instance. */
	const markerImages : Map<string,MicrioImage> = getContext('markerImages');
	/** Get the parent MicrioImage instance for this marker. */
	const image = markerImages.get(marker.id) as MicrioImage;
	/** Get marker-specific settings from the parent image's settings. */
	const settings = image.$settings._markers ?? {};

	// --- Configuration Flags ---

	/** Determine if media should autoplay based on global and marker settings. */
	const autoplayMedia = !settings.preventAutoPlay;
	/** Determine if clicking marker images should open the gallery popover. */
	const galleryEnabled = !marker.data?.preventImageOpen && !noGallery;
	/** Check if there's exactly one image associated with the marker. */
	const singleImage = marker.images?.length == 1;

	// --- Reactive Declarations (`$:`) ---

	/** Get the language-specific content object for the marker. */
	let content = $derived(marker.i18n ? marker.i18n[$lang] : (marker as unknown as Models.ImageData.MarkerCultureData));

	/** Determine if the marker has any displayable content. */
	let empty = $derived(!content?.title && !content?.audio
		&& (!marker.images || !marker.images.length)
		&& !content?.embedUrl
		&& !marker.videoTour
		&& !content?.body && !content?.bodySecondary);

	// --- Event Handlers ---

	/** Called when media playback ends. Dispatches 'close' event for tour auto-progression. */
	const mediaEnded = () : void => {
		if($tour && 'steps' in $tour && ($tour.isSerialTour || settings.tourAutoProgress)) {
			onclose?.(); // Signal parent (MarkerPopup) to close/advance
		}
	}

	/** Opens the image gallery popover. */
	function openGallery(startId:string|undefined) {
		if(!galleryEnabled) return;
		// Set the popover state to display the gallery
		micrio.state.popover.set({gallery: marker.images, galleryStart: startId, image});
	}

	// --- Media Playback State ---

	/** Initial paused state for audio and video based on settings and content presence. */
	const paused = $state({
		// Pause audio if autoplay is disabled globally or for this specific marker
		audio: !autoplayMedia || !marker.audioAutoPlay,
		// Pause video if embed autoplay is explicitly false, or if global autoplay is off,
		// or if there's also audio set to autoplay (prioritize audio)
		video: marker.embedAutoPlay === false || (!autoplayMedia || !!(content?.audio && marker.audioAutoPlay))
	});

	/** Convenience flag for video autoplay state. */
	const aplayVideo = !paused.video;

	// --- Utility ---

	/** Check if running in development environment based on tile base path. */
	const isDev = image.tileBase?.includes('micrio.dev');

	/** Helper to get the language-specific title of an image asset. */
	const getTitle = (image:Models.Assets.Image) => image.i18n?.[$lang]?.title;

	/** Determine the primary audio source (from video tour or marker content). */
	let audio = $derived(marker.videoTour?.i18n?.[$lang]?.audio ?? content?.audio);
	/** Get the source URL for the audio. Handles potential legacy `fileUrl` property. */
	let audioSrc = $derived(audio ? 'fileUrl' in audio ? audio.fileUrl as string : audio.src : undefined);
	/** Get the caption for the image if there's only one image. */
	let imageCaption = $derived(singleImage && marker.images?.[0]?.i18n?.[$lang]?.description);

</script>

<!-- Render content only if the language-specific content object exists -->
{#if content}
	<main class:empty bind:this={_content}>
		<!-- Title -->
		{#if content.title}<h1 bind:this={_title}>{content.title}</h1>{/if}

		<!-- Primary Body Text (if primaryBodyFirst setting is true) -->
		{#if content.body && settings.primaryBodyFirst}<Article>{@html content.body}</Article>{/if}

		<!-- Media Player (Audio or Video Tour) -->
		{#if !isSerialTour && (((!content || !content.embedUrl) && marker.videoTour) || (content && content.audio))}
			<!-- Don't show play overlay for audio/tour -->
			<Media
				src={audioSrc}
				{destroying}
				noPlayOverlay
				{image}
				uuid={marker.id}
				tour={marker.videoTour}
				autoplay={marker.audioAutoPlay || (!content.audio && !!marker.videoTour)}
				controls={!marker.videoTour || (!content || !content.embedUrl)}
				onended={mediaEnded}
				bind:paused={paused.audio}
			/>
			<!-- Show controls only if it's just audio -->
		{/if}

		<!-- Marker Images -->
		{#if !noImages && !!marker.images?.length}
			<section>
				{#each marker.images as imageAsset (imageAsset.id ?? imageAsset.src)}
					<button
						title={getTitle(imageAsset)}
						onclick={galleryEnabled ? () => openGallery(imageAsset.micrioId) : undefined}
						disabled={!galleryEnabled}
					>
						<figure>
							<!-- Generate IIIF URL for thumbnail if micrioId exists, otherwise use src -->
							<img
								alt={getTitle(imageAsset)}
								src={imageAsset.micrioId ? `https://iiif.${isDev ? 'micrio.dev' : 'micr.io'}/${imageAsset.micrioId}/full/${singleImage ? '^'+Math.min(imageAsset.width, 640)+',' : '^,320'}/0/default.webp` : imageAsset.src}
							/>
							{#if imageCaption}<figcaption>{imageCaption}</figcaption>{/if}
						</figure>
					</button>
				{/each}
			</section>
		{/if}

		<!-- Embed (IFrame or Video) -->
		{#if content.embedUrl && !noEmbed}
			<!-- Hidden secondary media player for video tour audio if embed exists -->
			{#if !content.audio && marker.videoTour}
				<Media {image} className="hidden" uuid={marker.id} tour={marker.videoTour} autoplay={autoplayMedia} secondary {destroying} />
			{/if}
			<!-- Main embed media player -->
			<Media
				{image}
				src={content.embedUrl}
				uuid={marker.id}
				width={400} height={240}
				controls
				title={content.embedTitle}
				figcaption={content.embedDescription}
				autoplay={aplayVideo}
				{destroying}
				onended={mediaEnded}
				bind:paused={paused.video}
			/>
		{/if}

		<!-- Primary Body Text (if primaryBodyFirst setting is false) -->
		{#if content.body && !settings.primaryBodyFirst}<Article>{@html content.body}</Article>{/if}
		<!-- Secondary Body Text -->
		{#if content.bodySecondary}<Article cn="secondary">{@html content.bodySecondary}</Article>{/if}
	</main>
{/if}

<style>
	main {
		/* Basic popup content styling */
		position: relative;
		padding: var(--micrio-popup-padding);
		padding-bottom: 0; /* Content adds its own bottom margin/padding */
		overflow-y: auto; /* Allow scrolling for long content */
		user-select: text; /* Allow text selection */
		color: var(--micrio-color);
		background: var(--micrio-background);
		backdrop-filter: var(--micrio-background-filter);
		box-shadow: var(--micrio-popup-shadow);
		border-radius: var(--micrio-border-radius);
		box-sizing: border-box;
		text-align: var(--micrio-text-align);
	}

	/* Remove extra styling from direct children (handled by sub-components) */
	main > :global(*) {
		--micrio-button-background: none;
		--micrio-background-filter: none;
		--micrio-button-shadow: none;
	}

	/* Ensure progress bar within media player is transparent */
	main :global(.micrio-progress-bar.container) {
		background: transparent;
		backdrop-filter: none;
	}

	/* Custom scrollbar styling */
	main:global(::-webkit-scrollbar) {
		background-color: transparent;
		width: 10px;
	}
	main:global(::-webkit-scrollbar-thumb) {
		background: var(--micrio-color);
		border-radius: var(--micrio-border-radius);
		margin-top: 10px;
	}

	/* Styling for empty state (though likely hidden by parent) */
	main.empty {
		width: auto;
	}

	/* Title styling */
	main h1 {
		font-size: 1.5em;
		font-weight: 600;
		margin: 0 0 1.25em 0;
	}

	/* Adjust margins for embedded Media components */
	main > :global(figure.micrio-media) {
		margin: calc(-1 * var(--micrio-popup-padding)); /* Extend to edges */
		margin-bottom: 0;
		width: auto; /* Override default figure width */
		--micrio-background: transparent;
	}
	/* Add bottom padding back for non-video media controls */
	main > :global(figure.micrio-media:not(.media-video):not(:last-child) > *:last-child:not(figcaption)) {
		margin-bottom: var(--micrio-popup-padding);
		background: var(--micrio-background); /* Ensure background matches popup */
		padding: 0 var(--micrio-popup-padding);
	}
	/* Add bottom margin for video media */
	main > :global(figure.micrio-media.media-video) {
		margin-bottom: var(--micrio-popup-padding);
	}

	/* Ensure background is transparent for nested media controls */
	main > :global(figure.micrio-media > div > aside.micrio-media) {
		--micrio-background: transparent;
	}

	/* Ensure last article has bottom padding */
	main > :global(article:last-child) {
		margin-bottom: var(--micrio-popup-padding);
	}

	/* Allow pre-wrap for paragraphs */
	main :global(p) {
		white-space: pre-line;
	}

	/* Hide elements with 'hidden' class */
	main :global(figure.hidden) {
		display: none;
	}

	/* Ensure media element fills its container */
	main :global(figure > div.micrio-media > *:first-child) {
		width: 100%;
	}

	/* Styling for image gallery section */
	button { /* Targets the button wrapping each image figure */
		padding: 0;
		margin: 0 calc(-1 * var(--micrio-popup-padding)) var(--micrio-popup-padding) calc(-1 * var(--micrio-popup-padding));
	}
	button:disabled {
		cursor: default;
	}

	figcaption {
		padding: 10px;
		font-style: italic;
		font-size: .9em;
		margin-bottom: var(--micrio-popup-padding);
		text-align: center;
	}

	/* Grid layout for multiple images */
	section {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); /* Responsive grid */
		column-gap: 5px;
		row-gap: 5px;
		justify-items: center;
		margin-bottom: var(--micrio-popup-padding);
	}
	section button {
		/* Reset button styles within the grid */
		color: inherit;
		border: none;
		display: block;
		width: 100%;
		cursor: pointer;
		margin: 0; /* Remove negative margins */
	}
	section figure {
		padding: 0;
		margin: 0;
	}
	section img {
		width: 100%;
		display: block;
		object-fit: cover; /* Ensure images cover their grid area */
	}

</style>
