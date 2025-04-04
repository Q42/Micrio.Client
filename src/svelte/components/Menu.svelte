<script module lang="ts">
	/**
	 * Module script for Menu.svelte
	 *
	 * Manages the global state for which menu item (if any) is currently open.
	 * Uses a single writable store (`opened`) to track the open menu item.
	 * Adds a global click listener to close the menu when clicking outside.
	 */
	import { writable } from 'svelte/store';
	import type { Models } from '../../types/models'; // Import Models type

	/** Writable store holding the currently opened menu item data, or undefined if none is open. */
	const opened = writable<Models.ImageData.Menu|undefined>(undefined);
	/** Function to close any currently open menu. */
	const close = () : void => opened.set(undefined);
	/** Flag to track if the global click listener is currently active. */
	let hooked:boolean = false;

	// Subscribe to the `opened` store to manage the global click listener.
	opened.subscribe(c => {
		if(c) { // If a menu item is opened
			if (!hooked) window.addEventListener('click', close); // Add listener if not already hooked
		} else { // If no menu item is open
			if (hooked) window.removeEventListener('click', close); // Remove listener if hooked
		}
		hooked = !!c; // Update hooked state
	});
</script>

<script lang="ts">
	/**
	 * Menu.svelte - Renders a single menu item and its potential children recursively.
	 *
	 * This component displays a button or link for a menu item. If the item has children,
	 * it renders them recursively within a dropdown/sub-menu structure. It handles
	 * click events to trigger actions (marker open, page open, external link) or
	 * toggle the visibility of child items.
	 */

	import type { HTMLMicrioElement } from '../../ts/element';

	import { getContext, onMount } from 'svelte';

	// UI Components
	import Menu from './Menu.svelte';
	import Icon from '../ui/Icon.svelte';
	import Fa from 'svelte-fa'; // Font Awesome icon component

	// --- Props ---

	interface Props {
		/** The data object for this menu item. */
		menu: Models.ImageData.Menu;
		/**
	 * The ID of the original image this menu belongs to.
	 * Used for actions that need to switch back to the original image (e.g., opening a marker).
	 */
		originalId?: string|null;
		onclose?: Function;
	}

	let { menu = $bindable(), originalId = null, onclose }: Props = $props();

	// --- Setup ---

	/** Get Micrio instance and relevant stores/properties from context. */
	const micrio = <HTMLMicrioElement>getContext('micrio');
	const { events, state: micrioState, _lang } = micrio;

	/** Reference to the button/link element for this menu item. */
	let _button:HTMLButtonElement|HTMLAnchorElement|undefined = $state();

	// --- Helper Functions ---

	/** Gets the language-specific culture data for a menu item. */
	const getCData = (m:Models.ImageData.Menu, lang:string) : Models.ImageData.MenuCultureData|undefined =>
		m.i18n?.[lang] ?? (m as unknown as Models.ImageData.MenuCultureData); // Fallback for older data structure

	// --- Reactive Declarations (`$:`) ---

	/** Reactive language-specific content for this menu item. */
	let cultureData = $derived(getCData(menu, $_lang));

	// --- Event Handlers ---

	/** Handles click events on the menu item's button or link. */
	function click(e:MouseEvent){
		if(!menu.link) e.preventDefault(); // Prevent default if it's not a standard link
		if(menu.action) menu.action(); // Execute custom action if defined

		// Determine if clicking should close the menu system
		const doClose = !!(isOpen || menu.action || menu.link); // Close if already open, has action, or is a link
		opened.set(doClose ? undefined : menu); // Set this menu as opened, or close all if doClose is true
		if(doClose) onclose?.(); // Dispatch close event for potential parent handling
	}

	// --- Lifecycle (onMount) ---

	onMount(() => {
		// Optimization: If a menu item has no title and only one child, replace it directly with the child.
		if(!cultureData?.title && menu.children?.length == 1) menu = menu.children[0];

		// Define default actions if not explicitly set
		if(!menu.action) {
			if(menu.markerId) { // If markerId is set, action opens the marker
				menu.action = () => {
					// If the marker belongs to a different image, switch back first
					if(originalId && micrio.$current?.id != originalId)
						micrio.open(originalId);
					// Set the active marker on the (potentially switched) current image
					micrio.$current?.state.marker.set(menu.markerId);
				}
			} else if(cultureData?.content || cultureData?.embed || menu.image) { // If content/embed/image exists, action opens the popover
				menu.action = () => {
					events.dispatch('page-open', menu); // Dispatch page-open event
					micrioState.popover.set({contentPage:menu}); // Set global popover state
				}
			}
		}

		// Store reference to the button element on the menu data object (used internally?)
		menu._button = _button as HTMLButtonElement; // Cast needed as _button could be anchor
	});

	// --- Reactive State for Open/Closed ---

	/** Recursively checks if this menu or any of its children are the currently opened menu. */
	const o=(m:Models.ImageData.Menu):boolean=>m==$opened||!!m.children?.some(o);
	/** Reactive flag indicating if this menu item or one of its descendants is currently open. */
	let isOpen = $derived($opened && o(menu));

</script>

