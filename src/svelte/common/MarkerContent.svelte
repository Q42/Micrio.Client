<script lang="ts">
	import type { HTMLMicrioElement } from '../../ts/element';
	import type { Models } from '../../types/models';
	import type { MicrioImage } from '../../ts/image';

	import type { Writable } from 'svelte/store';
	
	import { getContext, createEventDispatcher } from 'svelte';

	import Media from '../components/Media.svelte';
	import Article from './Article.svelte';

	export let marker:Models.ImageData.Marker;
	export let destroying:Writable<boolean>;
	export let noEmbed:boolean = false;
	export let noImages:boolean = false;
	export let noGallery:boolean = false;

	export let _content:HTMLElement|null=null;
	export let _title:HTMLElement|null=null;

	const dispatch = createEventDispatcher();

	const micrio = <HTMLMicrioElement>getContext('micrio');
	const lang = micrio._lang;
	const tour = micrio.state.tour;

	const isSerialTour = $tour && 'steps' in $tour && $tour.isSerialTour;

	const markerImages : WeakMap<Models.ImageData.Marker,MicrioImage> = getContext('markerImages');
	const image = markerImages.get(marker) as MicrioImage;
	const settings = image.$settings._markers ?? {};

	const autoplayMedia = !settings.preventAutoPlay;
	const galleryEnabled = !marker.data?.preventImageOpen && !noGallery;
	const singleImage = marker.images?.length == 1;
	const twoImages = marker.images?.length == 2;

	$: content = marker.i18n ? marker.i18n[$lang] : (<unknown>marker as Models.ImageData.MarkerCultureData);

	$: empty = !content?.title && !content?.audio
		&& (!marker.images || !marker.images.length)
		&& !content?.embedUrl
		&& !marker.videoTour
		&& !content?.body && !content?.bodySecondary;

	// In marker tours, optionally auto progress
	const mediaEnded = () : void => { if($tour && 'steps' in $tour && ($tour.isSerialTour || settings.tourAutoProgress)) dispatch('close'); }

	const paused = {
		audio: !autoplayMedia || !marker.audioAutoPlay,
		video: marker.embedAutoPlay === false || (!autoplayMedia || !!(content?.audio && marker.audioAutoPlay))
	}

	const aplayVideo = !paused.video;

	function openGallery(startId:string|undefined) {
		if(!galleryEnabled) return;
		micrio.state.popover.set({gallery: marker.images, galleryStart: startId, image});
	}

	const isDev = image.tileBase?.includes('micrio.dev');

	const getTitle = (image:Models.Assets.Image) => image.i18n?.[$lang]?.title;

	$: audio = marker.videoTour?.i18n?.[$lang]?.audio ?? content?.audio;
	$: audioSrc = audio ? 'fileUrl' in audio ? audio.fileUrl as string : audio.src : undefined;
	$: imageCaption = singleImage && marker.images?.[0]?.i18n?.[$lang]?.description;
</script>

