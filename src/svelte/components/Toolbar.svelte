<script lang="ts">
	/**
	 * Toolbar.svelte - Renders the main top toolbar with menus and tour lists.
	 *
	 * This component displays the primary navigation elements, typically at the top
	 * of the Micrio interface. It dynamically generates menu items based on the
	 * current image's data (pages, marker tours, video tours).
	 */

	import type { Models } from '../../types/models';
	import type { HTMLMicrioElement } from '../../ts/element';
	import type { MicrioImage } from '../../ts/image';
	import type { Unsubscriber } from 'svelte/store';

	import { onMount, getContext, tick } from 'svelte';
	import { fade } from 'svelte/transition';

	// Micrio TS imports
	import { createGUID, once } from '../../ts/utils';
	import { i18n } from '../../ts/i18n';

	// UI Components
	import Menu from './Menu.svelte'; // Recursive menu item component
	import Button from '../ui/Button.svelte'; // Used for mobile toggle

	// --- State & Context ---

	/** Reference to the current image's data (reactive). */
	let data: Models.ImageData.ImageData|undefined = $state();

	/** Get the main Micrio element instance from context. */
	const micrio = <HTMLMicrioElement>getContext('micrio');
	/** Destructure needed stores and properties. */
	const { state: micrioState, current, _lang, spaceData } = micrio;
	/** References to global state stores. */
	const { tour, marker, popover } = micrioState;

	/** Controls visibility of the menu on mobile. */
	let shown:boolean=$state(false);
	/** If true, indent the toolbar to accommodate the logo. */
	let indented:boolean=$state(false);
	/** Store the ID of the image this toolbar was initially created for (used for menu actions). */
	const originalId = ($current as MicrioImage).id;

	/** Array to hold the main menu pages defined in the image data. */
	let mainPages:Models.ImageData.Menu[]|undefined = $state();

	/** Flag indicating if the viewport is currently mobile-sized. */
	let isMobile:boolean = $state(window.innerWidth <= 500);
	/** Updates the `isMobile` flag based on window width. */
	const resize = ():boolean => isMobile = window.innerWidth <= 500;

	/** Closes the mobile menu overlay. */
	const close = () => { if(isMobile) shown = false };

	// --- Reactive Declarations (`$:`) ---

	/** Reactive flag to hide the toolbar when a tour, marker, or popover is active. */
	let hidden = $derived(!!$tour || !!$marker || !!$popover);
	/** Combined list of marker tours from image data and space data. */
	let markerTours = $derived((data?.markerTours ?? []).concat(spaceData?.markerTours ?? []));
	/** Does the image have any marker tours? */
	let hasMarkerTours = $derived(markerTours?.length > 0);
	/** Does the image have any video tours? */
	let hasVideoTours = $derived(data?.tours && data?.tours?.length > 0);
	/** Does the image have both marker and video tours? */
	let hasBothTourTypes = $derived(hasMarkerTours && hasVideoTours);

	/** Is the toolbar effectively empty (no pages or tours)? */
	let empty = $derived(!(mainPages?.length || hasMarkerTours || hasVideoTours));

	// --- Lifecycle (onMount) ---

	/** Array to store Svelte store unsubscribers for cleanup. */
	const unsubs:Unsubscriber[] = [];

	/** Helper function to get the language-specific title of a tour. */
	const getTourTitle = (t:Models.ImageData.Tour, lang:string) : string => ('title' in t ? t['title'] as string
		: t.i18n?.[lang]?.title) ?? '(Untitled)'; // Fallback title

	onMount(() => {
		// Subscribe to changes in the current MicrioImage
		const us = micrio.current.subscribe(c => {
			if(!c) return; // Exit if no current image
			// Clear previous subscriptions
			while(unsubs.length) unsubs.shift()?.();
			// Once the image info is loaded, check logo setting for indentation
			once(c.info).then(() => indented = !c.$settings.noLogo);
			// Subscribe to the image's data store
			unsubs.push(c.data.subscribe(d => {
				data = d; // Update local data reference
				// Process menu pages after a tick to ensure data is settled
				tick().then(() => {
					if(!d?.pages) return;
					// If mainPages hasn't been set yet, store the initial pages (excluding internal ones)
					if(!mainPages) mainPages = d.pages?.filter(p => !p.id?.startsWith('_'));
					// Find any image-specific generated menus (e.g., omni layer switcher)
					const imageSpecific = d.pages?.filter(p => p.id?.startsWith('_'));
					// If specific menus exist, merge them with the main pages
					if(imageSpecific.length) mainPages = [
						...(mainPages?.filter(p => !p.id?.startsWith('_')) ?? []), // Keep original main pages
						...imageSpecific // Add image-specific pages
					];
				});

			}));
		});

		// Add resize listener
		window.addEventListener('resize', resize);
		// Cleanup function
		return () => {
			window.removeEventListener('resize', resize); // Remove resize listener
			while(unsubs.length) unsubs.shift()?.(); // Unsubscribe from stores
			us(); // Unsubscribe from current image store
		}
	});
