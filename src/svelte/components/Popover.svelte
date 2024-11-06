<script lang="ts">
	import type { HTMLMicrioElement } from '../../ts/element';
	import type { Models } from '../../types/models';

	import { getContext, onMount, tick } from 'svelte';
	import { writable } from 'svelte/store';
	import { languageNames } from '../../ts/langs';
	import { i18n } from '../../ts/i18n';

	import Button from '../ui/Button.svelte';
	import Media from './Media.svelte';
	import Article from '../common/Article.svelte';
	import MarkerContent from '../common/MarkerContent.svelte';
	import Gallery from './MicrioGallery.svelte';

	export let popover:Models.State.PopoverType;

	const micrio = <HTMLMicrioElement>getContext('micrio');
	const { events, state, current, _lang } = micrio;

	const data = $current?.$data;
	const langs  = Object.keys(data?.revision ?? [])

	function click(e:MouseEvent) {
		if((e.target as HTMLElement)?.tagName == 'A') return;
		e.stopPropagation();
		e.preventDefault();
	}

	function close() {
		_dialog.close();
	}

	function closed(){
		if(popover.contentPage) events.dispatch('page-closed');
		else {
			if(tour) state.tour.set(undefined);
			else if(popover.marker) popover.image?.state.marker.set(undefined);
		}
		state.popover.set(undefined);
	}

	function clickPageButton(button:Models.ImageData.MenuPageButton) {
		close();
		if(button.type != 'close') setTimeout(() => {
			switch(button.type) {
				case 'marker':
					$current?.state.marker.set(button.action);
				break;
				case 'mtour':
					micrio.state.tour.set(data?.markerTours?.find(t => t.id == button.action));
				break;
				case 'vtour':
					micrio.state.tour.set(data?.tours?.find(t => t.id == button.action));
				break;
			}
		}, 200);
	}

	// Stop any media play on fading out
	const destroying = writable<boolean>(false);

	// Due to a chrome bug triggering STATUS_ACCESS_VIOLATION -- delay showing embed when switching langs
	let showEmbed:boolean = true;
	let currLang = $_lang;

	let _dialog:HTMLDialogElement;
	onMount(() => {
		_dialog.showModal();
		tick().then(() => {
			const button:HTMLElement|null = _dialog.querySelector('button.active') ?? _dialog.querySelector('button');
			button?.focus()
		});
		return _lang.subscribe(l => { if(l && l != currLang) {
			showEmbed = false;
			currLang = l;
			setTimeout(() => showEmbed = true, 200);
		}});
	});


	$: marker = popover.marker;
	$: content = marker ? (marker.i18n ? marker.i18n[$_lang] : (<unknown>marker as Models.ImageData.MarkerCultureData)) : undefined;
	$: tour = popover.markerTour;
	$: page = popover.contentPage;
	$: pageContent = page ? page.i18n?.[$_lang] ?? (<unknown>page as Models.ImageData.MenuCultureData) : undefined;
	$: pageIsVideo = page && pageContent && !page?.buttons?.length ? !!(pageContent.embed && (!pageContent.content || pageContent.content.length < 250) && !page.image) : undefined;
	$: pageContentImage = page?.image ? typeof page.image == 'string' ? page.image : page.image.src : undefined;
	$: pageHasVideoOrImage = !!pageContent?.embed || !!pageContentImage;
	$: noCloseButton = !!page?.buttons?.find(b => b.type == 'close');
	$: hasImages = !!popover.marker?.images && popover.marker.images.length > 0;
	$: hasContent = (content && content.body) || hasImages;
	$: hasPopoverContent = (content && content.body) || (hasImages && pageContent?.embed);
	$: hasAside = !noCloseButton || tour && tour.currentStep != undefined;
</script>