<!-- Main menu container -->
<menu class:opened={isOpen} data-title={cultureData?.title?.toLowerCase()}>
	{#if menu.link}
		<!-- Render as an anchor tag if it's an external link -->
		<a class="micrio-menu-action" onclick={click} href={menu.link} target={menu.linkTargetBlank ? '_blank' : undefined}>
			<strong>
				{cultureData?.title ?? '(Unknown)'}
				<Icon style="opacity:.75" name={menu.linkTargetBlank ? 'link-ext' : 'link'} /> <!-- Link icon -->
			</strong>
		</a>
	{:else}
		<!-- Render as a button otherwise -->
		<button class="micrio-menu-action" type="button" onclick={click} bind:this={_button}>
			<!-- Optional Font Awesome icon -->
			{#if menu.icon}<Fa icon={menu.icon} style="margin-right:10px;" />{/if}
			<strong>
				{cultureData?.title ?? '(Unknown)'}
				<!-- Chevron icon indicates children -->
				{#if menu.children && menu.children.length}<Icon name="chevron-down" />{/if}
			</strong>
		</button>
	{/if}
	<!-- Render child menu items recursively -->
	{#if menu.children && menu.children.length}
		<div class="items">
			{#each menu.children as child,i (i+child.id)}
				<!-- Pass originalId down for correct image switching -->
				<Menu menu={child} {originalId} onclose={close} />
			{/each}
		</div>
	{/if}
</menu>

<style>
	menu {
		padding: 0;
		margin: 0;
		transition: background .2s ease, box-shadow .2s ease;
	}
	/* Styling for the main button/link element */
	.micrio-menu-action {
		font-family: inherit;
		background: transparent;
		display: block;
		border: none;
		padding: 0 24px;
		font-size: .9em;
		cursor: pointer;
		text-decoration: none;
		border-radius: 0;
		color: inherit;
		text-shadow: inherit;
		box-sizing: border-box;
		text-align: center;
	}

	/* Mobile-specific styles */
	@media (max-width: 500px) {
		menu {
			font-size: 1em;
		}
		.micrio-menu-action {
			width: 100%;
			margin-bottom: 10px;
			padding: 6px 0;
		}

		/* Hide dropdown chevron on mobile */
		strong > :global(svg) {
			display: none;
		}

		/* Adjust font size for nested items on mobile */
		:global(.items) > menu > .micrio-menu-action {
			font-size: 1em;
		}
		/* Special styling for top-level menu items within the toolbar on mobile */
		:global(menu.micrio-toolbar) > menu > .micrio-menu-action {
			font-size: 1.5em;
			border-bottom: 1px solid rgba(255,255,255,.5);
			margin-top: 24px;
		}
	}

	/* Desktop-specific styles */
	@media (min-width: 501px) {
		/* Allow scrolling for long dropdowns */
		div.items {
			max-height: calc(100vh - 160px);
			overflow-y: auto;
			overflow-x: hidden;
		}
		/* Styling for top-level menu items within the toolbar */
		:global(menu.micrio-toolbar) > menu {
			color: #fff;
			margin-right: var(--micrio-border-margin);
			border-radius: var(--micrio-border-radius);
			overflow: hidden; /* Hide dropdown initially */
		}
		/* Apply background/shadow on hover/focus for top-level items */
		:global(menu.micrio-toolbar) > menu:hover,
		:global(menu.micrio-toolbar) > menu:focus-within {
			backdrop-filter: var(--micrio-background-filter);
			background: var(--micrio-background);
			box-shadow: var(--micrio-button-shadow);
		}
		:global(menu.micrio-toolbar) > menu > .micrio-menu-action {
			position: relative; /* Needed for absolute positioning of dropdown */
		}
		:global(menu.micrio-toolbar) > menu > .micrio-menu-action > strong {
			padding: 5px;
			margin: 0 -5px; /* Adjust padding visually */
		}
		/* Change text color on hover/focus for top-level items */
		:global(menu.micrio-toolbar) > menu:hover .micrio-menu-action,
		:global(menu.micrio-toolbar) > menu:focus-within .micrio-menu-action {
			text-shadow: none;
			color: var(--micrio-color);
		}
		/* Chevron icon styling */
		strong > :global(svg) {
			margin-left: 10px;
			line-height: 2px; /* Adjust vertical alignment */
		}
		/* Basic menu layout */
		menu {
			float: left; /* Arrange horizontally */
			position: relative; /* Position dropdown relative to this */
		}
		/* Hide dropdown items when menu is not focused or hovered */
		menu:not(:focus-within):not(:hover) .items {
			display: none;
		}
		/* Button/link styling within dropdown */
		.micrio-menu-action {
			height: var(--micrio-button-size);
			line-height: var(--micrio-button-size);
			width: 100%;
			text-align: var(--micrio-text-align);
			white-space: pre; /* Prevent wrapping */
			font-weight: 600;
		}
		/* Reset float for items within dropdown */
		:global(.items) menu {
			float: none;
		}
		:global(.items) .micrio-menu-action {
			width: 100%;
		}
		/* Apply hover color */
		.micrio-menu-action:hover,
		.micrio-menu-action:focus {
			text-shadow: none !important;
			color: var(--micrio-color-hover) !important;
		}
	}
</style>