</script>

<!-- Render toolbar only if not empty and not hidden -->
{#if !empty && !hidden}
	<!-- Control mobile visibility -->
	<!-- Apply indentation for logo -->
	<menu
		class:shown={!hidden && shown}
		class:indent={indented}
		class="micrio-toolbar"
		transition:fade={{duration: 200}}
	>
		<!-- Render main menu pages -->
		{#if mainPages}
			{#each mainPages as menu (menu.id)}
				<Menu {menu} {originalId} onclose={close} />
			{/each}
		{/if}
		<!-- Render Marker Tours menu (if any) -->
		{#if hasMarkerTours}
			<Menu onclose={close} menu={{
				id: createGUID(),
				i18n: {[$_lang]: {title: hasBothTourTypes ? 'Marker tours' : 'Tours'}}, // Dynamic title
				children: markerTours.map((t) => ({ // Create child items for each tour
					id: createGUID(),
					i18n: {[$_lang]: {title: getTourTitle(t,$_lang)}},
					action:()=>{ // Action starts the tour
						t.initialStep = 0; // Start from the beginning
						tour.set(t);
					}
				}))
			}}/>
		{/if}
		<!-- Render Video Tours menu (if any) -->
		{#if hasVideoTours}
			<Menu onclose={close} menu={{
				id: createGUID(),
				i18n: {[$_lang]: {title: hasBothTourTypes ? 'Video tours' : 'Tours'}}, // Dynamic title
				children: !data || !data.tours ? [] : data.tours.map((t) => ({ // Create child items
					id: createGUID(),
					i18n: {[$_lang]: {title: getTourTitle(t,$_lang)}},
					action:()=>{ // Action starts the tour
						// Switch back to original image if necessary
						if($current && $current.id != originalId) micrio.open(originalId);
						tour.set(t);
					}
				}))
			}}/>
		{/if}
	</menu>
	<!-- Mobile menu toggle button -->
	{#if isMobile}
		<!-- Change icon based on state -->
		<!-- Toggle mobile menu visibility -->
		<Button
			title={$i18n.menuToggle}
			type={shown ? 'close' : 'ellipsis-vertical'}
			className={'toggle transparent' + (indented ? ' indent' : '')}
			onclick={() => shown=!shown}
		/>
	{/if}
{/if}

<style>
	menu {
		/* Basic toolbar styling */
		position: absolute;
		top: calc(var(--micrio-border-margin) - (var(--micrio-button-size) / 2 - 27px)); /* Adjust vertical position slightly */
		left: var(--micrio-border-margin);
		margin: 0;
		padding: 0;
		color: #fff; /* Default text color */
		text-shadow: 1px 1px 2px #000; /* Text shadow for readability */
		transition: transform .25s ease; /* Transition for mobile slide-in/out */
		z-index: 1; /* Ensure above canvas */
	}

	/* Mobile styles */
	@media (max-width: 500px) {
		/* Mobile toggle button positioning */
		:global(.micrio-button.toggle) {
			position: absolute;
			top: var(--micrio-border-margin);
			left: 0;
			height: 34px; /* Smaller size */
			width: 34px;
			box-shadow: none; /* Remove shadow */
			z-index: 2; /* Above menu overlay */
		}
		/* Indent toggle button if logo is present */
		:global(.micrio-button.toggle.indent) {
			left: 35px;
		}
		/* Mobile menu overlay styling */
		menu {
			transform: translate3d(0,0,0);
			width: 100%;
			height: 100%;
			background: rgba(0,0,0,0.75); /* Semi-transparent background */
			top: 0;
			left: 0;
			padding: 32px 0; /* Vertical padding */
			overflow-y: auto; /* Allow scrolling */
			overflow-x: hidden;
			box-sizing: border-box;
			backdrop-filter: var(--micrio-background-filter);
			z-index: 1;
		}
		/* Hide menu off-screen when closed */
		menu:not(.shown) {
			transform: translate3d(calc(-100% - var(--micrio-border-margin) * 2), 0, 0);
		}
	}

	/* Desktop styles */
	@media (min-width: 501px) {
		/* Indent toolbar if logo is present */
		menu.indent {
			margin-left: calc(var(--micrio-border-margin) * 2 + 25px);
		}
		/* Slight visual adjustment for non-hovered top-level menu items */
		menu > :global(.micrio-menu:not(:hover) > button.micrio-menu) {
			margin-bottom: -15px; /* Pulls dropdown slightly closer? */
		}
	}

</style>
