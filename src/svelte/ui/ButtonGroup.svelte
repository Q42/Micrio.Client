<script lang="ts">
	/**
	 * ButtonGroup.svelte - A simple container for grouping buttons vertically.
	 *
	 * Provides styling to visually group buttons, typically used for zoom controls,
	 * fullscreen button, etc., within the main Controls component.
	 * It applies shared background, shadow, and border-radius, while adjusting
	 * the border-radius of the first and last child buttons.
	 */

	/** Optional additional CSS class name for the container div. */
	export let className:string = '';

</script>

<!-- Main container div -->
<div class={className}><slot /></div>

<style>
	div {
		/* Apply shared styling from CSS variables */
		box-shadow: var(--micrio-button-shadow);
		border-radius: var(--micrio-border-radius);
		backdrop-filter: var(--micrio-background-filter);
		background: var(--micrio-button-background, var(--micrio-background, none));
	}
	/* Hide the group if it contains no buttons */
	div:empty {
		display: none;
	}
	/* Styling for direct Button children */
	div > :global(.micrio-button) {
		display: block; /* Stack buttons vertically */
		box-shadow: none; /* Remove individual button shadow */
		/* Remove individual button background/filter */
		--micrio-background-filter: none;
		--micrio-button-background: none;
	}
	/* Remove border-radius from middle buttons */
	div :global(.micrio-button) {
		border-radius: 0;
	}
	/* Apply top border-radius to the first button */
	div :global(.micrio-button:first-child) {
		border-radius: var(--micrio-border-radius) var(--micrio-border-radius) 0 0;
	}
	/* Apply bottom border-radius to the last button */
	div :global(.micrio-button:last-child) {
		border-radius: 0 0 var(--micrio-border-radius) var(--micrio-border-radius);
	}

	/* Minor adjustments for mobile (potentially related to touch target size) */
	@media (max-width: 500px) {
		div > :global(*) {
			/* Slightly reduce height? */
			height: calc(var(--micrio-button-size) - 4px);
		}
		/* Remove potential extra padding on mobile? */
		div :global(.micrio-button:first-child) {
			padding-top: 0;
		}
		div :global(.micrio-button:last-child) {
			padding-bottom: 0;
		}
	}
</style>
