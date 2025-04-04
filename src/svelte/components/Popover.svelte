<script lang="ts">
	/**
	 * Popover.svelte - Renders a modal dialog for various content types.
	 *
	 * This component displays content in a modal dialog (<dialog> element).
	 * It can render:
	 * - Marker content (using MarkerContent) when `popover.marker` is set.
	 * - An image gallery (using MicrioGallery) when `popover.gallery` is set.
	 * - Custom page content (HTML, embeds) when `popover.contentPage` is set.
	 *
	 * It handles opening/closing the dialog, managing focus, and providing
	 * controls like close, tour navigation (if applicable), and language switching.
	 */

	import type { HTMLMicrioElement } from '../../ts/element';
    import type { Models } from '../../types/models';

	import { getContext, onMount, tick } from 'svelte';
	import { languageNames } from '../../ts/langs'; // For language names in switcher
	import { i18n } from '../../ts/i18n'; // For button titles

	// UI Components
	import Button from '../ui/Button.svelte';
	import Media from './Media.svelte';
	import Article from '../common/Article.svelte';
	import MarkerContent from '../common/MarkerContent.svelte';
	import Gallery from './MicrioGallery.svelte';
    import { writable } from 'svelte/store';

	// --- Props ---
	interface Props {
		/** The data object defining the content and type of the popover. */
		popover: Models.State.PopoverType;
	}

	let { popover }: Props = $props();

	// --- Context & State ---

	/** Get the main Micrio element instance from context. */
	const micrio = $state(<HTMLMicrioElement>getContext('micrio'));
	/** Destructure needed stores and properties. */
	const { events, state: micrioState, current, _lang } = micrio;

	/** Get data for the currently active image (used for language list). */
	const data = $current?.$data;
	/** List of available languages based on the current image's revision data. */
	const langs = Object.keys(data?.revision ?? {[$_lang]:0}); // Default to current lang if no revisions

	// --- Event Handlers & Functions ---

	/** Closes the dialog programmatically. */
	function close() {
		_dialog?.close(); // Use the native <dialog> close method
	}

	/** Handler for the native 'close' event of the <dialog> element. */
	function closed(){
		// Dispatch events based on the type of content that was shown
		if(popover.contentPage) events.dispatch('page-closed');
		else {
			// If closing a marker popover that was part of a tour, stop the tour
			if(tour) micrioState.tour.set(undefined);
			// Otherwise, if it was a marker popover, clear the active marker state
			else if(popover.marker) popover.image?.state.marker.set(undefined);
		}
		// Clear the global popover state to remove the component
		micrioState.popover.set(undefined);
	}

	/** Handles clicks on buttons defined within a content page. */
	function clickPageButton(button:Models.ImageData.MenuPageButton) {
		close(); // Close the popover first
		if(button.type != 'close') { // If it's not just a close button
			// Delay action slightly to allow popover to close
			setTimeout(() => {
				switch(button.type) {
					case 'marker':
						$current?.state.marker.set(button.action); // Open marker
						break;
					case 'mtour': // Marker Tour
						micrio.state.tour.set(data?.markerTours?.find(t => t.id == button.action)); // Start marker tour
						break;
					case 'vtour': // Video Tour
						micrio.state.tour.set(data?.tours?.find(t => t.id == button.action)); // Start video tour
						break;
					// 'link' type is handled by the <a> tag directly
				}
			}, 200);
		}
	}

	// --- Media Cleanup ---

	/** Writable store passed to MarkerContent/Media to signal when the popover is closing. */
	const destroying = writable<boolean>(false);

	// --- Language Switch Workaround ---

	/** Flag to temporarily hide embeds during language switch to prevent Chrome crash. */
	let showEmbed:boolean = $state(true);
	/** Stores the current language to detect changes. */
	let currLang = $_lang;

	// --- Lifecycle (onMount) ---

	/** Reference to the <dialog> DOM element. */
	let _dialog:HTMLDialogElement|undefined = $state();
	onMount(() => {
		_dialog!.showModal(); // Open the dialog modally
		// Focus the first active button after the dialog opens
		tick().then(() => {
			const button:HTMLElement|null = _dialog!.querySelector('button.active') ?? _dialog!.querySelector('button');
			button?.focus();
		});

		// Workaround for Chrome bug: Hide embeds briefly when language changes
		const langUnsub = _lang.subscribe(l => {
			if(l && l != currLang) { // If language changed
				showEmbed = false; // Hide embed
				currLang = l;
				setTimeout(() => showEmbed = true, 200); // Show embed again after delay
			}
		});

		// Cleanup function
		return () => {
			langUnsub(); // Unsubscribe from language store
		}
	});

	// --- Reactive Declarations (`$:`) ---

	/** Reactive reference to the marker data from the popover prop. */
	let marker = $derived(popover.marker);
	/** Reactive language-specific content for the marker. */
	let content = $derived(marker ? (marker.i18n ? marker.i18n[$_lang] : (marker as unknown as Models.ImageData.MarkerCultureData)) : undefined);
	/** Reactive reference to the marker tour associated with the popover. */
	let tour = $derived(popover.markerTour);
	/** Reactive reference to the content page data from the popover prop. */
	let page = $derived(popover.contentPage);
	/** Reactive language-specific content for the page. */
	let pageContent = $derived(page ? page.i18n?.[$_lang] ?? (page as unknown as Models.ImageData.MenuCultureData) : undefined);
	/** Determine if the page content is primarily a video embed. */
	let pageIsVideo = $derived(page && pageContent && !page?.buttons?.length ? !!(pageContent.embed && (!pageContent.content || pageContent.content.length < 250) && !page.image) : undefined);
	/** Get the image source URL for the page content. */
	let pageContentImage = $derived(page?.image ? typeof page.image == 'string' ? page.image : page.image.src : undefined);
	/** Flag indicating if the page has a video embed or an image. */
	let pageHasVideoOrImage = $derived(!!pageContent?.embed || !!pageContentImage);
	/** Flag indicating if the page defines its own close button. */
	let noCloseButton = $derived(!!page?.buttons?.find(b => b.type == 'close'));
	/** Flag indicating if the marker has associated images. */
	let hasImages = $derived(!!popover.marker?.images && popover.marker.images.length > 0);
	/** Flag indicating if the marker has body content or images. */
	let hasContent = $derived(!!(content && content.body) || hasImages);
	/** Flag indicating if the marker has body content OR (images AND an embed). Used for layout? */
	let hasPopoverContent = $derived((content && content.body) || (hasImages && pageContent?.embed));
	/** Flag indicating if the aside controls (close, tour nav) should be shown. */
	let hasAside = $derived(!noCloseButton || (tour && tour.currentStep != undefined));