{#if content}<main class:empty bind:this={_content}>
	{#if content.title}<h1 bind:this={_title}>{content.title}</h1>{/if}
	{#if content.body && settings.primaryBodyFirst}<Article>{@html content.body}</Article>{/if}
	{#if !isSerialTour && (((!content || !content.embedUrl) && marker.videoTour) || (content && content.audio))}<Media src={audioSrc} {destroying}
		noPlayOverlay {image} uuid={marker.id} tour={marker.videoTour} autoplay={marker.audioAutoPlay || (!content.audio && !!marker.videoTour)} controls={!marker.videoTour || (!content || !content.embedUrl)}
		on:ended={mediaEnded} bind:paused={paused.audio} />{/if}
	{#if !noImages && marker.images}<section>{#each marker.images as image}
		<button title={getTitle(image)} on:click={galleryEnabled ? () => openGallery(image.micrioId) : undefined}>
			<figure>
				<img alt={getTitle(image)} src={image.micrioId ? `https://iiif.${isDev ? 'micrio.dev' : 'micr.io'}/${image.micrioId}/full/${singleImage ? '^'+Math.min(image.width, 640)+',' : '^,320'}/0/default.webp` : image.src} />
				{#if imageCaption}<figcaption>{imageCaption}</figcaption>{/if}
			</figure>
		</button>
	{/each}</section>{/if}
	{#if content.embedUrl && !noEmbed}
		{#if !content.audio && marker.videoTour}<Media {image} className="hidden" uuid={marker.id} tour={marker.videoTour} autoplay={autoplayMedia} secondary {destroying} />{/if}
		<Media {image} src={content.embedUrl} uuid={marker.id} width={400} height={240} controls title={content.embedTitle} figcaption={content.embedDescription} autoplay={aplayVideo} {destroying}
			on:ended={mediaEnded} bind:paused={paused.video} />
	{/if}
	{#if content.body && !settings.primaryBodyFirst}<Article>{@html content.body}</Article>{/if}
	{#if content.bodySecondary}<Article cn="secondary">{@html content.bodySecondary}</Article>{/if}
</main>{/if}

<style>
	main {
		position: relative;
		padding: var(--micrio-popup-padding);
		padding-bottom: 0;
		overflow-y: auto;
		user-select: text;
		color: var(--micrio-color);
		background: var(--micrio-background);
		backdrop-filter: var(--micrio-background-filter);
		box-shadow: var(--micrio-popup-shadow);
		border-radius: var(--micrio-border-radius);
		box-sizing: border-box;
		text-align: var(--micrio-text-align);
	}

	main > :global(*) {
		--micrio-button-background: none;
		--micrio-background-filter: none;
		--micrio-button-shadow: none;
	}

	main :global(.micrio-progress-bar.container) {
		background: transparent;
		backdrop-filter: none;
	}

	main:global(::-webkit-scrollbar) {
		background-color: transparent;
		width: 10px;
	}

	main:global(::-webkit-scrollbar-thumb) {
		background: var(--micrio-color);
		border-radius: var(--micrio-border-radius);
		margin-top: 10px;
	}

	main.empty {
		width: auto;
	}

	main h1 {
		font-size: 1.5em;
		font-weight: 600;
		margin: 0 0 1.25em 0;
	}

	main > :global(figure.micrio-media) {
		margin: calc(-1 * var(--micrio-popup-padding));
		margin-bottom: 0;
		width: auto;
	}

	main > :global(figure.micrio-media:not(.media-video):not(:last-child) > *:last-child:not(figcaption)) {
		margin-bottom: var(--micrio-popup-padding);
		background: var(--micrio-background);
		padding: 0 var(--micrio-popup-padding);
	}
	main > :global(figure.micrio-media.media-video) {
		margin-bottom: var(--micrio-popup-padding);
	}


	main > :global(figure.micrio-media > div > aside.micrio-media) {
		--micrio-background: transparent;
	}

	main > :global(article:last-child) {
		margin-bottom: var(--micrio-popup-padding);
	}

	main :global(p) {
		white-space: pre-line;
	}

	main :global(figure.hidden) {
		display: none;
	}

	main :global(figure > div.micrio-media > *:first-child) {
		width: 100%;
	}

	button {
		padding: 0;
		margin: 0 calc(-1 * var(--micrio-popup-padding)) var(--micrio-popup-padding) calc(-1 * var(--micrio-popup-padding));
	}

	figcaption {
		padding: 10px;
		font-style: italic;
		font-size: .9em;
		margin-bottom: var(--micrio-popup-padding);
		text-align: center;
	}

	section {
		display: grid;
		grid-template-columns: repeat(3, auto);
		column-gap: 5px;
		row-gap: 5px;
		justify-items: center;
	}
	section button {
		color: inherit;
		border: none;
		display: block;
		width: 100%;
		cursor: pointer;
	}
	section figure {
		padding: 0;
		margin: 0;
	}
	section img {
		width: 100%;
		display: block;
		object-fit: cover;
	}

</style>
