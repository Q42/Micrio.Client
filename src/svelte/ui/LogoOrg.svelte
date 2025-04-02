<script lang="ts">
	/**
	 * LogoOrg.svelte - Displays the organization logo in the top-right corner.
	 *
	 * Renders the logo provided in the image's `organisation` data.
	 * Links to the organization's website (`href`).
	 * Hides itself when a tour, marker, or popover is active.
	 * Includes logic to potentially fetch a specific resolution of the logo image
	 * if it's hosted via Micrio's asset system (using micrioId).
	 */

	import type { HTMLMicrioElement } from '../../ts/element';
	import type { Models } from '../../types/models';

	import { getContext } from 'svelte';
	import { fade } from 'svelte/transition';

	// --- Props ---

	/** The organisation data object containing name, logo, and href. */
	export let organisation:Models.ImageInfo.Organisation;

	// --- Context & State ---

	/** Get the main Micrio element instance from context. */
	const micrio = <HTMLMicrioElement>getContext('micrio');
	/** Destructure needed state stores. */
	const { tour, marker, popover } = micrio.state;

	// --- Helper Functions ---

	/**
	 * Generates the appropriate source URL for the logo image.
	 * If the logo has a `micrioId` and is larger than 1024px, it attempts
	 * to construct a URL for a specific resolution level from Micrio's R2 storage.
	 * Otherwise, it returns the original `src` or the input string directly.
	 * @param img The logo image data object or a string URL.
	 * @returns The calculated image source URL.
	 */
	function getLogoSrc(img:Models.Assets.Image|string) : string {
		if(typeof img == 'string') return img; // Return directly if it's already a string URL

		let l:number=0; // Layer index
		let m = Math.max(img.width,img.height); // Get max dimension
		// Calculate the layer index needed to get a size around or below 1024px
		while(m>1024) {l++;m/=2;}

		// Construct Micrio R2 URL if applicable, otherwise use original src
		return (img.micrioId && img.width > 1024 ? 'https://r2.micr.io/' + img.micrioId + '/'+l+'/0-0.' + (img.isPng?'png':img.isWebP?'webp':'jpg') : img.src);
	}

	// --- Reactive Declarations (`$:`) ---

	/** Reactive flag to hide the logo when a tour, marker, or popover is active. */
	$: hidden = !!$tour || !!$marker || !!$popover;

</script>

<!-- Render the logo link only if not hidden and logo data exists -->
{#if !hidden && organisation.logo}
	<!-- Link to org website or fallback -->
	<!-- Fade in/out -->
	<!-- Tooltip -->
	<!-- Accessibility label -->
	<!-- Always open in new tab -->
	<a
		rel="noopener"
		href={organisation.href ?? '#'}
		transition:fade={{duration: 200}}
		title={organisation.name}
		aria-label="{organisation.name} homepage"
		target="_blank"
	>
		<!-- Render the logo image -->
		<img src={getLogoSrc(organisation.logo)} alt="Logo" />
	</a>
{/if}

<style>
	a {
		/* Positioning in top-right corner */
		position: absolute;
		top: calc(var(--micrio-border-margin) * 2);
		right: calc(var(--micrio-border-margin) * 2);
		z-index: 1; /* Above canvas, potentially below toolbar/popups */
		display: block; /* Ensure proper layout */
	}
	img {
		/* Limit logo height */
		max-height: 64px;
		display: block; /* Remove extra space below image */
	}
</style>
