<script lang="ts">
	/**
	 * Logo.svelte - Displays the Micrio logo in the top-left corner.
	 *
	 * This component renders the animated Micrio logo, which links to micr.io.
	 * It hides itself when a tour or marker is active and shows a loading
	 * animation based on the main `micrio.loading` store.
	 */

	import type { HTMLMicrioElement } from '../../ts/element';

	import { getContext, onMount } from 'svelte';
	import { fade } from 'svelte/transition';

	// --- Context & State ---

	/** Get the main Micrio element instance from context. */
	const micrio = <HTMLMicrioElement>getContext('micrio');
	/** Destructure needed state stores. */
	const { tour, marker } = micrio.state;

	/** Determine link target: _blank if embedded or not on micr.io, otherwise undefined. */
	const target = !/micr\.io/.test(location.origin) || self.parent != self
		? '_blank'
		: undefined;

	/** Local state tracking if the main Micrio instance is loading. */
	let loading:boolean = $state(false);
	/** Timeout ID for delaying the loading animation start. */
	let to:any;

	// --- Lifecycle (onMount) ---

	onMount(() => {
		// Subscribe to the global loading state
		const unsub = micrio.loading.subscribe(l => {
			clearTimeout(to); // Clear previous timeout
			if(!l) { // If loading finished
				loading = false; // Immediately set loading to false
			} else if(!loading) { // If loading started and not already animating
				// Delay showing the loading animation slightly
				to = setTimeout(() => loading = true, 750);
			}
		});
		// Cleanup subscription on destroy
		return unsub;
	});

	// --- Reactive Declarations (`$:`) ---

	/** Reactive flag to hide the logo when a tour or marker is active. */
	let hidden = $derived(!!$tour || !!$marker);

</script>

<!-- Render the logo link only if not hidden -->
{#if !hidden}
	<!-- Fade in/out -->
	<!-- Apply loading class for animation -->
	<!-- Set link target -->
	<a
		rel="noopener"
		href="https://micr.io/"
		transition:fade={{duration: 200}}
		title="Powered by Micrio"
		aria-label="Micrio homepage"
		class:loading
		{target}
	>
		<!-- Logo is rendered using CSS pseudo-elements ::before and ::after -->
	</a>
{/if}

<style>
	a {
		/* Positioning */
		position: absolute;
		top: calc(var(--micrio-border-margin) * 2);
		left: calc(var(--micrio-border-margin) * 2);
		z-index: 2; /* Above canvas, potentially below toolbar */

		/* Size */
		width: 22px;
		height: 22px;

		/* Appearance & Interaction */
		transition: transform .25s ease; /* Rotate on hover */
		display: block;
		cursor: pointer;
	}

	/* Hover effect */
	a:hover {
		transform: rotate3d(0,0,1,-90deg);
	}

	/* Logo elements using pseudo-elements */
	a::before, a::after {
		display: block;
		content: '';
		position: absolute;
		transform: rotate3d(0,0,1,45deg); /* Initial rotation */
		will-change: transform; /* Optimize animation */
		box-sizing: unset; /* Ensure border adds to size */
	}

	/* Outer square */
	a::before {
		border: 3px solid #00d4ee; /* Micrio blue */
		width: 16px;
		height: 16px;
	}
	/* Apply spinning animation when loading */
	a.loading::before {
		animation: spin 1s infinite ease-out;
	}

	/* Inner square */
	a::after {
		top: 8px; /* Position inside outer square */
		left: 8px;
		width: 6px;
		height: 6px;
		background: #c5ff5b; /* Micrio green */
		outline: 1px solid #c5ff5b; /* Ensure visibility on light backgrounds */
	}
	/* Apply faster spinning animation to inner square when loading */
	a.loading::after {
		animation: spin .5s infinite ease-out;
	}

	/* Spinning animation keyframes */
	@keyframes spin {
		from {
			transform: rotate3d(0,0,1,45deg);
		}
		to {
			/* Rotate 90 degrees further */
			transform: rotate3d(0,0,1,135deg);
		}
	}
</style>
