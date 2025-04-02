<script lang="ts">
	/**
	 * Details.svelte - Displays image title, description, size, and source link.
	 *
	 * This component uses the HTML <details> element to show basic image information,
	 * typically positioned in the bottom-left corner. It's controlled by the
	 * `showInfo` setting in the image configuration.
	 */

	import type { Readable, Writable } from 'svelte/store';
	import type { Models } from '../../types/models';
	import type { HTMLMicrioElement } from '../../ts/element';

	import { getContext, onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { i18n } from '../../ts/i18n';

	import Button from '../ui/Button.svelte';

	// --- Props ---

	/** Readable store containing the ImageInfo object for the current image. */
	export let info:Readable<Models.ImageInfo.ImageInfo|undefined>;
	/** Writable store containing the ImageData object for the current image. */
	export let data:Writable<Models.ImageData.ImageData|undefined>;

	// --- Context & State ---

	/** Get the main Micrio element instance and relevant stores from context. */
	const { _lang, current } = <HTMLMicrioElement>getContext('micrio');

	/** Local state to track if the details element is open. */
	let opened = false;

	// --- Helper Functions ---

	/**
	 * Formats a length in centimeters into a more readable unit (mm, cm, m, km, µm, nm).
	 * @param length Length in centimeters.
	 * @returns Formatted string with unit (e.g., "12.34 cm", "1.50 m").
	 */
	function getLength(length:number) : string {
		let unit = 'cm';

		// Convert to larger or smaller units based on magnitude
		if (length >= 1e5) { unit = 'km'; length /= 1e5; } else
		if (length >= 100) { unit = 'm'; length /= 100; } else
		// Handle very small values
		if (length < 1/1e6) { unit = 'nm'; length *= 1e7; } else
		if (length < 1/1e3) { unit = 'µm'; length *= 1e4; } else
		if (length < 1) { unit = 'mm'; length *= 10; }

		// Return formatted string with 2 decimal places and the unit
		return length.toFixed(2) + ' ' + unit;
	}

	// --- Reactive Declarations (`$:`) ---

	/** Get physical dimensions from current image settings. */
	$: cmWidth = $current?.$settings.cmWidth;
	$: cmHeight = $current?.$settings.cmHeight;

	/** Get the language-specific content from the ImageData store. */
	$: cData = !$data ? undefined : $data?.i18n ? $data.i18n[$_lang] : $data as Models.ImageData.ImageDetailsCultureData;

	/** Reactive title, preferring language-specific data over base info. */
	$: title = cData?.title ?? $info?.title ?? '';
	/** Reactive description from language-specific data. */
	$: description = cData?.description;
	/** Reactive source link from language-specific data. */
	$: link = cData?.sourceUrl;
	/** Reactive copyright text from language-specific data. */
	$: copyright = cData?.copyright;

	/** Reactive formatted size string based on physical dimensions. */
	$: size = cmWidth && cmHeight ? getLength(cmWidth) + ' x ' + getLength(cmHeight) : null;

	// --- Lifecycle ---

	/** Reference to the <details> DOM element. */
	let _element:HTMLDetailsElement;
	/** Update the local `opened` state when the details element is toggled by the user. */
	onMount(() => { _element.ontoggle = () => { opened = _element.open; } });

</script>

<!-- Render the details element only if there's content to display -->
{#if title || description || link}
	<details class:opened transition:fade={{duration: 200}} bind:this={_element}>
		<!-- Summary section: shows title and/or size -->
		{#if title || size}
			<summary>
				{#if title}<cite>{title}</cite>{/if}
				{#if size}<small>{size}</small>{/if}
			</summary>
		{/if}
		<!-- Description section (rendered as HTML) -->
		{#if description}
			{@html description}
		{/if}
		<!-- Link section: shows source URL or copyright text as a link -->
		{#if link}
			<p><a rel="noopener noreferrer" href={link} target="_blank">{copyright || link}</a></p>
		{/if}
		<!-- Close button (only shown when details are open) -->
		{#if opened}
			<Button type="close" title={$i18n.close} on:click={() => _element.open = false} />
		{/if}
	</details>
{/if}

<style>
	details {
		/* Positioning and basic appearance */
		position: absolute;
		bottom: var(--micrio-border-margin);
		left: var(--micrio-border-margin);
		padding: var(--micrio-popup-padding);
		font-size: .9em;
		max-width: 410px;
		user-select: text; /* Allow text selection */
		white-space: normal; /* Allow text wrapping */
		transition: all .5s ease;
		box-sizing: border-box;
		color: var(--micrio-color);
		background: var(--micrio-background);
		backdrop-filter: var(--micrio-background-filter);
		box-shadow: var(--micrio-popup-shadow);
		border-radius: var(--micrio-border-radius);
	}

	details summary {
		cursor: pointer; /* Indicate it's clickable */
		list-style: none; /* Remove default marker in some browsers */
	}
	/* Hide default marker in Webkit */
	details summary::-webkit-details-marker {
		display: none;
	}

	details small {
		/* Styling for the size text */
		display: block;
		font-style: italic;
		font-weight: normal;
	}

	details > * {
		/* Basic styling for direct children */
		margin: 0;
		overflow: hidden; /* Prevent content overflow */
		text-overflow: ellipsis; /* Add ellipsis for long text */
	}

	details :global(a) {
		/* Styling for links within the details content */
		color: var(--micrio-color-hover, inherit); /* Use hover color or inherit */
	}

	details :global(button) {
		/* Positioning for the close button */
		position: absolute;
		top: 0;
		left: calc(100% + 8px); /* Position to the right */
	}

	/* Responsive adjustments for smaller screens */
	@media (max-width: 600px) {
		details {
			max-width: calc(100% - 10px); /* Adjust max width */
		}
		/* Hide title when closed on small screens */
		details:not([open]) cite {
			display: none;
		}
		/* Show a '?' marker when closed on small screens */
		details:not([open]) summary::marker,
		details:not([open]) summary::-webkit-details-marker {
			display: inline-block; /* Ensure marker shows */
			content: '?';
			font-size: 20px;
			font-weight: bold;
			line-height: 20px;
			margin-right: 5px; /* Add some spacing */
		}
		/* Reposition close button for small screens */
		details :global(button) {
			position: absolute;
			top: auto;
			left: auto;
			right: 0;
			bottom: calc(100% + 8px); /* Position above */
		}
	}

</style>
