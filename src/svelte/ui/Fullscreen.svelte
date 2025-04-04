<script lang="ts">
	/**
	 * Fullscreen.svelte - Provides a button to toggle fullscreen mode for a target element.
	 *
	 * Handles browser differences (standard Fullscreen API vs. webkit prefixed)
	 * and manages the button's appearance based on the current fullscreen state.
	 * Optionally hooks/unhooks scroll zoom on the main Micrio element when entering/exiting
	 * fullscreen if the target element is the Micrio instance itself.
	 */

	import type { HTMLMicrioElement } from '../../ts/element';

	import { getContext, onMount } from 'svelte';
	import { Browser } from '../../ts/utils'; // Browser detection utilities
	import { i18n } from '../../ts/i18n'; // For button title translation

	import Button from './Button.svelte'; // Reusable button component

	// --- Props ---

	/** The HTML element to make fullscreen. */
	export let el:HTMLElement;

	// --- Feature Detection & State ---

	/** Check for standard Fullscreen API support. */
	const isNative: boolean = 'requestFullscreen' in el;
	/** Check for webkit prefixed Fullscreen API support (older Safari). */
	const isWebkit:boolean = 'webkitRequestFullscreen' in el;

	/** Get the main Micrio element instance from context. */
	const micrio = getContext<HTMLMicrioElement>('micrio');

	/** Helper function to get the currently active fullscreen element (handles prefixes). */
	const getActiveEl = () : Element | null => isNative ? document.fullscreenElement // Standard API
		/** @ts-ignore Check for webkit prefix */
		: document['webkitFullscreenElement'] ?? null; // Webkit API

	/** Reactive state tracking if the target element `el` is currently fullscreen. */
	let isActive: boolean = getActiveEl() === el; // Use strict equality

	/**
	 * Check if fullscreen is available for this element.
	 * Webkit prefixed API might not allow nested fullscreen elements.
	 */
	const available = isNative || (isWebkit && !getActiveEl());

	/** Small delay helper (Promise-based setTimeout). Used for Safari workaround. */
	const to = () : Promise<void> => new Promise(ok => setTimeout(ok, 500));

	// --- Fullscreen API Interaction ---

	/** Stores the previously active fullscreen element for Safari workaround. */
	let wasActive: Element | null | undefined; // Correct type: Element | null | undefined

	/** Enters fullscreen mode for the target element `el`. */
	async function enter() {
		if(isNative) { // Standard API
			// Safari 16.4+ workaround: Exit existing fullscreen before requesting new one
			wasActive = getActiveEl(); // Store the current fullscreen element (Element | null)
			if(Browser.safari && wasActive) {
				await document.exitFullscreen().then(to); // Exit and wait briefly
			}
			el.requestFullscreen(); // Request fullscreen for the target element
		}
		// Safari <16.4 (webkit prefix)
		else if('webkitRequestFullscreen' in el) {
			// Type assertion needed as TypeScript doesn't know about prefixed methods
			(el['webkitRequestFullscreen'] as unknown as Function)();
		}
	}

	/** Exits fullscreen mode. */
	async function exit() {
		if(isNative) { // Standard API
			await document.exitFullscreen().then(to); // Exit fullscreen and wait briefly
			// Safari workaround: Re-enter fullscreen for the previously active element if needed
			// Check if wasActive is an HTMLElement before calling requestFullscreen
			if(wasActive && wasActive instanceof HTMLElement) wasActive.requestFullscreen();
			wasActive = undefined; // Clear stored element
		}
		// Webkit prefixed API
		else if('webkitExitFullscreen' in document) {
			(document['webkitExitFullscreen'] as unknown as Function)();
		}
	}

	/** Toggles fullscreen mode based on the current `isActive` state. */
	function toggle() {
		if(isActive) exit();
		else enter();
	}

	// --- Scroll Zoom Hooking ---

	/**
	 * Check if scroll zoom needs to be hooked/unhooked.
	 * This is only done if the target element `el` is the main Micrio element
	 * AND scroll zoom wasn't already hooked by default settings.
	 */
	const addScrollZoom = el == micrio && !micrio.events.scrollHooked;

	/** Handles fullscreen change events. Updates `isActive` state and hooks/unhooks scroll zoom if needed. */
	const onchange = () : void => {
		isActive = getActiveEl() === el; // Update active state using strict equality
		// If managing scroll zoom for the main Micrio element
		if(addScrollZoom) {
			if(isActive) micrio.events.hookScroll(); // Hook scroll on entering fullscreen
			else micrio.events.unhookScroll(); // Unhook scroll on exiting fullscreen
		}
	};

	// --- Lifecycle (onMount) ---

	/** Add fullscreen change event listener on mount if API is available. */
	if(available) {
		onMount(() => {
			// Determine the correct event name based on browser prefix
			const evt = isNative ? 'fullscreenchange' : 'webkitfullscreenchange';
			document.addEventListener(evt, onchange);
			// Cleanup: remove listener on component destroy
			return () => document.removeEventListener(evt, onchange);
		});
	}
</script>

<!-- Render the button only if the Fullscreen API is available -->
{#if available}
	<!-- Change icon based on state -->
	<!-- Set accessible title -->
	<!-- Trigger toggle function on click -->
	<Button
		type={isActive ? 'minimize' : 'maximize'}
		title={$i18n.fullscreenToggle}
		on:click={toggle}
	/>
{/if}

<!-- No specific styles needed, inherits from Button -->