</script>

<!-- The dialog element -->
<!-- Handle native close event (e.g., ESC key) -->
<!-- Signal start of closing animation -->
<!-- Prevent clicks inside from closing -->
<!-- Add class if displaying a page -->
<!-- Add class if page is article-like -->
<!-- Add class if page has media -->
<dialog bind:this={_dialog}
	onclose={closed}
	onoutrostart={() => destroying.set(true)}
	class:page={!!page}
	class:article={!!page && !pageIsVideo}
	class:has-media={pageHasVideoOrImage}
>
	<!-- Aside for controls (close, tour nav) -->
	{#if hasAside}
		<!-- Position inside if no main content -->
		<aside class:inside={page ? !pageIsVideo : !hasContent && !content?.embedUrl}>
			{#if !noCloseButton}
				<!-- Standard close button -->
				<Button type="close" title={$i18n.close} className="close-popover" onclick={close} />
			{/if}
			<!-- Tour navigation buttons -->
			{#if tour && tour.currentStep != undefined}
				{#if tour.currentStep > 0}
					<Button type="arrow-left" title={$i18n.tourStepPrev} className="prev-tour-step" onclick={() => tour && tour.prev && tour.prev()} />
				{/if}
				{#if tour.currentStep < tour.steps.length-1}
					<Button type="arrow-right" title={$i18n.tourStepNext} className="next-tour-step" onclick={() => tour && tour.next && tour.next()} />
				{/if}
			{/if}
		</aside>
	{/if}

	<!-- Render content based on popover type -->
	{#if marker}
		<!-- Marker Content -->
		{#if content && content.embedUrl}
			<!-- Render embed directly if present -->
			<Media src={content.embedUrl} uuid={marker.id} figcaption={content.embedDescription} controls autoplay={marker.embedAutoPlay} />
		{:else if marker.images && marker.images.length}
			<!-- Render gallery if images are present -->
			<Gallery gallery={marker.images} />
		{/if}
		<!-- Render MarkerContent if there's body text OR (images AND an embed) -->
		{#if hasPopoverContent}
			<MarkerContent {marker} noEmbed noGallery noImages={!content || !content.embedUrl} onclose={close} />
		{/if}
	{:else if popover.gallery}
		<!-- Gallery Content -->
		<Gallery gallery={popover.gallery} startId={popover.galleryStart} />
	{:else if page && pageContent}
		<!-- Page Content -->
		{#if langs.length > 1}
			<!-- Language switcher for pages -->
			<menu>{#each langs as l}
				<Button onclick={() => micrio.lang = l} title={languageNames?.of(l) ?? l} active={l==$_lang}>{l.toUpperCase()}</Button>
			{/each}</menu>
		{/if}
		{#if pageIsVideo}
			<!-- Render as full video if pageIsVideo is true -->
			{#if showEmbed}<Media src={pageContent.embed} figcaption={pageContent.content} controls autoplay />{/if}
		{:else}
			<!-- Render as article content -->
			<Article>
				{#if pageContent.title}<h2>{pageContent.title}</h2>{/if}
				{#if pageContent.embed && showEmbed}<Media src={pageContent.embed} controls />{/if}
				{#if pageContentImage}<img src={pageContentImage} alt="" />{/if}
				{#if pageContent.content}{@html pageContent.content}{/if}
			</Article>
		{/if}
		<!-- Render page buttons if defined -->
		{#if page.buttons && page.buttons.length}
			<menu class="right">{#each page.buttons as button}
				<Button
					href={button.type == 'link' ? button.action : undefined}
					blankTarget={button.blankTarget}
					onclick={() => clickPageButton(button)}
				>
					{button.i18nTitle[$_lang]}
				</Button>
			{/each}</menu>
		{/if}
	{/if}
</dialog>

<style>
	/* Styling for the dialog backdrop */
	dialog::backdrop {
		color: #fff;
		animation: fadeInBg .2s forwards;
		backdrop-filter: blur(8px);
	}
	@keyframes fadeInBg {
		from { background: #0000; }
		to { background: var(--micrio-popover-background); }
	}
	/* Fade-in animation for the dialog itself */
	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}
	dialog {
		animation: fadeIn .5s forwards;
		background: transparent; /* Dialog itself is transparent, backdrop provides background */
		border: none;
		overflow: visible; /* Allow controls outside the dialog bounds */
		padding: 0;
		pointer-events: all; /* Enable interaction */
		max-width: 90vw; /* Limit width */
		max-height: 90vh; /* Limit height */
		max-width: 90cqw; /* Use container query units */
		max-height: 90cqh;
	}
	/* Ensure media elements within the dialog have rounded corners */
	dialog :global(div.micrio-media > *:first-child) {
		border-radius: var(--micrio-border-radius);
		overflow: hidden;
	}
	/* Remove background from media controls inside the dialog */
	dialog :global(div.micrio-media > aside) {
		--micrio-background: none;
		--micrio-button-background: none;
	}

	/* Ensure iframe fills width in article-style pages */
	dialog.page.article :global(figure.media-video iframe) {
		width: 100%;
	}

	/* Positioning for the controls aside */
	aside {
		--micrio-background-filter: none; /* Remove filter from controls */
		position: absolute;
		z-index: 1; /* Above dialog content */
	}

	/* Flex layout for non-article popovers (gallery, marker with media) */
	dialog:not(.article)  {
		display: flex;
	}

	/* Ensure media container fills height in non-article popovers */
	dialog:not(.article) :global(figure > div.micrio-media) {
		height: 100%;
	}

	/* Desktop layout */
	@media (min-width: 640px) { /* Increased breakpoint */
		aside {
			display: block;
			left: 100%; /* Position to the right */
			margin-left: var(--micrio-border-margin);
			top: 0;
		}
		/* Position controls inside if no main content */
		aside.inside {
			right: 0;
			left: auto;
			top: 0; /* Keep at top right */
			margin-left: 0;
			margin-right: var(--micrio-border-margin);
		}
		/* Ensure absolute positioning for external controls */
		aside:not(.inside) {
			z-index: 2; /* Above potential overlapping elements */
			position: absolute;
			top: 0;
			left: 100%;
		}
		/* Vertical spacing for buttons in aside */
		aside > :global(.micrio-button) {
			padding: 0;
			margin: 0 0 8px 0;
			display: block;
		}

		/* Default size for non-article popovers */
		dialog:not(.article)  {
			width: calc(85vw - 56px); /* Responsive width */
			height: calc(9 / 16 * 85vw); /* 16:9 aspect ratio */
			width: calc(85cqw - 56px);
			height: calc(9 / 16 * 85cqw);
		}

		/* Styling for marker content within popover */
		dialog > :global(main) {
			width: 25vw; /* Fixed width for marker content */
			width: 25cqw;
			min-width: unset;
			max-width: 320px;
		}

		/* Add margin for close button */
		dialog > :global(main > h1) { /* Corrected selector */
			margin-right: 55px;
		}
	}
	/* Mobile layout */
	@media (max-width: 639px) { /* Adjusted breakpoint */
		aside {
			position: fixed; /* Fixed position relative to viewport */
			top: var(--micrio-border-margin);
			right: var(--micrio-border-margin);
		}
		/* Style buttons in mobile aside */
		aside :global(.micrio-button) {
			display: inline-block !important; /* Arrange horizontally */
			border-radius: var(--micrio-border-radius) !important;
			height: var(--micrio-button-size);
			box-shadow: var(--micrio-button-shadow);
			padding: 0 !important;
			margin-left: 8px; /* Spacing between buttons */
		}

		/* Fullscreen dialog on mobile */
		dialog:not(.article)  {
			width: 100%;
			height: 100%;
			flex-direction: column; /* Stack content vertically */
		}

		/* Media container takes remaining space */
		dialog:not(.article) :global(figure.micrio-media) {
			flex: 1;
		}
	}

	/* Styling for the main figure element */
	dialog > :global(figure) {
		flex: 1; /* Allow figure to grow */
		position: relative;
		margin: 0;
	}

	/* Styling for figcaption */
	dialog > :global(figure > figcaption) {
		position: absolute;
		width: 100%;
		bottom: 100%; /* Position above the figure */
		font-style: italic;
		text-align: center;
		font-size: 90%;
		padding: 0; /* Remove padding */
		margin: var(--micrio-border-margin);
		color: var(--micrio-color);
	}

	/* Ensure media element fills its container, leaving space for controls */
	dialog > :global(figure > div.micrio-media > *:first-child) {
		width: 100%;
		height: calc(100% - var(--micrio-button-size)); /* Adjust height */
	}
	/* Ensure embedded Micrio instance fills height */
	dialog > :global(figure > div.micrio-media > micr-io) {
		height: 100% !important;
	}

	/* Aspect ratio adjustments for desktop */
	@media (min-aspect-ratio: 16/9) {
		dialog:not(.article) {
			height: 75vh; /* Limit height based on viewport */
			width: calc(16 / 9 * 75vh); /* Calculate width based on height */
			height: 75cqh;
			width: calc(16 / 9 * 75cqh);
		}
	}

	/* Mobile layout adjustments for non-article popovers */
	@media (max-width: 639px) {
		/* Remove border radius from media element */
		dialog :global(div.micrio-media > *:first-child) {
			border-radius: 0; /* Use square corners */
		}
		/* Adjust height and layout for media container */
		dialog:not(.article) > :global(*:first-child) {
			height: 50vh; /* Use half the viewport height */
			height: 50cqh;
			flex-direction: column;
			justify-content: center;
		}

		/* Ensure figure takes appropriate space */
		dialog:not(.article) > :global(figure:first-child) {
			flex: none;
			display: flex;
			flex-direction: column;
		}
	}

	/** Article page styling */
	dialog.article > :global(article) {
		text-shadow: none;
		color: var(--micrio-color);
		background: var(--micrio-background);
		padding: 20px;
		box-sizing: border-box;
		max-height: calc(90cqh - 48px); /* Limit height */
		max-height: calc(90vh - 48px);
		overflow-x: hidden;
		overflow-y: auto; /* Allow vertical scrolling */
		border-radius: var(--micrio-border-radius); /* Add radius */
	}

	/* Desktop width for article pages */
	@media (min-width: 640px) {
		dialog.article {
			width: 540px;
		}
	}

	/* Article content styling */
	dialog.article h2 {
		text-align: center;
	}
	dialog.article :global(article img) {
		width: 100%; /* Make images responsive */
		height: auto; /* Maintain aspect ratio */
	}

	/** Custom page buttons styling */
	menu {
		margin: 10px 0;
		padding: 0;
		list-style: none; /* Remove list styling */
	}
	menu > :global(.micrio-button) {
		margin-right: 10px; /* Spacing between buttons */
	}
	menu.right {
		text-align: right; /* Align buttons to the right */
	}
	menu.right > :global(.micrio-button) {
		margin: 0 0 0 10px; /* Adjust margin for right alignment */
	}

</style>