<dialog bind:this={_dialog}
	on:close={closed}
	on:outrostart={() => destroying.set(true)}
	class:page={!!page} class:article={!!page && !pageIsVideo} class:has-media={pageHasVideoOrImage}>
	{#if hasAside}<aside class:inside={!hasContent}>
		{#if !noCloseButton}
			<Button type="close" title={$i18n.close} className="close-popover" on:click={close} />
		{/if}
		{#if tour && tour.currentStep != undefined}
			{#if tour.currentStep > 0}<Button type="arrow-left" title={$i18n.tourStepPrev} className="prev-tour-step" on:click={() => tour && tour.prev && tour.prev()} />{/if}
			{#if tour.currentStep < tour.steps.length-1}<Button type="arrow-right" title={$i18n.tourStepNext} className="next-tour-step" on:click={() => tour && tour.next && tour.next()} />{/if}
		{/if}
	</aside>{/if}
	{#if marker}
		{#if content && content.embedUrl}
			<Media src={content ? content.embedUrl : undefined} uuid={marker.id} figcaption={content ? content.embedDescription : undefined} controls autoplay={marker.embedAutoPlay} {destroying} />
		{:else if marker.images && marker.images.length}
			<Gallery gallery={marker.images} />
		{/if}
		{#if hasPopoverContent}<MarkerContent {marker} {destroying} noEmbed noGallery noImages={!content || !content.embedUrl} />{/if}
	{:else if popover.gallery}
		<Gallery gallery={popover.gallery} startId={popover.galleryStart} />
	{:else if page && pageContent}
		{#if langs.length > 1}<menu>{#each langs as l}
			<Button on:click={() => micrio.lang = l} title={languageNames?.of(l) ?? l} active={l==$_lang}>{l.toUpperCase()}</Button>
		{/each}</menu>{/if}
		{#if pageIsVideo}
			{#if showEmbed}<Media src={pageContent.embed} figcaption={pageContent.content} controls autoplay {destroying} />{/if}
		{:else}
			<Article>
				{#if pageContent.title}<h2>{pageContent.title}</h2>{/if}
				{#if pageContent.embed && showEmbed}<Media src={pageContent.embed} controls />{/if}
				{#if pageContentImage}<img src={pageContentImage} alt="" />{/if}
				{#if pageContent.content}{@html pageContent.content}{/if}
			</Article>
		{/if}
		{#if page.buttons && page.buttons.length}
			<menu class="right">{#each page.buttons as button}
				<Button href={button.type == 'link' ? button.action : undefined}
					blankTarget={button.blankTarget}
					on:click={() => clickPageButton(button)}>{button.i18nTitle[$_lang]}</Button>
			{/each}</menu>
		{/if}
	{/if}
</dialog>

<style>
	dialog::backdrop {
		color: #fff;
		animation: fadeInBg .2s forwards;
		backdrop-filter: blur(8px);
	}
	@keyframes fadeInBg {
		from {
			background: #0000;
		}
		to {
			background: var(--micrio-popover-background);
		}
	}
	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	dialog {
		animation: fadeIn .5s forwards;
		background: transparent;
		border: none;
		overflow: visible;
		padding: 0;
		pointer-events: all;
	}
	dialog :global(div.micrio-media > *:first-child) {
		border-radius: var(--micrio-border-radius);
		overflow: hidden;
	}
	dialog :global(div.micrio-media > aside) {
		--micrio-background: none;
		--micrio-button-background: none;
	}

	dialog.page.article :global(figure.media-video iframe) {
		width: 100%;
	}

	aside {
		--micrio-background-filter: none;
		position: absolute;
		z-index: 1;
	}

	dialog:not(.article)  {
		display: flex;
	}

	dialog:not(.article) :global(figure > div.micrio-media) {
		height: 100%;
	}

	@media (min-width: 640px) {
		aside {
			display: block;
			left: 100%;
			margin-left: var(--micrio-border-margin);
			top: 0;
		}
		aside.inside {
			right: 0;
			left: auto;
		}
		aside:not(.inside) {
			z-index: 2;
			position: absolute;
			top: 0;
			left: 100%;
			z-index: 2;
		}
		aside > :global(.micrio-button) {
			padding: 0;
			margin: 0 0 8px 0;
			display: block;
		}

		dialog:not(.article)  {
			width: calc(85vw - 56px);
			height: calc(9 / 16 * 85vw);
			width: calc(85cqw - 56px);
			height: calc(9 / 16 * 85cqw);
		}

		dialog > :global(main) {
			width: 25vw;
			width: 25cqw;
			min-width: unset;
			max-width: 320px;
		}

		dialog > :global(main > h3) {
			margin-right: 55px;
		}
	}
	@media (max-width: 640px) {
		aside {
			position: fixed;
			top: var(--micrio-border-margin);
			right: var(--micrio-border-margin);
		}
		aside :global(.micrio-button) {
			display: inline-block !important;
			border-radius: var(--micrio-border-radius) !important;
			height: var(--micrio-button-size);
			box-shadow: var(--micrio-button-shadow);
			padding: 0 !important;
			margin-bottom: 8px;
		}

		dialog:not(.article)  {
			width: 100%;
			height: 100%;
			flex-direction: column;
		}

		dialog:not(.article) :global(figure.micrio-media) {
			flex: 1;
		}
	}

	dialog > :global(figure) {
		flex: 1;
		position: relative;
		margin: 0;
	}

	dialog > :global(figure > figcaption) {
		position: absolute;
		width: 100%;
		bottom: 100%;
		font-style: italic;
		text-align: center;
		font-size: 90%;
		padding: 16px 0;
		padding: 0;
		margin: var(--micrio-border-margin);
		color: var(--micrio-color);
	}

	dialog > :global(figure > div.micrio-media > *:first-child) {
		width: 100%;
		height: calc(100% - var(--micrio-button-size));
	}
	dialog > :global(figure > div.micrio-media > micr-io) {
		height: 100% !important;
	}

	@media (min-aspect-ratio: 16/9) {
		dialog:not(.article) {
			height: 75vh;
			width: calc(16 / 9 * 75vh);
			height: 75cqh;
			width: calc(16 / 9 * 75cqh);
		}
	}

	@media (max-width: 640px) {
		dialog :global(div.micrio-media > *:first-child) {
			border-radius: none;
		}
		dialog:not(.article) > :global(*:first-child) {
			height: 50vh;
			height: 50cqh;
			flex-direction: column;
			justify-content: center;
		}

		dialog:not(.article) > :global(figure:first-child) {
			flex: none;
			display: flex;
			flex-direction: column;
		}
	}

	/** Articles */
	dialog.article > :global(article) {
		text-shadow: none;
		color: var(--micrio-color);
		background: var(--micrio-background);
		padding: 20px;
		box-sizing: border-box;
		max-height: calc(90cqh - 48px);
		max-height: calc(90vh - 48px);
		overflow-x: hidden;
		overflow-y: auto;
	}

	@media (min-width: 640px) {
		dialog.article {
			width: 540px;
		}
	}

	dialog.article h2 {
		text-align: center;
	}
	dialog.article :global(article img) {
		width: 100%;
	}

	/** Custom page buttons */
	menu {
		margin: 10px 0;
		padding: 0;
	}
	menu > :global(.micrio-button) {
		margin-right: 10px;
	}
	menu.right {
		text-align: right;
	}
	menu.right > :global(.micrio-button) {
		margin: 0 0 0 10px;
	}

</style>
